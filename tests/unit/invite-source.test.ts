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

// The page's two RPC failure branches — the observability half of the same file.
//
// Separate describe from the tier boundary above because the concern is different: that block
// proves the page asks the composition for what it may RENDER; this one proves the page says
// something when a read fails. They share a subject and nothing else.
//
// WHY A SOURCE CHECK IS THE RIGHT LEVEL HERE — and the first version of this paragraph got the
// reason wrong, which is why it is spelled out. It claimed forcing an RPC failure "needs grant
// manipulation or a transport fault — a new pattern in this repo". That is false: producing the
// error is CHEAP and the pattern is established in three files. `tests/rls/reveal-instructions.test.ts:491`
// calls this very function with a `service_role` client and gets a deterministic `42501`, because
// the explicit revoke in `20260907180022` denies that role; `claim-slots.test.ts` and
// `release-slot.test.ts` do the same for theirs.
//
// The real barrier is the other half: OBSERVING the log line. These branches produce the correct
// rendered output either way — the defect is an observability gap, not a wrong answer — so the
// assertion has to be about what reached the sink, and capturing workerd's stdout from a test is
// what this repo has no harness for. A source check is the pragmatic level until one exists.
//
// (It is true, and still worth knowing, that a malformed token cannot produce an error at all:
// both functions bound their arguments at 43 characters and return NULL for every miss.)
describe("invite/[token].astro — the two RPC failure branches", () => {
  const pageSource = readFileSync(PAGE, "utf8");
  const frontmatter = stripFrontmatterComments(pageSource.slice(0, pageSource.length - templateOf(pageSource).length));

  /** Every `console.error(...)` / `console.warn(...)` call in the frontmatter, as its raw argument
   *  list, found by BALANCING PARENTHESES from the opening one.
   *
   *  Comments are already stripped, so a rationale sentence naming a forbidden identifier cannot
   *  land in here — the mistake `stripFrontmatterComments` exists to prevent.
   *
   *  WHY NOT A LAZY `/console\.error\(([\s\S]*?)\);/`, which is what this was. Every way that regex
   *  broke failed OPEN — it dropped arguments rather than flagging them (impl-review F2):
   *    - a `);` inside a string literal truncated the list, discarding everything after it;
   *    - `console.warn` was never scanned at all, and the eslint allowlist permits `warn`;
   *    - a call in expression position, without a trailing `;`, matched nothing.
   *  A guard whose parse failures hide the thing it guards against is worse than no guard.
   *
   *  `warn` is included because the allowlist is what defines the risk surface, not the level this
   *  page happens to use today. */
  function logCalls(): string[] {
    const calls: string[] = [];
    const opener = /console\.(?:error|warn)\(/g;
    for (let match = opener.exec(frontmatter); match !== null; match = opener.exec(frontmatter)) {
      let depth = 1;
      let index = match.index + match[0].length;
      const start = index;
      while (index < frontmatter.length && depth > 0) {
        const char = frontmatter[index];
        if (char === "(") {
          depth += 1;
        } else if (char === ")") {
          depth -= 1;
        }
        index += 1;
      }
      calls.push(frontmatter.slice(start, index - 1));
    }
    return calls;
  }

  it("says something when the read door fails", () => {
    // Anchored to the CALL plus the function name, not to a bare identifier: `get_period_by_token`
    // appears in the rpc invocation a few lines above, so a substring check would pass without any
    // logging at all.
    expect(frontmatter).toMatch(/console\.error\(\s*"get_period_by_token failed:"/);
  });

  it("says something when the reveal door fails", () => {
    // The one that matters most. A failure here downgrades a caretaker who HAS claimed to the
    // pre-claim page at status 200 — their instructions vanish and, before this assertion existed,
    // nothing anywhere recorded it.
    expect(frontmatter).toMatch(/console\.error\(\s*"get_claimed_details failed:"/);
  });

  it("never puts a bearer credential in a log line", () => {
    const calls = logCalls();

    // EXACT-count control, not `>= 2`. The parser above can only under-report — a call it fails to
    // read is a call this case never inspects — so the control has to notice that, and a floor
    // cannot. Counting openers independently of the parse is what makes a silent parse failure
    // loud (impl-review F2).
    const openers = frontmatter.match(/console\.(?:error|warn)\(/g) ?? [];
    expect(openers.length, "no console.error/warn calls found — the assertions below would be vacuous").toBeGreaterThan(
      0,
    );
    expect(calls.length, "the argument-list parser read fewer calls than exist — it failed open").toBe(openers.length);

    for (const call of calls) {
      // Everything after the leading message literal. The message legitimately contains
      // `get_period_by_token`, and the patterns below are deliberately substring-wide, so the
      // literal has to come off first or every case fails on its own message.
      const args = call.replace(/^\s*"[^"]*"\s*,?/, "");

      // SUBSTRING, not `\b…\b`, and that is the fix rather than an oversight. `\bclaimSecret\b`
      // does NOT match `rawClaimSecret` — measured — which is the raw, ungated cookie value sitting
      // in scope two lines away; `\btoken\b` likewise misses `p_token` and `tokenDigest`. For a
      // credential guard the correct direction to fail is a false alarm, never a false pass.
      expect(args, "a log line carries something token-shaped").not.toMatch(/token/i);
      expect(args, "a log line carries something secret-shaped").not.toMatch(/secret/i);
    }
  });
});
