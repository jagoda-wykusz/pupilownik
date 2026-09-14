import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { digestInviteToken, generateClaimSecret, generateInviteToken } from "@/lib/invite-token";
import { createAnonClient, createOwnerWithPet, type OwnerWithPetContext } from "../helpers/auth";
import { getTestEnv } from "../setup";
import type { Database } from "@/db/database.types";

// S-09 Phase 1 — `update_pet_with_instructions`, the owner's edit door.
//
// SECURITY INVOKER, so `pets_update_own` and `care_instructions_update_own` are the
// authorization boundary and the body is only a guard. Two things therefore need covering from
// both directions: the policies must refuse another owner's rows, and the grant layer must
// refuse anon and service_role outright.
//
// Every "what actually landed" check reads the rows back through the OWNING owner's client.
// The function's return value is its own account of what it did, and a test that only read
// that would pass against a function that wrote nothing.

interface InstructionRow {
  id: string;
  title: string;
  body: string | null;
  is_sensitive: boolean;
  sort_order: number;
}

const INSTRUCTION_COLUMNS = "id, title, body, is_sensitive, sort_order";

describe("update_pet_with_instructions — the owner's edit door", () => {
  let anon: SupabaseClient<Database>;
  let a: OwnerWithPetContext;
  let b: OwnerWithPetContext;

  async function instructionsOf(owner: OwnerWithPetContext, petId: string): Promise<InstructionRow[]> {
    const { data, error } = await owner.client
      .from("care_instructions")
      .select(INSTRUCTION_COLUMNS)
      .eq("pet_id", petId)
      .order("sort_order")
      .order("id");
    expect(error).toBeNull();
    return data ?? [];
  }

  async function seedInstruction(
    owner: OwnerWithPetContext,
    petId: string,
    title: string,
    isSensitive: boolean,
    sortOrder: number,
  ): Promise<string> {
    const { data, error } = await owner.client
      .from("care_instructions")
      .insert({ pet_id: petId, title, is_sensitive: isSensitive, sort_order: sortOrder })
      .select("id")
      .single();
    expect(error).toBeNull();
    if (!data) {
      throw new Error(`update-pet test: seeding instruction "${title}" failed`);
    }
    return data.id;
  }

  // A pet covered by a live period on which one slot is genuinely claimed — the state the
  // freeze predicate keys on. Built through the real doors (create_period_with_slots, then
  // claim_slots as anon) rather than by hand-writing claim columns, so the predicate is
  // exercised against rows the product itself would produce.
  async function coverWithClaimedPeriod(owner: OwnerWithPetContext, petId: string): Promise<string> {
    const token = generateInviteToken();
    const { data: period, error: periodError } = await owner.client.rpc("create_period_with_slots", {
      p_title: "Wyjazd",
      p_start_date: "2026-10-01",
      p_end_date: "2026-10-02",
      p_token_digest: await digestInviteToken(token),
      p_pet_ids: [petId],
    });
    expect(periodError).toBeNull();
    if (!period) {
      throw new Error("update-pet test: seeding a covering period failed");
    }

    const { data: slots } = await owner.client
      .from("care_slots")
      .select("id")
      .eq("period_id", period.id)
      .order("slot_date")
      .order("time_of_day")
      .limit(1);
    const slotId = slots?.[0]?.id;
    if (!slotId) {
      throw new Error("update-pet test: the seeded period produced no slots");
    }

    const { error: claimError } = await anon.rpc("claim_slots", {
      p_token: token,
      p_slot_ids: [slotId],
      p_claim_secret: generateClaimSecret(),
      p_name: "Ania",
    });
    expect(claimError).toBeNull();

    return period.id;
  }

  // No explicit return annotation: `ReturnType<SupabaseClient<Database>["rpc"]>` resolves to a
  // different structural instance of PostgrestFilterBuilder than the call site produces, and
  // TS reports them as two unrelated types with the same name. Inference is correct here.
  function update(client: SupabaseClient<Database>, petId: string, instructions: unknown[], name = "Burek") {
    return client.rpc("update_pet_with_instructions", {
      p_pet_id: petId,
      p_name: name,
      p_species: "dog",
      p_breed: "",
      p_age: "",
      p_instructions: instructions as never,
    });
  }

  beforeAll(async () => {
    anon = createAnonClient();
    a = await createOwnerWithPet("A-Burek");
    b = await createOwnerWithPet("B-Mru");
  });

  // ── 1. Grant posture ──────────────────────────────────────────────────────────────────
  describe("grant posture", () => {
    it("an authenticated owner may execute it", async () => {
      const { error } = await update(a.client, a.petId, []);
      expect(error).toBeNull();
    });

    it("anon may NOT execute it, and the refusal names the function", async () => {
      const { error } = await anon.rpc("update_pet_with_instructions", {
        p_pet_id: a.petId,
        p_name: "hacked",
        p_species: "dog",
        p_breed: "",
        p_age: "",
        p_instructions: [] as never,
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      // The message, not just the code. A code-only assertion keeps passing with the grant
      // fully widened to a DIFFERENT function — it only proves that something, somewhere, was
      // refused (context/foundation/lessons.md).
      expect(error?.message).toContain("update_pet_with_instructions");
    });

    it("service_role may NOT execute it", async () => {
      const serviceKey = process.env.SUPABASE_SERVICE_KEY;
      if (!serviceKey) {
        throw new Error("SUPABASE_SERVICE_KEY must be set in .env.test (see .env.test.example).");
      }
      const service = createClient<Database>(getTestEnv().url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { error } = await update(service, a.petId, [], "hacked");

      // Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to service_role on every new
      // function in `public`, so this passes only while the migration's explicit revoke stands.
      expect(error?.code).toBe("42501");
    });
  });

  // ── 2. Scope ──────────────────────────────────────────────────────────────────────────
  describe("scope", () => {
    it("another owner's pet answers NULL and is not mutated", async () => {
      const { data, error } = await update(a.client, b.petId, [], "hacked");

      // Not an error — RLS simply filters the row out, so the guarded UPDATE matches nothing.
      expect(error).toBeNull();
      expect(data).toBeNull();

      const { data: victim } = await b.client.from("pets").select("name").eq("id", b.petId).single();
      expect(victim?.name).toBe("B-Mru");
    });

    it("a pet that does not exist answers NULL, indistinguishable from someone else's", async () => {
      const { data, error } = await update(a.client, crypto.randomUUID(), []);
      expect(error).toBeNull();
      expect(data).toBeNull();
    });
  });

  // ── 3. The instruction sync ───────────────────────────────────────────────────────────
  describe("instruction sync", () => {
    it("updates a named row, inserts an unnamed one, and deletes one the payload omits", async () => {
      const owner = await createOwnerWithPet("Sync");
      const keepId = await seedInstruction(owner, owner.petId, "Karmienie", false, 0);
      const dropId = await seedInstruction(owner, owner.petId, "Do skasowania", false, 1);

      const { data, error } = await update(owner.client, owner.petId, [
        { id: keepId, title: "Karmienie 2x", body: "250g", is_sensitive: false },
        { title: "Nowa", body: "spacer", is_sensitive: true },
      ]);
      expect(error).toBeNull();
      expect(data).toBe(owner.petId);

      const rows = await instructionsOf(owner, owner.petId);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ id: keepId, title: "Karmienie 2x", body: "250g", is_sensitive: false });
      expect(rows[1]).toMatchObject({ title: "Nowa", body: "spacer", is_sensitive: true });
      expect(rows.some((row) => row.id === dropId)).toBe(false);
    });

    it("takes sort_order from array position, not from the payload", async () => {
      const owner = await createOwnerWithPet("Order");
      const firstId = await seedInstruction(owner, owner.petId, "Pierwsza", false, 0);
      const secondId = await seedInstruction(owner, owner.petId, "Druga", false, 1);

      // Sent in the reverse order, and each object additionally carries a sort_order the
      // function must IGNORE — if it honoured the payload, the rows would come back unswapped.
      const { error } = await update(owner.client, owner.petId, [
        { id: secondId, title: "Druga", is_sensitive: false, sort_order: 99 },
        { id: firstId, title: "Pierwsza", is_sensitive: false, sort_order: 98 },
      ]);
      expect(error).toBeNull();

      const rows = await instructionsOf(owner, owner.petId);
      expect(rows.map((row) => row.id)).toEqual([secondId, firstId]);
      expect(rows.map((row) => row.sort_order)).toEqual([0, 1]);
    });

    it("an empty instruction array deletes every row", async () => {
      const owner = await createOwnerWithPet("Empty");
      await seedInstruction(owner, owner.petId, "Zniknie", false, 0);

      const { error } = await update(owner.client, owner.petId, []);
      expect(error).toBeNull();
      expect(await instructionsOf(owner, owner.petId)).toEqual([]);
    });

    it("cannot adopt an instruction belonging to another of the owner's OWN pets", async () => {
      const owner = await createOwnerWithPet("First");
      const { data: second, error: secondError } = await owner.client
        .from("pets")
        .insert({ owner_id: owner.userId, name: "Second", species: "cat" })
        .select("id")
        .single();
      expect(secondError).toBeNull();
      if (!second) {
        throw new Error("update-pet test: seeding a second pet failed");
      }
      const foreignId = await seedInstruction(owner, second.id, "Cudza-ale-moja", false, 0);

      // RLS permits this row — it IS this owner's. Only the `pet_id = p_pet_id` predicate on
      // the child update stands between the payload and adopting it through the wrong pet's
      // endpoint, which is exactly why that redundant-looking predicate is kept.
      const { error } = await update(owner.client, owner.petId, [
        { id: foreignId, title: "przejęta", is_sensitive: false },
      ]);
      expect(error).toBeNull();

      // It was not moved...
      const { data: stillThere } = await owner.client
        .from("care_instructions")
        .select("pet_id, title")
        .eq("id", foreignId)
        .single();
      expect(stillThere).toMatchObject({ pet_id: second.id, title: "Cudza-ale-moja" });

      // ...and it was not silently copied onto the target pet either.
      expect(await instructionsOf(owner, owner.petId)).toEqual([]);
    });
  });

  // ── 4. The freeze ─────────────────────────────────────────────────────────────────────
  //
  // The predicate: an unrevoked period covering this pet with at least one claimed slot. Note
  // it is NOT delete_pet's predicate (Phase 2), which has no claim condition.
  describe("the is_sensitive freeze", () => {
    it("refuses a flip while a claimed live trip covers the pet, and names the rows in DETAIL", async () => {
      const owner = await createOwnerWithPet("Frozen");
      const sensitiveId = await seedInstruction(owner, owner.petId, "Kod bramy", true, 0);
      await coverWithClaimedPeriod(owner, owner.petId);

      const { error } = await update(owner.client, owner.petId, [
        { id: sensitiveId, title: "Kod bramy", is_sensitive: false },
      ]);

      expect(error).not.toBeNull();
      expect(error?.code).toBe("PT409");
      // DETAIL carries a JSON array the route parses — the claim_slots shape.
      expect(JSON.parse(error?.details ?? "[]")).toEqual([sensitiveId]);

      // And nothing landed: the raise rolls the whole call back, including the pets UPDATE
      // that ran before it. A refusal that left the name changed would be worse than none.
      const rows = await instructionsOf(owner, owner.petId);
      expect(rows[0]).toMatchObject({ id: sensitiveId, is_sensitive: true });
      const { data: pet } = await owner.client.from("pets").select("name").eq("id", owner.petId).single();
      expect(pet?.name).toBe("Frozen");
    });

    it("allows editing instruction TEXT while frozen — that is the PRD guardrail", async () => {
      const owner = await createOwnerWithPet("TextEdit");
      const publicId = await seedInstruction(owner, owner.petId, "Karmienie", false, 0);
      const sensitiveId = await seedInstruction(owner, owner.petId, "Kod bramy", true, 1);
      await coverWithClaimedPeriod(owner, owner.petId);

      const { error } = await update(owner.client, owner.petId, [
        { id: publicId, title: "Karmienie 3x dziennie", body: "300g", is_sensitive: false },
        { id: sensitiveId, title: "Kod bramy 9999#", is_sensitive: true },
      ]);
      expect(error).toBeNull();

      const rows = await instructionsOf(owner, owner.petId);
      expect(rows.map((row) => row.title)).toEqual(["Karmienie 3x dziennie", "Kod bramy 9999#"]);
      expect(rows.map((row) => row.is_sensitive)).toEqual([false, true]);
    });

    it("allows a flip when the covering trip has no claim yet", async () => {
      const owner = await createOwnerWithPet("NoClaim");
      const sensitiveId = await seedInstruction(owner, owner.petId, "Kod bramy", true, 0);

      const token = generateInviteToken();
      const { error: periodError } = await owner.client.rpc("create_period_with_slots", {
        p_title: "Bez claimu",
        p_start_date: "2026-11-01",
        p_end_date: "2026-11-02",
        p_token_digest: await digestInviteToken(token),
        p_pet_ids: [owner.petId],
      });
      expect(periodError).toBeNull();

      const { error } = await update(owner.client, owner.petId, [
        { id: sensitiveId, title: "Kod bramy", is_sensitive: false },
      ]);
      expect(error).toBeNull();

      const rows = await instructionsOf(owner, owner.petId);
      expect(rows[0]).toMatchObject({ id: sensitiveId, is_sensitive: false });
    });

    it("allows a flip once the covering trip is revoked", async () => {
      const owner = await createOwnerWithPet("Revoked");
      const sensitiveId = await seedInstruction(owner, owner.petId, "Kod bramy", true, 0);
      const periodId = await coverWithClaimedPeriod(owner, owner.petId);

      const { data: revoked, error: revokeError } = await owner.client.rpc("revoke_period", {
        p_period_id: periodId,
      });
      expect(revokeError).toBeNull();
      expect(revoked).toBe(periodId);

      const { error } = await update(owner.client, owner.petId, [
        { id: sensitiveId, title: "Kod bramy", is_sensitive: false },
      ]);
      expect(error).toBeNull();

      const rows = await instructionsOf(owner, owner.petId);
      expect(rows[0]).toMatchObject({ id: sensitiveId, is_sensitive: false });
    });

    it("does not freeze a NEW row — nothing has been disclosed about a row that did not exist", async () => {
      const owner = await createOwnerWithPet("NewRow");
      const publicId = await seedInstruction(owner, owner.petId, "Karmienie", false, 0);
      await coverWithClaimedPeriod(owner, owner.petId);

      const { error } = await update(owner.client, owner.petId, [
        { id: publicId, title: "Karmienie", is_sensitive: false },
        { title: "Nowy kod bramy", is_sensitive: true },
      ]);
      expect(error).toBeNull();

      const rows = await instructionsOf(owner, owner.petId);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ title: "Nowy kod bramy", is_sensitive: true });
    });

    it("freezes in BOTH directions — public -> sensitive is refused too", async () => {
      const owner = await createOwnerWithPet("BothWays");
      const publicId = await seedInstruction(owner, owner.petId, "Karmienie", false, 0);
      await coverWithClaimedPeriod(owner, owner.petId);

      const { error } = await update(owner.client, owner.petId, [
        { id: publicId, title: "Karmienie", is_sensitive: true },
      ]);

      // Retracting something a caretaker has already read is the milder direction, but the
      // predicate does not distinguish them and this pins that it does not. A one-directional
      // guard would be a different decision, and it is not the one this slice made.
      expect(error?.code).toBe("PT409");
    });
  });
});
