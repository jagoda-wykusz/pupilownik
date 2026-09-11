import { describe, expect, it } from "vitest";

import { composeCaretakerView } from "@/lib/invite-view";

// FR-008's guarantee, at the layer that decides what the caretaker page may render.
//
// The database half is already pinned: tests/rls/reveal-instructions.test.ts asserts that the
// read door's payload carries no sensitive row and no note, by searching the WHOLE serialized
// answer rather than a named field — because the failure to catch is "the column split is right
// but the API serializes it anyway". This file asserts the same property one layer up, the same
// way, because until composeCaretakerView existed the gate lived in a Map and a ternary in
// .astro frontmatter: rebuilding either from the PUBLIC payload leaked the sensitive tier to
// every holder of the link with the entire suite still green (test-plan.md §3 Phase 4, Risk #4).
//
// The sentinels below are searched for as SUBSTRINGS of the serialized result, not read out of
// named fields. A test that checks `pet.sensitiveInstructions` is empty passes just as happily
// when the same rows are copied somewhere else in the object.

const SECRET_TITLE = "Klucze";
const SECRET_BODY = "Klucze u sąsiadki, mieszkanie 4, kod 1234";
const NOTE = "Zapasowy klucz leży pod wycieraczką";

interface Instruction {
  id: string;
  title: string;
  body: string | null;
  sort_order: number;
}

interface Pet {
  id: string;
  name: string;
  species: "dog" | "cat" | "other";
  instructions: Instruction[];
}

function instruction(id: string, title: string, body: string | null): Instruction {
  return { id, title, body, sort_order: 0 };
}

function pet(id: string, name: string, instructions: Instruction[]): Pet {
  return { id, name, species: "dog", instructions };
}

/** The read door's answer: every pet, PUBLIC rows only. */
const PUBLIC_PETS: Pet[] = [
  pet("pet-a", "Burek", [instruction("pub-a", "Karmienie", "Rano i wieczorem")]),
  pet("pet-b", "Mruczek", [instruction("pub-b", "Spacer", "Raz dziennie")]),
];

/** The reveal door's answer: the SENSITIVE rows for the same pets, plus the trip note. */
const DETAILS = {
  pets: [pet("pet-a", "Burek", [instruction("sec-a", SECRET_TITLE, SECRET_BODY)]), pet("pet-b", "Mruczek", [])],
  caretaker_note: NOTE,
};

describe("composeCaretakerView — the instruction tier gate", () => {
  describe("before a claim", () => {
    it("hides the sensitive tier and the note ANYWHERE in the result, not just in their own fields", () => {
      const composed = composeCaretakerView({ pets: PUBLIC_PETS, details: null });

      const serialized = JSON.stringify(composed);
      expect(serialized).not.toContain(SECRET_BODY);
      expect(serialized).not.toContain(SECRET_TITLE);
      expect(serialized).not.toContain(NOTE);
    });

    it("still renders every pet with its public rows, so the page is not emptied by the gate", () => {
      const composed = composeCaretakerView({ pets: PUBLIC_PETS, details: null });

      expect(composed.pets.map((entry) => entry.name)).toEqual(["Burek", "Mruczek"]);
      expect(composed.pets[0]?.publicInstructions.map((row) => row.title)).toEqual(["Karmienie"]);
      expect(composed.pets.every((entry) => entry.sensitiveInstructions.length === 0)).toBe(true);
      expect(composed.caretakerNote).toBeNull();
    });

    it("gives the page no undifferentiated instruction list to reach for", () => {
      // The composed pet drops `instructions` on purpose. Keeping it would leave the template
      // two ways to say the same thing, and the day the tiers are composed differently one of
      // them goes stale without a failing test.
      const composed = composeCaretakerView({ pets: PUBLIC_PETS, details: null });

      expect(Object.keys(composed.pets[0] ?? {}).sort()).toEqual([
        "id",
        "name",
        "publicInstructions",
        "sensitiveInstructions",
        "species",
      ]);
    });
  });

  describe("after a claim", () => {
    it("reveals the sensitive rows on the right pet, and the note", () => {
      const composed = composeCaretakerView({ pets: PUBLIC_PETS, details: DETAILS });

      expect(composed.pets[0]?.sensitiveInstructions.map((row) => row.body)).toEqual([SECRET_BODY]);
      expect(composed.caretakerNote).toBe(NOTE);
    });

    it("keeps the two tiers apart rather than merging them", () => {
      // The design draws them as separate blocks and the whole slice is about the distinction;
      // a merged list would lose it while still "showing everything after the claim".
      const composed = composeCaretakerView({ pets: PUBLIC_PETS, details: DETAILS });

      expect(composed.pets[0]?.publicInstructions.map((row) => row.id)).toEqual(["pub-a"]);
      expect(composed.pets[0]?.sensitiveInstructions.map((row) => row.id)).toEqual(["sec-a"]);
    });

    it("lists a pet that has no sensitive rows with an empty list, not as missing", () => {
      const composed = composeCaretakerView({ pets: PUBLIC_PETS, details: DETAILS });

      expect(composed.pets[1]?.name).toBe("Mruczek");
      expect(composed.pets[1]?.sensitiveInstructions).toEqual([]);
      expect(composed.pets[1]?.publicInstructions.map((row) => row.id)).toEqual(["pub-b"]);
    });

    it("matches pets by id, so a future ordering change cannot hand one animal another's keys", () => {
      // The two doors order pets identically today (both `order by pet.name, pet.id`). This is
      // the case that stops that from becoming load-bearing: the failure it guards is silent —
      // a plausible-looking page with the wrong instructions on the wrong animal.
      const reversed = { ...DETAILS, pets: [...DETAILS.pets].reverse() };
      const composed = composeCaretakerView({ pets: PUBLIC_PETS, details: reversed });

      expect(composed.pets[0]?.name).toBe("Burek");
      expect(composed.pets[0]?.sensitiveInstructions.map((row) => row.id)).toEqual(["sec-a"]);
      expect(composed.pets[1]?.sensitiveInstructions).toEqual([]);
    });

    it("does not conjure a pet the read door never returned", () => {
      // A pet named only by the reveal would mean the two doors disagree about the period.
      // Inventing an animal out of the sensitive tier is the wrong way to answer that.
      const extra = {
        ...DETAILS,
        pets: [...DETAILS.pets, pet("pet-ghost", "Widmo", [instruction("sec-ghost", "Kod", "9999")])],
      };
      const composed = composeCaretakerView({ pets: PUBLIC_PETS, details: extra });

      expect(composed.pets.map((entry) => entry.id)).toEqual(["pet-a", "pet-b"]);
      expect(JSON.stringify(composed)).not.toContain("9999");
    });
  });
});
