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
  already_held_count: number;
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
    return data ?? [];
  }

  async function freeSlotIds(owner: OwnerWithPetContext, periodId: string, count: number): Promise<string[]> {
    const free = (await slotsOf(owner, periodId)).filter((slot) => slot.claimed_by_name === null);
    if (free.length < count) {
      throw new Error(`claim-slots test: wanted ${count} free slots in ${periodId}, found ${free.length}`);
    }
    return free.slice(0, count).map((slot) => slot.id);
  }

  // A capability is a RAW secret plus the digest the database will derive from it. The call
  // sends the secret; the table assertions compare against the digest. Computing the digest
  // here with digestClaimSecret rather than reading it back from the row is what makes the
  // app/database hashing agreement a tested property instead of an assumed one.
  async function newCapability(): Promise<{ secret: string; digest: string }> {
    const secret = generateClaimSecret();
    return { secret, digest: await digestClaimSecret(secret) };
  }

  function claim(
    client: SupabaseClient<Database>,
    token: string,
    slotIds: string[],
    secret: string,
    name: string | null = null,
  ) {
    return client.rpc("claim_slots", {
      p_token: token,
      p_slot_ids: slotIds,
      p_claim_secret: secret,
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
    // Only the id is kept: B exists as the IDOR target, reached by slot uuid through A's
    // token. Resolving B's own link is get_period_by_token's test, not this one.
    ({ id: bPeriodId } = await seedPeriod(b, "B-wyjazd", "2026-08-01", "2026-08-03"));

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
      const { data, error } = await claim(
        anon,
        generateInviteToken(),
        [aPeriodId],
        (await newCapability()).secret,
        "Ania",
      );

      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    it("an authenticated owner may execute it — a signed-in owner opening their own link", async () => {
      const { error } = await claim(
        a.client,
        generateInviteToken(),
        [aPeriodId],
        (await newCapability()).secret,
        "Ania",
      );

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

      const { error } = await claim(service, aToken, [aPeriodId], (await newCapability()).secret, "Ania");

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

      const { data, error } = await claim(anon, aToken, [bSlotId], (await newCapability()).secret, "Intruz");

      // Refused, not silently ignored: the slot is not in A's period, so the update matched
      // nothing and the row-count comparison rolled it back. The uuid is perfectly valid —
      // `period_id = v_period.id` in the update's WHERE is the only thing that stopped it.
      expect(error?.code).toBe("PT409");
      expect(data).toBeNull();

      const bSlot = (await slotsOf(b, bPeriodId)).find((slot) => slot.id === bSlotId);
      expect(bSlot?.claimed_by_name).toBeNull();
      expect(bSlot?.claim_digest).toBeNull();

      // And nothing leaked about B. Assert the PAYLOAD, not the absence of a value it never
      // carries: DETAIL is built from jsonb_build_object('slot_date', …, 'time_of_day', …) and
      // holds no slot id at any time, so `not.toContain(bSlotId)` passed unconditionally and
      // would keep passing if the conflicts query lost its `period_id = v_period.id` scope and
      // started dumping B's rows here (impl-review F3 — the anti-pattern lessons.md records).
      // An empty array is the whole assertion: a foreign slot must produce no conflict rows at
      // all, because naming one would confirm it exists.
      expect(JSON.parse(error?.details ?? "null")).toEqual([]);
    });

    it("refuses a claim through a revoked link, and says nothing about why", async () => {
      const revokedSlots = await slotsOf(a, revokedPeriodId);
      const targetId = revokedSlots[0].id;

      const { data, error } = await claim(anon, revokedToken, [targetId], (await newCapability()).secret, "Ania");

      // NULL, exactly as get_period_by_token answers a revoked token. A distinct refusal here
      // would confirm the period exists — the uniform-failure rule survives the write for the
      // TOKEN, which is the half of it that is a security property.
      expect(error).toBeNull();
      expect(data).toBeNull();

      const after = (await slotsOf(a, revokedPeriodId)).find((slot) => slot.id === targetId);
      expect(after?.claimed_by_name).toBeNull();
    });

    it("rejects malformed arguments and writes nothing", async () => {
      // A dedicated period, not the shared aPeriodId: the "nothing was written" assertion is a
      // count over the period's free slots, so it would silently start failing the day any
      // earlier test in this file claims in A's period (impl-review F7).
      const period = await seedPeriod(a, "A-zle-argumenty", "2026-12-10", "2026-12-12");
      const capability = await newCapability();
      const [slotId] = await freeSlotIds(a, period.id, 1);

      const empty = await claim(anon, period.token, [], capability.secret, "Ania");
      const shortSecret = await claim(anon, period.token, [slotId], "not-a-capability-secret", "Ania");
      const noName = await claim(anon, period.token, [slotId], capability.secret, "   ");

      expect(empty.error?.code).toBe("PT400");
      expect(shortSecret.error?.code).toBe("PT400");
      // The blank name is checked AFTER the period and capability lookups, unlike the other
      // two — the test name says "writes nothing" rather than "before touching a table"
      // because only two of the three are pre-table.
      expect(noName.error?.code).toBe("PT400");

      // None of the three wrote anything. 3 days x 3 times of day.
      const free = (await slotsOf(a, period.id)).filter((slot) => slot.claimed_by_name === null);
      expect(free).toHaveLength(9);
    });

    // The three DoS bounds on the only anon-reachable WRITE in this schema. Without these,
    // deleting any of them leaves the suite green — a layer described rather than pinned, which
    // is exactly what context/foundation/lessons.md forbids (impl-review F7).
    it("bounds every input an anonymous caller controls", async () => {
      const period = await seedPeriod(a, "A-granice", "2026-12-20", "2026-12-22");
      const capability = await newCapability();
      const [slotId] = await freeSlotIds(a, period.id, 1);

      // Read this one for what it is: the 43-character bound's real effect — that no hashing
      // happens — is NOT observable through this API, because a 44-character token would miss
      // the index and return null either way. So this does not pin the bound, and saying it
      // did would be the same mistake as the DETAIL assertion above. What it does pin is the
      // ANSWER: a wrong-length token must come back as the uniform failure, not as a PT400,
      // or the shape of the error would separate "malformed" from "unknown" and hand a prober
      // an oracle. That assertion fails the moment someone turns the length check into a raise.
      const longToken = await claim(anon, `${period.token}x`, [slotId], capability.secret, "Ania");
      expect(longToken.error).toBeNull();
      expect(longToken.data).toBeNull();

      // 93 = MAX_SPAN_DAYS x 3 = every slot in the longest possible trip. One more is refused
      // before any table is touched, so an unbounded array is never allocated against.
      const tooMany = await claim(
        anon,
        period.token,
        Array.from({ length: 94 }, () => crypto.randomUUID()),
        capability.secret,
        "Ania",
      );
      expect(tooMany.error?.code).toBe("PT400");

      // claimed_by_name is unbounded `text` with no CHECK, so this bound is the only thing
      // between an anonymous caller and storage amplification.
      const longName = await claim(anon, period.token, [slotId], capability.secret, "a".repeat(81));
      expect(longName.error?.code).toBe("PT400");
      // 80 exactly is the boundary and must be accepted, or the bound is off by one.
      const maxName = await claim(anon, period.token, [slotId], capability.secret, "a".repeat(80));
      expect(maxName.error).toBeNull();
    });
  });

  // ── 3. All or nothing ───────────────────────────────────────────────────────────────────
  describe("atomicity", () => {
    it("a partial selection leaves EVERY requested slot unclaimed", async () => {
      const period = await seedPeriod(a, "A-czesciowy", "2026-10-01", "2026-10-03");
      const ids = await freeSlotIds(a, period.id, 4);

      // Someone takes the first slot.
      const first = await claim(anon, period.token, [ids[0]], (await newCapability()).secret, "Ania");
      expect(first.error).toBeNull();

      // A second caretaker asks for that one plus three free ones.
      const second = await claim(anon, period.token, ids, (await newCapability()).secret, "Basia");
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
      const capability = await newCapability();

      const { data, error } = await claim(anon, period.token, ids, capability.secret, "  Ania  ");
      const receipt = data as ClaimReceipt | null;

      expect(error).toBeNull();
      expect(receipt?.period_id).toBe(period.id);
      expect(receipt?.end_date).toBe("2026-10-12");
      // Trimmed on the way in, so a stray space cannot mint a second identity.
      expect(receipt?.name).toBe("Ania");
      expect(receipt?.claimed_count).toBe(3);
      expect(receipt?.already_held_count).toBe(0);
      expect([...(receipt?.slot_ids ?? [])].sort()).toEqual([...ids].sort());

      const claimed = (await slotsOf(a, period.id)).filter((slot) => slot.claimed_by_name !== null);
      expect(claimed).toHaveLength(3);
      for (const slot of claimed) {
        // care_slots_claim_complete makes the triple all-or-nothing per row; this asserts the
        // function actually writes all three rather than relying on the constraint's promise.
        expect(slot.claimed_by_name).toBe("Ania");
        expect(slot.claimed_at).not.toBeNull();
        // The digest the database stored equals the one the app derives from the same secret.
        // The secret itself never reaches a column, which is the point of impl-review F1.
        expect(slot.claim_digest).toBe(capability.digest);
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
      const capability = await newCapability();

      const first = await claim(anon, period.token, ids.slice(0, 2), capability.secret, "Ania");
      expect(first.error).toBeNull();

      // The same capability comes back with a DIFFERENT name — what a tampered client, or a
      // second person on a shared browser, would send.
      const second = await claim(anon, period.token, ids.slice(2, 4), capability.secret, "Basia");
      const receipt = second.data as ClaimReceipt | null;

      expect(second.error).toBeNull();
      expect(receipt?.name).toBe("Ania");

      const mine = (await slotsOf(a, period.id)).filter((slot) => slot.claim_digest === capability.digest);
      expect(mine).toHaveLength(4);
      expect(new Set(mine.map((slot) => slot.claimed_by_name))).toEqual(new Set(["Ania"]));
    });

    // impl-review F4. The scenario is NOT a user re-selecting a taken slot — Phase 4's UI makes
    // those unselectable — it is a retry: the POST lands, the response is lost on a flaky
    // connection, and the client resends the identical set. Before this fix that second request
    // answered PT409 naming the caretaker's OWN slots, so a claim that genuinely succeeded was
    // reported as refused.
    it("is retry-safe — resending an identical claim succeeds and writes nothing new", async () => {
      const period = await seedPeriod(a, "A-ponowienie", "2026-11-20", "2026-11-22");
      const ids = await freeSlotIds(a, period.id, 3);
      const capability = await newCapability();

      const first = await claim(anon, period.token, ids, capability.secret, "Ania");
      expect(first.error).toBeNull();
      expect((first.data as ClaimReceipt).claimed_count).toBe(3);

      const retry = await claim(anon, period.token, ids, capability.secret, "Ania");
      const receipt = retry.data as ClaimReceipt | null;

      expect(retry.error).toBeNull();
      // Nothing new was written, and the receipt says so rather than leaving the route to guess
      // whether a zero means "already yours" or "nothing happened".
      expect(receipt?.claimed_count).toBe(0);
      expect(receipt?.already_held_count).toBe(3);
      expect(receipt?.slot_ids ?? []).toEqual([]);

      const mine = (await slotsOf(a, period.id)).filter((slot) => slot.claim_digest === capability.digest);
      expect(mine).toHaveLength(3);
    });

    // A mixed request must still refuse — retry-safety must not become "partial claims are fine".
    it("still refuses when the shortfall is someone else's slot, and names only that slot", async () => {
      const period = await seedPeriod(a, "A-mieszany", "2026-11-25", "2026-11-27");
      const ids = await freeSlotIds(a, period.id, 3);
      const mine = await newCapability();
      const theirs = await newCapability();

      expect((await claim(anon, period.token, [ids[0]], mine.secret, "Ania")).error).toBeNull();
      expect((await claim(anon, period.token, [ids[2]], theirs.secret, "Basia")).error).toBeNull();

      // ids[0] is already mine (satisfied), ids[1] is free, ids[2] is Basia's (a real conflict).
      const mixed = await claim(anon, period.token, ids, mine.secret, "Ania");
      expect(mixed.error?.code).toBe("PT409");

      const detail = JSON.parse(mixed.error?.details ?? "null") as { slot_date: string; time_of_day: string }[];
      const rows = await slotsOf(a, period.id);
      const contested = rows.find((slot) => slot.id === ids[2]);
      expect(detail).toHaveLength(1);
      expect(detail[0].time_of_day).toBe(contested?.time_of_day);

      // And the whole thing rolled back: the free middle slot is still free.
      expect(rows.find((slot) => slot.id === ids[1])?.claimed_by_name).toBeNull();
    });

    it("still requires a name from a capability that holds nothing yet", async () => {
      const period = await seedPeriod(a, "A-bez-imienia", "2026-11-10", "2026-11-11");
      const ids = await freeSlotIds(a, period.id, 1);

      const { error } = await claim(anon, period.token, ids, (await newCapability()).secret, null);

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
          capability: await newCapability(),
          name: `Opiekun-${index}`,
        })),
      );

      const outcomes = await Promise.all(
        claimants.map((claimant) =>
          claim(claimant.client, period.token, [contested], claimant.capability.secret, claimant.name),
        ),
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
      expect(rows[0].claim_digest).toBe(claimants.find((claimant) => claimant.name === winner)?.capability.digest);
    });
  });
});
