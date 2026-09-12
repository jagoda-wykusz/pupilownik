import { z } from "zod";

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
  title: textField(120).and(z.string().min(1, "Tytuł instrukcji jest wymagany")),
  body: textField(2000).optional(),
  is_sensitive: z.boolean(),
  // Bounded ABOVE as well as below, and the ceiling is the column's, not a domain rule.
  // `care_instructions.sort_order` is `integer` (20260712204748_pets_and_instructions.sql:32) and
  // create_pet_with_instructions casts `(i ->> 'sort_order')::int` inside the function, so a value
  // past 2^31-1 reached Postgres and raised 22003. Measured 2026-09-12 through the real route:
  // 1e12 answered 500 "Nie udało się zapisać zwierzęcia", while 2147483647 created the pet — so
  // the limit is exactly the type's, which is why this bound is the type's and not an invented
  // smaller one. A tighter domain cap would be a rule this change has no basis for.
  sort_order: z.number().int().min(0).max(2147483647).optional(),
});

export const createPetSchema = z.object({
  name: textField(120).and(z.string().min(1, "Imię zwierzęcia jest wymagane")),
  species: z.enum(["dog", "cat", "other"]),
  breed: textField(120).optional(),
  age: textField(120).optional(),
  instructions: z.array(createInstructionSchema).max(50),
});

export type CreatePetInput = z.infer<typeof createPetSchema>;
export type CreateInstructionInput = z.infer<typeof createInstructionSchema>;
