import { describe, expect, it } from "vitest";
import { countDays, formatDay, formatRange, formatWeekday, MAX_SPAN_DAYS } from "@/lib/period-format";

// Pure calendar arithmetic and Polish labels — runs in the `unit` project, no Supabase.
//
// These dates are `date` columns, not instants. Every assertion here exists because the
// obvious implementation gets it wrong: a viewer's timezone shifts the day westward, and
// taking the year from one end of a range mislabels the other.
describe("period-format", () => {
  it("formats a day in the calendar sense, not the viewer's timezone", () => {
    // Would render as "12 lipca" anywhere west of Greenwich if parsed as local midnight.
    expect(formatDay("2026-07-13")).toBe("13 lipca");
    expect(formatWeekday("2026-07-13")).toBe("poniedziałek");
  });

  it("prints the year once when the range stays inside one year", () => {
    expect(formatRange("2026-07-13", "2026-07-15")).toBe("13 lipca – 15 lipca 2026");
  });

  it("prints both years when the range crosses New Year", () => {
    // The regression this test exists for: the start day used to inherit the end year.
    expect(formatRange("2026-12-27", "2027-01-03")).toBe("27 grudnia 2026 – 3 stycznia 2027");
  });

  it("counts days inclusively, both ends and across a year boundary", () => {
    expect(countDays("2026-07-13", "2026-07-13")).toBe(1);
    expect(countDays("2026-07-13", "2026-07-15")).toBe(3);
    expect(countDays("2026-12-27", "2027-01-03")).toBe(8);
    // The exact bound the database CHECK, the zod refine and the island all share.
    expect(countDays("2026-07-01", "2026-07-31")).toBe(MAX_SPAN_DAYS);
    expect(countDays("2026-07-01", "2026-08-01")).toBe(MAX_SPAN_DAYS + 1);
  });

  it("is unaffected by a DST transition inside the range", () => {
    // Poland springs forward on 2026-03-29. A local-time implementation loses an hour here
    // and can round a day off the count.
    expect(countDays("2026-03-28", "2026-03-30")).toBe(3);
    expect(formatRange("2026-03-28", "2026-03-30")).toBe("28 marca – 30 marca 2026");
  });
});
