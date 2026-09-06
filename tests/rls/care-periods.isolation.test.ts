import { beforeAll, describe, expect, it } from "vitest";
import { createOwnerClient, type OwnerContext } from "../helpers/auth";

// Risk #1 — owner-isolation on public.care_periods (S-02).
//
// Mirrors tests/rls/pets.isolation.test.ts: two distinct owners, each an ANON-KEYED client
// carrying its own user JWT (never a service_role client — that bypasses RLS and makes every
// assertion a tautology). Per test-plan §6.5, all four denial surfaces are asserted, not just
// SELECT — the deny-by-default gate lives on INSERT/DELETE too.
//
// token_digest is seeded with a distinct dummy per row: the column is NOT NULL from the first
// migration, and Phase 2 adds a unique index on it, so reusing one value here would start
// failing then.
describe("care_periods RLS owner-isolation", () => {
  let a: OwnerContext;
  let b: OwnerContext;
  let aPeriodId: string;
  let bPeriodId: string;

  beforeAll(async () => {
    a = await createOwnerClient();
    b = await createOwnerClient();

    const aInsert = await a.client
      .from("care_periods")
      .insert({
        owner_id: a.userId,
        title: "A-wyjazd",
        start_date: "2026-07-13",
        end_date: "2026-07-15",
        token_digest: crypto.randomUUID(),
      })
      .select("id")
      .single();
    const bInsert = await b.client
      .from("care_periods")
      .insert({
        owner_id: b.userId,
        title: "B-wyjazd",
        start_date: "2026-08-01",
        end_date: "2026-08-03",
        token_digest: crypto.randomUUID(),
      })
      .select("id")
      .single();

    expect(aInsert.error).toBeNull();
    expect(bInsert.error).toBeNull();
    if (!aInsert.data || !bInsert.data) {
      throw new Error("care_periods RLS test: seeding a period failed");
    }
    aPeriodId = aInsert.data.id;
    bPeriodId = bInsert.data.id;
  });

  it("SELECT is isolated — each owner sees only their own periods", async () => {
    const { data: aRows } = await a.client.from("care_periods").select("id, owner_id");
    const { data: bRows } = await b.client.from("care_periods").select("id, owner_id");

    expect(aRows).toEqual([{ id: aPeriodId, owner_id: a.userId }]);
    expect(bRows).toEqual([{ id: bPeriodId, owner_id: b.userId }]);
    expect(aRows?.some((r) => r.owner_id === b.userId)).toBe(false);
    expect(bRows?.some((r) => r.owner_id === a.userId)).toBe(false);
  });

  it("cross-tenant UPDATE affects zero rows and does not mutate the victim", async () => {
    const { data: updated, error } = await a.client
      .from("care_periods")
      .update({ title: "hacked" })
      .eq("id", bPeriodId)
      .select("id");

    // B's period is invisible to A → the UPDATE matches nothing. Not an error, 0 rows.
    expect(error).toBeNull();
    expect(updated).toEqual([]);

    const { data: bRow } = await b.client.from("care_periods").select("title").eq("id", bPeriodId).single();
    expect(bRow?.title).toBe("B-wyjazd");
  });

  it("INSERT owning a period as another user is denied (with check)", async () => {
    const { error } = await a.client.from("care_periods").insert({
      owner_id: b.userId,
      title: "sneaky",
      start_date: "2026-09-01",
      end_date: "2026-09-02",
      token_digest: crypto.randomUUID(),
    });
    expect(error).not.toBeNull();
  });

  it("cross-tenant DELETE removes nothing (row survives)", async () => {
    const { error } = await a.client.from("care_periods").delete().eq("id", bPeriodId);
    // No visibility on B's period → 0 rows removed, no error.
    expect(error).toBeNull();

    const { data: stillThere } = await b.client.from("care_periods").select("id").eq("id", bPeriodId);
    expect(stillThere).toEqual([{ id: bPeriodId }]);
  });

  it("self-UPDATE cannot reassign owner_id to another owner (with check)", async () => {
    const { error } = await a.client.from("care_periods").update({ owner_id: b.userId }).eq("id", aPeriodId);
    // The with-check predicate ((select auth.uid()) = owner_id) rejects the reassignment.
    expect(error).not.toBeNull();
  });

  it("rejects a period whose end_date precedes its start_date", async () => {
    const { error } = await a.client.from("care_periods").insert({
      owner_id: a.userId,
      title: "odwrócony",
      start_date: "2026-07-20",
      end_date: "2026-07-10",
      token_digest: crypto.randomUUID(),
    });
    expect(error).not.toBeNull();
  });

  it("rejects a period longer than 31 days", async () => {
    // 2026-07-01 → 2026-08-05 is 36 days; the CHECK caps the span at 31 inclusive, which is
    // what bounds how many slots one transaction can generate.
    const { error } = await a.client.from("care_periods").insert({
      owner_id: a.userId,
      title: "za długi",
      start_date: "2026-07-01",
      end_date: "2026-08-05",
      token_digest: crypto.randomUUID(),
    });
    expect(error).not.toBeNull();
  });
});
