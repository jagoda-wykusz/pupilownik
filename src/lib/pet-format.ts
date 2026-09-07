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
