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

export function formatRange(startDate: string, endDate: string): string {
  const year = new Intl.DateTimeFormat("pl-PL", { year: "numeric", timeZone: "UTC" }).format(asUtcDate(endDate));
  return `${formatDay(startDate)} – ${formatDay(endDate)} ${year}`;
}

// Inclusive: a period that starts and ends on the same day is one day long, and
// generates three slots. Both ends are parsed as UTC midnight, so the difference is
// exact — no DST hour to round away.
export function countDays(startDate: string, endDate: string): number {
  return (asUtcDate(endDate).getTime() - asUtcDate(startDate).getTime()) / DAY_MS + 1;
}
