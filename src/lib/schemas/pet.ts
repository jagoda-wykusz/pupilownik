import { z } from "zod";

// Server-side contract for creating a pet with its care instructions. The API
// route is the source of truth — this schema is the single validation gate the
// handler (and later the client, for UX) share. Mirror of the pet_species enum
// and the create_pet_with_instructions RPC signature (see the S-01 migration).
// Upper bounds cap a single request: the RPC bulk-inserts every instruction in one
// transaction, so an unbounded array / huge strings would be a DoS vector.
export const createInstructionSchema = z.object({
  title: z.string().min(1, "Tytuł instrukcji jest wymagany").max(120),
  body: z.string().max(2000).optional(),
  is_sensitive: z.boolean(),
  sort_order: z.number().int().min(0).optional(),
});

export const createPetSchema = z.object({
  name: z.string().min(1, "Imię zwierzęcia jest wymagane").max(120),
  species: z.enum(["dog", "cat", "other"]),
  breed: z.string().max(120).optional(),
  age: z.string().max(120).optional(),
  instructions: z.array(createInstructionSchema).max(50),
});

export type CreatePetInput = z.infer<typeof createPetSchema>;
export type CreateInstructionInput = z.infer<typeof createInstructionSchema>;
