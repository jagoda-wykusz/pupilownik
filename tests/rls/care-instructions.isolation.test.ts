import { beforeAll, describe, expect, it } from "vitest";
import { createOwnerClient, type OwnerContext } from "../helpers/auth";

// Risk #1 — owner-isolation on public.care_instructions (S-01).
//
// care_instructions has NO owner_id; ownership is transitive through the parent pet
// (pets.owner_id). These tests prove the transitive RLS gate on all four surfaces via
// two distinct anon-keyed owners (never service_role).
describe("care_instructions RLS owner-isolation (transitive via pet)", () => {
  let a: OwnerContext;
  let b: OwnerContext;
  let aPetId: string;
  let bPetId: string;
  let aInsId: string;
  let bInsId: string;

  async function seedPetWithInstruction(
    owner: OwnerContext,
    petName: string,
    title: string,
  ): Promise<{ petId: string; insId: string }> {
    const pet = await owner.client
      .from("pets")
      .insert({ owner_id: owner.userId, name: petName, species: "dog" })
      .select("id")
      .single();
    expect(pet.error).toBeNull();
    if (!pet.data) {
      throw new Error("care_instructions RLS test: seeding a pet failed");
    }
    const petId = pet.data.id;

    const ins = await owner.client.from("care_instructions").insert({ pet_id: petId, title }).select("id").single();
    expect(ins.error).toBeNull();
    if (!ins.data) {
      throw new Error("care_instructions RLS test: seeding an instruction failed");
    }
    return { petId, insId: ins.data.id };
  }

  beforeAll(async () => {
    a = await createOwnerClient();
    b = await createOwnerClient();
    ({ petId: aPetId, insId: aInsId } = await seedPetWithInstruction(a, "A-pet", "A-feed"));
    ({ petId: bPetId, insId: bInsId } = await seedPetWithInstruction(b, "B-pet", "B-feed"));
  });

  it("SELECT is isolated — each owner sees only instructions under their own pets", async () => {
    const { data: aRows } = await a.client.from("care_instructions").select("id, pet_id");
    const { data: bRows } = await b.client.from("care_instructions").select("id, pet_id");

    expect(aRows).toEqual([{ id: aInsId, pet_id: aPetId }]);
    expect(bRows).toEqual([{ id: bInsId, pet_id: bPetId }]);
    expect(aRows?.some((r) => r.id === bInsId)).toBe(false);
  });

  it("cross-tenant UPDATE affects zero rows and does not mutate the victim", async () => {
    const { data: updated, error } = await a.client
      .from("care_instructions")
      .update({ title: "hacked" })
      .eq("id", bInsId)
      .select("id");

    expect(error).toBeNull();
    expect(updated).toEqual([]);

    const { data: bRow } = await b.client.from("care_instructions").select("title").eq("id", bInsId).single();
    expect(bRow?.title).toBe("B-feed");
  });

  it("INSERT under another owner's pet is denied (with check)", async () => {
    const { error } = await a.client.from("care_instructions").insert({ pet_id: bPetId, title: "sneaky" });
    // The parent pet is not owned by A → the transitive with-check fails.
    expect(error).not.toBeNull();
  });

  it("cross-tenant DELETE removes nothing (row survives)", async () => {
    const { error } = await a.client.from("care_instructions").delete().eq("id", bInsId);
    expect(error).toBeNull();

    const { data: stillThere } = await b.client.from("care_instructions").select("id").eq("id", bInsId);
    expect(stillThere).toEqual([{ id: bInsId }]);
  });

  // ── The positive half, and the one hole the refusals above leave ──────────────────────
  // Added by S-09, which relies on both policies: update_pet_with_instructions is security
  // invoker and synchronises these rows under the caller's own RLS. Every assertion above is a
  // refusal, so all four survive DELETING the policies they describe.

  it("an owner CAN update their own instruction — the permitting half of care_instructions_update_own", async () => {
    const { data: updated, error } = await a.client
      .from("care_instructions")
      .update({ title: "A-feed twice daily", body: "250g" })
      .eq("id", aInsId)
      .select("id, title, body");

    expect(error).toBeNull();
    expect(updated).toEqual([{ id: aInsId, title: "A-feed twice daily", body: "250g" }]);

    await a.client.from("care_instructions").update({ title: "A-feed", body: null }).eq("id", aInsId);
  });

  it("an owner CAN delete their own instruction — the permitting half of care_instructions_delete_own", async () => {
    const seeded = await a.client
      .from("care_instructions")
      .insert({ pet_id: aPetId, title: "A-temporary" })
      .select("id")
      .single();
    expect(seeded.error).toBeNull();
    if (!seeded.data) {
      throw new Error("care_instructions RLS test: seeding a throwaway instruction failed");
    }

    const { error } = await a.client.from("care_instructions").delete().eq("id", seeded.data.id);
    expect(error).toBeNull();

    const { data: gone } = await a.client.from("care_instructions").select("id").eq("id", seeded.data.id);
    expect(gone).toEqual([]);
  });

  // The defence S-09 actually leans on, and which nothing pinned before. An edit payload
  // carries instruction ids, so re-pointing one at a stranger's pet is the natural attack on
  // that route. Only INSERT under a foreign pet was covered above; UPDATE was not.
  //
  // Measured in psql 2026-09-13 before this test existed: "new row violates row-level security
  // policy for table care_instructions". This asserts the refusal rather than the message.
  it("re-pointing an own instruction at another owner's pet is denied (update with check)", async () => {
    const { error } = await a.client.from("care_instructions").update({ pet_id: bPetId }).eq("id", aInsId);
    expect(error).not.toBeNull();

    // And the row still belongs where it did — a refusal that left the row moved would be worse
    // than no refusal, because the error would look handled.
    const { data: row } = await a.client.from("care_instructions").select("pet_id").eq("id", aInsId).single();
    expect(row?.pet_id).toBe(aPetId);
  });
});
