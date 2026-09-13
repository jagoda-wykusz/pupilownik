import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Pins the shape of the freshness ledger in context/foundation/test-plan.md §8.
//
// WHY A DOCUMENT GETS AN EXECUTABLE GUARD, which is unusual here and needs the argument made.
// `/10x-test-plan`'s schema has always specified these three bullets as bare dates. It was ignored
// repeatedly: the first bullet reached 1167 characters and ELEVEN semicolon-separated clauses, each
// change appending one more summary of what it had done. Eleven is the clause count, which is
// exact; the commit count is lower, because some changes added two at once. Measured 2026-09-13, and several of
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

/** §8 only — from its heading to the next `## `.
 *
 *  SCOPED AFTER REVIEW, and the reason is the failure this repo keeps meeting. The first version
 *  matched the whole document, so a stray `- Stack versions last verified: …` anywhere would have
 *  satisfied the presence floor with §8 gutted — and worse, if any section ever ILLUSTRATES the
 *  forbidden shape, `exec` would return the illustration and the suite would go red over its own
 *  rationale. Both reviewers found this independently. */
//  NO `m` FLAG, and that is not an oversight — it is the bug this slice shipped with for four
//  minutes. With `m`, the `$` inside the lookahead matches at EVERY line end, so the lazy
//  `[\s\S]*?` stopped at the first one and the slice came back empty. The floor below caught it
//  immediately. Without `m`, `$` means end of input and `\n## ` anchors the heading instead of `^`.
const LEDGER = (/\n## 8\. [^\n]*\n([\s\S]*?)(?=\n## |$)/.exec(testPlan)?.[1] ?? "").split(
  "Refresh (`/10x-test-plan --refresh`) when:",
)[0];

/** The three bullets the schema defines, by their exact prefixes. */
const LEDGER_BULLETS = [
  "Strategy (§1–§5) last reviewed",
  "Stack versions last verified",
  "AI-native tool references last verified",
];

describe("the freshness ledger stayed a ledger", () => {
  it("still has all three bullets and only those, so the assertions below are not vacuous", () => {
    // GUARDS THE GUARD. Rename a bullet and every shape assertion below would find nothing to check
    // and pass — the failure shape context/foundation/lessons.md records, and the one this whole
    // repo keeps re-learning.
    expect(LEDGER.length, "§8 could not be located — its heading changed, or the section is gone").toBeGreaterThan(50);

    for (const prefix of LEDGER_BULLETS) {
      expect(
        LEDGER.includes(`- ${prefix}:`),
        `§8 no longer has a "${prefix}" bullet — either it was renamed, in which case update LEDGER_BULLETS here, or §8 has been restructured and this whole file needs rewriting`,
      ).toBe(true);
    }

    // EXACTLY three, because the list above is an allow-list. Now that the three named bullets are
    // defended, a FOURTH is the obvious place for the next changelog to accrete — and it would pass
    // green. Raised in review; the schema defines §8 as three bullets, so a fourth is itself drift.
    const bullets = LEDGER.split("\n").filter((line) => line.startsWith("- "));
    expect(
      bullets.length,
      `§8 has ${bullets.length} bullets, expected exactly ${LEDGER_BULLETS.length}. A new one is drift from the schema — and if it is carrying a changelog, that belongs in §7.`,
    ).toBe(LEDGER_BULLETS.length);
  });

  it("keeps each bullet a bare date", () => {
    for (const prefix of LEDGER_BULLETS) {
      // The prefixes are LITERALS, not patterns, so escaping is unconditional: the day one gains a
      // `.`, `+` or `?` it would otherwise become a wildcard silently.
      //
      // What escaping does NOT protect against, measured after review corrected two wrong guesses —
      // mine and the reviewer's. Left unescaped, `(§1–§5)` is a group that still requires its
      // literal contents, so the pattern demands `§1–§5` WITHOUT parentheses, which the document
      // does not contain. It therefore matches NOTHING: `exec` returns undefined, `?? ""` yields an
      // empty string, and the assertion below fails. A missed escape is loud, not silent.
      const escaped = prefix.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
      const line = new RegExp(String.raw`^- ${escaped}: .*$`, "m").exec(LEDGER)?.[0] ?? "";

      expect(
        line,
        `"${prefix}" is no longer a date. §8 answers only "is the guide stale" — what changed and why belongs in §7, which is where ten of the eleven clauses that once bloated this section were pointing anyway. Found: ${line.slice(0, 90)}`,
      ).toMatch(new RegExp(String.raw`^- ${escaped}: \d{4}-\d{2}-\d{2}$`));
    }
  });
});
