import { beforeAll, describe, expect, it } from "vitest";
import { digestClaimSecret, digestInviteToken, generateClaimSecret, generateInviteToken } from "@/lib/invite-token";
import { createOwnerWithPet, type OwnerWithPetContext } from "../helpers/auth";

// `care_slots_claim_complete` — the constraint the whole atomicity argument rests on, and which
// nothing asserted until now.
//
// claim_slots allocates with ONE guarded statement: `update … where claimed_by_name is null`
// (20260907171514:186-198). That predicate is only a truthful freeness test because the triple
// CHECK makes the three claim columns all-or-nothing per row
// (20260907065515_claim_capability_and_note.sql:75-82):
//
//     (claimed_by_name is null) = (claimed_at is null)
//     and (claimed_by_name is null) = (claim_digest is null)
//
// Without it a row could carry a digest and no name — free by the predicate, claimed in fact —
// and a second caretaker would overwrite a term someone already holds. The unique constraint
// cannot catch that: it is the SAME row (20260906094254:14-17 says so in as many words).
//
// tests/rls/claim-slots.test.ts asserts the function WRITES all three columns, which would keep
// passing with the constraint dropped. This file asserts the database REFUSES every half-written
// combination — the property the function's correctness leans on rather than the function's own
// behaviour.
//
// The writes go through the owner's ordinary client under `care_slots_update_own`, not through
// any function: the point is what the table itself will accept, and a function that happens to
// write all three columns would hide the answer.

describe("care_slots_claim_complete — the claim triple is all-or-nothing", () => {
  let owner: OwnerWithPetContext;
  let freeSlotId: string;
  let spareSlotId: string;
  let digest: string;

  beforeAll(async () => {
    owner = await createOwnerWithPet("Burek");

    const token = generateInviteToken();
    const { data, error } = await owner.client.rpc("create_period_with_slots", {
      p_title: "Wyjazd",
      p_start_date: "2027-11-01",
      p_end_date: "2027-11-02",
      p_token_digest: await digestInviteToken(token),
      p_pet_ids: [owner.petId],
    });
    expect(error).toBeNull();
    if (!data) {
      throw new Error("claim-complete test: seeding the period failed");
    }

    const slots = await owner.client
      .from("care_slots")
      .select("id")
      .eq("period_id", data.id)
      .order("slot_date")
      .order("time_of_day")
      .limit(2);
    freeSlotId = slots.data?.[0]?.id ?? "";
    // A SECOND slot for the positive case, so it cannot claim the row the refusal cases read
    // back — that would make this file order-dependent for no benefit.
    spareSlotId = slots.data?.[1]?.id ?? "";
    expect(freeSlotId).not.toBe("");
    expect(spareSlotId).not.toBe("");

    digest = await digestClaimSecret(generateClaimSecret());
  });

  /** The three claim columns, and only those. NOT a Record<string, …> — the generated Update
   *  type rejects an index signature outright, which `astro check` catches even though eslint
   *  and vitest do not. */
  interface ClaimPatch {
    claimed_by_name?: string;
    claimed_at?: string;
    claim_digest?: string;
  }

  /** Attempt a partial write as the owner and return the error the database gave, if any. */
  async function attempt(patch: ClaimPatch): Promise<{ code?: string; message?: string }> {
    const { error } = await owner.client.from("care_slots").update(patch).eq("id", freeSlotId);
    return { code: error?.code, message: error?.message };
  }

  async function isStillFree(slotId: string = freeSlotId): Promise<boolean> {
    const { data, error } = await owner.client
      .from("care_slots")
      .select("claimed_by_name, claimed_at, claim_digest")
      .eq("id", slotId)
      .single();
    expect(error).toBeNull();
    return data?.claimed_by_name === null && data.claimed_at === null && data.claim_digest === null;
  }

  it.each([
    { half: "a name with no timestamp and no digest", patch: { claimed_by_name: "Ania" } },
    {
      half: "a name and a timestamp but no digest",
      patch: { claimed_by_name: "Ania", claimed_at: "2027-11-01T08:00:00Z" },
    },
    { half: "a digest with no name", patch: { claim_digest: "DIGEST" } },
    { half: "a timestamp with no name", patch: { claimed_at: "2027-11-01T08:00:00Z" } },
  ])("refuses $half", async ({ patch }) => {
    // The digest is only known after beforeAll, and an it.each table is built at collection
    // time — hence the sentinel, resolved here.
    const resolved: ClaimPatch = {
      ...patch,
      ...(patch.claim_digest === undefined ? {} : { claim_digest: digest }),
    };

    const error = await attempt(resolved);

    // A REFUSAL, not an empty result. RLS denial on UPDATE is silent — zero rows, no error — so
    // asserting "the row did not change" alone would keep passing with the constraint dropped
    // and the write applied. The constraint must name itself.
    expect(error.code).toBe("23514");
    expect(error.message).toContain("care_slots_claim_complete");
    expect(await isStillFree()).toBe(true);
  });

  it("accepts the complete triple, so the refusals above are about COMPLETENESS", async () => {
    // Guards the guard: without this, a policy or grant mistake that refused every UPDATE would
    // make all four cases above pass for entirely the wrong reason.
    const { error } = await owner.client
      .from("care_slots")
      .update({ claimed_by_name: "Ania", claimed_at: "2027-11-01T08:00:00Z", claim_digest: digest })
      .eq("id", spareSlotId);

    expect(error).toBeNull();
    expect(await isStillFree(spareSlotId)).toBe(false);
    expect(await isStillFree()).toBe(true);
  });
});
