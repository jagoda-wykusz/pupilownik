<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Domain Guardrails — Phase 4

- **Plan**: `context/changes/testing-domain-guardrails/plan.md`
- **Scope**: Phase 4 of 5 — Contention at the HTTP layer, and the rest of Risk #3
- **Date**: 2026-09-11
- **Reviewed commit**: 71fdf87 (fixes landed in Phase 5)
- **Verdict**: NEEDS ATTENTION (all findings triaged and fixed)
- **Findings**: 2 critical-in-substance, 4 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | FAIL    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | FAIL    |

This is the only phase of the change to fail a dimension, and it fails two. Both failures are
the same kind of error: **a claim about the system asserted in prose, carried into tests, and
never measured.**

## F1 — The new constraint file closed a gap that did not exist

- **Severity**: ❌ CRITICAL (as a process failure; the file itself was harmless)
- **Impact**: 🔎 MEDIUM
- **Dimension**: Plan Adherence
- **Location**: `tests/rls/care-slots-claim-complete.test.ts` (deleted), `plan.md` Current State Analysis
- **Detail**: `tests/rls/care-slots.isolation.test.ts:123` already refused **all six** invalid
  claim-column combinations, plus the complete triple and the release direction. The new file
  covered four of the six and neither of the other two — a strict subset. Verified by reading
  the sibling.
- **Root cause, and it is the finding that matters**: the research pass at the start of this
  change reported "the triple CHECK has no negative test". That was false. It went into
  `plan.md` unverified, from there into the commit message and the file header — three
  assertions of a gap that never existed. **The mutation run did not catch it**, because
  dropping the constraint fails the pre-existing test too: "all five new cases failed" was true
  and proved nothing about novelty.
- **Fix**: The one genuine improvement — asserting SQLSTATE `23514` and the constraint's **name**
  rather than `not.toBeNull()` — folded into the existing test; the duplicate file deleted;
  `plan.md` corrected in place with the reason.
- **Decision**: FIXED

## F2 — The 40P01 deadlock branch is unreachable, and two tests claimed to reach it

- **Severity**: ❌ CRITICAL (as a false claim in code comments)
- **Impact**: 🔎 MEDIUM
- **Dimension**: Success Criteria
- **Location**: `tests/rls/claim-slots.test.ts` and `tests/api/invite-claim.test.ts`, contention blocks
- **Detail**: Both comments said overlapping selections are "the only shape that can deadlock".
  They cannot deadlock at all. `claim_slots` allocates with a single UPDATE carrying **no
  `ORDER BY`** (verified: the three `order by` clauses in that function are in the name lookup
  and the conflict aggregation, not the UPDATE), so both racing sessions run identical SQL, get
  the same plan, and take row locks in the **same order**. A consistent global lock order makes
  deadlock impossible. The loser blocks, re-evaluates `claimed_by_name is null` under READ
  COMMITTED, and raises `PT409` — always. The ten clean runs at each layer were not luck; they
  were the only outcome the schedule permits.
- **Consequences**: the plan's Phase 4 contract said the `40P01` mapping would be "exercised
  rather than assumed" — it was not; and `expect(["PT409","40P01"]).toContain(...)` was strictly
  weaker than `toBe("PT409")` for no gain, masking a regression that started producing deadlocks.
- **Fix**: assertion tightened to `toBe("PT409")`; both comments rewritten to state the
  mechanism truthfully; the branch covered deterministically by injection in
  `tests/unit/claim-error-mapping.test.ts`, which also covers `PT400`, the uniform 404 and the
  500 fallthrough — none of which had body-level assertions before. The plan contract corrected
  in place.
- **Note on criterion 4.7**: it reads "overlapping-selection case run ~10 times without spurious
  failure" and that WAS met. The unmet claim lived in the contract prose, not the criterion, so
  4.7 stays checked and the contract carries the correction.
- **Decision**: FIXED

## F3 — The contention block was mostly duplication

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Success Criteria
- **Detail**: Every assertion except one had a sequential twin in the same file. The exception —
  a PT409 refusal sets no capability cookie — needed no race to reach: `"sets NO cookie on any
refusal"` covers 403, 404 and 400 but not the database's own refusal.
- **Fix**: that assertion moved into the sequential 409 test where it belongs; the duplicate
  winner-cookie assertion dropped. The block now earns its place on the all-or-nothing invariant
  and the route's translation of the outcome, and its header says so — including that it is a
  **weaker** race detector than the six-claimant RPC case, not a stronger one.
- **Decision**: FIXED

## F4 — Race failures were undiagnosable

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Success Criteria
- **Detail**: Filtering by status meant any third status — the 500 fallthrough under connection
  pressure — failed as "expected length 1, received 0" with no statement of what came back.
  Files run in parallel, so two `Promise.all` bursts hit one local Postgres at once.
- **Fix**: `expect(statuses.sort()).toEqual([200, 409])` — same strength, honest failure message.
- **Decision**: FIXED

## F5 — Caretaker names collided with earlier tests in the same period

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Success Criteria
- **Detail**: "Ania", "Basia", "Celina", "Dorota" were already used by tests 300 lines earlier in
  the same seeded period. The `not.toContain(loser)` assertion was safe only because the read was
  narrowly scoped — widen it by one slot and the test fails on an unrelated claim.
- **Fix**: names suffixed per call with a uuid fragment, with the reason in a helper comment.
- **Decision**: FIXED

## F6 — The positive constraint case reintroduced the order-dependency its own comment forbade

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW
- **Detail**: It asserted the _other_ slot was still free, which is why it failed cascadingly
  under the drop-constraint mutation rather than on its own subject.
- **Fix**: moot — the file was deleted under F1, and the surviving test in
  `care-slots.isolation.test.ts` never had this problem.
- **Decision**: FIXED (by deletion)

## Observations recorded, not fixed

- **`conflictMessage` is module-private**, so its composition (time-of-day lookup, joining, the
  JSON.parse fallbacks) is reachable only through a full HTTP+DB round trip and its sentence is
  asserted by regex in three places against one inline literal. Partially mitigated: the new
  injection test now pins the PT409 sentence shape without a database.
- **Still untested in Risk #3**, prioritized for a future change: the claim × revoke TOCTOU
  (`claim_slots` resolves the period with `revoked_at is null` and then updates slots with no
  re-check — a revoke committing in between lets a claim land on a called-off trip); the
  documented claim × release lost-update window; and one capability claiming concurrently across
  two periods. The first is the only one that looks like it could be a real defect rather than an
  accepted gap.
- **Test-file shims** are now a fourth copy of `createFakeCookies` with three incompatible `call`
  signatures. Consolidation is its own change.

## Process finding — the one worth carrying

Four phases, and in **three** of them the plan's stated premise about system behaviour turned
out to be false, each time revealed by measurement rather than by planning or by reviewing the
plan. F1 adds the sharper version: **a mutation only refutes hypotheses you already hold**, so it
confirmed a gap analysis that was wrong at its root. The rule this change earned:

> A sentence about what happens when a guard is removed is a PREDICTION. It belongs in a
> mutation run before it belongs in prose — and the mutation has to be able to tell the
> prediction apart from its neighbours, or it confirms the wrong thing.

Recorded in `test-plan.md` §6.6 and §7.
