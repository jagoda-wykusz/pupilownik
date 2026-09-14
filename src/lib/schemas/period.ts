import { z } from "zod";
import { countDays, MAX_NOTE_LENGTH, MAX_PETS_PER_PERIOD, MAX_SPAN_DAYS, MAX_TITLE_LENGTH } from "@/lib/period-format";

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
  noteTooLong: `Notatka może mieć najwyżej ${MAX_NOTE_LENGTH} znaków`,
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
      // z.guid(), NOT z.uuid() — see the note above periodIdSchema. z.uuid() enforces the
      // RFC 4122 variant nibble, which the `uuid` column does not, so it rejected pet ids
      // the database holds perfectly happily (every fixed id in supabase/seed.sql).
      pet_ids: z
        .array(z.guid(PERIOD_MESSAGES.petIdInvalid), PERIOD_MESSAGES.petsRequired)
        .min(1, PERIOD_MESSAGES.petsRequired)
        .max(MAX_PETS_PER_PERIOD, PERIOD_MESSAGES.petsTooMany),
      // The design's NOTATKA: free text about the TRIP, not about a pet. Optional — a trip
      // without one is the normal case.
      //
      // Unlike `title`, the bound here is mirrored from a real database CHECK
      // (care_periods_note_length), so this is the "clean 400 instead of a constraint error"
      // half of a two-layer guarantee rather than the only layer.
      //
      // The transform normalises an untouched textarea's "" to undefined so the RPC receives
      // NULL. That matters beyond tidiness: Phase 3 reveals the note only to a caretaker who
      // has claimed, and it keys the callout on `caretaker_note is null`. An empty string
      // stored instead of NULL would render an empty highlighted box on the caretaker's
      // screen for every trip whose owner never typed a note.
      caretaker_note: z
        .string(PERIOD_MESSAGES.noteTooLong)
        .trim()
        .max(MAX_NOTE_LENGTH, PERIOD_MESSAGES.noteTooLong)
        .optional()
        .transform((value) => (value === undefined || value === "" ? undefined : value)),
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

// z.guid(), not z.uuid(), and the difference is load-bearing rather than cosmetic.
//
// zod's `uuid()` enforces RFC 4122: it checks the version nibble AND the variant nibble
// (position 17 must be 8, 9, a or b). Postgres's `uuid` TYPE enforces neither — it accepts
// any 32 hex digits. So `uuid()` is a STRICTER domain than the column it guards, and it
// rejected ids the database stores happily: every fixed identifier in supabase/seed.sql
// (`44444444-…`, `66666666-…`) has variant nibble 4 and failed, which made the entire
// seeded dataset unreachable through the UI — a trip could not be created, the seeded
// period rendered as not-found, and its link could not be regenerated.
//
// `guid()` is the 8-4-4-4-12 hex check with no opinion about version or variant, which is
// exactly the column's domain. That is what this guard is for: turning a malformed path
// segment into a clean 404/400 instead of a database error. It was never an authorisation
// check — RLS is, and RLS does not care whether an id is RFC-compliant.
//
// Do not "tighten" this back to uuid(). Real ids come from gen_random_uuid() and are v4, so
// the strictness looks free right up to the moment a hand-written fixture, a seed row or a
// pasted id from a bug report goes through it.
export const periodIdSchema = z.guid();

// The body of POST /api/periods/[id]/slots/[slotId]/release.
//
// One field, and it exists so the release is optimistically concurrent: the page echoes back
// the `claimed_at` it rendered, and `release_slot` refuses when the stored row no longer
// carries that value (supabase/migrations/20260914150000_release_slot_expected_claimed_at.sql).
// Without it an owner acting on a stale tab silently wipes a claim made after that tab loaded.
export const RELEASE_MESSAGES = {
  // Same shape-level message as PERIOD_MESSAGES.notAnObject and for the same reason: a non-object
  // body (null, "x", 42, []) is valid JSON, reaches zod, and would otherwise produce zod's
  // English default with an empty path.
  notAnObject: "Dane są niepoprawne",
  claimedAtInvalid: "Nieprawidłowy znacznik terminu",
} as const;

export const releaseSlotSchema = z.object(
  {
    // `offset: true` is REQUIRED, not decoration. PostgREST serialises `timestamptz` with a
    // numeric offset ("2026-09-14T12:00:00.123456+00:00"), and zod's default datetime check
    // accepts only a "Z" suffix — so the strict form would reject every real value this field
    // can carry. Fractional seconds of any length are allowed by default, which covers
    // Postgres's microseconds.
    //
    // The value is passed to the RPC verbatim and cast by Postgres. This check is therefore the
    // "clean 400 instead of a 22007" half of a two-layer guarantee, not the guarantee itself.
    // The message rides INSIDE the params object (`error`), not as a second argument the way
    // `z.iso.date(msg)` above takes it — the checked overloads differ between the two, and the
    // two-argument form typechecks nowhere.
    expected_claimed_at: z.iso.datetime({ offset: true, error: RELEASE_MESSAGES.claimedAtInvalid }),
  },
  RELEASE_MESSAGES.notAnObject,
);
