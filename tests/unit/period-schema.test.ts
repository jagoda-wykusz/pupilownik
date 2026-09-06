import { describe, expect, it } from "vitest";
import { createPeriodSchema } from "@/lib/schemas/period";
import { MAX_PETS_PER_PERIOD, MAX_SPAN_DAYS, MAX_TITLE_LENGTH } from "@/lib/period-format";

// `POST /api/periods` returns the first zod issue's message, and NewPeriodForm renders it
// verbatim. That makes "every rejection carries a Polish, user-facing message" a contract,
// not a nicety — and one that breaks silently: zod falls back to its English default
// ("Invalid input: expected string, received undefined") for a MISSING key, because a custom
// `.min(1, …)` message only fires once the key is present. Adding a field without a
// type-level message would put English internals in front of an owner, and nothing else
// would notice.
describe("createPeriodSchema — every rejection is renderable", () => {
  const PET = "8f14e45f-ceea-467a-9575-9c4d0a1e0000";
  const valid = { title: "Weekend", start_date: "2026-07-13", end_date: "2026-07-15", pet_ids: [PET] };

  it("accepts a well-formed payload", () => {
    expect(createPeriodSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["a missing title", { ...valid, title: undefined }],
    ["an empty title", { ...valid, title: "   " }],
    ["an over-long title", { ...valid, title: "x".repeat(MAX_TITLE_LENGTH + 1) }],
    ["missing pet_ids", { ...valid, pet_ids: undefined }],
    ["empty pet_ids", { ...valid, pet_ids: [] }],
    ["too many pet_ids", { ...valid, pet_ids: Array<string>(MAX_PETS_PER_PERIOD + 1).fill(PET) }],
    ["a non-uuid pet id", { ...valid, pet_ids: ["not-a-uuid"] }],
    ["a missing start date", { ...valid, start_date: undefined }],
    ["a missing end date", { ...valid, end_date: undefined }],
    ["reversed dates", { ...valid, start_date: "2026-07-15", end_date: "2026-07-13" }],
    ["a span over the cap", { ...valid, start_date: "2026-07-01", end_date: "2026-08-01" }],
  ])("rejects %s with a Polish message", (_label, payload) => {
    const result = createPeriodSchema.safeParse(payload);
    expect(result.success).toBe(false);

    const message = result.success ? "" : result.error.issues[0].message;
    // Non-empty, and not one of zod's English defaults. Checking for Polish diacritics or
    // known Polish words is brittle; checking that it is not zod's phrasing is the property
    // that actually matters — an English internal reaching the owner is the failure.
    expect(message).not.toBe("");
    expect(message).not.toMatch(/^Invalid input/);
    expect(message).not.toMatch(/^Too (small|big)/);
    expect(message).not.toMatch(/expected|received/i);
  });

  it("names the span cap in its message, so the owner learns the bound", () => {
    const result = createPeriodSchema.safeParse({ ...valid, start_date: "2026-07-01", end_date: "2026-08-01" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(String(MAX_SPAN_DAYS));
    }
  });
});
