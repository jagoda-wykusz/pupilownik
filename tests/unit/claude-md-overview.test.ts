import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The guard on CLAUDE.md's project preamble.
//
// WHY THIS NEEDS A GUARD. CLAUDE.md is two documents in one file: a project overview we own,
// and a course-material fence `10x-cli get` rewrites between the BEGIN/END markers. Before
// 2026-09-14 the file was ONLY the fence — an agent that read it learned about Playwright
// locators and nothing about Pupilownik. Restoring the preamble fixes that once; this test is
// what keeps it fixed, because the failure mode is silent in exactly the way `ci-gate-source`
// describes: a CLI upgrade that widened its write range would delete the preamble, produce no
// error, and be noticed by whoever next onboarded cold.
//
// WHAT THIS CANNOT SEE. It asserts the preamble is PRESENT and points where it claims to point,
// never that its prose is accurate — a stale table row passes here. The pointers themselves are
// checked as paths (`npm run check:links` covers markdown links; these are `@`-references and
// bare paths that it does not resolve), so a renamed foundation doc fails here rather than
// rotting into a dead reference.

const ROOT = path.resolve(import.meta.dirname, "../..");
const claudeMd = readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");

const BEGIN = "<!-- BEGIN @przeprogramowani/10x-cli -->";
const END = "<!-- END @przeprogramowani/10x-cli -->";

describe("CLAUDE.md", () => {
  it("keeps the CLI fence intact and exactly once", () => {
    expect(claudeMd.split(BEGIN)).toHaveLength(2);
    expect(claudeMd.split(END)).toHaveLength(2);
    expect(claudeMd.indexOf(BEGIN)).toBeLessThan(claudeMd.indexOf(END));
  });

  it("carries a project preamble ABOVE the fence, not inside it", () => {
    const preamble = claudeMd.slice(0, claudeMd.indexOf(BEGIN));

    // A bare `# Pupilownik` heading and some substance under it. The length bound is what
    // separates "the preamble exists" from "someone left the heading and deleted the body".
    expect(preamble).toMatch(/^# Pupilownik$/m);
    expect(preamble.length).toBeGreaterThan(800);
  });

  it("routes the reader to the operational contract rather than restating it", () => {
    // AGENTS.md owns the hard rules. If CLAUDE.md stops naming it, an agent reads the overview
    // and starts editing without ever meeting `prerender = false` or the RLS rule.
    expect(claudeMd.slice(0, claudeMd.indexOf(BEGIN))).toContain("@AGENTS.md");
  });

  it("names the two product rules that every change is judged against", () => {
    const preamble = claudeMd.slice(0, claudeMd.indexOf(BEGIN));

    // Not decoration: these are the PRD's two NFR guardrails (atomic claim, no leak outside the
    // link), and they are the reason `claim_slots` and the token digest look the way they do.
    expect(preamble).toContain("claim_slots");
    expect(preamble).toContain("src/lib/invite-token.ts");
  });

  it("points only at documents that exist", () => {
    const preamble = claudeMd.slice(0, claudeMd.indexOf(BEGIN));
    const referenced = [
      "AGENTS.md",
      "README.md",
      "context/foundation/prd.md",
      "context/foundation/roadmap.md",
      "context/foundation/test-plan.md",
      "context/foundation/lessons.md",
      "docs/reference",
      "src/middleware.ts",
      "src/lib/invite-token.ts",
      "src/pages/invite/claim.ts",
    ];

    for (const target of referenced) {
      expect(preamble, `${target} is no longer referenced by CLAUDE.md`).toContain(target);
      expect(existsSyncRelative(target), `CLAUDE.md points at ${target}, which does not exist`).toBe(true);
    }
  });
});

function existsSyncRelative(relative: string): boolean {
  try {
    readFileSyncOrDir(path.join(ROOT, relative));
    return true;
  } catch {
    return false;
  }
}

/** `readFileSync` throws EISDIR on a directory — a directory target (docs/reference) is a hit. */
function readFileSyncOrDir(absolute: string): void {
  try {
    readFileSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EISDIR") {
      return;
    }
    throw error;
  }
}
