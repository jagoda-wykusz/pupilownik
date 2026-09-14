import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { digestClaimSecret, digestInviteToken, generateClaimSecret, generateInviteToken } from "@/lib/invite-token";
import { createAnonClient, createOwnerWithPet, type OwnerWithPetContext } from "../helpers/auth";
import {
  NOTE,
  PUBLIC_TITLE,
  SECRET_BODY,
  SECRET_TITLE,
  type ClaimedDetails,
  type RevokedAnswer,
} from "../helpers/reveal";
import type { Database } from "@/db/database.types";

// What releasing a term costs the caretaker who held it — Risk #5, the leg no test covered.
//
// `release_slot` nulls claim_digest along with the name and the timestamp, so freeing a
// capability's LAST term revokes that caretaker's reveal outright: the trip note, the sensitive
// instruction tier and their own record of which days they took. That sentence is stated as
// fact in three places — release_slot.sql:16-22, docs/reference/data-access.md, and prd.md
// §Open Questions #5, where it is the REASON revoking a trip deliberately does not bulk-release
// its terms. Until this file, nothing asserted it: neither tests/rls/release-slot.test.ts nor
// tests/api/release-slot.test.ts ever calls get_claimed_details.
//
// That matters beyond coverage. The reason recorded in those documents was once written
// backwards and shipped that way for months (corrected 2026-09-11); a claim nothing can falsify
// is exactly how that happens. Both directions are pinned here so the next inversion fails.
//
// THREE wrong implementations, and each case below is here to reject exactly one of them. The
// first two were mutation-tested when the file landed; the third was found by review, which is
// the honest note to keep — mutation testing only refutes the hypotheses you already hold.
//
//   1. never clear claim_digest        → rejected by "collapses their reveal"
//   2. clear the WHOLE capability      → rejected by "keeps the reveal alive"
//   3. clear it across OTHER periods   → rejected by "leaves their other trip alone"
//
// A fourth statement has no mutation behind it and is here as composition rather than as a
// guard: releasing a revoked trip's last term takes even the one-bit "called off" card away,
// because the claim gate runs BEFORE the revoked branch. That ordering is asserted from the
// other side in tests/unit/claimed-details-ordering.test.ts; here it is observed end to end.

interface ClaimColumns {
  claimed_by_name: string | null;
  claimed_at: string | null;
  claim_digest: string | null;
}

const FREED: ClaimColumns = { claimed_by_name: null, claimed_at: null, claim_digest: null };

describe("releasing a term and the caretaker's reveal", () => {
  let anon: SupabaseClient<Database>;
  let owner: OwnerWithPetContext;

  async function seedInstructions(): Promise<void> {
    const { error } = await owner.client.from("care_instructions").insert([
      { pet_id: owner.petId, title: PUBLIC_TITLE, body: "Rano i wieczorem.", is_sensitive: false, sort_order: 1 },
      { pet_id: owner.petId, title: SECRET_TITLE, body: SECRET_BODY, is_sensitive: true, sort_order: 2 },
    ]);
    expect(error).toBeNull();
  }

  // Dates vary per period on purpose: with every trip on the same two days, a defect that
  // scoped by (slot_date, time_of_day) instead of period_id would be invisible here.
  let nextDay = 1;
  async function seedPeriod(title: string): Promise<{ id: string; token: string }> {
    const day = nextDay++;
    const token = generateInviteToken();
    const { data, error } = await owner.client.rpc("create_period_with_slots", {
      p_title: title,
      p_start_date: `2027-03-${String(day).padStart(2, "0")}`,
      p_end_date: `2027-03-${String(day + 1).padStart(2, "0")}`,
      p_token_digest: await digestInviteToken(token),
      p_pet_ids: [owner.petId],
      p_caretaker_note: NOTE,
    });
    expect(error).toBeNull();
    if (!data) {
      throw new Error(`release-reveal test: seeding "${title}" failed`);
    }
    return { id: data.id, token };
  }

  /** Free slot ids of a period, read back as the OWNER — anon holds no grant on care_slots. */
  async function freeSlotIds(periodId: string): Promise<string[]> {
    const { data, error } = await owner.client
      .from("care_slots")
      .select("id")
      .eq("period_id", periodId)
      .is("claimed_by_name", null)
      .order("slot_date")
      .order("time_of_day");
    expect(error).toBeNull();
    return (data ?? []).map((slot) => slot.id);
  }

  /** Take `count` slots of one period with the GIVEN capability, so one secret can be made to
   *  span two trips — the state that exposes cross-period over-reach. */
  async function claimWith(periodId: string, token: string, secret: string, count: number): Promise<string[]> {
    const free = await freeSlotIds(periodId);
    if (free.length < count) {
      throw new Error(`release-reveal test: wanted ${count} free slots, found ${free.length}`);
    }
    const slotIds = free.slice(0, count);

    const { error } = await anon.rpc("claim_slots", {
      p_token: token,
      p_slot_ids: slotIds,
      p_claim_secret: secret,
      p_name: "Ania",
    });
    expect(error).toBeNull();
    return slotIds;
  }

  /** Mint-your-own convenience wrapper over claimWith. */
  async function claim(periodId: string, token: string, count: number): Promise<{ secret: string; slotIds: string[] }> {
    const secret = generateClaimSecret();
    return { secret, slotIds: await claimWith(periodId, token, secret, count) };
  }

  async function reveal(token: string, secret: string): Promise<ClaimedDetails | RevokedAnswer | null> {
    const { data, error } = await anon.rpc("get_claimed_details", { p_token: token, p_claim_secret: secret });
    expect(error).toBeNull();
    return data as ClaimedDetails | RevokedAnswer | null;
  }

  /** Narrow to the content answer so "the payload came back" cannot be satisfied by
   *  `{revoked: true}`. Throws rather than returning null, and names WHICH of the two non-content
   *  answers arrived — the difference between "you hold nothing here" and "the trip was called
   *  off" is the distinction this file exists to observe, so a failure must not flatten it. */
  async function revealContent(token: string, secret: string): Promise<ClaimedDetails> {
    const answer = await reveal(token, secret);
    if (answer === null) {
      throw new Error("release-reveal test: expected content from the reveal door, got null");
    }
    if ("revoked" in answer) {
      throw new Error("release-reveal test: expected content from the reveal door, got {revoked: true}");
    }
    return answer;
  }

  async function release(periodId: string, slotId: string): Promise<void> {
    // `release_slot` is optimistically concurrent, so it needs the `claimed_at` a page would
    // have rendered. This suite is about what a release does to the CARETAKER'S REVEAL, not
    // about the concurrency guard itself (tests/rls/release-slot.test.ts owns that), so the
    // token is read fresh here — the equivalent of an owner acting on a current view.
    const { data: current, error: readError } = await owner.client
      .from("care_slots")
      .select("claimed_at")
      .eq("id", slotId)
      .single();
    expect(readError).toBeNull();
    if (current?.claimed_at == null) {
      throw new Error("release-reveal test: wanted a claimed slot to release, found no claimed_at");
    }

    const { data, error } = await owner.client.rpc("release_slot", {
      p_period_id: periodId,
      p_slot_id: slotId,
      p_expected_claimed_at: current.claimed_at,
    });
    expect(error).toBeNull();
    // The function returns the freed slot id. A NULL means its WHERE matched nothing, so the
    // rest of the test would be asserting against a write that never happened. This does not
    // prove the SET wrote all three columns — the column reads below do that.
    expect(data).toBe(slotId);
  }

  /** Read one slot's three claim columns back as the owner. The function's return value is its
   *  own account of what it did; anchoring to the row keeps every case honest. */
  async function claimColumnsOf(slotId: string): Promise<ClaimColumns> {
    const { data, error } = await owner.client
      .from("care_slots")
      .select("claimed_by_name, claimed_at, claim_digest")
      .eq("id", slotId)
      .single();
    expect(error).toBeNull();
    if (!data) {
      throw new Error(`release-reveal test: slot ${slotId} not readable`);
    }
    return data;
  }

  beforeAll(async () => {
    anon = createAnonClient();
    owner = await createOwnerWithPet("Burek");
    await seedInstructions();
  });

  describe("when the released term was the caretaker's LAST", () => {
    it("collapses their reveal to nothing — note, sensitive tier and own days all gone", async () => {
      const period = await seedPeriod("Ostatni termin");
      const { secret, slotIds } = await claim(period.id, period.token, 1);

      const before = await revealContent(period.token, secret);
      expect(before.caretaker_note).toBe(NOTE);
      expect(before.slots.map((slot) => slot.id)).toEqual(slotIds);
      expect(JSON.stringify(before)).toContain(SECRET_BODY);

      await release(period.id, slotIds[0]);

      // The write landed and took the digest with it — that column is the whole mechanism
      // behind the assertion below.
      expect(await claimColumnsOf(slotIds[0])).toEqual(FREED);

      const after = await reveal(period.token, secret);
      // Plain null: the trip is live, this caretaker simply holds nothing in it any more, so
      // they get exactly the stranger's answer.
      expect(after).toBeNull();
    });

    it("takes even the called-off card from a holder on a REVOKED trip", async () => {
      // The composition the header names. `get_claimed_details` checks the claim gate BEFORE it
      // branches on revoked_at, so releasing the holder's last term drops them out of the gate
      // and the one-bit status goes with it. This is what prd.md §Open Questions #5 means by
      // "bulk release would change what the caretaker sees, and change it for the worse" — here
      // it is observed rather than argued.
      const period = await seedPeriod("Odwołany i zwolniony");
      const { secret, slotIds } = await claim(period.id, period.token, 1);

      expect((await owner.client.rpc("revoke_period", { p_period_id: period.id })).data).toBe(period.id);
      expect(await reveal(period.token, secret)).toEqual({ revoked: true });

      await release(period.id, slotIds[0]);

      expect(await reveal(period.token, secret)).toBeNull();
    });
  });

  describe("when the caretaker still holds another term", () => {
    it("keeps the reveal alive and takes only the freed term out of it", async () => {
      const period = await seedPeriod("Dwa terminy");
      const { secret, slotIds } = await claim(period.id, period.token, 2);
      const [released, kept] = slotIds;

      const before = await revealContent(period.token, secret);
      expect(before.slots.map((slot) => slot.id).sort()).toEqual([...slotIds].sort());

      await release(period.id, released);

      const after = await revealContent(period.token, secret);
      expect(after.slots.map((slot) => slot.id)).toEqual([kept]);
      // Everything the reveal exists to serve survives — this is the case that fails if an
      // implementation clears the capability on any release rather than on its last term.
      expect(after.caretaker_note).toBe(NOTE);
      expect(after.name).toBe("Ania");
    });

    it("leaves their OTHER trip alone, including its digest", async () => {
      // One capability across two trips — the state a caretaker who helps two households is in,
      // and which tests/rls/reveal-instructions.test.ts already treats as realistic. Without
      // this case, an implementation that cleared every row carrying the digest in ANY period
      // passes the whole file while silently cutting that caretaker out of their second trip.
      //
      // The kept row's digest is compared against an INDEPENDENTLY derived value, not against a
      // snapshot of itself: an all-null snapshot would otherwise equal an all-null re-read and
      // the case would pass having proved nothing.
      const secret = generateClaimSecret();
      const digest = await digestClaimSecret(secret);

      const here = await seedPeriod("Dom pierwszy");
      const there = await seedPeriod("Dom drugi");
      const [releasedId] = await claimWith(here.id, here.token, secret, 1);
      const [keptId] = await claimWith(there.id, there.token, secret, 1);

      expect((await claimColumnsOf(keptId)).claim_digest).toBe(digest);

      await release(here.id, releasedId);

      expect(await claimColumnsOf(releasedId)).toEqual(FREED);
      const keptAfter = await claimColumnsOf(keptId);
      expect(keptAfter.claimed_by_name).toBe("Ania");
      expect(keptAfter.claimed_at).not.toBeNull();
      expect(keptAfter.claim_digest).toBe(digest);
      // And the reveal for the other trip still answers in full.
      const other = await revealContent(there.token, secret);
      expect(other.slots.map((slot) => slot.id)).toEqual([keptId]);
      expect(JSON.stringify(other)).toContain(SECRET_BODY);
    });
  });
});
