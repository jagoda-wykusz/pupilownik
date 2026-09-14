import { describe, expect, it } from "vitest";
import { PET_MESSAGES, petIdSchema, updatePetSchema } from "@/lib/schemas/pet";
import {
  MAX_INSTRUCTION_BODY_LENGTH,
  MAX_INSTRUCTION_TITLE_LENGTH,
  MAX_INSTRUCTIONS_PER_PET,
  MAX_PET_NAME_LENGTH,
} from "@/lib/pet-format";

// S-09 Phase 1 — the edit schema's message contract, in the Docker-free `unit` project.
//
// The point of this file is NOT to re-assert zod's own behaviour (an "implementation mirror",
// which test-plan.md §6.1 names as the anti-pattern). It is the language boundary: PUT
// /api/pets/[id] hands `issue.message` straight to the island, which renders it verbatim, so
// any path that produces a zod DEFAULT ships English onto an owner's screen.
//
// Membership against PET_MESSAGES is the assertion rather than a "does this look English"
// heuristic, for the reason PERIOD_MESSAGES records: zod's own defaults for the format checks
// ("Invalid UUID", "Invalid input") do not match any obvious English proxy, so a heuristic
// silently lets exactly the interesting cases through.

const ALLOWED: readonly string[] = Object.values(PET_MESSAGES);

function messagesFor(payload: unknown): string[] {
  const result = updatePetSchema.safeParse(payload);
  if (result.success) {
    throw new Error("pet-schema test: expected this payload to be refused, but it parsed");
  }
  return result.error.issues.map((issue) => issue.message);
}

const VALID = {
  name: "Burek",
  species: "dog",
  instructions: [{ title: "Karmienie", is_sensitive: false }],
};

describe("updatePetSchema — the message contract", () => {
  it("accepts a minimal valid payload", () => {
    expect(updatePetSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts an instruction carrying an id, and one without", () => {
    const parsed = updatePetSchema.safeParse({
      ...VALID,
      instructions: [
        { id: crypto.randomUUID(), title: "Istniejąca", is_sensitive: true },
        { title: "Nowa", body: "treść", is_sensitive: false },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  // The table-driven core. Every refusal an owner can trigger has to come back in Polish, and
  // each case names the message it must produce — so a future edit that swaps a message for
  // zod's default fails here rather than on someone's screen.
  const cases: { name: string; payload: unknown; expected: string }[] = [
    { name: "a missing name", payload: { species: "dog", instructions: [] }, expected: PET_MESSAGES.nameRequired },
    { name: "an empty name", payload: { ...VALID, name: "   " }, expected: PET_MESSAGES.nameRequired },
    {
      name: "a name past the bound",
      payload: { ...VALID, name: "x".repeat(MAX_PET_NAME_LENGTH + 1) },
      expected: PET_MESSAGES.nameTooLong,
    },
    { name: "a missing species", payload: { name: "B", instructions: [] }, expected: PET_MESSAGES.speciesInvalid },
    { name: "an unknown species", payload: { ...VALID, species: "dragon" }, expected: PET_MESSAGES.speciesInvalid },
    {
      name: "a non-object body",
      payload: 42,
      expected: PET_MESSAGES.notAnObject,
    },
    {
      name: "missing instructions",
      payload: { name: "B", species: "dog" },
      expected: PET_MESSAGES.instructionsRequired,
    },
    {
      name: "too many instructions",
      payload: {
        ...VALID,
        instructions: Array.from({ length: MAX_INSTRUCTIONS_PER_PET + 1 }, () => ({
          title: "x",
          is_sensitive: false,
        })),
      },
      expected: PET_MESSAGES.instructionsTooMany,
    },
    {
      name: "a malformed instruction id",
      payload: { ...VALID, instructions: [{ id: "nope", title: "x", is_sensitive: false }] },
      expected: PET_MESSAGES.instructionIdInvalid,
    },
    {
      name: "an empty instruction title",
      payload: { ...VALID, instructions: [{ title: "  ", is_sensitive: false }] },
      expected: PET_MESSAGES.instructionTitleRequired,
    },
    {
      name: "an instruction title past the bound",
      payload: {
        ...VALID,
        instructions: [{ title: "x".repeat(MAX_INSTRUCTION_TITLE_LENGTH + 1), is_sensitive: false }],
      },
      expected: PET_MESSAGES.instructionTitleTooLong,
    },
    {
      name: "an instruction body past the bound",
      payload: {
        ...VALID,
        instructions: [{ title: "x", body: "y".repeat(MAX_INSTRUCTION_BODY_LENGTH + 1), is_sensitive: false }],
      },
      expected: PET_MESSAGES.instructionBodyTooLong,
    },
    {
      name: "a missing is_sensitive",
      payload: { ...VALID, instructions: [{ title: "x" }] },
      expected: PET_MESSAGES.sensitiveRequired,
    },
  ];

  it.each(cases)("refuses $name with its own Polish sentence", ({ payload, expected }) => {
    expect(messagesFor(payload)).toContain(expected);
  });

  // The sweep: no payload an owner can send may produce a message from outside the table. This
  // is what catches a field added later without a message of its own.
  it.each(cases)("produces only PET_MESSAGES entries for $name", ({ payload }) => {
    for (const message of messagesFor(payload)) {
      expect(ALLOWED).toContain(message);
    }
  });

  // The bound is exactly the column's, asserted as an accept/refuse PAIR rather than a single
  // refusal — a refusal alone passes against a schema that refuses everything.
  it("accepts a name exactly at the bound and refuses one character more", () => {
    expect(updatePetSchema.safeParse({ ...VALID, name: "x".repeat(MAX_PET_NAME_LENGTH) }).success).toBe(true);
    expect(updatePetSchema.safeParse({ ...VALID, name: "x".repeat(MAX_PET_NAME_LENGTH + 1) }).success).toBe(false);
  });

  it("rejects a NUL character, which Postgres refuses while parsing the jsonb argument", () => {
    const withNul = `Bu${String.fromCharCode(0)}rek`;
    expect(messagesFor({ ...VALID, name: withNul })).toContain(PET_MESSAGES.nulCharacter);
  });

  it("does not accept a client-supplied sort_order — ordering belongs to the RPC", () => {
    const parsed = updatePetSchema.safeParse({
      ...VALID,
      instructions: [{ title: "x", is_sensitive: false, sort_order: 99 }],
    });
    // zod strips unknown keys rather than refusing them, so the assertion is that the value
    // does not survive into the parsed output — not that the parse fails.
    expect(parsed.success).toBe(true);
    expect(parsed.success && "sort_order" in parsed.data.instructions[0]).toBe(false);
  });
});

describe("petIdSchema", () => {
  it("accepts a v4 uuid", () => {
    expect(petIdSchema.safeParse(crypto.randomUUID()).success).toBe(true);
  });

  // The whole reason this is z.guid() and not z.uuid(). Every fixed identifier in
  // supabase/seed.sql has variant nibble 4, which RFC 4122 rejects and the `uuid` COLUMN
  // accepts happily — tightening this would make the seeded dataset unreachable through the UI.
  it("accepts a non-RFC-4122 uuid, because the column does", () => {
    expect(petIdSchema.safeParse("44444444-4444-4444-4444-444444444444").success).toBe(true);
  });

  it("refuses a malformed id", () => {
    expect(petIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});
