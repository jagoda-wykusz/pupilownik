import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { digestClaimSecret, digestInviteToken, generateClaimSecret, generateInviteToken } from "@/lib/invite-token";
import { createAnonClient, createOwnerWithPet, type OwnerWithPetContext } from "../helpers/auth";
import { getTestEnv } from "../setup";
import type { Database } from "@/db/database.types";

// Risk #3 (atomic claim) and Risk #5 (link-only scope) — S-03 Phase 2.
//
// `claim_slots` is the first anon-reachable WRITE in this schema. It is SECURITY DEFINER, so
// it bypasses RLS by design and there is no policy behind it to catch a mistake in its body:
// these assertions are its only automated guard, exactly as they are for get_period_by_token.
//
// Every caretaker call goes through createAnonClient() — no session, the `anon` role, which
// is what someone following an invite link actually is. State is read back through the
// OWNER's client, because anon holds no grant on care_slots at all.

interface ClaimReceipt {
  period_id: string;
  end_date: string;
  name: string;
  claimed_count: number;
  slot_ids: string[];
}

interface SlotRow {
  id: string;
  slot_date: string;
  time_of_day: string;
  claimed_by_name: string | null;
  claimed_at: string | null;
  claim_digest: string | null;
}

const SLOT_COLUMNS = "id, slot_date, time_of_day, claimed_by_name, claimed_at, claim_digest";

describe("claim_slots — the caretaker write door", () => {
  let anon: SupabaseClient<Database>;
  let a: OwnerWithPetContext;
  let b: OwnerWithPetContext;

  let aToken: string;
  let aPeriodId: string;
  let bToken: string;
  let bPeriodId: string;
  let revokedToken: string;
  let revokedPeriodId: string;

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
      throw new Error(`claim-slots test: seeding "${title}" failed`);
    }
    return { id: data.id, token };
  }

  // Read the period's slots back as the OWNER. This is the assertion surface for every
  // "what actually landed" check — the claim receipt is the function's own account of what it
  // did, and a test that only reads the receipt would pass against a function that wrote
  // nothing.
  async function slotsOf(owner: OwnerWithPetContext, periodId: string): Promise<SlotRow[]> {
    const { data, error } = await owner.client
      .from("care_slots")
      .select(SLOT_COLUMNS)
      .eq("period_id", periodId)
      .order("slot_date")
      .order("time_of_day");
    expect(error).toBeNull();
    return (data ?? []) as SlotRow[];
  }

  async function freeSlotIds(owner: OwnerWithPetContext, periodId: string, count: number): Promise<string[]> {
    const free = (await slotsOf(owner, periodId)).filter((slot) => slot.claimed_by_name === null);
    if (free.length < count) {
      throw new Error(`claim-slots test: wanted ${count} free slots in ${periodId}, found ${free.length}`);
    }
    return free.slice(0, count).map((slot) => slot.id);
  }

  async function newCapability(): Promise<string> {
    return digestClaimSecret(generateClaimSecret());
  }

  function claim(
    client: SupabaseClient<Database>,
    token: string,
    slotIds: string[],
    digest: string,
    name: string | null = null,
  ) {
    return client.rpc("claim_slots", {
      p_token: token,
      p_slot_ids: slotIds,
      p_claim_digest: digest,
      // Omitted rather than sent as null when absent: the parameter is `default null`, and
      // the generated Args type says `p_name?: string`. This is what a first-claim-with-no-
      // name request actually looks like on the wire.
      ...(name === null ? {} : { p_name: name }),
    });
  }

  beforeAll(async () => {
    anon = createAnonClient();
    a = await createOwnerWithPet("A-Burek");
    b = await createOwnerWithPet("B-Mru");

    // 3 days x 3 times of day = 9 slots each.
    ({ id: aPeriodId, token: aToken } = await seedPeriod(a, "A-wyjazd", "2026-07-13", "2026-07-15"));
    ({ id: bPeriodId, token: bToken } = await seedPeriod(b, "B-wyjazd", "2026-08-01", "2026-08-03"));

    const revoked = await seedPeriod(a, "A-odwolany", "2026-09-01", "2026-09-02");
    revokedPeriodId = revoked.id;
    revokedToken = revoked.token;
    const { error } = await a.client
      .from("care_periods")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", revoked.id);
    expect(error).toBeNull();
  });

  // ── 1. Grant posture ────────────────────────────────────────────────────────────────────
  //
  // The posture is asserted BEHAVIOURALLY — anon gets past the permission check, service_role
  // does not — rather than by reading has_function_privilege, because PostgREST exposes only
  // functions in `public` and the catalog is not reachable from a test client. That read is
  // Phase 2's manual criterion 2.4. What matters is that these assertions still FAIL when the
  // posture changes in either direction, which is the property lessons.md asks for: a test
  // that also passes with the grant layer removed is a description of it, not a test.
  describe("grant posture", () => {
    it("anon may execute it — this is the caretaker's door", async () => {
      // A syntactically valid but unknown token: the function returns NULL from its own body,
      // which proves execution was permitted. A 42501 here means anon lost EXECUTE.
      const { data, error } = await claim(anon, generateInviteToken(), [aPeriodId], await newCapability(), "Ania");

      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    it("an authenticated owner may execute it — a signed-in owner opening their own link", async () => {
      const { error } = await claim(a.client, generateInviteToken(), [aPeriodId], await newCapability(), "Ania");

      expect(error).toBeNull();
    });

    it("service_role may NOT execute it", async () => {
      const serviceKey = process.env.SUPABASE_SERVICE_KEY;
      if (!serviceKey) {
        throw new Error("SUPABASE_SERVICE_KEY must be set in .env.test (see .env.test.example).");
      }
      const service = createClient<Database>(getTestEnv().url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { error } = await claim(service, aToken, [aPeriodId], await newCapability(), "Ania");

      // Assert the REFUSAL, not the absence of an effect: Supabase's ALTER DEFAULT PRIVILEGES
      // grants EXECUTE to service_role on every new function in `public`, so this passes only
      // while the migration's explicit revoke is still there.
      expect(error?.code).toBe("42501");
    });
  });

  // ── 2. IDOR ─────────────────────────────────────────────────────────────────────────────
  describe("scope", () => {
    it("a token for period A cannot claim a slot in period B", async () => {
      const [bSlotId] = await freeSlotIds(b, bPeriodId, 1);

      const { data, error } = await claim(anon, aToken, [bSlotId], await newCapability(), "Intruz");

      // Refused, not silently ignored: the slot is not in A's period, so the update matched
      // nothing and the row-count comparison rolled it back. The uuid is perfectly valid —
      // `period_id = v_period.id` in the update's WHERE is the only thing that stopped it.
      expect(error?.code).toBe("PT409");
      expect(data).toBeNull();

      const bSlot = (await slotsOf(b, bPeriodId)).find((slot) => slot.id === bSlotId);
      expect(bSlot?.claimed_by_name).toBeNull();
      expect(bSlot?.claim_digest).toBeNull();

      // And nothing leaked about B: the DETAIL names only slots inside the derived period.
      expect(error?.details ?? "").not.toContain(bSlotId);
    });

    it("refuses a claim through a revoked link, and says nothing about why", async () => {
      const revokedSlots = await slotsOf(a, revokedPeriodId);
      const targetId = revokedSlots[0].id;

      const { data, error } = await claim(anon, revokedToken, [targetId], await newCapability(), "Ania");

      // NULL, exactly as get_period_by_token answers a revoked token. A distinct refusal here
      // would confirm the period exists — the uniform-failure rule survives the write for the
      // TOKEN, which is the half of it that is a security property.
      expect(error).toBeNull();
      expect(data).toBeNull();

      const after = (await slotsOf(a, revokedPeriodId)).find((slot) => slot.id === targetId);
      expect(after?.claimed_by_name).toBeNull();
    });

    it("rejects malformed arguments before touching a table", async () => {
      const digest = await newCapability();
      const [slotId] = await freeSlotIds(a, aPeriodId, 1);

      const empty = await claim(anon, aToken, [], digest, "Ania");
      const badDigest = await claim(anon, aToken, [slotId], "NOT-A-DIGEST", "Ania");
      const noName = await claim(anon, aToken, [slotId], digest, "   ");

      expect(empty.error?.code).toBe("PT400");
      expect(badDigest.error?.code).toBe("PT400");
      expect(noName.error?.code).toBe("PT400");

      // None of the three wrote anything.
      const free = (await slotsOf(a, aPeriodId)).filter((slot) => slot.claimed_by_name === null);
      expect(free).toHaveLength(9);
    });
  });

  // ── 3. All or nothing ───────────────────────────────────────────────────────────────────
  describe("atomicity", () => {
    it("a partial selection leaves EVERY requested slot unclaimed", async () => {
      const period = await seedPeriod(a, "A-czesciowy", "2026-10-01", "2026-10-03");
      const ids = await freeSlotIds(a, period.id, 4);

      // Someone takes the first slot.
      const first = await claim(anon, period.token, [ids[0]], await newCapability(), "Ania");
      expect(first.error).toBeNull();

      // A second caretaker asks for that one plus three free ones.
      const second = await claim(anon, period.token, ids, await newCapability(), "Basia");
      expect(second.error?.code).toBe("PT409");
      expect(second.data).toBeNull();

      const rows = await slotsOf(a, period.id);
      const requested = ids.map((id) => rows.find((slot) => slot.id === id));

      // The taken one is still Ania's; the other THREE are still free — not claimed by Basia,
      // which is the whole point. A read-then-write implementation would have written them.
      expect(requested[0]?.claimed_by_name).toBe("Ania");
      expect(requested.slice(1).map((slot) => slot?.claimed_by_name)).toEqual([null, null, null]);
      expect(requested.slice(1).map((slot) => slot?.claim_digest)).toEqual([null, null, null]);

      // The refusal names the conflicting term rather than an opaque count, so Phase 4's
      // route can compose "Rano 1 października jest już zajęte".
      const detail = JSON.parse(second.error?.details ?? "[]") as { slot_date: string; time_of_day: string }[];
      expect(detail).toHaveLength(1);
      expect(detail[0].slot_date).toBe(rows.find((slot) => slot.id === ids[0])?.slot_date);
      expect(detail[0].time_of_day).toBe(rows.find((slot) => slot.id === ids[0])?.time_of_day);
    });

    it("claims a whole multi-slot selection when every slot is free", async () => {
      const period = await seedPeriod(a, "A-komplet", "2026-10-10", "2026-10-12");
      const ids = await freeSlotIds(a, period.id, 3);
      const digest = await newCapability();

      const { data, error } = await claim(anon, period.token, ids, digest, "  Ania  ");
      const receipt = data as ClaimReceipt | null;

      expect(error).toBeNull();
      expect(receipt?.period_id).toBe(period.id);
      expect(receipt?.end_date).toBe("2026-10-12");
      // Trimmed on the way in, so a stray space cannot mint a second identity.
      expect(receipt?.name).toBe("Ania");
      expect(receipt?.claimed_count).toBe(3);
      expect([...(receipt?.slot_ids ?? [])].sort()).toEqual([...ids].sort());

      const claimed = (await slotsOf(a, period.id)).filter((slot) => slot.claimed_by_name !== null);
      expect(claimed).toHaveLength(3);
      for (const slot of claimed) {
        // care_slots_claim_complete makes the triple all-or-nothing per row; this asserts the
        // function actually writes all three rather than relying on the constraint's promise.
        expect(slot.claimed_by_name).toBe("Ania");
        expect(slot.claimed_at).not.toBeNull();
        expect(slot.claim_digest).toBe(digest);
      }
    });
  });

  // ── 4. One capability = one identity ────────────────────────────────────────────────────
  //
  // Phase 1 impl-review F1: the schema cannot hold this. care_slots_claim_complete ties the
  // three claim columns per ROW, but nothing ties them across rows, so `claim_digest` = X with
  // "Ania" on one slot and "Basia" on another is a representable state. `claim_slots` is the
  // ONLY enforcement layer, which makes this test the only thing that would notice it break.
  describe("capability identity", () => {
    it("reuses the stored name on a follow-up claim and ignores the one passed", async () => {
      const period = await seedPeriod(a, "A-dokladka", "2026-11-01", "2026-11-03");
      const ids = await freeSlotIds(a, period.id, 4);
      const digest = await newCapability();

      const first = await claim(anon, period.token, ids.slice(0, 2), digest, "Ania");
      expect(first.error).toBeNull();

      // The same capability comes back with a DIFFERENT name — what a tampered client, or a
      // second person on a shared browser, would send.
      const second = await claim(anon, period.token, ids.slice(2, 4), digest, "Basia");
      const receipt = second.data as ClaimReceipt | null;

      expect(second.error).toBeNull();
      expect(receipt?.name).toBe("Ania");

      const mine = (await slotsOf(a, period.id)).filter((slot) => slot.claim_digest === digest);
      expect(mine).toHaveLength(4);
      expect(new Set(mine.map((slot) => slot.claimed_by_name))).toEqual(new Set(["Ania"]));
    });

    it("still requires a name from a capability that holds nothing yet", async () => {
      const period = await seedPeriod(a, "A-bez-imienia", "2026-11-10", "2026-11-11");
      const ids = await freeSlotIds(a, period.id, 1);

      const { error } = await claim(anon, period.token, ids, await newCapability(), null);

      expect(error?.code).toBe("PT400");
    });
  });

  // ── 5. Concurrency ──────────────────────────────────────────────────────────────────────
  describe("concurrency", () => {
    // WHAT THIS DOES NOT PROVE: that the row lock was exercised. Nothing here forces the
    // UPDATEs to overlap, so the same assertions would pass against a broken read-then-write
    // implementation that happened not to interleave. It is a non-flaky OUTCOME check that is
    // opportunistically a mechanism check — test-plan.md:64 names the anti-pattern it avoids
    // ("testing two sequential claims and calling it concurrency", "'final status 200' ≠ 'only
    // one winner'"), not a proof it delivers. A deterministic lock proof needs two held
    // transactions, which needs a `pg` client this repo deliberately does not carry.
    //
    // All six claimants live inside ONE it(): Vitest runs files in parallel but tests within a
    // file serially, so splitting them across it() blocks would produce no contention at all.
    it("admits exactly one winner when six caretakers race for the same slot", async () => {
      const period = await seedPeriod(a, "A-wyscig", "2026-12-01", "2026-12-01");
      const [contested] = await freeSlotIds(a, period.id, 1);

      const claimants = await Promise.all(
        Array.from({ length: 6 }, async (_unused, index) => ({
          client: createAnonClient(),
          digest: await newCapability(),
          name: `Opiekun-${index}`,
        })),
      );

      const outcomes = await Promise.all(
        claimants.map((claimant) => claim(claimant.client, period.token, [contested], claimant.digest, claimant.name)),
      );

      const won = outcomes.filter((outcome) => outcome.error === null);
      const refused = outcomes.filter((outcome) => outcome.error?.code === "PT409");

      expect(won).toHaveLength(1);
      expect(refused).toHaveLength(5);

      // The invariant, read back from the table rather than from the responses: exactly one
      // row carries a claim, its name is the winner's, and all three claim columns are set.
      const winner = (won[0].data as ClaimReceipt).name;
      const rows = (await slotsOf(a, period.id)).filter((slot) => slot.claimed_by_name !== null);

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(contested);
      expect(rows[0].claimed_by_name).toBe(winner);
      expect(rows[0].claimed_at).not.toBeNull();
      expect(rows[0].claim_digest).toBe(claimants.find((claimant) => claimant.name === winner)?.digest);
    });
  });
});
