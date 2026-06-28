import { beforeAll, describe, expect, it } from "vitest";
import { createOwnerClient, type OwnerContext } from "../helpers/auth";

// Risk #1 — owner-isolation on public.profiles.
//
// Two distinct owners, each an ANON-KEYED client carrying its own user JWT (never a
// service_role client — that bypasses RLS and makes every assertion a tautology).
// The signup trigger gives each owner exactly one profile row (id === userId).
//
// The headline (impl-review F3): prove the DENIED operations are actually denied.
// Grants may already permit INSERT/DELETE; deny-by-default RLS is the real gate.
describe("profiles RLS owner-isolation", () => {
  let a: OwnerContext;
  let b: OwnerContext;

  beforeAll(async () => {
    a = await createOwnerClient();
    b = await createOwnerClient();
  });

  it("SELECT is isolated — each owner sees only their own row", async () => {
    const { data: aRows, error: aErr } = await a.client.from("profiles").select("id");
    const { data: bRows, error: bErr } = await b.client.from("profiles").select("id");

    expect(aErr).toBeNull();
    expect(bErr).toBeNull();
    expect(aRows).toEqual([{ id: a.userId }]);
    expect(bRows).toEqual([{ id: b.userId }]);
    // Explicitly: A never sees B's row and vice versa.
    expect(aRows?.some((r) => r.id === b.userId)).toBe(false);
    expect(bRows?.some((r) => r.id === a.userId)).toBe(false);
  });

  it("cross-tenant UPDATE affects zero rows and does not mutate the victim", async () => {
    const { data: updated, error } = await a.client
      .from("profiles")
      .update({ created_at: new Date(0).toISOString() })
      .eq("id", b.userId)
      .select("id");

    // No SELECT visibility on B's row → the UPDATE matches nothing. Not an error, 0 rows.
    expect(error).toBeNull();
    expect(updated).toEqual([]);

    // Confirm from B's own session that nothing changed.
    const { data: bRow } = await b.client.from("profiles").select("created_at").eq("id", b.userId).single();
    expect(new Date(bRow?.created_at ?? 0).getTime()).not.toBe(0);
  });

  it("INSERT is denied (no INSERT policy → deny-by-default)", async () => {
    const { error } = await a.client.from("profiles").insert({ id: crypto.randomUUID() });
    // RLS rejects the write outright.
    expect(error).not.toBeNull();
  });

  it("DELETE of one's own row is denied (no DELETE policy → row survives)", async () => {
    const { error } = await a.client.from("profiles").delete().eq("id", a.userId);
    // No DELETE policy means the row is invisible to DELETE → 0 rows removed, no error.
    expect(error).toBeNull();

    const { data: stillThere } = await a.client.from("profiles").select("id").eq("id", a.userId);
    expect(stillThere).toEqual([{ id: a.userId }]);
  });

  it("self-UPDATE cannot reassign id to another owner (with check)", async () => {
    const { error } = await a.client.from("profiles").update({ id: b.userId }).eq("id", a.userId);
    // The with-check predicate ((select auth.uid()) = id) rejects the reassignment.
    expect(error).not.toBeNull();
  });
});
