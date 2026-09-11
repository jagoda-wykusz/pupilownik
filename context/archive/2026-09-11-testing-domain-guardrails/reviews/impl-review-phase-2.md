<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Domain Guardrails — Phase 2

- **Plan**: `context/changes/testing-domain-guardrails/plan.md`
- **Scope**: Phase 2 of 5 — Releasing a term and the caretaker's reveal (Risk #5)
- **Date**: 2026-09-11
- **Reviewed commit**: 0649961
- **Verdict**: NEEDS ATTENTION (all findings triaged and fixed)
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

No production code and no migration shipped in this phase, so the review is entirely about
whether the new tests prove what they claim. The plan's contract was met in full, plus two
cases beyond it (disclosed at the phase gate).

## The finding that matters most

The phase-gate report claimed two mutations proved the two halves discriminate — and that held
up under review. What it could not show is the limit of the method: **mutation testing only
refutes hypotheses you already hold.** A third wrong implementation — clearing the capability's
rows across EVERY period rather than the one released from — passed all four original tests,
because every test seeded exactly one period and no capability ever spanned two. The failure
it hides is real and product-visible: a caretaker helping two households silently loses their
second trip's reveal when the first household frees a term.

## Findings

### F1 — Snapshot compared with itself, in a test that duplicated a stronger sibling

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `tests/rls/release-reveal.test.ts:240,244` (as committed in 0649961)
- **Detail**: `expect(await claimColumnsOf(kept)).toEqual(keptBefore)` never asserted
  `keptBefore` was non-null. Had `claim_slots` stopped writing `claim_digest`, both reads would
  be all-null and the case would pass having proved nothing. The file never imported
  `digestClaimSecret`, so it never checked the digest was the RIGHT value — only unchanged.
  Separately the whole case restated `tests/rls/release-slot.test.ts:184-188`, which already
  releases one of two slots held by one capability and compares the kept row against an
  independently derived digest. Verified by reading the sibling.
- **Fix**: Repurposed the case to span two periods (see F2) and compare the kept digest against
  `digestClaimSecret(secret)`.
- **Decision**: FIXED

### F2 — No capability spanning two periods

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: whole file
- **Detail**: A `release_slot` that matched on `claim_digest` without `period_id` passed all
  four original cases. `tests/rls/reveal-instructions.test.ts:375` already treats the
  one-capability-two-trips state as realistic, so this is not a hypothetical shape.
- **Fix**: New case "leaves their OTHER trip alone, including its digest" — one secret claims in
  two seeded periods; releasing in the first leaves the second's row and reveal intact.
- **Mutation evidence**: with `period_id = p_period_id` dropped from `release_slot`'s WHERE and
  the match moved to the digest, the new case fails. Before the rework, that mutation passed
  every test in the file.
- **Decision**: FIXED

### F3 — The header advertised a distinction the file never tested

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `tests/rls/release-reveal.test.ts:26-29,194` (as committed)
- **Detail**: The header made "plain null, NOT `{revoked: true}`" its headline claim, but
  nothing in the file revoked anything, so `toBeNull()` asserted the ordinary non-holder outcome
  on a live trip — already pinned five ways in `reveal-instructions.test.ts`.
- **Fix**: New case "takes even the called-off card from a holder on a REVOKED trip": revoke →
  holder gets `{revoked: true}` → release their last term → plain null, because the claim gate
  runs before the revoked branch. Recorded in the header as composition, not as a mutation-backed
  guard — there is no mutation behind it and the file now says so.
- **Decision**: FIXED

### F4 — `revealContent` flattened the two non-content answers

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Location**: `tests/rls/release-reveal.test.ts:130-136` (as committed)
- **Detail**: One error message for both `null` and `{revoked: true}` — erasing exactly the
  distinction the file exists to observe. Its doc comment also claimed every caller had already
  asserted the reveal was alive, which was false for the first caller.
- **Fix**: Separate messages naming which answer arrived; corrected doc comment.
- **Decision**: FIXED

### F5 — Weak case: "leaves the trip itself untouched for everyone else"

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Detail**: Only discriminated period-wide over-reach, already caught at row level and more
  cheaply by `tests/rls/release-slot.test.ts:185-187`.
- **Fix**: Removed; its ground is covered by the sibling and by the new cross-period case.
- **Decision**: FIXED

### F6 — Duplicated fixtures and reveal shapes

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Detail**: The reveal-door interfaces and the sensitive-instruction fixture strings existed
  verbatim in two files. **The review called this a "third copy"; that was wrong** —
  `tests/rls/revoke-period.test.ts` reads the door untyped via `Object.keys` and declares
  nothing. Two copies, checked. Still worth extracting: the constants are ASSERTED against, so
  two definitions of "the sensitive body" is two definitions of what a leak looks like.
- **Fix**: `tests/helpers/reveal.ts`; both files import from it. `reveal-instructions.test.ts`
  re-run unchanged, 16/16.
- **Decision**: FIXED

### F7 — Dead branches and identical dates

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Detail**: `slotIds[0] ?? ""` was unreachable noise, and every seeded period used the same
  two dates, so a defect scoped by `(slot_date, time_of_day)` instead of `period_id` would have
  been invisible.
- **Fix**: Plain indexing; `seedPeriod` advances the date per period.
- **Decision**: FIXED

## Verification after fixes

| Check                                   | Result                       |
| --------------------------------------- | ---------------------------- |
| `release-reveal.test.ts`                | 4 tests, EXIT=0              |
| `reveal-instructions.test.ts` (touched) | 16 tests, EXIT=0             |
| `npm test`                              | 33 files / 331 tests, EXIT=0 |
| `npx astro check`                       | 0 errors, EXIT=0             |
| `npm run lint`                          | 0 errors, 6 warnings, EXIT=0 |

**Three mutations now stand behind this file**, each rejected by exactly one case:

| Mutation to `release_slot`    | Rejected by                         |
| ----------------------------- | ----------------------------------- |
| never clear `claim_digest`    | "collapses their reveal to nothing" |
| clear the WHOLE capability    | "keeps the reveal alive…"           |
| clear it across OTHER periods | "leaves their OTHER trip alone…"    |

The revoked-trip case has no mutation behind it and is documented in the file as composition
rather than as a guard.

## Process note

The task-runner notification again reported `exit code 0` for a lint run that had errors. Same
cause as phase 1: the exit code belongs to the last element of the command chain. Read it from
the output file.
