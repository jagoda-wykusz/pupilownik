<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Period ↔ Pets Relation

- **Plan**: `context/changes/period-pets-relation/plan.md`
- **Scope**: Phase 1 of 3, commit `0553bd1`
- **Date**: 2026-09-06
- **Verdict**: REJECTED at review time → all 9 findings triaged; 7 fixed, 1 justified, 1 skipped with the reason recorded
- **Findings**: 1 critical, 3 warnings, 5 observations

## Verdicts (at review time)

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING (F3) |
| Scope Discipline | PASS |
| Safety & Quality | FAIL (F1 critical; F2, F3) |
| Architecture | PASS |
| Pattern Consistency | WARNING (F7, F9) |
| Success Criteria | PASS |

All five automated criteria passed at review time and again after triage: `db:reset` (9
migrations), advisors clean, `db:gen-types` with no drift, `astro check` 0 errors,
`npm run lint` 0 errors, `npm run build` complete, **103/103** tests (100 before triage).

Both review agents independently confirmed that every guardrail from §What We're NOT Doing
held: no instructions anywhere, no `NOTATKA` field, no database constraint or trigger for
"at least one pet", no backfill, slots still period-scoped, `/pets` untouched. All four
policies are genuine conjunctions over both parents, and UPDATE carries the full predicate in
both `using` and `with check`.

**Why REJECTED and not NEEDS ATTENTION.** `master` had a dead user-facing path: an owner could
not create a trip. Not a latent defect and not a future risk — a feature that did not work,
committed and passed through a manual verification gate. The fix was small; the verdict
described the state, not the cost of repair.

## Findings

### F1 — The create-trip path was broken on master

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality (Reliability)
- **Location**: `src/components/periods/NewPeriodForm.tsx:80` vs `src/lib/schemas/period.ts:25-28`
- **Detail**: Both agents found this independently, and it was reproduced through HTTP with
  the shipped island's exact body:

  ```
  status=400 {"error":"Validation failed","issues":[{"path":["pet_ids"],
              "message":"Invalid input: expected array, received undefined"}]}
  ```

  `pet_ids` became required with `.min(1)` while the island still posted three fields, so
  every submit from `/periods/new` was rejected and rendered as "Dane są niepoprawne".
  `NewPeriodForm.tsx` and `new.astro` were not in commit `0553bd1` — they belonged to Phase 2.

  This is the unpriced half of the phase-boundary adaptation. Pulling the schema and route
  into Phase 1 was correct for the suite, but it moved the **server-side requirement ahead of
  its client-side supplier**. Neither the plan nor the addendum sanctioned a broken owner
  flow between phases, and the plan's own Phase 1 gate pauses there, so the window was real.
  The suite could not catch it: `periods.post.test.ts` hand-builds the body, and `tests/` has
  no component renderer. It is the `lessons.md` consumer-enumeration rule applied to a schema
  field — the field was added ahead of its producer.
- **Fix A ⭐ (chosen)**: supply the owner's pets to the island and post the selected ids.
  Verified through HTTP: an owner with no pets gets a route out rather than a dead form; an
  owner with two pets gets both chips; creating with two pets yields 2 join rows and 9 slots;
  an empty selection is refused with 400.
- **Fix B (not chosen)**: make `pet_ids` optional with a default until Phase 2. Rejected
  because the RPC refuses an empty list anyway, so a default means inventing data — exactly
  what the backfill decision rejected.
- **Consequence**: Phase 2's items 3 and 4 came forward with the fix. **Phase 2 is now design
  polish only** — chip styling against the hi-fi reference and the three-theme check. That is
  the second phase-boundary move in this change; both are recorded.
- **Decision**: FIXED via Fix A

### F2 — The anon revoke on the new table was pinned only by a comment

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: migration `:42`; `tests/rls/invite-token.test.ts:132-143`
- **Detail**: the "is the only door" test asserted 42501 for `care_periods` and `care_slots`;
  `care_period_pets` was absent. Removing `revoke all … from anon` left all 100 tests
  passing, because deny-by-default RLS returns zero rows either way. The sixth instance of
  the pattern `lessons.md` was written for — inside a commit whose migration comment claimed
  the gap closed.
- **Fix**: added `care_period_pets` to the 42501 assertions. Mutation-tested by granting anon
  SELECT back: the test now fails.
- **Decision**: FIXED

### F3 — Two planned route cases missing; a foreign pet answered 500

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Plan Adherence / Safety & Quality
- **Location**: `tests/api/periods.post.test.ts`; `src/pages/api/periods.ts:48-56`
- **Detail**: the plan's §Testing Strategy required a case for an empty `pet_ids` (400) and
  one for a pet the caller does not own. Neither existed — the file had no second owner. The
  route also mapped every DB error to 500, so a foreign `pet_id` (42501 from the with-check)
  and a NULL element (23502) — both client-input errors — were served as server failures.
- **Fix**: both cases added, and the route now maps 42501 / 23503 / 23502 / P0001 from this
  RPC to **400** with a distinct message. zod cannot catch these; it does not know who owns
  a pet.
- **Decision**: FIXED

### F4 — The empty-list test passed on any error

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Location**: `tests/rls/care-period-pets.isolation.test.ts:142`; migration `:154`
- **Detail**: it asserted only `expect(error).not.toBeNull()`, so it would also pass if
  PostgREST failed to resolve the argument list — the wrong-reason failure a sibling test
  warns about in a comment. "At least one pet" is the *only* layer enforcing that rule, so
  its test has to pin the raise. Separately, `array[null]` slipped past the length guard;
  verified in psql that the **RLS policy** refused it (not the NOT NULL constraint, correcting
  one agent's reading), so the transaction still rolled back.
- **Fix**: the test pins `P0001` and the raise's message and covers `[NULL]` too;
  `20260906174022_filter_null_pet_ids.sql` strips NULLs **before** the count. The naive fix
  (`where pid is not null` on the insert) would have made `[NULL]` insert zero rows and leave
  a petless period — silently worse than the policy violation it replaced. `CREATE OR REPLACE`
  with an unchanged argument list preserved the grants, verified from the catalog.
- **Decision**: FIXED

### F5 — Only the INSERT policy is mutation-covered

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM
- **Dimension**: Success Criteria
- **Location**: migration `:53-66`, `:108-121`
- **Detail**: the SELECT and DELETE conjunctions are not pinned — dropping either half from
  either leaves every test passing, because no test creates a row whose two parents have
  different owners. And `seed.sql` writes this table as `postgres`, bypassing RLS, so such a
  row is representable.
- **Decision**: SKIPPED, with the cost recorded. Producing that row needs a privileged write,
  and the application cannot make one: INSERT and UPDATE both refuse it and there is no
  pet-ownership-transfer path (`pets_update_own` carries `using` + `with check` on
  `owner_id`). The two available producers are a `service_role` client — widening a fence
  `test-plan.md` §6.6 records as existing for exactly one call in one file — or a deliberately
  invalid row in `seed.sql`, which lands in every developer's database and shows in the UI.
  Both cost more than the residual risk: these clauses are defense-in-depth against corrupt
  data a privileged process would have to create first. Recorded in `test-plan.md` §7 with
  that reasoning.

### F6 — A secondary assertion could not see the leak it named

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Location**: `tests/rls/care-period-pets.isolation.test.ts:94-95`
- **Detail**: the follow-up read went through the victim's own client, whose SELECT policy
  would filter A's illicit row out under either single-half mutation. Harmless — the line
  above it was load-bearing — but the comment oversold it.
- **Fix**: removed the assertion; the comment now says what the remaining one actually checks.
- **Decision**: FIXED

### F7 — Pet seeding duplicated twice instead of composing the helper

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: `tests/api/periods.post.test.ts` (two `beforeAll` blocks)
- **Detail**: both blocks grew their own six-line pet-insert instead of composing
  `createOwnerWithPet()` — the duplication that helper was introduced to prevent. Defensible
  (the route test also needs a cookie header) but it wanted one more composition.
- **Fix**: `createAuthenticatedOwnerWithPet()` added to `tests/helpers/session.ts` and used in
  both places.
- **Decision**: FIXED

### F8 — `MAX_PETS_PER_PERIOD = 20` was an undocumented pick

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Adherence
- **Location**: `src/lib/period-format.ts:43`
- **Detail**: the plan said `<bound>`; 20 was chosen with no recorded reason, and the upper
  bound exists only in zod — the RPC has none.
- **Fix**: comment records why 20 (roughly an order of magnitude above a household of pets)
  and why the RPC needs no bound of its own (a caller can only link pets they own, and RLS
  already caps that at their own pet count).
- **Decision**: JUSTIFIED IN PLACE

### F9 — The registry described a signature that no longer exists

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: `docs/reference/contract-surfaces.md:25`
- **Detail**: the `create_period_with_slots` row still carried the pre-change contract despite
  a breaking signature change. Phase 3 owns the registry work, but the row was actively wrong
  on `master`.
- **Fix**: row updated with the five-argument signature, the raise as the only enforcement of
  "at least one pet", and why it stays security-invoker. The remaining registry rows
  (`care_period_pets`, `MAX_PETS_PER_PERIOD`, `createOwnerWithPet`) stay in Phase 3.
- **Decision**: FIXED

## Post-triage state

9 migrations apply clean from scratch, advisors clean, no type drift, `astro check` and lint
clean, build complete, **103/103** tests. Phase 2 is reduced to design polish.
