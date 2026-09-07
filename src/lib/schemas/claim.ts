import { z } from "zod";
import { MAX_CLAIMANT_NAME_LENGTH, MAX_SLOTS_PER_CLAIM } from "@/lib/period-format";

// Server-side contract for POST /invite/claim.
//
// Every bound here mirrors one that `claim_slots` enforces in SQL. The SQL raise is the
// guarantee — it is the only thing standing between an anonymous caller and the table, and it
// holds whether or not this file exists. What this schema buys is that a malformed request
// answers a clean 400 with a Polish sentence instead of surfacing `PT400` as an opaque error,
// which is the same division of labour `createPeriodSchema` has with its RPC.
//
// The bounds are imported, not retyped: `period-format.ts` is where the shared numbers live so
// the island, this schema and the database cannot drift (see MAX_CLAIMANT_NAME_LENGTH's own
// comment for why that one is the odd case — it mirrors a function guard, not a column CHECK).

export const CLAIM_MESSAGES = {
  tokenInvalid: "Nieprawidłowy link zaproszenia",
  slotsRequired: "Wybierz co najmniej jeden termin",
  slotsTooMany: `Można zająć najwyżej ${MAX_SLOTS_PER_CLAIM} terminów naraz`,
  slotIdInvalid: "Nieprawidłowy identyfikator terminu",
  nameRequired: "Podaj swoje imię",
  nameTooLong: `Imię może mieć najwyżej ${MAX_CLAIMANT_NAME_LENGTH} znaków`,
  // A body that is not an object at all — valid JSON, so it reaches zod, and would otherwise
  // produce zod's English default with an empty path.
  notAnObject: "Dane są niepoprawne",
} as const;

export const claimSchema = z.object(
  {
    // 43 characters exactly, matching the bound get_period_by_token and claim_slots both
    // apply before hashing. The character class matters as much as the length: base64url only,
    // so a token carrying anything else is refused here rather than being hashed.
    token: z.string({ error: CLAIM_MESSAGES.tokenInvalid }).regex(/^[A-Za-z0-9_-]{43}$/, CLAIM_MESSAGES.tokenInvalid),

    slot_ids: z
      .array(z.uuid({ error: CLAIM_MESSAGES.slotIdInvalid }), { error: CLAIM_MESSAGES.slotsRequired })
      .min(1, CLAIM_MESSAGES.slotsRequired)
      .max(MAX_SLOTS_PER_CLAIM, CLAIM_MESSAGES.slotsTooMany),

    // Optional at the schema layer, required at the database layer — and only on a FIRST
    // claim. A caretaker whose cookie already holds slots on this trip sends no name, and
    // `claim_slots` reuses the stored one (it is the only enforcement of "one capability = one
    // identity", S-03 Phase 1 impl-review F1). Making this required here would break the
    // follow-up claim the whole cookie exists to enable.
    //
    // Trimmed before the length check so "   " is empty rather than three characters, matching
    // the `btrim` the function applies.
    name: z
      .string({ error: CLAIM_MESSAGES.nameRequired })
      .trim()
      .min(1, CLAIM_MESSAGES.nameRequired)
      .max(MAX_CLAIMANT_NAME_LENGTH, CLAIM_MESSAGES.nameTooLong)
      .optional(),
  },
  { error: CLAIM_MESSAGES.notAnObject },
);

export type ClaimInput = z.infer<typeof claimSchema>;
