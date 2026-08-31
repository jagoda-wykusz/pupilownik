import { z } from "zod";

// Server-side contract for creating a pet with its care instructions. The API
// route is the source of truth — this schema is the single validation gate the
// handler (and later the client, for UX) share. Mirror of the pet_species enum
// and the create_pet_with_instructions RPC signature (see the S-01 migration).
export const createInstructionSchema = z.object({
  title: z.string().min(1, "Tytuł instrukcji jest wymagany"),
  body: z.string().optional(),
  is_sensitive: z.boolean(),
  sort_order: z.number().int().optional(),
});

export const createPetSchema = z.object({
  name: z.string().min(1, "Imię zwierzęcia jest wymagane"),
  species: z.enum(["dog", "cat", "other"]),
  breed: z.string().optional(),
  age: z.string().optional(),
  instructions: z.array(createInstructionSchema),
});

export type CreatePetInput = z.infer<typeof createPetSchema>;
export type CreateInstructionInput = z.infer<typeof createInstructionSchema>;
