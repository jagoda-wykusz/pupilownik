import { z } from "zod";
import { countDays, MAX_PETS_PER_PERIOD, MAX_SPAN_DAYS, MAX_TITLE_LENGTH } from "@/lib/period-format";

// Server-side contract for creating a care period. The API route is the source of
// truth — this schema is the single validation gate the handler (and the island, for
// UX) share. Mirror of the create_period_with_slots RPC signature (S-02).
//
// The span bound and the day count live in period-format.ts rather than here so the
// island can reuse them without pulling zod into the browser bundle. Duplicating the
// database's CHECK is deliberate: the CHECK is the guarantee, this is what turns a
// violation into a clean 400 instead of a 500.

// The exact set of messages this schema can produce. Exported so the unit test can assert
// membership instead of guessing at "does this look English" — zod's own defaults for the
// format checks ("Invalid UUID", "Invalid ISO date") do not match any obvious English
// heuristic, so a proxy silently lets them through. Membership fails on ALL of them.
export const PERIOD_MESSAGES = {
  titleRequired: "Nazwa wyjazdu jest wymagana",
  titleTooLong: `Nazwa może mieć najwyżej ${MAX_TITLE_LENGTH} znaków`,
  petsRequired: "Wybierz co najmniej jedno zwierzę",
  petsTooMany: `Wyjazd może obejmować najwyżej ${MAX_PETS_PER_PERIOD} zwierząt`,
  petIdInvalid: "Nieprawidłowy identyfikator zwierzęcia",
  startDateInvalid: "Podaj poprawną datę rozpoczęcia",
  endDateInvalid: "Podaj poprawną datę zakończenia",
  datesReversed: "Data zakończenia nie może być wcześniejsza niż data rozpoczęcia",
  spanTooLong: `Wyjazd może trwać najwyżej ${MAX_SPAN_DAYS} dni`,
  // The shape itself, not a field. Without this, a non-object body (null, "x", 42, []) is
  // valid JSON, reaches zod, and produces its English default with an empty path — which the
  // route would then hand to the island to render.
  notAnObject: "Dane są niepoprawne",
} as const;

export const createPeriodSchema = z
  .object(
    {
      // Every message here is user-facing: the route returns the first issue's message and the
      // island renders it verbatim, so a field must carry a Polish message at the TYPE level
      // too. `.min(1, …)` only fires when the key is present but empty — a MISSING key hits the
      // type check first and would otherwise surface zod's English default.
      title: z
        .string(PERIOD_MESSAGES.titleRequired)
        .trim()
        .min(1, PERIOD_MESSAGES.titleRequired)
        .max(MAX_TITLE_LENGTH, PERIOD_MESSAGES.titleTooLong),
      start_date: z.iso.date(PERIOD_MESSAGES.startDateInvalid),
      end_date: z.iso.date(PERIOD_MESSAGES.endDateInvalid),
      // At least one pet is also enforced inside create_period_with_slots, which is the
      // guarantee; this bound is what turns a violation into a clean 400 instead of surfacing
      // the RPC's raise as a 500.
      pet_ids: z
        .array(z.uuid(PERIOD_MESSAGES.petIdInvalid), PERIOD_MESSAGES.petsRequired)
        .min(1, PERIOD_MESSAGES.petsRequired)
        .max(MAX_PETS_PER_PERIOD, PERIOD_MESSAGES.petsTooMany),
    },
    PERIOD_MESSAGES.notAnObject,
  )
  .refine((value) => Date.parse(value.end_date) >= Date.parse(value.start_date), {
    message: PERIOD_MESSAGES.datesReversed,
    path: ["end_date"],
  })
  .refine((value) => countDays(value.start_date, value.end_date) <= MAX_SPAN_DAYS, {
    message: PERIOD_MESSAGES.spanTooLong,
    path: ["end_date"],
  });

export const periodIdSchema = z.uuid();
