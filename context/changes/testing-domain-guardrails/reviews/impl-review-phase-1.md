<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Domain Guardrails — Test Rollout Phase 4

- **Plan**: `context/changes/testing-domain-guardrails/plan.md`
- **Scope**: Phase 1 of 5 — The caretaker page's instruction gate (Risk #4)
- **Date**: 2026-09-11
- **Reviewed commit**: 877f970
- **Verdict**: NEEDS ATTENTION (all findings triaged and fixed)
- **Findings**: 0 critical, 4 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

Production code was clean: no path lets the sensitive tier or the note reach an unproven
visitor, page behaviour is unchanged, `invite-view.ts` gained no import, and no boundary from
§What We're NOT Doing was crossed. **Every finding was in the guards, not the code** — which is
the failure mode `lessons.md` already records for this project, arriving here in its test form.

## The correction that outlives this review

The phase's own framing overstated the risk, and the review is what surfaced it. `get_period_by_token`
returns public instruction rows only, so before a claim the page is never handed a sensitive row or
the note — there was nothing to leak at this layer. Secrecy is enforced by the two SECURITY DEFINER
doors plus `splitRevealAnswer`, already pinned one layer down. What Phase 1 actually pins is
everything downstream of that gate: tier separation, id-keyed matching, no dropped or conjured pet,
and the note travelling only with the reveal. Real, but narrower than "leaks a house key".
**Phase 5's §7 entry must use the narrower wording.**

## Findings

### F1 — "Guards the guard" passed on a comment

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `tests/unit/invite-source.test.ts:44,49`
- **Detail**: `stripComments` ran on the template only; the frontmatter went in raw. `[token].astro:191`
  names `composeCaretakerView` inside a `//` comment, so deleting the call at :197 left the
  "guards the guard" assertion green (the import line would have carried it too) — turning every
  absence assertion in the file into a permanent tautology. `tests/unit/claimed-details-ordering.test.ts:66`
  already strips `--` lines for exactly this reason; the precedent was not carried over.
- **Fix**: Strip `//` and block comments from the frontmatter; assert the call shape
  `composeCaretakerView({`, not the bare identifier.
- **Decision**: FIXED

### F2 — The flagship composition test could not fail

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `tests/unit/invite-composition.test.ts:59-66`
- **Detail**: The case passed `details: null`, so `SECRET_BODY` / `SECRET_TITLE` / `NOTE` existed
  only in a fixture it never handed in. No implementation short of fabricating constants could
  put them in the output. The whole-serialization search is load-bearing in
  `tests/rls/reveal-instructions.test.ts` because the database HOLDS the rows and declines to
  serialize them; here the function never receives them.
- **Fix**: Give the PUBLIC fixture a sentinel row and assert it is never promoted into
  `sensitiveInstructions`; add the proven-but-empty reveal case (`pets: []`,
  `caretaker_note: null`); narrow the file header to what it can actually prove.
- **Decision**: FIXED

### F3 — The note guard checked the wrong half of the file

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `tests/unit/invite-source.test.ts:67-70`
- **Detail**: Note assertions ran on the template only. `const note = details?.caretaker_note`
  in the frontmatter plus `{note}` below passes all of them while restoring the ungated ternary
  this phase removed. A blanket frontmatter ban is not available: `[token].astro:72` legitimately
  declares `caretaker_note` in the `ClaimedDetails` interface.
- **Fix**: Assert the comment-stripped frontmatter contains neither `details.caretaker_note` nor
  `details?.caretaker_note` nor `details?.pets` nor `new Map(`.
- **Decision**: FIXED

### F4 — Both instruction tiers share one type, so swapped arguments typecheck

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/invite-view.ts:108-114`
- **Detail**: `pets: P[]` and `details.pets: P[]` were the same type, so a call with the two
  arguments swapped compiles cleanly and would hand the sensitive tier to every holder of the link.
- **Fix (applied)**: Narrow `details.pets` to `{ id: string; instructions: P["instructions"] }[]`
  and pin the single call site's shape in the source guard.
- **CORRECTION — the review's recommendation overclaimed, and this was measured, not assumed.**
  The narrowing does NOT make the swap a compile error: TypeScript is structural, so a full public
  pet stays assignable to the narrower shape. Verified by compiling the swapped call with `tsc`
  (exit 0). What the narrowing genuinely buys is dropping the over-constraint that forced the
  reveal door to carry `name` and `species`, which the function never reads. Closing the swap
  properly would need nominal/branded types for the two tiers — out of this phase's scope. The
  live defence is that exactly one call site exists and the source guard pins its shape.
- **Decision**: FIXED (with the corrected rationale recorded in code)

### F5 — Bare block comments in the template were not stripped

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `tests/unit/invite-source.test.ts:37-39`
- **Detail**: `stripComments` matched only brace-wrapped blocks. The template carries two bare
  ones (`[token].astro:221-227`, `:239-248`; the second names `get_claimed_details`). Nothing was
  wrong today, but the guard sat one explanatory sentence away from failing on its own rationale.
- **Fix**: Strip both forms.
- **Decision**: FIXED (folded into F1)

### F6 — The plan still carried the rule we deliberately narrowed

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `plan.md` — Phase 1, change #4
- **Detail**: The contract still read "below the fence there is no reference to `details`", a rule
  narrowed by agreement at the start of the phase because the banner and the island prop
  legitimately keep reading `details`. Left unamended, a later reader sees the narrower guard as
  an unexplained shortfall. Same class as the "verify posture from the catalogue, not the comment"
  lesson, in its document form.
- **Fix**: Record the narrowing and its reason in the contract.
- **Decision**: FIXED

### F7 — The module's third export is pinned by a separate file

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `tests/unit/invite-composition.test.ts`
- **Detail**: `[token].astro:147-151` stated the convention outright — the split lives in
  `invite-view.ts` "and pinned by the same test file". The third export is pinned elsewhere.
- **Fix**: Update the page comment to name one test file per decision.
- **Decision**: FIXED

## Verification after fixes

| Check                           | Result                                                                 |
| ------------------------------- | ---------------------------------------------------------------------- |
| `npx vitest run --project unit` | 135 tests, EXIT=0                                                      |
| `npm test`                      | 32 files / 327 tests, EXIT=0 (pre-F5 edit)                             |
| `npx astro check`               | 0 errors, EXIT=0                                                       |
| `npm run build`                 | Complete, EXIT=0                                                       |
| `npm run lint`                  | see the phase-2 commit; read from file, never from a task notification |

Mutation evidence: deleting the `composeCaretakerView` call from `[token].astro` now fails three
source-guard cases. Before F1 it failed none.

## Process note worth carrying

Twice in this phase a background task notification reported `exit code 0` while the tool had
failed — 321 lint errors the first time, 2 the second. The exit code belonged to the last element
of the command chain, not to eslint. `lessons.md` records this for pipes; the task-runner wrapper
is the same defect in new clothing. **Read the exit code out of the output file.**
