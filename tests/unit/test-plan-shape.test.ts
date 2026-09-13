import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Pins the shape of the freshness ledger in context/foundation/test-plan.md §8.
//
// WHY A DOCUMENT GETS AN EXECUTABLE GUARD, which is unusual here and needs the argument made.
// `/10x-test-plan`'s schema has always specified these three bullets as bare dates. It was ignored
// ELEVEN times: the first bullet reached 1167 characters and eleven semicolon-separated clauses,
// each change appending one more summary of what it had done. Measured 2026-09-13, and several of
// those clauses were written in the same session that then noticed the problem.
//
// The reason the written contract failed is worth stating, because it decides what kind of guard
// helps: the schema lives in a skill directory OUTSIDE this repository. Nobody editing test-plan.md
// opens it. A comment in the file itself is the same mechanism one step closer — better, and now
// present under §8 — but it is still advisory, and advisory is exactly what just failed. So the
// shape is asserted.
//
// WHAT THIS DOES NOT DO. It says nothing about whether the dates are CURRENT — a ledger claiming a
// 2026-09-13 review that never happened passes here and is worthless. Freshness is a human
// judgement and this file cannot make it. All it guarantees is that the bullet stayed a date, so
// the section keeps answering "is the guide stale" instead of turning back into a changelog.
//
// THE ACCEPTED COST, recorded because it was a real decision and not an oversight: the contract now
// lives in two places. Change the schema and this test must change with it. That was weighed
// against eleven accretions and judged worth it.

const ROOT = path.resolve(import.meta.dirname, "../..");
const testPlan = readFileSync(path.join(ROOT, "context/foundation/test-plan.md"), "utf8");

/** The three bullets the schema defines, by their exact prefixes. */
const LEDGER_BULLETS = [
  "Strategy (§1–§5) last reviewed",
  "Stack versions last verified",
  "AI-native tool references last verified",
];

describe("the freshness ledger stayed a ledger", () => {
  it("still has all three bullets, so the assertions below are not vacuous", () => {
    // GUARDS THE GUARD. Rename a bullet and every shape assertion below would find nothing to check
    // and pass — the failure shape context/foundation/lessons.md records, and the one this whole
    // repo keeps re-learning. Without this the file would report green against a §8 that no longer
    // exists.
    for (const prefix of LEDGER_BULLETS) {
      expect(
        testPlan.includes(`- ${prefix}:`),
        `§8 no longer has a "${prefix}" bullet — either it was renamed, in which case update LEDGER_BULLETS here, or §8 has been restructured and this whole file needs rewriting`,
      ).toBe(true);
    }
  });

  it("keeps each bullet a bare date", () => {
    for (const prefix of LEDGER_BULLETS) {
      // Escape the parentheses in "Strategy (§1–§5)" — unescaped they would be a capture group and
      // the pattern would match a bullet that does not contain them at all.
      const escaped = prefix.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
      const line = new RegExp(String.raw`^- ${escaped}: .*$`, "m").exec(testPlan)?.[0] ?? "";

      expect(
        line,
        `"${prefix}" is no longer a date. §8 answers only "is the guide stale" — what changed and why belongs in §7, which is where ten of the eleven clauses that once bloated this section were pointing anyway. Found: ${line.slice(0, 90)}`,
      ).toMatch(new RegExp(String.raw`^- ${escaped}: \d{4}-\d{2}-\d{2}$`));
    }
  });
});
