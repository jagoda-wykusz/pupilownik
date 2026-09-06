import { beforeAll, describe, expect, it } from "vitest";
import { createOwnerWithPet, type OwnerWithPetContext } from "../helpers/auth";

// Risk #1 — owner-isolation on public.care_period_pets (S-08).
//
// This table carries no owner_id of its own; ownership is transitive through BOTH parents.
// That makes the with-check cases the reason this file exists: the policy predicate is a
// conjunction, and either half alone would be an IDOR that stays invisible until S-03 ships
// the instruction reveal.
//
//   - period A + pet B  → owner A attaches their own trip to someone else's pet, and that
//     pet's instructions would leak through A's invite link.
//   - period B + pet A  → owner A attaches their pet to someone else's trip.
//
// Neither is caught by checking one parent, and neither fails loudly today. Hence both are
// asserted here, alongside the four standard denial surfaces from test-plan.md §6.5.
//
// Seeding goes through create_period_with_slots, so these tests also prove the RPC links the
// pets it was given under the caller's own RLS.
describe("care_period_pets RLS owner-isolation", () => {
  let a: OwnerWithPetContext;
  let b: OwnerWithPetContext;
  let aPeriodId: string;
  let bPeriodId: string;

  async function seedPeriod(owner: OwnerWithPetContext, title: string, petIds: string[]): Promise<string> {
    const { data, error } = await owner.client.rpc("create_period_with_slots", {
      p_title: title,
      p_start_date: "2026-07-13",
      p_end_date: "2026-07-15",
      p_token_digest: crypto.randomUUID(),
      p_pet_ids: petIds,
    });
    expect(error).toBeNull();
    if (!data) {
      throw new Error(`care_period_pets RLS test: seeding "${title}" failed`);
    }
    return data.id;
  }

  beforeAll(async () => {
    a = await createOwnerWithPet("A-Burek");
    b = await createOwnerWithPet("B-Mru");

    aPeriodId = await seedPeriod(a, "A-wyjazd", [a.petId]);
    bPeriodId = await seedPeriod(b, "B-wyjazd", [b.petId]);
  });

  it("links the pets the RPC was given", async () => {
    const { data } = await a.client.from("care_period_pets").select("pet_id").eq("period_id", aPeriodId);
    expect(data).toEqual([{ pet_id: a.petId }]);
  });

  it("SELECT is isolated — each owner sees only their own links", async () => {
    const { data: aRows } = await a.client.from("care_period_pets").select("period_id, pet_id");
    const { data: bRows } = await b.client.from("care_period_pets").select("period_id, pet_id");

    expect(aRows).toEqual([{ period_id: aPeriodId, pet_id: a.petId }]);
    expect(bRows).toEqual([{ period_id: bPeriodId, pet_id: b.petId }]);
  });

  it("cross-tenant UPDATE affects zero rows and does not mutate the victim", async () => {
    const { data: updated, error } = await a.client
      .from("care_period_pets")
      .update({ pet_id: a.petId })
      .eq("period_id", bPeriodId)
      .select("period_id");

    // Denial under RLS is silent for UPDATE — zero rows, no error.
    expect(error).toBeNull();
    expect(updated).toEqual([]);

    const { data: bRow } = await b.client.from("care_period_pets").select("pet_id").eq("period_id", bPeriodId);
    expect(bRow).toEqual([{ pet_id: b.petId }]);
  });

  it("cross-tenant DELETE removes nothing (row survives)", async () => {
    const { error } = await a.client.from("care_period_pets").delete().eq("period_id", bPeriodId);
    expect(error).toBeNull();

    const { data: stillThere } = await b.client.from("care_period_pets").select("pet_id").eq("period_id", bPeriodId);
    expect(stillThere).toEqual([{ pet_id: b.petId }]);
  });

  // The two cases this file exists for. Each fails if the policy predicate drops one half of
  // its conjunction — and only these two would notice.
  it("refuses A's period + B's pet (with check, pet side)", async () => {
    const { error } = await a.client.from("care_period_pets").insert({ period_id: aPeriodId, pet_id: b.petId });

    // A owns the period, so a period-only predicate would have allowed this — and B's
    // instructions would then be reachable through A's invite link once S-03 ships.
    expect(error).not.toBeNull();

    const { data: leaked } = await b.client.from("care_period_pets").select("pet_id").eq("pet_id", b.petId);
    expect(leaked).toEqual([{ pet_id: b.petId }]);
  });

  it("refuses B's period + A's pet (with check, period side)", async () => {
    const { error } = await a.client.from("care_period_pets").insert({ period_id: bPeriodId, pet_id: a.petId });

    // A owns the pet, so a pet-only predicate would have allowed this.
    expect(error).not.toBeNull();
  });

  it("refuses a self-UPDATE that moves a link onto another owner's pet (with check)", async () => {
    const { error } = await a.client.from("care_period_pets").update({ pet_id: b.petId }).eq("period_id", aPeriodId);

    expect(error).not.toBeNull();
  });

  it("the RPC rolls the whole create back when a pet is not the caller's", async () => {
    const before = await a.client.from("care_periods").select("id");

    const { error } = await a.client.rpc("create_period_with_slots", {
      p_title: "A-kradziez",
      p_start_date: "2026-08-01",
      p_end_date: "2026-08-02",
      p_token_digest: crypto.randomUUID(),
      p_pet_ids: [b.petId],
    });

    // The join insert fails the with-check, which aborts the function's single transaction —
    // so no orphan period is left behind. This is the guarantee that keeps pet ownership in
    // the database rather than in the API handler.
    expect(error).not.toBeNull();

    const after = await a.client.from("care_periods").select("id");
    expect(after.data?.length).toBe(before.data?.length ?? 0);
  });

  it("the RPC refuses an empty pet list", async () => {
    const { error } = await a.client.rpc("create_period_with_slots", {
      p_title: "A-bez-zwierzat",
      p_start_date: "2026-08-05",
      p_end_date: "2026-08-06",
      p_token_digest: crypto.randomUUID(),
      p_pet_ids: [],
    });

    // "At least one pet" is enforced in the RPC and only there — see the plan's Critical
    // Implementation Details. This assertion is the whole guarantee, so it must exist.
    expect(error).not.toBeNull();
  });

  it("deduplicates a repeated pet id rather than failing on the primary key", async () => {
    const periodId = await seedPeriod(a, "A-duplikat", [a.petId, a.petId]);

    const { data } = await a.client.from("care_period_pets").select("pet_id").eq("period_id", periodId);
    expect(data).toEqual([{ pet_id: a.petId }]);
  });

  it("deleting a pet cascades the link and leaves the period petless, not broken", async () => {
    const solo = await createOwnerWithPet("Solo");
    const periodId = await seedPeriod(solo, "Solo-wyjazd", [solo.petId]);

    const { error } = await solo.client.from("pets").delete().eq("id", solo.petId);
    expect(error).toBeNull();

    const { data: links } = await solo.client.from("care_period_pets").select("pet_id").eq("period_id", periodId);
    const { data: period } = await solo.client.from("care_periods").select("id").eq("id", periodId);

    // A petless period is representable by decision, not by accident: enforcement of
    // "at least one pet" lives only in the RPC. S-03's caretaker page must tolerate this.
    expect(links).toEqual([]);
    expect(period).toEqual([{ id: periodId }]);
  });
});
