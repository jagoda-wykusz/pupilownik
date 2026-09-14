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

// A well-formed timestamp that matches no stored row, for the grant-posture cases where the
// slot id is random anyway. The point of those cases is the permission check, which happens
// before the body runs — a real token would prove nothing extra and there is no row to read one
// from.
const NOWHERE_CLAIMED_AT = "2000-01-01T00:00:00+00:00";

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

  // The optimistic-concurrency token a rendered page would be holding. Read back from the
  // table rather than remembered from the claim, because `claimed_at` is stamped by the
  // database and the point of the token is that it matches what Postgres stored.
  //
  // Takes the owner whose RLS can SEE the row, which is not always the caller under test: the
  // cross-owner case below deliberately hands A a token read through B's client, so the refusal
  // it asserts cannot be passing merely because A guessed a wrong timestamp.
  async function claimedAtOf(owner: OwnerWithPetContext, periodId: string, slotId: string): Promise<string> {
    const row = (await slotsOf(owner, periodId)).find((slot) => slot.id === slotId);
    if (row?.claimed_at == null) {
      throw new Error("release-slot test: wanted a claimed slot, found no claimed_at");
    }
    return row.claimed_at;
  }

  function release(client: SupabaseClient<Database>, periodId: string, slotId: string, expectedClaimedAt: string) {
    return client.rpc("release_slot", {
      p_period_id: periodId,
      p_slot_id: slotId,
      p_expected_claimed_at: expectedClaimedAt,
    });
  }

  // The generated types declare `p_expected_claimed_at` as non-nullable, which is correct for
  // every caller that goes through them — and precisely why the null case needs a deliberate
  // hole to be tested at all. An `authenticated` caller hitting PostgREST directly is not bound
  // by this repo's TypeScript, and the function has to refuse them rather than fall back to the
  // old unguarded release. Cast here, once, rather than widening the helper's parameter and
  // letting every call site pass null by accident.
  const NULL_TOKEN = null as unknown as string;

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
      const { data, error } = await release(a.client, crypto.randomUUID(), crypto.randomUUID(), NOWHERE_CLAIMED_AT);

      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    it("anon may NOT execute it — a caretaker cannot free anyone's term", async () => {
      const claimed = await seedClaimedPeriod(a, "A-anon-nie-moze", "2027-01-05", "2027-01-06");

      const { error } = await release(
        anon,
        claimed.id,
        claimed.slotIds[0],
        await claimedAtOf(a, claimed.id, claimed.slotIds[0]),
      );

      // The MESSAGE, not just the SQLSTATE. anon holds no UPDATE grant on care_slots either
      // (verified: has_table_privilege('anon','public.care_slots','update') is false), so
      // granting EXECUTE back to anon moves the identical 42501 one layer inward — "permission
      // denied for TABLE care_slots" — and a code-only assertion keeps passing with the
      // function grant fully widened. Measured: the suite went 8/8 green under
      // `grant execute on function public.release_slot(uuid,uuid,timestamptz) to anon`. Naming the
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

      const { error } = await release(service, crypto.randomUUID(), crypto.randomUUID(), NOWHERE_CLAIMED_AT);

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

      const { data, error } = await release(a.client, claimed.id, target, await claimedAtOf(a, claimed.id, target));

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
      // Captured ONCE, before the first release, and replayed — which is exactly what a stale
      // browser tab holds. After the first call the row is free, so there is no token left to
      // read.
      const token = await claimedAtOf(a, claimed.id, target);

      expect((await release(a.client, claimed.id, target, token)).error).toBeNull();

      const { data, error } = await release(a.client, claimed.id, target, token);

      // `claimed_at = p_expected_claimed_at` in the WHERE turns the second call into a no-op
      // that reports itself honestly, rather than an error the route would have to classify:
      // the row is free now, and equality against a non-null token is never true for NULL. The
      // old `claimed_at is not null` guard answered this case identically — the difference is
      // that it ALSO waved through the re-claimed case below, which this one refuses.
      expect(error).toBeNull();
      expect(data).toBeNull();

      const freed = (await slotsOf(a, claimed.id)).find((row) => row.id === target);
      expect(freed?.claimed_by_name).toBeNull();
    });

    it("answers NULL for another owner's slot and leaves it claimed", async () => {
      const theirs = await seedClaimedPeriod(b, "B-cudze", "2027-02-01", "2027-02-02");
      const target = theirs.slotIds[0];

      // A is handed the CORRECT token, read through B's own client. That is deliberate: with a
      // made-up timestamp this case would miss on the equality and pass without RLS doing any
      // work at all, which is the tautology context/foundation/lessons.md warns about. A knows
      // the exact value and is still refused.
      const { data, error } = await release(a.client, theirs.id, target, await claimedAtOf(b, theirs.id, target));

      // care_slots_update_own filtered the row out. Same NULL as "already free" — A learns
      // nothing about whether B's period or slot exists, and the PT412 branch does not fire
      // either, because the explaining read is RLS-scoped too.
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

      const { data, error } = await release(
        a.client,
        one.id,
        two.slotIds[0],
        await claimedAtOf(a, two.id, two.slotIds[0]),
      );

      expect(error).toBeNull();
      expect(data).toBeNull();

      const slot = (await slotsOf(a, two.id)).find((row) => row.id === two.slotIds[0]);
      expect(slot?.claimed_by_name).toBe("Ania");
    });

    it("leaves a released term immediately claimable again through the invite link", async () => {
      const claimed = await seedClaimedPeriod(a, "A-znowu-wolne", "2027-04-01", "2027-04-02");
      const target = claimed.slotIds[0];

      expect((await release(a.client, claimed.id, target, await claimedAtOf(a, claimed.id, target))).error).toBeNull();

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

  // ── 3. Optimistic concurrency ──────────────────────────────────────────────
  //
  // prd.md §Open Questions #3, closed by
  // supabase/migrations/20260914150000_release_slot_expected_claimed_at.sql. The scenario is one
  // owner with two tabs, not two owners: tab A renders the grid, the term changes hands through
  // the still-live invite link, and tab A then clicks "Zwolnij" on a view that is already wrong.
  //
  // The sequence below is the whole point and is written out rather than helper-wrapped: a test
  // that released and re-claimed through a fixture would be easy to read as "release twice",
  // which is a different case entirely (§2 covers it).
  describe("optimistic concurrency", () => {
    // Seed a period, claim a term as Ania, capture the token a page would have rendered, then
    // let Basia take the term over so the stored row moves out from under that token.
    async function seedRelaimedTerm(title: string, start: string, end: string) {
      const claimed = await seedClaimedPeriod(a, title, start, end);
      const target = claimed.slotIds[0];
      const staleToken = await claimedAtOf(a, claimed.id, target);

      // Ania lets it go — with a CURRENT token, so this first release is the legitimate one.
      expect((await release(a.client, claimed.id, target, staleToken)).error).toBeNull();

      // Basia takes it through the link. This is what makes `staleToken` stale.
      const secret = generateClaimSecret();
      const digest = await digestClaimSecret(secret);
      const { error } = await anon.rpc("claim_slots", {
        p_token: claimed.token,
        p_slot_ids: [target],
        p_claim_secret: secret,
        p_name: "Basia",
      });
      expect(error).toBeNull();

      return { ...claimed, target, staleToken, basiaDigest: digest };
    }

    it("refuses a release carrying a token from before the term changed hands", async () => {
      const { id, target, staleToken } = await seedRelaimedTerm("A-wyscig", "2027-05-01", "2027-05-02");

      const { data, error } = await release(a.client, id, target, staleToken);

      // PT412, NOT a NULL return. This is the one miss that must not look like the other four:
      // answering NULL would send the route to its 404, whose sentence tells the owner the term
      // is free while Basia is standing on it.
      expect(error?.code).toBe("PT412");
      expect(data).toBeNull();
    });

    it("leaves Basia's claim completely intact after the refused release", async () => {
      const { id, target, staleToken, basiaDigest } = await seedRelaimedTerm(
        "A-wyscig-nic-nie-pisze",
        "2027-05-05",
        "2027-05-06",
      );
      const before = (await slotsOf(a, id)).find((row) => row.id === target);

      await release(a.client, id, target, staleToken);

      // Read the row back rather than trusting the error: the raise has to roll the statement
      // back, and an assertion on the SQLSTATE alone would pass against a function that refused
      // AFTER writing. All three claim columns, because they are one fact.
      const after = (await slotsOf(a, id)).find((row) => row.id === target);
      expect(after?.claimed_by_name).toBe("Basia");
      expect(after?.claim_digest).toBe(basiaDigest);
      expect(after?.claimed_at).toBe(before?.claimed_at);
    });

    it("still releases when the owner refreshes and sends the CURRENT token", async () => {
      const { id, target } = await seedRelaimedTerm("A-wyscig-po-odswiezeniu", "2027-05-10", "2027-05-11");

      // The remedy the route's 409 sentence asks for. Without this the previous two tests would
      // also pass against a function that refuses every release outright.
      const { data, error } = await release(a.client, id, target, await claimedAtOf(a, id, target));

      expect(error).toBeNull();
      expect(data).toBe(target);

      const after = (await slotsOf(a, id)).find((row) => row.id === target);
      expect(after?.claimed_by_name).toBeNull();
      expect(after?.claimed_at).toBeNull();
      expect(after?.claim_digest).toBeNull();
    });

    it("answers NULL rather than PT412 for a stale token on a term that is simply free", async () => {
      // The two refusals must stay distinguishable at the source. A function that raised PT412
      // on every non-match would turn the ordinary "this term was already released" case into a
      // 409, and the owner would be told someone is holding a slot that nobody is.
      const claimed = await seedClaimedPeriod(a, "A-wyscig-wolny", "2027-05-15", "2027-05-16");
      const target = claimed.slotIds[0];
      const token = await claimedAtOf(a, claimed.id, target);

      expect((await release(a.client, claimed.id, target, token)).error).toBeNull();

      const { data, error } = await release(a.client, claimed.id, target, token);

      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    it("refuses a NULL token instead of falling back to the old unguarded behaviour", async () => {
      // The argument is not optional in the signature, but `authenticated` can call this RPC
      // directly through PostgREST and pass an explicit null. That must not resolve to "release
      // whatever is there" — which is precisely what the pre-migration guard did.
      const claimed = await seedClaimedPeriod(a, "A-wyscig-null", "2027-05-20", "2027-05-21");
      const target = claimed.slotIds[0];

      const { data, error } = await release(a.client, claimed.id, target, NULL_TOKEN);

      expect(error?.code).toBe("PT412");
      expect(data).toBeNull();

      const after = (await slotsOf(a, claimed.id)).find((row) => row.id === target);
      expect(after?.claimed_by_name).toBe("Ania");
    });
  });
});
