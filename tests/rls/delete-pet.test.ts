import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { digestInviteToken, generateInviteToken } from "@/lib/invite-token";
import { createAnonClient, createOwnerWithPet, type OwnerWithPetContext } from "../helpers/auth";
import { getTestEnv } from "../setup";
import type { Database } from "@/db/database.types";

// S-09 Phase 2 — `delete_pet`, the owner's remove door and the refusal that is the point of it.
//
// SECURITY INVOKER, so `pets_delete_own` is the authorization boundary and the body is only a
// guard. Two directions therefore need covering: the policy must refuse another owner's row,
// and the grant layer must refuse anon and service_role outright.
//
// Every negative is paired with a row-count probe read back through the OWNING owner's client.
// A status or an error code on its own cannot tell a refusal apart from a delete that happened
// and then reported failure — and the whole reason this function exists is that the cascade is
// silent (context/foundation/lessons.md: a passing assertion is not a guard unless it fails
// when the guarded behaviour disappears).
//
// THE PREDICATE IS `revoked_at is null`, WITH NO CLAIM CONDITION. That is deliberately NOT
// update_pet_with_instructions' freeze predicate, which additionally requires a claimed slot.
// A live trip nobody has claimed yet is still a trip whose caretaker may claim it tomorrow, so
// "no claim yet" is covered here as a REFUSAL while the sibling suite covers it as a permit.

describe("delete_pet — the owner's remove door", () => {
  let anon: SupabaseClient<Database>;
  let a: OwnerWithPetContext;
  let b: OwnerWithPetContext;

  async function petExists(owner: OwnerWithPetContext, petId: string): Promise<boolean> {
    const { data, error } = await owner.client.from("pets").select("id").eq("id", petId);
    expect(error).toBeNull();
    return (data ?? []).length === 1;
  }

  async function seedInstruction(owner: OwnerWithPetContext, petId: string, title: string): Promise<string> {
    const { data, error } = await owner.client
      .from("care_instructions")
      .insert({ pet_id: petId, title, is_sensitive: false, sort_order: 0 })
      .select("id")
      .single();
    expect(error).toBeNull();
    if (!data) {
      throw new Error(`delete-pet test: seeding instruction "${title}" failed`);
    }
    return data.id;
  }

  // A period covering the pet, built through the real door (create_period_with_slots) rather
  // than by hand-writing the link row, so the guard is exercised against rows the product
  // itself produces. No claim is made: the delete-block does not need one.
  async function coverWithPeriod(owner: OwnerWithPetContext, petId: string, title: string): Promise<string> {
    const { data, error } = await owner.client.rpc("create_period_with_slots", {
      p_title: title,
      p_start_date: "2026-10-01",
      p_end_date: "2026-10-02",
      p_token_digest: await digestInviteToken(generateInviteToken()),
      p_pet_ids: [petId],
    });
    expect(error).toBeNull();
    if (!data) {
      throw new Error("delete-pet test: seeding a covering period failed");
    }
    return data.id;
  }

  function remove(client: SupabaseClient<Database>, petId: string) {
    return client.rpc("delete_pet", { p_pet_id: petId });
  }

  beforeAll(async () => {
    anon = createAnonClient();
    a = await createOwnerWithPet("A-Burek");
    b = await createOwnerWithPet("B-Mru");
  });

  // ── 1. Grant posture ──────────────────────────────────────────────────────────────────
  describe("grant posture", () => {
    it("an authenticated owner may execute it", async () => {
      const owner = await createOwnerWithPet("Grant");
      const { error } = await remove(owner.client, owner.petId);
      expect(error).toBeNull();
    });

    it("anon may NOT execute it, and the refusal names the function", async () => {
      const { error } = await anon.rpc("delete_pet", { p_pet_id: a.petId });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      // The message, not just the code. The same SQLSTATE arrives from the table layer, so a
      // code-only assertion proves only that something, somewhere, was refused — it keeps
      // passing with this grant fully widened (context/foundation/lessons.md).
      expect(error?.message).toContain("delete_pet");
      expect(await petExists(a, a.petId)).toBe(true);
    });

    it("service_role may NOT execute it", async () => {
      const serviceKey = process.env.SUPABASE_SERVICE_KEY;
      if (!serviceKey) {
        throw new Error("SUPABASE_SERVICE_KEY must be set in .env.test (see .env.test.example).");
      }
      const service = createClient<Database>(getTestEnv().url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { error } = await remove(service, a.petId);

      // Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to service_role on every new
      // function in `public`, so this passes only while the migration's explicit revoke stands.
      expect(error?.code).toBe("42501");
      expect(await petExists(a, a.petId)).toBe(true);
    });
  });

  // ── 2. Scope ──────────────────────────────────────────────────────────────────────────
  describe("scope", () => {
    it("another owner's pet answers NULL and survives", async () => {
      const { data, error } = await remove(a.client, b.petId);

      // Not an error — RLS simply filters the row out, so the guarded DELETE matches nothing.
      expect(error).toBeNull();
      expect(data).toBeNull();
      expect(await petExists(b, b.petId)).toBe(true);
    });

    it("a pet that does not exist answers NULL, indistinguishable from someone else's", async () => {
      const { data, error } = await remove(a.client, crypto.randomUUID());
      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    it("a STRANGER's covered pet answers NULL, not PT409 — the refusal leaks no trip", async () => {
      const victim = await createOwnerWithPet("Victim");
      await coverWithPeriod(victim, victim.petId, "Sekretny wyjazd");

      const { data, error } = await remove(a.client, victim.petId);

      // The blocker query runs under the CALLER's RLS, so it finds nothing here and the call
      // falls through to the delete, which also finds nothing. If it were security definer — or
      // if the guard read the link table outside RLS — a stranger would learn from the 409 both
      // that the pet exists and that a trip covers it.
      expect(error).toBeNull();
      expect(data).toBeNull();
      expect(await petExists(victim, victim.petId)).toBe(true);
    });
  });

  // ── 3. The delete, and what goes with it ──────────────────────────────────────────────
  describe("deleting an uncovered pet", () => {
    it("removes the pet and cascades its care instructions", async () => {
      const owner = await createOwnerWithPet("Uncovered");
      const instructionId = await seedInstruction(owner, owner.petId, "Karmienie");

      const { data, error } = await remove(owner.client, owner.petId);
      expect(error).toBeNull();
      expect(data).toBe(owner.petId);

      expect(await petExists(owner, owner.petId)).toBe(false);
      const { data: rows } = await owner.client.from("care_instructions").select("id").eq("id", instructionId);
      expect(rows ?? []).toEqual([]);
    });

    it("deletes a pet covered ONLY by an already-revoked trip", async () => {
      const owner = await createOwnerWithPet("OnlyRevoked");
      const periodId = await coverWithPeriod(owner, owner.petId, "Odwołany");
      const { error: revokeError } = await owner.client.rpc("revoke_period", { p_period_id: periodId });
      expect(revokeError).toBeNull();

      const { data, error } = await remove(owner.client, owner.petId);
      expect(error).toBeNull();
      expect(data).toBe(owner.petId);
      expect(await petExists(owner, owner.petId)).toBe(false);
    });
  });

  // ── 4. The refusal ────────────────────────────────────────────────────────────────────
  describe("the live-trip block", () => {
    it("refuses while an unrevoked trip covers the pet, names it in DETAIL, and the pet survives", async () => {
      const owner = await createOwnerWithPet("Blocked");
      const instructionId = await seedInstruction(owner, owner.petId, "Karmienie");
      const periodId = await coverWithPeriod(owner, owner.petId, "Majówka");

      const { error } = await remove(owner.client, owner.petId);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("PT409");
      // DETAIL carries JSON the route parses — {id, title} per blocking trip, because the
      // route's sentence has to name the trip the owner must revoke.
      expect(JSON.parse(error?.details ?? "[]")).toEqual([{ id: periodId, title: "Majówka" }]);

      // The assertion that makes this a guard rather than a description: the pet, and its
      // instructions, are STILL THERE. The measured failure mode this function exists to stop
      // is a delete that succeeds silently while the trip and the claim survive it.
      expect(await petExists(owner, owner.petId)).toBe(true);
      const { data: rows } = await owner.client.from("care_instructions").select("id").eq("id", instructionId);
      expect((rows ?? []).map((row) => row.id)).toEqual([instructionId]);
    });

    it("refuses even with NO claim on the trip — this is not the freeze predicate", async () => {
      const owner = await createOwnerWithPet("NoClaim");
      await coverWithPeriod(owner, owner.petId, "Nikt nie zajął");

      const { error } = await remove(owner.client, owner.petId);

      // update_pet_with_instructions ALLOWS an is_sensitive flip in exactly this state
      // (tests/rls/update-pet.test.ts, "allows a flip when the covering trip has no claim
      // yet"). The two predicates read alike and are not alike; this pins the difference from
      // the delete side, so a later slice cannot "unify" them without turning a test red.
      expect(error?.code).toBe("PT409");
      expect(await petExists(owner, owner.petId)).toBe(true);
    });

    it("names every blocking trip, not just the first", async () => {
      const owner = await createOwnerWithPet("TwoTrips");
      const first = await coverWithPeriod(owner, owner.petId, "Wyjazd A");
      const second = await coverWithPeriod(owner, owner.petId, "Wyjazd B");

      const { error } = await remove(owner.client, owner.petId);

      expect(error?.code).toBe("PT409");
      const blockers: unknown = JSON.parse(error?.details ?? "[]");
      expect(Array.isArray(blockers) ? blockers.length : 0).toBe(2);
      const ids = (blockers as { id: string }[]).map((row) => row.id).sort();
      expect(ids).toEqual([first, second].sort());
    });

    it("ignores a revoked trip when another live one blocks — and vice versa", async () => {
      const owner = await createOwnerWithPet("Mixed");
      const revoked = await coverWithPeriod(owner, owner.petId, "Odwołany");
      const live = await coverWithPeriod(owner, owner.petId, "Żywy");
      await owner.client.rpc("revoke_period", { p_period_id: revoked });

      const { error } = await remove(owner.client, owner.petId);

      expect(error?.code).toBe("PT409");
      // Only the live one is named. A guard that counted revoked trips too would tell the owner
      // to revoke something already revoked — an instruction with no next step.
      expect(JSON.parse(error?.details ?? "[]")).toEqual([{ id: live, title: "Żywy" }]);
    });

    it("deletes once the blocking trip is revoked — the remedy the refusal names actually works", async () => {
      const owner = await createOwnerWithPet("Remedy");
      const periodId = await coverWithPeriod(owner, owner.petId, "Do odwołania");

      const blocked = await remove(owner.client, owner.petId);
      expect(blocked.error?.code).toBe("PT409");

      const { data: revoked, error: revokeError } = await owner.client.rpc("revoke_period", {
        p_period_id: periodId,
      });
      expect(revokeError).toBeNull();
      expect(revoked).toBe(periodId);

      const { data, error } = await remove(owner.client, owner.petId);
      expect(error).toBeNull();
      expect(data).toBe(owner.petId);
      expect(await petExists(owner, owner.petId)).toBe(false);
    });
  });
});
