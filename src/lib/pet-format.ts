// Presentation constants for pets, shared by the owner's screens and the caretaker's page.
//
// Extracted in S-03 Phase 3, when the caretaker page became the THIRD consumer of the same
// three Polish words. Until then they were copied in `pets/index.astro` (as a Record) and in
// `AddPetForm.tsx` (as a {value,label} array for the segmented control) — two spellings of one
// fact, which is fine at two and stops being fine at three. `context/foundation/lessons.md`
// asks for the consumers to be enumerated before a shared thing changes; both were migrated
// here deliberately rather than left behind a new copy.
//
// Like `period-format.ts`, this module pulls in NO runtime dependency beyond the generated
// database types, so a React island can import it without dragging zod into the browser.

import type { Database } from "@/db/database.types";

export type Species = Database["public"]["Enums"]["pet_species"];

// Keyed by the enum, so adding a species to `pet_species` without adding a label here is a
// type error rather than an "undefined" rendered onto a page.
export const SPECIES_LABEL: Record<Species, string> = {
  dog: "Pies",
  cat: "Kot",
  other: "Inne",
};

// Declaration order is display order, and it is the order the design's segmented control
// draws. Derived from the map above rather than written out again — the point of this module
// is that the labels exist once.
export const SPECIES_OPTIONS: { value: Species; label: string }[] = (Object.keys(SPECIES_LABEL) as Species[]).map(
  (value) => ({ value, label: SPECIES_LABEL[value] }),
);

// Input bounds, here rather than in `schemas/pet.ts` for the same reason `period-format.ts`
// holds MAX_TITLE_LENGTH: an island needs them to validate before submitting, and importing
// the schema module would drag zod into the browser bundle.
//
// These are the values `createPetSchema` has enforced since S-01, moved rather than invented —
// `tests/api/pets.post.test.ts` pins every one of them as an accept/refuse pair (120/121,
// 2000/2001, 50/51), so a typo here fails immediately rather than silently widening a bound.
//
// MAX_INSTRUCTION_SORT_ORDER is the `integer` column's ceiling, not a domain rule: the RPC
// casts `(i ->> 'sort_order')::int`, so a larger value raised 22003 from Postgres. S-09's
// update path derives sort_order from array position and never reads a client-supplied one,
// but the bound stays exported because the create path still accepts it.
export const MAX_PET_NAME_LENGTH = 120;
export const MAX_PET_BREED_LENGTH = 120;
export const MAX_PET_AGE_LENGTH = 120;
export const MAX_INSTRUCTION_TITLE_LENGTH = 120;
export const MAX_INSTRUCTION_BODY_LENGTH = 2000;
export const MAX_INSTRUCTIONS_PER_PET = 50;
export const MAX_INSTRUCTION_SORT_ORDER = 2147483647;
