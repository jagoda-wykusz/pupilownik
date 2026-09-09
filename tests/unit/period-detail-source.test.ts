import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The one automated guard on the slice's central rule (full-plan review F9).
//
// The rule: `claim_digest` may be read in `[id].astro`'s FRONTMATTER, because that runs on the
// server — and must not travel one step further, because Astro serializes island props into the
// HTML. `20260907171514_claim_secret_not_digest.sql:14-19` names this page's payload verbatim as
// the disclosure to avoid.
//
// WHAT THIS DOES AND DOES NOT PROVE, stated plainly because a test that overclaims is worse than
// none. It does NOT render the page: the container API is unreachable here — vitest's SSR
// environment sets `resolve.external`, which @cloudflare/vite-plugin rejects outright, so
// importing a `.astro` file in this suite is not currently possible. So this is a SOURCE check,
// not an output check. It cannot catch a digest that arrives through an indirection (a variable
// assigned from `slot.claim_digest` above the fence and then rendered below).
//
// What it does catch is the regression that actually threatens this page — someone reaching for
// the column in the template or handing it to an island, which is how the leak would realistically
// be written. Together with the type-level guard (`CaretakerLabel` has no digest field, so the
// obvious version is a compile error) and manual step 1.8 (view-source for a 64-hex string), that
// is three independent layers. Replace this with a rendered-HTML assertion the day the page
// becomes importable.

const PAGE = path.resolve(import.meta.dirname, "../../src/pages/periods/[id].astro");

// Everything after the closing `---` of the frontmatter: the part that becomes HTML.
function templateOf(source: string): string {
  // The opening fence is the first line of the file, so it has no leading newline to match on.
  expect(source.startsWith("---"), "the page should open with a frontmatter fence").toBe(true);
  const close = /\r?\n---\r?\n/.exec(source);
  expect(close, "frontmatter closing fence not found").not.toBeNull();
  return source.slice((close?.index ?? 0) + (close?.[0].length ?? 0));
}

// Comments in the template explain the boundary and necessarily name the thing they forbid, so
// they have to come out before the assertion — otherwise the guard fails on its own rationale.
function stripComments(template: string): string {
  return template.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

describe("periods/[id].astro — the digest boundary", () => {
  const source = readFileSync(PAGE, "utf8");
  const template = stripComments(templateOf(source));

  it("reads claim_digest in the frontmatter, so the guard is testing something real", () => {
    // Guards the guard: if the page stops selecting the column, the assertions below start
    // passing for the wrong reason and would keep passing forever.
    const frontmatter = source.slice(0, source.indexOf(templateOf(source)));
    expect(frontmatter).toContain("claim_digest");
  });

  it("never mentions claim_digest below the frontmatter fence", () => {
    expect(template).not.toContain("claim_digest");
  });

  it("never renders claimed_by_name raw — it reaches the screen only through groupCaretakers", () => {
    // The other half of Phase 1's boundary. This column is anon-written; normalization is what
    // stands between it and the owner's screen, and the normalized value arrives as
    // `caretaker.label`, never under the column's own name.
    expect(template).not.toContain("claimed_by_name");
  });

  it("passes the release island ids and labels only", () => {
    const island = /<ReleaseSlotButton[\s\S]*?\/>/.exec(template);
    expect(island, "ReleaseSlotButton not found in the template").not.toBeNull();

    const props = island?.[0] ?? "";
    expect(props).not.toContain("digest");
    expect(props).not.toContain("claimed_by_name");
    // The label passed is the grouped, normalized one — the same expression the <bdi> renders.
    expect(props).toContain("caretaker?.label");
  });
});
