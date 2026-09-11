import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The second half of Phase 4's guard on FR-008. tests/unit/invite-composition.test.ts proves
// composeCaretakerView keeps the sensitive tier and the note away from an unproven visitor;
// this file proves the PAGE actually asks it, instead of composing them again itself.
//
// WHAT THIS DOES AND DOES NOT PROVE, stated plainly for the same reason
// tests/unit/period-detail-source.test.ts states it: this is a SOURCE check, not an output
// check. The page is not rendered — this project has no page renderer by choice (test-plan.md
// §4 defers e2e, §7 excludes the caretaker page's HTML), so nothing here can catch a leak that
// arrives through an indirection.
//
// What it does catch is the regression that would realistically be written: someone reaching
// back for `details.pets` or `details.caretaker_note` in the template, or rebuilding the
// per-pet sensitive map inline. That is exactly how the gate looked before this phase, and how
// it would look again.
//
// Deliberately NARROW. `details` itself is still legitimately read below the fence — the
// "Zapisano, <imię>!" banner and the island's `hasCapability` prop both need it, and moving
// those into the lib was ruled out of this phase's scope. The rule this file enforces is about
// INSTRUCTIONS and the NOTE, not about the identifier.

const PAGE = path.resolve(import.meta.dirname, "../../src/pages/invite/[token].astro");

/** Everything after the closing `---` of the frontmatter: the part that becomes HTML. */
function templateOf(source: string): string {
  expect(source.startsWith("---"), "the page should open with a frontmatter fence").toBe(true);
  const close = /\r?\n---\r?\n/.exec(source);
  expect(close, "frontmatter closing fence not found").not.toBeNull();
  return source.slice((close?.index ?? 0) + (close?.[0].length ?? 0));
}

/** Comments in the template explain the boundary and necessarily name the thing they forbid,
 *  so they come out before the assertions — otherwise the guard fails on its own rationale.
 *
 *  Both comment forms, because the page uses both: brace-wrapped blocks inside the JSX-ish
 *  body, and BARE block comments sitting directly inside an `&&` branch — the inactive and the
 *  revoked card each open with one. The optional braces in the pattern below are what covers
 *  the second form; without them a future explanatory sentence naming a forbidden identifier
 *  fails this suite on its own rationale. */
function stripComments(template: string): string {
  return template.replace(/\{?\s*\/\*[\s\S]*?\*\/\s*\}?/g, "");
}

/** The frontmatter's comments explain this very boundary and name the function by name, so they
 *  have to come out too. Without this the "guards the guard" case below passes on the RATIONALE
 *  for the rule rather than on the code implementing it — delete the call and it stays green,
 *  which silently turns every absence assertion in this file into a tautology. That is the
 *  mistake `tests/unit/claimed-details-ordering.test.ts:66` already records, in SQL. */
function stripFrontmatterComments(frontmatter: string): string {
  return frontmatter.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("invite/[token].astro — the instruction tier boundary", () => {
  const source = readFileSync(PAGE, "utf8");
  const template = stripComments(templateOf(source));
  const frontmatter = stripFrontmatterComments(source.slice(0, source.length - templateOf(source).length));

  it("asks composeCaretakerView for what it may render", () => {
    // Guards the guard: if the page stops calling the function, the absence assertions below
    // start passing for the wrong reason and would keep passing forever.
    //
    // Asserts the CALL, not the identifier. The identifier alone appears in the import line and
    // in the frontmatter's own rationale comment, so a bare `toContain` here survives deleting
    // the call — which is the failure this case exists to prevent.
    expect(frontmatter).toContain("composeCaretakerView({");
  });

  it("feeds the composition the PUBLIC payload as its spine, not the reveal", () => {
    // The two tiers are structurally identical types, so a call with the arguments swapped
    // typechecks cleanly (measured with tsc) and would hand the sensitive tier to every holder
    // of the link. Nominal types would close it properly; until then the defence is that there
    // is exactly one call site, and this pins its shape.
    expect(frontmatter).toContain("composeCaretakerView({ pets: payload?.pets ?? [], details })");
  });

  it("renders the sensitive tier only from the composed value", () => {
    expect(template).toContain("sensitiveInstructions");
    expect(template).not.toContain("details.pets");
    expect(template).not.toContain("details?.pets");
    // The inline map this phase removed. Named explicitly because reintroducing it is the
    // shortest path back to the leak.
    expect(template).not.toContain("sensitiveByPet");
  });

  it("renders the public tier only from the composed value", () => {
    expect(template).toContain("publicInstructions");
    // The undifferentiated list the composed pet deliberately does not carry.
    expect(template).not.toContain("pet.instructions");
  });

  it("never reaches for the trip note behind the composition", () => {
    expect(template).toContain("caretakerNote");
    expect(template).not.toContain("caretaker_note");
  });

  it("does not rebuild either gate in the frontmatter and hand the template an alias", () => {
    // The template assertions above are necessary and not sufficient. `const note =
    // details?.caretaker_note` up here, then `{note}` below, passes every one of them while
    // restoring exactly the ungated ternary this phase removed — the composition is bypassed
    // and nothing says so. Same for a hand-rolled per-pet map.
    //
    // Note what is NOT banned: the bare string `caretaker_note`. `[token].astro`'s
    // `ClaimedDetails` interface legitimately declares that field, and the page has to name it
    // to type the reveal door's answer. What is banned is READING it off `details`.
    expect(frontmatter).not.toContain("details.caretaker_note");
    expect(frontmatter).not.toContain("details?.caretaker_note");
    expect(frontmatter).not.toContain("details?.pets");
    expect(frontmatter).not.toContain("new Map(");
  });
});
