import { describe, expect, it } from "vitest";
import { createPeriodSchema, PERIOD_MESSAGES } from "@/lib/schemas/period";
import { MAX_PETS_PER_PERIOD, MAX_SPAN_DAYS, MAX_TITLE_LENGTH } from "@/lib/period-format";

// `POST /api/periods` returns a zod issue's message and NewPeriodForm renders it verbatim, so
// "every rejection carries a Polish, user-facing message" is a contract — one that breaks
// silently, because zod falls back to its own English defaults whenever a message argument is
// missing.
//
// This asserts MEMBERSHIP in PERIOD_MESSAGES rather than "does the string look English". The
// first version of this file used a heuristic (not /^Invalid input/, not /^Too (small|big)/,
// no "expected"/"received") and the phase-2 review found it unsound: zod's format defaults are
// "Invalid UUID" and "Invalid ISO date", which match none of those patterns. Deleting a
// message argument left the test green while an owner saw English. Membership fails on every
// default, known or not — which is the difference between guarding a property and describing
// one (context/foundation/lessons.md).
describe("createPeriodSchema — every rejection is renderable", () => {
  const PET = "8f14e45f-ceea-467a-9575-9c4d0a1e0000";
  const valid = { title: "Weekend", start_date: "2026-07-13", end_date: "2026-07-15", pet_ids: [PET] };
  const allowed: string[] = Object.values(PERIOD_MESSAGES);

  it("accepts a well-formed payload", () => {
    expect(createPeriodSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    // Field-level rejections.
    ["a missing title", { ...valid, title: undefined }, PERIOD_MESSAGES.titleRequired],
    ["a non-string title", { ...valid, title: 42 }, PERIOD_MESSAGES.titleRequired],
    ["an empty title", { ...valid, title: "   " }, PERIOD_MESSAGES.titleRequired],
    ["an over-long title", { ...valid, title: "x".repeat(MAX_TITLE_LENGTH + 1) }, PERIOD_MESSAGES.titleTooLong],
    ["missing pet_ids", { ...valid, pet_ids: undefined }, PERIOD_MESSAGES.petsRequired],
    ["a non-array pet_ids", { ...valid, pet_ids: "abc" }, PERIOD_MESSAGES.petsRequired],
    ["empty pet_ids", { ...valid, pet_ids: [] }, PERIOD_MESSAGES.petsRequired],
    [
      "too many pet_ids",
      { ...valid, pet_ids: Array<string>(MAX_PETS_PER_PERIOD + 1).fill(PET) },
      PERIOD_MESSAGES.petsTooMany,
    ],
    ["a non-uuid pet id", { ...valid, pet_ids: ["not-a-uuid"] }, PERIOD_MESSAGES.petIdInvalid],
    ["a missing start date", { ...valid, start_date: undefined }, PERIOD_MESSAGES.startDateInvalid],
    // A present-but-malformed date, which the first version of this file never covered — and
    // which is exactly where zod's "Invalid ISO date" default would have slipped through.
    ["a malformed start date", { ...valid, start_date: "13-07-2026" }, PERIOD_MESSAGES.startDateInvalid],
    ["an impossible date", { ...valid, start_date: "2026-02-30" }, PERIOD_MESSAGES.startDateInvalid],
    ["a missing end date", { ...valid, end_date: undefined }, PERIOD_MESSAGES.endDateInvalid],
    ["reversed dates", { ...valid, start_date: "2026-07-15", end_date: "2026-07-13" }, PERIOD_MESSAGES.datesReversed],
    [
      "a span over the cap",
      { ...valid, start_date: "2026-07-01", end_date: "2026-08-01" },
      PERIOD_MESSAGES.spanTooLong,
    ],
    // Root-level: a body that is valid JSON but not an object at all. Reachable from any
    // non-island client, and the one path whose message comes from the schema's shape.
    ["a null body", null, PERIOD_MESSAGES.notAnObject],
    ["a string body", "hello", PERIOD_MESSAGES.notAnObject],
    ["a number body", 42, PERIOD_MESSAGES.notAnObject],
    ["an array body", [], PERIOD_MESSAGES.notAnObject],
  ])("rejects %s with its own message", (_label, payload, expected) => {
    const result = createPeriodSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    // The route picks a field-level issue when one exists, falling back to the root issue.
    // Mirror that here so the test asserts what the owner actually sees.
    const issue = result.error.issues.find((i) => i.path.length > 0) ?? result.error.issues[0];
    expect(issue.message).toBe(expected);
    // Membership is the guard: any zod default — including ones not yet encountered — fails.
    expect(allowed).toContain(issue.message);
  });

  it("names the span cap in its message, so the owner learns the bound", () => {
    expect(PERIOD_MESSAGES.spanTooLong).toContain(String(MAX_SPAN_DAYS));
    expect(PERIOD_MESSAGES.petsTooMany).toContain(String(MAX_PETS_PER_PERIOD));
    expect(PERIOD_MESSAGES.titleTooLong).toContain(String(MAX_TITLE_LENGTH));
  });
});
