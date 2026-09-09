<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Owner Occupancy View

- **Plan**: `context/changes/owner-occupancy-view/plan.md`
- **Scope**: Phase 2 of 3 — "The release function" (commit `b2e0677`)
- **Date**: 2026-09-09
- **Verdict**: NEEDS ATTENTION (both warnings fixed during triage)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

All four planned changes are a clean MATCH on intent and contract; nothing planned is missing,
`claim_slots` was not touched, and the commit holds exactly the six files the phase called for.
Both warnings are about claims that are not true rather than about code that does not work.

## Findings

### F1 — The anon refusal test passes with the grant widened

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `tests/rls/release-slot.test.ts:127`
- **Detail**: The plan required "an assertion that FAILS if the grant is widened, not merely one
  that passes on an empty result". `expect(error?.code).toBe("42501")` did not clear that bar.
  Mutation-tested: with `grant execute on function public.release_slot(uuid,uuid) to anon` live
  in the catalog, the suite still passed 8/8. The cause, read from the catalog rather than
  inferred — `has_table_privilege('anon','public.care_slots','update')` is `false` — is that
  widening the FUNCTION grant just moves the identical SQLSTATE one layer inward. The two states
  differ only by message: `permission denied for function release_slot` (posture intact) vs
  `permission denied for table care_slots` (grant widened). Exactly the anti-pattern
  `lessons.md` records. The `service_role` case at `:137` is unaffected — service_role holds
  both UPDATE and BYPASSRLS, so widening its grant makes the call succeed and that assertion
  genuinely fails.
- **Fix**: Assert the message names the function alongside the SQLSTATE.
  - Strength: Restores the property the plan demanded, at one line.
  - Tradeoff: Couples the test to a Postgres error string — acceptable; it is the only signal
    that separates the two layers.
  - Confidence: HIGH — verified by mutation in both directions.
  - Blind spot: None significant.
- **Decision**: FIXED. Re-proved by mutation: green with the posture intact, **red**
  (`expected 'permission denied for table care_slots' to contain 'function release_slot'`) with
  the grant widened, green again after restoring.

### F2 — The migration denies a lost update that is actually reachable

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260909090000_release_slot.sql:41-45`, and
  `plan.md` §Critical Implementation Details (the origin of the claim)
- **Detail**: The comment asserted that between the page render and the owner's click a row
  "can only be released by someone else, never re-claimed by a different person. There is no
  newer claim to clobber." False from the second clause on: a released row is
  `claimed_by_name is null`, which is exactly the state `claim_slots` writes into. Tab A renders
  showing Ania → tab B releases → Basia claims through the still-live link → tab A releases on
  stale UI and silently wipes Basia's newer claim; `claimed_at is not null` is true again, so
  nothing stops it. This commit's own test at `:232` proves the middle step. Scale: needs two
  concurrent owner surfaces plus a caretaker claim landing between them, and the slot ends free
  either way — the loss is Basia's fresh claim and the owner's stale-identity decision. The
  defect originates in the plan; the migration implemented it faithfully.
- **Fix A ⭐ Recommended**: Correct the comment to state the accepted risk; route the concurrency
  question to `prd.md` §Open Questions.
  - Strength: Keeps Phase 3's island props as planned (ids only), and stops the false premise
    being inherited by the next slice that reads this function.
  - Tradeoff: The lost update stays reachable in v1.
  - Confidence: HIGH — the window needs two owner sessions; one owner per period, no realtime.
  - Blind spot: Haven't measured how often an owner keeps two tabs open.
- **Fix B**: Add a `p_claimed_at timestamptz` argument ANDed into the WHERE.
  - Strength: Closes the window properly; `claimed_at` is not a secret, so it may reach the
    island without breaching the no-digest-to-the-client rule.
  - Tradeoff: Changes a committed, registered signature and widens Phase 3's props.
  - Confidence: MEDIUM — mechanism sound, knock-on unbudgeted.
  - Blind spot: Timestamp round-tripping through PostgREST unverified.
- **Decision**: FIXED via Fix A. Migration comment rewritten to state the window and the
  accepted risk; a correction block added under the plan's §Critical Implementation Details
  telling Phase 3 not to re-derive "impossible" from that paragraph; `prd.md` §Open Questions
  gains item 3 ("Wyścig przy zwalnianiu terminu").

### F3 — Releasing a caretaker's LAST term revokes their reveal, undocumented

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `supabase/migrations/20260909090000_release_slot.sql`,
  `docs/reference/contract-surfaces.md` (`release_slot` row)
- **Detail**: `get_claimed_details` gates the whole sensitive tier on
  `claim_digest = <digest>` within the period, so freeing one of several terms is harmless but
  freeing a capability's last term revokes that caretaker's reveal outright — trip note,
  sensitive instructions, stored name — and is indistinguishable to them from a bad link. This
  is intended behaviour: plan Progress row 3.7 manually verifies exactly it, and "no
  notification to the caretaker" is in §What We're NOT Doing. Only the documentation was silent.
- **Fix**: Name `get_claimed_details` as the downstream consumer in the migration header and in
  the registry row.
- **Decision**: FIXED.

### F4 — Two test cases beyond the five the plan named

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `tests/rls/release-slot.test.ts:137`, `:215`
- **Detail**: `service_role may NOT execute it` pins the other half of a revoke line the plan's
  SQL contract does name. `slot from a DIFFERENT period of the same owner` is the only assertion
  that would catch the `period_id = p_period_id` predicate being dropped — the plan motivated
  that predicate in prose but omitted it from its test list. Gap-fills, not creep.
- **Fix**: No action.
- **Decision**: SKIPPED — accepted as beneficial coverage.

## Success criteria

All six automated criteria re-verified on the reviewed tree, and again after the triage fixes
(a migration file changed, so `db:reset` was re-run rather than assumed):

| Criterion                    | Result                                     |
| ---------------------------- | ------------------------------------------ |
| 2.1 `npm run db:reset`       | exit 0, 14 migrations applied              |
| 2.2 `npm run db:gen-types`   | `release_slot` present, +4 generated lines |
| 2.3 `release-slot` suite     | 8 passed                                   |
| 2.4 `npx vitest run`         | 23 files, 232 tests passed                 |
| 2.5 `npm run build` + `lint` | exit 0 / exit 0 (4 pre-existing warnings)  |
| 2.6 `supabase db advisors`   | "No issues found"                          |

Manual 2.7–2.9 were confirmed by the user and independently read from the catalog:
`authenticated` t / `anon` f / `service_role` f; `provolatile` = `v`, `prosecdef` = `f`,
`proconfig` = `{search_path=""}`; releasing an already-free slot returns NULL and changes no row.
The grant widened for F1's mutation test was revoked and the posture re-read afterwards.

## Note for whoever picks up Phase 3

The plan's §Critical Implementation Details now carries a correction block. Read it before
designing the release island: the "no version token needs to travel to the client" conclusion
stands, but as an accepted risk, not as a proved impossibility.
