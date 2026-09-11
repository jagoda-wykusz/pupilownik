import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { digestInviteToken, generateClaimSecret, generateInviteToken } from "@/lib/invite-token";
import { createAnonClient, createOwnerWithPet, type OwnerWithPetContext } from "../helpers/auth";
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
// BOTH halves are load-bearing and neither is sufficient alone:
//   A. releasing the last term collapses the reveal to NULL
//   B. releasing one of two leaves the reveal alive, minus that term
// An implementation that clears the reveal on ANY release passes A and fails B. One that never
// clears it passes B and fails A.
//
// Note which NULL half A asserts: a plain null, NOT S-06's `{revoked: true}`. The trip is still
// live; the caretaker simply no longer holds anything in it, so they fall back to the stranger's
// answer rather than the called-off card.

const SECRET_BODY = "Klucze u sąsiadki, mieszkanie 4. Kod do klatki 1234#";
const SECRET_TITLE = "Dostęp do mieszkania";
const PUBLIC_TITLE = "Karmienie";
const NOTE = "Burek boi się burzy — wtedy najlepiej zostać z nim w pokoju.";

interface Instruction {
  id: string;
  title: string;
  body: string | null;
  sort_order: number;
}
interface Pet {
  id: string;
  name: string;
  species: string;
  instructions: Instruction[];
}
interface ClaimedDetails {
  name: string;
  caretaker_note: string | null;
  slots: { id: string; slot_date: string; time_of_day: string }[];
  pets: Pet[];
}
/** S-06 Phase 2's one-bit answer. Kept as its own type so a test meaning "content came back"
 *  cannot be satisfied by it. */
interface RevokedAnswer {
  revoked: true;
}

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

  async function seedPeriod(title: string): Promise<{ id: string; token: string }> {
    const token = generateInviteToken();
    const { data, error } = await owner.client.rpc("create_period_with_slots", {
      p_title: title,
      p_start_date: "2027-03-01",
      p_end_date: "2027-03-02",
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

  /** Take `count` slots with ONE fresh capability and hand back its raw secret. */
  async function claim(periodId: string, token: string, count: number): Promise<{ secret: string; slotIds: string[] }> {
    const free = await freeSlotIds(periodId);
    if (free.length < count) {
      throw new Error(`release-reveal test: wanted ${count} free slots, found ${free.length}`);
    }
    const slotIds = free.slice(0, count);
    const secret = generateClaimSecret();

    const { error } = await anon.rpc("claim_slots", {
      p_token: token,
      p_slot_ids: slotIds,
      p_claim_secret: secret,
      p_name: "Ania",
    });
    expect(error).toBeNull();
    return { secret, slotIds };
  }

  async function reveal(token: string, secret: string): Promise<ClaimedDetails | RevokedAnswer | null> {
    const { data, error } = await anon.rpc("get_claimed_details", { p_token: token, p_claim_secret: secret });
    expect(error).toBeNull();
    return data as ClaimedDetails | RevokedAnswer | null;
  }

  /** Narrow to the content answer so "the payload came back" cannot be satisfied by
   *  `{revoked: true}`. Throws rather than returning null, because every caller below has
   *  already asserted the reveal is alive at that point. */
  async function revealContent(token: string, secret: string): Promise<ClaimedDetails> {
    const answer = await reveal(token, secret);
    if (answer === null || "revoked" in answer) {
      throw new Error("release-reveal test: expected a content answer from the reveal door");
    }
    return answer;
  }

  async function release(periodId: string, slotId: string): Promise<void> {
    const { data, error } = await owner.client.rpc("release_slot", { p_period_id: periodId, p_slot_id: slotId });
    expect(error).toBeNull();
    // The function returns the freed slot id; a NULL here means it matched nothing and the rest
    // of the test would be asserting against a write that never happened.
    expect(data).toBe(slotId);
  }

  /** Read one slot's three claim columns back as the owner. The function's return value is its
   *  own account of what it did — anchoring both halves to the row keeps them honest. */
  async function claimColumnsOf(slotId: string): Promise<{
    claimed_by_name: string | null;
    claimed_at: string | null;
    claim_digest: string | null;
  }> {
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

      await release(period.id, slotIds[0] ?? "");

      // The write actually landed, and it took the digest with it — that column is the whole
      // mechanism behind the assertion below.
      expect(await claimColumnsOf(slotIds[0] ?? "")).toEqual({
        claimed_by_name: null,
        claimed_at: null,
        claim_digest: null,
      });

      const after = await reveal(period.token, secret);
      // Plain null, not `{revoked: true}`: the trip is live, this caretaker simply holds nothing
      // in it any more, so they get exactly the stranger's answer.
      expect(after).toBeNull();
    });

    it("leaves the trip itself untouched for everyone else", async () => {
      // Releasing is not revoking. A second caretaker who still holds a term keeps their reveal,
      // which is what separates this from the S-06 path.
      const period = await seedPeriod("Dwie zdolności");
      const first = await claim(period.id, period.token, 1);
      const second = await claim(period.id, period.token, 1);

      await release(period.id, first.slotIds[0] ?? "");

      expect(await reveal(period.token, first.secret)).toBeNull();
      const survivor = await revealContent(period.token, second.secret);
      expect(survivor.slots.map((slot) => slot.id)).toEqual(second.slotIds);
      expect(survivor.caretaker_note).toBe(NOTE);
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
      // Everything the reveal exists to serve survives — this is the half that fails if an
      // implementation clears the capability on any release rather than on its last term.
      expect(after.caretaker_note).toBe(NOTE);
      expect(JSON.stringify(after)).toContain(SECRET_BODY);
      expect(after.name).toBe("Ania");
    });

    it("keeps the kept term's digest intact while the freed one is cleared", async () => {
      // The two rows shared one capability, so a release that reached further than the slot it
      // was given would show up here as a cleared digest on the row nobody released.
      const period = await seedPeriod("Digest sąsiada");
      const { slotIds } = await claim(period.id, period.token, 2);
      const [released, kept] = slotIds;

      const keptBefore = await claimColumnsOf(kept);
      await release(period.id, released);

      expect((await claimColumnsOf(released)).claim_digest).toBeNull();
      expect(await claimColumnsOf(kept)).toEqual(keptBefore);
    });
  });
});
