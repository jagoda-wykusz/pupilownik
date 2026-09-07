import { describe, expect, it } from "vitest";
import { createPeriodSchema, periodIdSchema, PERIOD_MESSAGES } from "@/lib/schemas/period";
import { MAX_NOTE_LENGTH, MAX_PETS_PER_PERIOD, MAX_SPAN_DAYS, MAX_TITLE_LENGTH } from "@/lib/period-format";

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
    ["an over-long note", { ...valid, caretaker_note: "x".repeat(MAX_NOTE_LENGTH + 1) }, PERIOD_MESSAGES.noteTooLong],
    ["a non-string note", { ...valid, caretaker_note: 42 }, PERIOD_MESSAGES.noteTooLong],
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
    expect(PERIOD_MESSAGES.noteTooLong).toContain(String(MAX_NOTE_LENGTH));
  });

  // The id guards must accept every id the `uuid` COLUMN accepts, not only RFC 4122-compliant
  // ones. zod's uuid() checks the variant nibble; Postgres checks nothing beyond 32 hex
  // digits. That gap made the whole of supabase/seed.sql unreachable through the UI: a trip
  // could not be created, the seeded period rendered as not-found, and its link could not be
  // regenerated. These ids are taken verbatim from the seed, so the test fails the moment
  // either guard is "tightened" back to uuid().
  describe("id guards match the database's uuid domain, not RFC 4122", () => {
    const SEEDED = ["44444444-4444-4444-4444-444444444444", "66666666-6666-6666-6666-666666666666"];
    const valid = { title: "Weekend", start_date: "2026-07-13", end_date: "2026-07-15" };

    it.each(SEEDED)("periodIdSchema accepts the seeded id %s", (id) => {
      expect(periodIdSchema.safeParse(id).success).toBe(true);
    });

    it.each(SEEDED)("createPeriodSchema accepts the seeded pet id %s", (id) => {
      expect(createPeriodSchema.safeParse({ ...valid, pet_ids: [id] }).success).toBe(true);
    });

    // Loosening the check must not turn it into no check at all — a malformed path segment
    // still has to produce a clean 400/404 rather than reaching the database.
    it.each([
      "not-a-uuid",
      "",
      "44444444-4444-4444-4444",
      "4444444444444444444444444444444444",
      "zzzzzzzz-4444-4444-4444-444444444444",
    ])("still rejects the malformed id %s", (id) => {
      expect(periodIdSchema.safeParse(id).success).toBe(false);
    });
  });

  // The note is optional, and "absent" has to reach the RPC as NULL rather than as an empty
  // string. Phase 3 reveals the note only to a caretaker who claimed and keys the callout on
  // `caretaker_note is null`, so a stored "" would render an empty highlighted box on every
  // trip whose owner never typed one. The island always posts `note.trim()`, which is "" for
  // an untouched field — so this normalisation is on the hot path, not a defensive edge.
  describe("caretaker_note", () => {
    it("accepts a payload with no note at all", () => {
      const result = createPeriodSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.caretaker_note).toBeUndefined();
      }
    });

    it.each([
      ["an empty string", ""],
      ["whitespace only", "   \n  "],
    ])("normalises %s to undefined so the RPC stores NULL", (_label, note) => {
      const result = createPeriodSchema.safeParse({ ...valid, caretaker_note: note });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.caretaker_note).toBeUndefined();
      }
    });

    it("keeps a real note, trimmed", () => {
      const result = createPeriodSchema.safeParse({ ...valid, caretaker_note: "  Klucze u sąsiadki  " });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.caretaker_note).toBe("Klucze u sąsiadki");
      }
    });

    it("accepts a note at exactly the bound, matching the database CHECK", () => {
      const atBound = "x".repeat(MAX_NOTE_LENGTH);
      const result = createPeriodSchema.safeParse({ ...valid, caretaker_note: atBound });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.caretaker_note).toBe(atBound);
      }
    });
  });
});
