import { describe, expect, it } from "vitest";

import { composeCaretakerView } from "@/lib/invite-view";

// What composeCaretakerView may put in front of the caretaker, at the layer that decides it.
//
// BE PRECISE ABOUT WHAT THIS CAN AND CANNOT PROVE, because the first version of this header was
// not and a review caught it. Secrecy is NOT enforced here: `get_period_by_token` returns public
// instruction rows only, so before a claim this function is never handed a sensitive row or the
// note in the first place — there is nothing to withhold. The real gate is the two database
// doors plus splitRevealAnswer, pinned by tests/rls/reveal-instructions.test.ts and
// tests/unit/invite-view.test.ts. What THIS file pins is everything downstream of that gate:
// that the two tiers stay apart, that rows land on the pet they belong to, that a pet is neither
// dropped nor conjured, and that the note travels with the reveal and only with it.
//
// Hence the shape of the pre-claim cases below. Searching a serialized result for a string the
// function was never given proves nothing — that technique is load-bearing in
// reveal-instructions.test.ts because the DATABASE holds the rows and chooses not to serialize
// them. The equivalent here is to hand the PUBLIC payload a sentinel row and assert the
// composition never promotes it into the sensitive tier, which is the mistake this code could
// actually make.

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

/** A row that is PUBLIC but carries a sentinel, so the pre-claim cases can assert the tier it
 *  ends up in rather than assert the absence of a string the function never received. */
const PUBLIC_SENTINEL = "PUBLICZNY-WIERSZ-NIE-JEST-WRAZLIWY";

/** The read door's answer: every pet, PUBLIC rows only. */
const PUBLIC_PETS: Pet[] = [
  pet("pet-a", "Burek", [instruction("pub-a", "Karmienie", PUBLIC_SENTINEL)]),
  pet("pet-b", "Mruczek", [instruction("pub-b", "Spacer", "Raz dziennie")]),
];

/** The reveal door's answer: the SENSITIVE rows for the same pets, plus the trip note. */
const DETAILS = {
  pets: [pet("pet-a", "Burek", [instruction("sec-a", SECRET_TITLE, SECRET_BODY)]), pet("pet-b", "Mruczek", [])],
  caretaker_note: NOTE,
};

describe("composeCaretakerView — the instruction tier gate", () => {
  describe("before a claim", () => {
    it("never promotes a public row into the sensitive tier", () => {
      // The falsifiable half of the pre-claim guarantee, and the one mistake this code could
      // actually make: composing `sensitiveInstructions` from the public payload. Asserting the
      // absence of SECRET_BODY here would prove nothing — it is never passed in.
      const composed = composeCaretakerView({ pets: PUBLIC_PETS, details: null });

      expect(JSON.stringify(composed.pets.map((entry) => entry.sensitiveInstructions))).not.toContain(PUBLIC_SENTINEL);
      expect(composed.pets[0]?.publicInstructions.map((row) => row.body)).toEqual([PUBLIC_SENTINEL]);
    });

    it("carries no trip note, whatever the public payload holds", () => {
      const composed = composeCaretakerView({ pets: PUBLIC_PETS, details: null });

      expect(composed.caretakerNote).toBeNull();
      expect(JSON.stringify(composed)).not.toContain(NOTE);
    });

    it("treats a proven-but-empty reveal exactly as no reveal", () => {
      // The shape the door genuinely returns for a caretaker whose trip has no sensitive rows
      // and no note — non-null, but carrying nothing. `details !== null` must not be read as
      // "something to show", which is the branch a conditional implementation would get wrong.
      const composed = composeCaretakerView({ pets: PUBLIC_PETS, details: { pets: [], caretaker_note: null } });

      expect(composed.caretakerNote).toBeNull();
      expect(composed.pets.map((entry) => entry.name)).toEqual(["Burek", "Mruczek"]);
      expect(composed.pets.every((entry) => entry.sensitiveInstructions.length === 0)).toBe(true);
      expect(composed.pets[0]?.publicInstructions.map((row) => row.id)).toEqual(["pub-a"]);
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
