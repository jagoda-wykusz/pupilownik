import { describe, expect, it } from "vitest";
import { CLAIM_COOKIE, claimCookieOptions } from "@/lib/claim-cookie";

// Pure arithmetic and a fixed attribute set — no Supabase, so this runs in the `unit` project
// with Docker down.
//
// This file exists because the Phase 4 review found the module had NO test at all (F6), while
// `claimCookieOptions(endDate, now = new Date())` carries an injectable clock for the sole
// purpose of being testable. The route suite's only assertion was `maxAge > 0` against a trip
// ending nine months out, which cannot fail for any plausible regression — including the
// removal of the floor that the module itself calls "the case that actually happens".
describe("capability cookie", () => {
  const DAY = 60 * 60 * 24;
  // A fixed clock, so these assertions do not drift with the calendar.
  const now = new Date("2027-06-01T12:00:00Z");

  it("pins the attribute set — every one of them is a security property", () => {
    const options = claimCookieOptions("2027-06-30", now);

    // toEqual, not toMatchObject: an ADDED attribute is as much a change to the contract as a
    // removed one. A stray `domain` would widen where a bearer credential travels.
    expect(options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/invite",
      maxAge: options.maxAge,
    });
  });

  it("expires a week after the trip ends", () => {
    // 29 days to the end date, plus the 7-day buffer, minus the half-day already elapsed.
    const options = claimCookieOptions("2027-06-30", now);

    expect(options.maxAge).toBe(29 * DAY + 7 * DAY - DAY / 2);
  });

  it("keeps a day of life for a trip that ends today — the case that actually happens", () => {
    // A last-minute favour. Without the floor the computed age is ~6.5 days here, but for a
    // trip that ended over a week ago it goes NEGATIVE, and the browser drops the cookie the
    // instant it is set: the caretaker claims successfully, the reload shows the pre-claim
    // page, and it reads as "it didn't work".
    const endsToday = claimCookieOptions("2027-06-01", now);
    const endedLongAgo = claimCookieOptions("2027-01-01", now);

    expect(endsToday.maxAge).toBeGreaterThan(0);
    expect(endedLongAgo.maxAge).toBe(DAY);
  });

  it("parses the end date as UTC, so a clock west of Greenwich does not lose a day", () => {
    // 23:30 UTC on 31 May is still 31 May in UTC but already 1 June nowhere — the bug this
    // guards is parsing `end_date` in the viewer's zone, which is why period-format.ts pins
    // UTC too. Both calls must agree to the second.
    const beforeMidnightUtc = claimCookieOptions("2027-06-30", new Date("2027-06-01T23:30:00Z"));
    const sameInstant = claimCookieOptions("2027-06-30", new Date("2027-06-01T23:30:00.000Z"));

    expect(beforeMidnightUtc.maxAge).toBe(sameInstant.maxAge);
    // And the end date is read as UTC midnight, not as local midnight: 29 whole days plus the
    // buffer, minus the 23.5 hours elapsed.
    expect(beforeMidnightUtc.maxAge).toBe(29 * DAY + 7 * DAY - (23 * 3600 + 1800));
  });

  it("names the cookie once, for every consumer", () => {
    // The route, the page and the route suite all reference this constant rather than a
    // literal. A drifting name is a bug with no symptom: the cookie simply stops arriving.
    expect(CLAIM_COOKIE).toBe("pupilownik_claim");
  });
});
