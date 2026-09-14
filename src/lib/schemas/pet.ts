import { z } from "zod";
import {
  MAX_INSTRUCTION_BODY_LENGTH,
  MAX_INSTRUCTION_SORT_ORDER,
  MAX_INSTRUCTION_TITLE_LENGTH,
  MAX_INSTRUCTIONS_PER_PET,
  MAX_PET_AGE_LENGTH,
  MAX_PET_BREED_LENGTH,
  MAX_PET_NAME_LENGTH,
} from "@/lib/pet-format";

// Every user-supplied string goes through this, and the reason is a measured 500 rather than a
// preference. `z.string()` accepts U+0000; JSON.stringify emits it as a valid \u0000 escape, so
// request.json() parses it happily — and Postgres then refuses it while PARSING THE JSONB
// ARGUMENT, with SQLSTATE 22P05 ("unsupported Unicode escape sequence"). Measured 2026-09-12
// through the real route: a NUL in an instruction title or a pet name answered
// 500 "Nie udało się zapisać zwierzęcia", while the same payload without it answered 201.
//
// That is the same defect class this change was opened to close — bad client input reading as a
// server fault — one SQLSTATE away from the one it did close. It is reachable through `name`,
// `breed`, `age`, instruction `title` and `body`, by any signed-in caller.
//
// A NUL is rejected rather than stripped: silently altering what someone typed is a worse answer
// than telling them it is not storable, and Postgres cannot store it in a text column at all.
const textField = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !value.includes("\u0000"), {
      message: "Tekst nie może zawierać znaku zerowego",
    });

// Server-side contract for creating a pet with its care instructions. The API
// route is the source of truth — this schema is the single validation gate the
// handler (and later the client, for UX) share. Mirror of the pet_species enum
// and the create_pet_with_instructions RPC signature (see the S-01 migration).
// Upper bounds cap a single request: the RPC bulk-inserts every instruction in one
// transaction, so an unbounded array / huge strings would be a DoS vector.
export const createInstructionSchema = z.object({
  title: textField(MAX_INSTRUCTION_TITLE_LENGTH).and(z.string().min(1, "Tytuł instrukcji jest wymagany")),
  body: textField(MAX_INSTRUCTION_BODY_LENGTH).optional(),
  is_sensitive: z.boolean(),
  // Bounded ABOVE as well as below, and the ceiling is the column's, not a domain rule.
  // `care_instructions.sort_order` is `integer` (20260712204748_pets_and_instructions.sql:32) and
  // create_pet_with_instructions casts `(i ->> 'sort_order')::int` inside the function, so a value
  // past 2^31-1 reached Postgres and raised 22003. Measured 2026-09-12 through the real route:
  // 1e12 answered 500 "Nie udało się zapisać zwierzęcia", while 2147483647 created the pet — so
  // the limit is exactly the type's, which is why this bound is the type's and not an invented
  // smaller one. A tighter domain cap would be a rule this change has no basis for.
  sort_order: z.number().int().min(0).max(MAX_INSTRUCTION_SORT_ORDER).optional(),
});

export const createPetSchema = z.object({
  name: textField(MAX_PET_NAME_LENGTH).and(z.string().min(1, "Imię zwierzęcia jest wymagane")),
  species: z.enum(["dog", "cat", "other"]),
  breed: textField(MAX_PET_BREED_LENGTH).optional(),
  age: textField(MAX_PET_AGE_LENGTH).optional(),
  instructions: z.array(createInstructionSchema).max(MAX_INSTRUCTIONS_PER_PET),
});

export type CreatePetInput = z.infer<typeof createPetSchema>;
export type CreateInstructionInput = z.infer<typeof createInstructionSchema>;

// ── S-09: the edit path ──────────────────────────────────────────────────────────────────
//
// `updatePetSchema` is NOT `createPetSchema` with an extra key, even though the field list is
// almost identical, and the difference is the error contract rather than the shape.
//
// POST /api/pets answers `{ error: "Validation failed", issues }` — the S-01 convention, with
// zod's raw issues attached. The newer routes (periods.ts:42, claim.ts:76-78) answer a single
// Polish sentence the island renders verbatim, and `issues` was dropped there because nothing
// read it and it shipped zod's English internals alongside the Polish. PUT follows the newer
// one, which means every field needs a Polish message at the TYPE level too: `.min(1, …)` only
// fires when a key is present but empty, so a MISSING key hits the type check first and would
// otherwise surface zod's English default straight onto the owner's screen.
//
// The create schema is deliberately left alone. Migrating it would change the body of a route
// whose tests pin `body.error === "Validation failed"` (tests/api/pets.post.test.ts:122), and
// that is a separate change with its own consumers to enumerate.

// The exact set of messages this schema can produce. Exported so a unit test can assert
// membership rather than guessing at "does this look English" — zod's defaults for the format
// checks ("Invalid UUID") do not match any obvious English heuristic, so a proxy silently lets
// them through. Membership fails on all of them. Same reasoning as PERIOD_MESSAGES.
export const PET_MESSAGES = {
  nameRequired: "Imię zwierzęcia jest wymagane",
  nameTooLong: `Imię może mieć najwyżej ${MAX_PET_NAME_LENGTH} znaków`,
  speciesInvalid: "Wybierz gatunek zwierzęcia",
  breedTooLong: `Rasa może mieć najwyżej ${MAX_PET_BREED_LENGTH} znaków`,
  ageTooLong: `Wiek może mieć najwyżej ${MAX_PET_AGE_LENGTH} znaków`,
  instructionsRequired: "Lista instrukcji jest wymagana",
  instructionsTooMany: `Zwierzę może mieć najwyżej ${MAX_INSTRUCTIONS_PER_PET} instrukcji`,
  instructionIdInvalid: "Nieprawidłowy identyfikator instrukcji",
  instructionTitleRequired: "Tytuł instrukcji jest wymagany",
  instructionTitleTooLong: `Tytuł instrukcji może mieć najwyżej ${MAX_INSTRUCTION_TITLE_LENGTH} znaków`,
  instructionBodyTooLong: `Treść instrukcji może mieć najwyżej ${MAX_INSTRUCTION_BODY_LENGTH} znaków`,
  sensitiveRequired: "Oznaczenie instrukcji jako wrażliwej jest wymagane",
  fieldInvalid: "Nieprawidłowa wartość pola",
  nulCharacter: "Tekst nie może zawierać znaku zerowego",
  // The shape itself, not a field. Without this, a non-object body (null, "x", 42, []) is
  // valid JSON, reaches zod, and produces its English default with an empty path — which the
  // route would then hand to the island to render.
  notAnObject: "Dane są niepoprawne",
} as const;

// U+0000, built rather than written as a literal escape. `textField` at the top of this file
// spells it as a string escape and means exactly the same character.
const NUL_CHARACTER = String.fromCharCode(0);

// A Polish-messaged twin of `textField`. The NUL refusal is the same measured 22P05 defence
// documented at the top of this file; only the message plumbing differs.
//
// Two messages, not one, and the split is a measured bug rather than tidiness. The first
// argument to z.string() is the TYPE-level message — the one a MISSING key produces, because a
// missing key fails the type check before any `.max()` or `.min()` refinement runs. Passing the
// too-long sentence there meant an omitted `name` answered "Imię może mieć najwyżej 120 znaków",
// which tells the owner the opposite of what is wrong. Caught by tests/api/pets.put.test.ts.
const petTextField = (max: number, invalid: string, tooLong: string) =>
  z
    .string(invalid)
    .max(max, tooLong)
    .refine((value) => !value.includes(NUL_CHARACTER), { message: PET_MESSAGES.nulCharacter });

// `id` present -> the RPC updates that stored row; absent -> it inserts a new one. Rows the
// payload never names are deleted. That is what makes PUT the honest verb: the body is the
// complete desired instruction set, not a patch.
//
// `sort_order` is deliberately ABSENT from this schema, unlike the create one. The update RPC
// derives it from array position, so accepting a client value would mean two writers disagree
// about who owns ordering — which is how a list starts reordering itself on save.
export const updateInstructionSchema = z.object(
  {
    id: z.guid(PET_MESSAGES.instructionIdInvalid).optional(),
    title: petTextField(
      MAX_INSTRUCTION_TITLE_LENGTH,
      PET_MESSAGES.instructionTitleRequired,
      PET_MESSAGES.instructionTitleTooLong,
    )
      .refine((value) => value.trim().length > 0, { message: PET_MESSAGES.instructionTitleRequired })
      .pipe(z.string()),
    body: petTextField(
      MAX_INSTRUCTION_BODY_LENGTH,
      PET_MESSAGES.fieldInvalid,
      PET_MESSAGES.instructionBodyTooLong,
    ).optional(),
    is_sensitive: z.boolean(PET_MESSAGES.sensitiveRequired),
  },
  PET_MESSAGES.notAnObject,
);

export const updatePetSchema = z.object(
  {
    name: petTextField(MAX_PET_NAME_LENGTH, PET_MESSAGES.nameRequired, PET_MESSAGES.nameTooLong)
      .refine((value) => value.trim().length > 0, { message: PET_MESSAGES.nameRequired })
      .pipe(z.string()),
    species: z.enum(["dog", "cat", "other"], PET_MESSAGES.speciesInvalid),
    breed: petTextField(MAX_PET_BREED_LENGTH, PET_MESSAGES.fieldInvalid, PET_MESSAGES.breedTooLong).optional(),
    age: petTextField(MAX_PET_AGE_LENGTH, PET_MESSAGES.fieldInvalid, PET_MESSAGES.ageTooLong).optional(),
    instructions: z
      .array(updateInstructionSchema, PET_MESSAGES.instructionsRequired)
      .max(MAX_INSTRUCTIONS_PER_PET, PET_MESSAGES.instructionsTooMany),
  },
  PET_MESSAGES.notAnObject,
);

export type UpdatePetInput = z.infer<typeof updatePetSchema>;
export type UpdateInstructionInput = z.infer<typeof updateInstructionSchema>;

// z.guid(), not z.uuid(). The full reasoning lives on `periodIdSchema` in
// `src/lib/schemas/period.ts` and applies here identically: zod's uuid() enforces the RFC 4122
// variant nibble, the `uuid` COLUMN enforces nothing of the sort, and every fixed identifier in
// supabase/seed.sql fails the stricter check. A pet id is the same shape from the same
// generator. Do not "tighten" this to uuid().
//
// Declared here rather than imported from period.ts so a pet route does not have to reach into
// the period module for its id guard; the note above is the shared part, not the symbol.
export const petIdSchema = z.guid();
