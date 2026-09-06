import { beforeAll, describe, expect, it } from "vitest";
import { createOwnerClient, type OwnerContext } from "../helpers/auth";

// Risk #1 — owner-isolation on public.care_slots (S-02).
//
// Slots carry no owner_id of their own: ownership is transitive through
// care_periods.owner_id, the same shape as care_instructions through pets.owner_id. That
// makes the with-check cases the interesting ones — a slot must not be attachable to
// someone else's period.
//
// Seeding goes through create_period_with_slots rather than a raw insert, so these tests
// also prove the generation RPC produces the right rows under the caller's own RLS.
describe("care_slots RLS owner-isolation", () => {
  let a: OwnerContext;
  let b: OwnerContext;
  let aPeriodId: string;
  let bPeriodId: string;
  let bSlotId: string;

  async function seedPeriod(owner: OwnerContext, title: string, start: string, end: string): Promise<string> {
    const { data, error } = await owner.client.rpc("create_period_with_slots", {
      p_title: title,
      p_start_date: start,
      p_end_date: end,
      p_token_digest: crypto.randomUUID(),
    });
    expect(error).toBeNull();
    if (!data) {
      throw new Error(`care_slots RLS test: seeding "${title}" failed`);
    }
    return data.id;
  }

  beforeAll(async () => {
    a = await createOwnerClient();
    b = await createOwnerClient();

    // 3 days x 3 times of day = 9 slots each.
    aPeriodId = await seedPeriod(a, "A-wyjazd", "2026-07-13", "2026-07-15");
    bPeriodId = await seedPeriod(b, "B-wyjazd", "2026-08-01", "2026-08-03");

    const { data: bSlots } = await b.client.from("care_slots").select("id").eq("period_id", bPeriodId).limit(1);
    if (!bSlots || bSlots.length === 0) {
      throw new Error("care_slots RLS test: B's period generated no slots");
    }
    bSlotId = bSlots[0].id;
  });

  it("generates one slot per day per time-of-day", async () => {
    const { data: aSlots } = await a.client
      .from("care_slots")
      .select("slot_date, time_of_day")
      .eq("period_id", aPeriodId);

    expect(aSlots).toHaveLength(9);
    expect(new Set(aSlots?.map((s) => s.slot_date))).toEqual(new Set(["2026-07-13", "2026-07-14", "2026-07-15"]));
    expect(new Set(aSlots?.map((s) => s.time_of_day))).toEqual(new Set(["morning", "afternoon", "evening"]));
    // Every slot starts free; S-03 is what fills these.
    const { data: claimed } = await a.client
      .from("care_slots")
      .select("id")
      .eq("period_id", aPeriodId)
      .not("claimed_by_name", "is", null);
    expect(claimed).toEqual([]);
  });

  it("SELECT is isolated — each owner sees only slots in their own periods", async () => {
    const { data: aSlots } = await a.client.from("care_slots").select("period_id");
    const { data: bSlots } = await b.client.from("care_slots").select("period_id");

    expect(aSlots?.every((s) => s.period_id === aPeriodId)).toBe(true);
    expect(bSlots?.every((s) => s.period_id === bPeriodId)).toBe(true);
    expect(aSlots?.some((s) => s.period_id === bPeriodId)).toBe(false);
  });

  it("cross-tenant UPDATE affects zero rows and does not mutate the victim", async () => {
    const { data: updated, error } = await a.client
      .from("care_slots")
      .update({ claimed_by_name: "hacked" })
      .eq("id", bSlotId)
      .select("id");

    expect(error).toBeNull();
    expect(updated).toEqual([]);

    const { data: bRow } = await b.client.from("care_slots").select("claimed_by_name").eq("id", bSlotId).single();
    expect(bRow?.claimed_by_name).toBeNull();
  });

  it("INSERT into another owner's period is denied (with check)", async () => {
    const { error } = await a.client.from("care_slots").insert({
      period_id: bPeriodId,
      slot_date: "2026-08-04",
      time_of_day: "morning",
    });
    expect(error).not.toBeNull();
  });

  it("cross-tenant DELETE removes nothing (row survives)", async () => {
    const { error } = await a.client.from("care_slots").delete().eq("id", bSlotId);
    expect(error).toBeNull();

    const { data: stillThere } = await b.client.from("care_slots").select("id").eq("id", bSlotId);
    expect(stillThere).toEqual([{ id: bSlotId }]);
  });

  it("self-UPDATE cannot move a slot into another owner's period (with check)", async () => {
    const { data: aSlots } = await a.client.from("care_slots").select("id").eq("period_id", aPeriodId).limit(1);
    const aSlotId = aSlots?.[0]?.id;
    if (!aSlotId) {
      throw new Error("care_slots RLS test: A's period generated no slots");
    }

    const { error } = await a.client.from("care_slots").update({ period_id: bPeriodId }).eq("id", aSlotId);
    // The with-check predicate resolves against B's period, which A does not own.
    expect(error).not.toBeNull();
  });

  it("rejects a duplicate slot within the same period (unique constraint)", async () => {
    const { error } = await a.client.from("care_slots").insert({
      period_id: aPeriodId,
      slot_date: "2026-07-13",
      time_of_day: "morning",
    });
    // This is the constraint S-03's atomic claim rests on: no two rows for the same
    // (period, date, time-of-day), so a slot has exactly one identity.
    expect(error).not.toBeNull();
  });
});
