// Presentation helpers and calendar arithmetic shared by the owner's period screens,
// the caretaker landing page (Phase 4) and the zod schema, so all of them name a day,
// a time of day and the span bound the same way.
//
// This module deliberately pulls in NO runtime dependency. The create-period island
// needs MAX_SPAN_DAYS and countDays for its client-side validation, and importing them
// from the schema module shipped the whole of zod to the browser for two values.
//
// Slot dates are calendar dates ("the morning of 13 July"), stored as `date` and
// arriving as "YYYY-MM-DD". They are parsed and formatted in UTC on purpose: read in
// the viewer's zone, a date west of Greenwich would render as the previous day.

import type { Database } from "@/db/database.types";

export type TimeOfDay = Database["public"]["Enums"]["time_of_day"];

export const TIME_OF_DAY_LABEL: Record<TimeOfDay, string> = {
  morning: "Rano",
  afternoon: "Popołudnie",
  evening: "Wieczór",
};

// Declaration order is display order — the enum's own order, which is also what
// generate_series + enum_range produce.
export const TIMES_OF_DAY: TimeOfDay[] = ["morning", "afternoon", "evening"];

// The bound on how long a period may be. It exists in three places on purpose, and this
// is the source for two of them: the care_periods_max_span CHECK is the guarantee, the
// zod refinement turns a violation into a clean 400 instead of a 500, and the island uses
// it to say so before a request is made. 31 days x 3 times of day = at most 93 generated
// slots, which is also the cap on what one request can write (S-01 impl-review F1).
export const MAX_SPAN_DAYS = 31;

// Upper bound on the period title, shared with the zod schema for the same reason as
// MAX_SPAN_DAYS: the island must be able to say "too long" itself rather than bouncing
// the user off a generic 400.
export const MAX_TITLE_LENGTH = 120;

// Upper bound on how many pets one trip may cover. Shared with the zod schema so the chip
// selector can refuse before a request is made. The bound exists because an unbounded array
// on a create endpoint is a DoS vector (S-01 impl-review F1), not because an owner is
// expected to approach it: this product serves a private owner with a household of pets, so
// 20 is roughly an order of magnitude above any real case while still capping the array.
// It lives only here and in zod — the RPC has no upper bound, because a caller can only link
// pets they own and RLS already caps that at their own pet count.
export const MAX_PETS_PER_PERIOD = 20;

// Upper bound on the caretaker note (the design's NOTATKA — free text scoped to the trip,
// not to a pet). Unlike MAX_TITLE_LENGTH this one is ALSO a database CHECK
// (care_periods_note_length), so the guarantee is in the schema and this constant is what
// turns a violation into a clean 400 and lets the island say so first. Change one and you
// must change both. 2000 is generous for "klucze u sąsiadki, mieszkanie 4" while still
// capping a field that is written by an owner and later served to a caretaker.
export const MAX_NOTE_LENGTH = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;

function asUtcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export function formatDay(isoDate: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(asUtcDate(isoDate));
}

export function formatWeekday(isoDate: string): string {
  return new Intl.DateTimeFormat("pl-PL", { weekday: "long", timeZone: "UTC" }).format(asUtcDate(isoDate));
}

function formatYear(isoDate: string): string {
  return new Intl.DateTimeFormat("pl-PL", { year: "numeric", timeZone: "UTC" }).format(asUtcDate(isoDate));
}

// The year is printed once at the end when both dates share it, and at BOTH ends when they
// do not. Taking the year from end_date alone attributed the start day to the wrong year —
// "27 grudnia – 3 stycznia 2027" for a period starting in 2026. The 31-day cap does not
// prevent it: an 8-day trip over New Year is enough, and this string is the authoritative
// date range on the owner's detail screen and on the caretaker's page.
export function formatRange(startDate: string, endDate: string): string {
  const startYear = formatYear(startDate);
  const endYear = formatYear(endDate);

  if (startYear === endYear) {
    return `${formatDay(startDate)} – ${formatDay(endDate)} ${endYear}`;
  }
  return `${formatDay(startDate)} ${startYear} – ${formatDay(endDate)} ${endYear}`;
}

// Inclusive: a period that starts and ends on the same day is one day long, and
// generates three slots. Both ends are parsed as UTC midnight, so the difference is
// exact — no DST hour to round away.
export function countDays(startDate: string, endDate: string): number {
  return (asUtcDate(endDate).getTime() - asUtcDate(startDate).getTime()) / DAY_MS + 1;
}
