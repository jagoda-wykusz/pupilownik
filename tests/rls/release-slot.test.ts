import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { digestClaimSecret, digestInviteToken, generateClaimSecret, generateInviteToken } from "@/lib/invite-token";
import { createAnonClient, createOwnerWithPet, type OwnerWithPetContext } from "../helpers/auth";
import { getTestEnv } from "../setup";
import type { Database } from "@/db/database.types";

// S-04 Phase 2 — `release_slot`, the owner's inverse of the caretaker's claim.
//
// Unlike claim_slots this function is SECURITY INVOKER, so `care_slots_update_own` is the
// authorization boundary and the body is only a guard. That split is what these assertions
// have to cover from both sides: the policy must refuse another owner's slot, and the grant
// layer must refuse anon and service_role outright.
//
// Every "what actually landed" check reads the row back through the OWNING owner's client —
// the function's return value is its own account of what it did, and a test that only read
// that would pass against a function that wrote nothing.

interface SlotRow {
  id: string;
  slot_date: string;
  time_of_day: string;
  claimed_by_name: string | null;
  claimed_at: string | null;
  claim_digest: string | null;
}

const SLOT_COLUMNS = "id, slot_date, time_of_day, claimed_by_name, claimed_at, claim_digest";

describe("release_slot — the owner's release door", () => {
  let anon: SupabaseClient<Database>;
  let a: OwnerWithPetContext;
  let b: OwnerWithPetContext;

  async function seedPeriod(
    owner: OwnerWithPetContext,
    title: string,
    start: string,
    end: string,
  ): Promise<{ id: string; token: string }> {
    const token = generateInviteToken();
    const { data, error } = await owner.client.rpc("create_period_with_slots", {
      p_title: title,
      p_start_date: start,
      p_end_date: end,
      p_token_digest: await digestInviteToken(token),
      p_pet_ids: [owner.petId],
    });
    expect(error).toBeNull();
    if (!data) {
      throw new Error(`release-slot test: seeding "${title}" failed`);
    }
    return { id: data.id, token };
  }

  async function slotsOf(owner: OwnerWithPetContext, periodId: string): Promise<SlotRow[]> {
    const { data, error } = await owner.client
      .from("care_slots")
      .select(SLOT_COLUMNS)
      .eq("period_id", periodId)
      .order("slot_date")
      .order("time_of_day");
    expect(error).toBeNull();
    return data ?? [];
  }

  // Seed one period and take `count` of its slots with a single fresh capability, so every
  // test below starts from a genuinely claimed row rather than a hand-written one.
  async function seedClaimedPeriod(
    owner: OwnerWithPetContext,
    title: string,
    start: string,
    end: string,
    count = 1,
    name = "Ania",
  ): Promise<{ id: string; token: string; slotIds: string[]; digest: string }> {
    const period = await seedPeriod(owner, title, start, end);
    const secret = generateClaimSecret();
    const digest = await digestClaimSecret(secret);

    const free = (await slotsOf(owner, period.id)).filter((slot) => slot.claimed_by_name === null);
    if (free.length < count) {
      throw new Error(`release-slot test: wanted ${count} free slots in "${title}", found ${free.length}`);
    }
    const slotIds = free.slice(0, count).map((slot) => slot.id);

    const { error } = await anon.rpc("claim_slots", {
      p_token: period.token,
      p_slot_ids: slotIds,
      p_claim_secret: secret,
      p_name: name,
    });
    expect(error).toBeNull();

    return { ...period, slotIds, digest };
  }

  function release(client: SupabaseClient<Database>, periodId: string, slotId: string) {
    return client.rpc("release_slot", { p_period_id: periodId, p_slot_id: slotId });
  }

  beforeAll(async () => {
    anon = createAnonClient();
    a = await createOwnerWithPet("A-Burek");
    b = await createOwnerWithPet("B-Mru");
  });

  // ── 1. Grant posture ────────────────────────────────────────────────────────────────────
  //
  // Asserted from BOTH directions: the owner gets past the permission check, anon and
  // service_role do not. The refusals assert SQLSTATE 42501 rather than an empty result,
  // because a NULL return is also what a permitted-but-unmatched call answers — an assertion
  // on the absence of an effect would keep passing with the whole grant layer removed, which
  // is the anti-pattern context/foundation/lessons.md records.
  describe("grant posture", () => {
    it("an authenticated owner may execute it — this is the owner's door", async () => {
      // A valid-shaped but unknown pair: the function returns NULL from its own body, which
      // proves execution was permitted. A 42501 here means authenticated lost EXECUTE.
      const { data, error } = await release(a.client, crypto.randomUUID(), crypto.randomUUID());

      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    it("anon may NOT execute it — a caretaker cannot free anyone's term", async () => {
      const claimed = await seedClaimedPeriod(a, "A-anon-nie-moze", "2027-01-05", "2027-01-06");

      const { error } = await release(anon, claimed.id, claimed.slotIds[0]);

      // The MESSAGE, not just the SQLSTATE. anon holds no UPDATE grant on care_slots either
      // (verified: has_table_privilege('anon','public.care_slots','update') is false), so
      // granting EXECUTE back to anon moves the identical 42501 one layer inward — "permission
      // denied for TABLE care_slots" — and a code-only assertion keeps passing with the
      // function grant fully widened. Measured: the suite went 8/8 green under
      // `grant execute on function public.release_slot(uuid,uuid) to anon`. Naming the
      // function is what makes this a test of the grant rather than a description of it
      // (context/foundation/lessons.md).
      expect(error?.code).toBe("42501");
      expect(error?.message).toContain("function release_slot");

      // And the term is still taken: the refusal happened before the body ran.
      const slot = (await slotsOf(a, claimed.id)).find((row) => row.id === claimed.slotIds[0]);
      expect(slot?.claimed_by_name).toBe("Ania");
    });

    it("service_role may NOT execute it", async () => {
      const serviceKey = process.env.SUPABASE_SERVICE_KEY;
      if (!serviceKey) {
        throw new Error("SUPABASE_SERVICE_KEY must be set in .env.test (see .env.test.example).");
      }
      const service = createClient<Database>(getTestEnv().url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { error } = await release(service, crypto.randomUUID(), crypto.randomUUID());

      // Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to service_role on every new
      // function in `public`, so this passes only while the migration's explicit revoke stands.
      expect(error?.code).toBe("42501");
    });
  });

  // ── 2. The release itself ───────────────────────────────────────────────────────────────
  describe("releasing", () => {
    it("frees the owner's own claimed slot, nulling all three claim columns together", async () => {
      const claimed = await seedClaimedPeriod(a, "A-zwolnij", "2027-01-10", "2027-01-12", 2);
      const [target, keep] = claimed.slotIds;

      const { data, error } = await release(a.client, claimed.id, target);

      expect(error).toBeNull();
      expect(data).toBe(target);

      const rows = await slotsOf(a, claimed.id);
      const freed = rows.find((row) => row.id === target);
      // All three, read back from the table. care_slots_claim_complete makes the triple
      // all-or-nothing per row, but this asserts the function actually writes all three rather
      // than leaning on the constraint's promise.
      expect(freed?.claimed_by_name).toBeNull();
      expect(freed?.claimed_at).toBeNull();
      expect(freed?.claim_digest).toBeNull();

      // Scoped to ONE slot: the caretaker's other term is untouched, so this is a release and
      // not an accidental "free everything this capability holds".
      const untouched = rows.find((row) => row.id === keep);
      expect(untouched?.claimed_by_name).toBe("Ania");
      expect(untouched?.claim_digest).toBe(claimed.digest);
    });

    it("answers NULL on a second release of the same slot and changes nothing", async () => {
      const claimed = await seedClaimedPeriod(a, "A-dwa-razy", "2027-01-15", "2027-01-16");
      const target = claimed.slotIds[0];

      expect((await release(a.client, claimed.id, target)).error).toBeNull();

      const { data, error } = await release(a.client, claimed.id, target);

      // `claimed_at is not null` in the WHERE turns the second call into a no-op that reports
      // itself honestly, rather than an error the route would have to classify.
      expect(error).toBeNull();
      expect(data).toBeNull();

      const freed = (await slotsOf(a, claimed.id)).find((row) => row.id === target);
      expect(freed?.claimed_by_name).toBeNull();
    });

    it("answers NULL for another owner's slot and leaves it claimed", async () => {
      const theirs = await seedClaimedPeriod(b, "B-cudze", "2027-02-01", "2027-02-02");
      const target = theirs.slotIds[0];

      const { data, error } = await release(a.client, theirs.id, target);

      // care_slots_update_own filtered the row out. Same NULL as "already free" — A learns
      // nothing about whether B's period or slot exists.
      expect(error).toBeNull();
      expect(data).toBeNull();

      const slot = (await slotsOf(b, theirs.id)).find((row) => row.id === target);
      expect(slot?.claimed_by_name).toBe("Ania");
      expect(slot?.claimed_at).not.toBeNull();
      expect(slot?.claim_digest).toBe(theirs.digest);
    });

    it("answers NULL when the slot belongs to a DIFFERENT period of the same owner", async () => {
      // The `period_id = p_period_id` predicate is redundant with RLS — both periods are A's,
      // so the policy permits the write either way. This is the only assertion that would
      // notice if that predicate were dropped, and it is why the route's URL and the guard
      // agree on which trip a slot belongs to.
      const one = await seedClaimedPeriod(a, "A-wyjazd-jeden", "2027-03-01", "2027-03-02");
      const two = await seedClaimedPeriod(a, "A-wyjazd-dwa", "2027-03-10", "2027-03-11");

      const { data, error } = await release(a.client, one.id, two.slotIds[0]);

      expect(error).toBeNull();
      expect(data).toBeNull();

      const slot = (await slotsOf(a, two.id)).find((row) => row.id === two.slotIds[0]);
      expect(slot?.claimed_by_name).toBe("Ania");
    });

    it("leaves a released term immediately claimable again through the invite link", async () => {
      const claimed = await seedClaimedPeriod(a, "A-znowu-wolne", "2027-04-01", "2027-04-02");
      const target = claimed.slotIds[0];

      expect((await release(a.client, claimed.id, target)).error).toBeNull();

      // A DIFFERENT caretaker, with their own capability — the point of the release is that
      // the freed term goes back on the market for whoever holds the link next.
      const secret = generateClaimSecret();
      const digest = await digestClaimSecret(secret);
      const { error } = await anon.rpc("claim_slots", {
        p_token: claimed.token,
        p_slot_ids: [target],
        p_claim_secret: secret,
        p_name: "Basia",
      });

      expect(error).toBeNull();

      const slot = (await slotsOf(a, claimed.id)).find((row) => row.id === target);
      expect(slot?.claimed_by_name).toBe("Basia");
      expect(slot?.claim_digest).toBe(digest);
      expect(slot?.claimed_at).not.toBeNull();
    });
  });
});
