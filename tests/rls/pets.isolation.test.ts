import { beforeAll, describe, expect, it } from "vitest";
import { createOwnerClient, type OwnerContext } from "../helpers/auth";

// Risk #1 — owner-isolation on public.pets (S-01).
//
// Two distinct owners, each an ANON-KEYED client carrying its own user JWT (never a
// service_role client — that bypasses RLS and makes every assertion a tautology).
// The headline (test-plan §6.5): prove all four denial surfaces, not just SELECT —
// the deny-by-default gate lives on INSERT/DELETE.
describe("pets RLS owner-isolation", () => {
  let a: OwnerContext;
  let b: OwnerContext;
  let aPetId: string;
  let bPetId: string;

  beforeAll(async () => {
    a = await createOwnerClient();
    b = await createOwnerClient();

    const aInsert = await a.client
      .from("pets")
      .insert({ owner_id: a.userId, name: "A-dog", species: "dog" })
      .select("id")
      .single();
    const bInsert = await b.client
      .from("pets")
      .insert({ owner_id: b.userId, name: "B-cat", species: "cat" })
      .select("id")
      .single();

    expect(aInsert.error).toBeNull();
    expect(bInsert.error).toBeNull();
    if (!aInsert.data || !bInsert.data) {
      throw new Error("pets RLS test: seeding a pet failed");
    }
    aPetId = aInsert.data.id;
    bPetId = bInsert.data.id;
  });

  it("SELECT is isolated — each owner sees only their own pets", async () => {
    const { data: aRows } = await a.client.from("pets").select("id, owner_id");
    const { data: bRows } = await b.client.from("pets").select("id, owner_id");

    expect(aRows).toEqual([{ id: aPetId, owner_id: a.userId }]);
    expect(bRows).toEqual([{ id: bPetId, owner_id: b.userId }]);
    expect(aRows?.some((r) => r.owner_id === b.userId)).toBe(false);
    expect(bRows?.some((r) => r.owner_id === a.userId)).toBe(false);
  });

  it("cross-tenant UPDATE affects zero rows and does not mutate the victim", async () => {
    const { data: updated, error } = await a.client
      .from("pets")
      .update({ name: "hacked" })
      .eq("id", bPetId)
      .select("id");

    // B's pet is invisible to A → the UPDATE matches nothing. Not an error, 0 rows.
    expect(error).toBeNull();
    expect(updated).toEqual([]);

    const { data: bRow } = await b.client.from("pets").select("name").eq("id", bPetId).single();
    expect(bRow?.name).toBe("B-cat");
  });

  it("INSERT owning a pet as another user is denied (with check)", async () => {
    const { error } = await a.client.from("pets").insert({ owner_id: b.userId, name: "sneaky", species: "other" });
    expect(error).not.toBeNull();
  });

  it("cross-tenant DELETE removes nothing (row survives)", async () => {
    const { error } = await a.client.from("pets").delete().eq("id", bPetId);
    // No visibility on B's pet → 0 rows removed, no error.
    expect(error).toBeNull();

    const { data: stillThere } = await b.client.from("pets").select("id").eq("id", bPetId);
    expect(stillThere).toEqual([{ id: bPetId }]);
  });

  it("self-UPDATE cannot reassign owner_id to another owner (with check)", async () => {
    const { error } = await a.client.from("pets").update({ owner_id: b.userId }).eq("id", aPetId);
    // The with-check predicate ((select auth.uid()) = owner_id) rejects the reassignment.
    expect(error).not.toBeNull();
  });

  // The POSITIVE half, added by S-09. Every assertion above is a refusal, and a suite made only
  // of refusals stays green when the policy it is supposed to guard is DELETED — dropping
  // `pets_update_own` denies the owner too, so all four tests above keep passing. That is the
  // "asercja, która opisuje warstwę zamiast jej pilnować" failure in context/foundation/lessons.md.
  // S-09 leans on this policy (update_pet_with_instructions is security invoker and relies on it
  // as the authorization boundary), so it is pinned from the permitting side here.
  it("an owner CAN update their own pet — the permitting half of pets_update_own", async () => {
    const { data: updated, error } = await a.client
      .from("pets")
      .update({ name: "A-dog renamed", breed: "kundel" })
      .eq("id", aPetId)
      .select("id, name, breed");

    expect(error).toBeNull();
    expect(updated).toEqual([{ id: aPetId, name: "A-dog renamed", breed: "kundel" }]);

    // Read back through the owner's own client, never a service-role one.
    const { data: row } = await a.client.from("pets").select("name").eq("id", aPetId).single();
    expect(row?.name).toBe("A-dog renamed");

    // Restore, so the ordering of tests in this file stays irrelevant.
    await a.client.from("pets").update({ name: "A-dog", breed: null }).eq("id", aPetId);
  });
});
