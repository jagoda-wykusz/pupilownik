<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Close / cancel a care period (FR-012, S-06)

- **Plan**: `context/changes/close-care-period/plan.md`
- **Scope**: Phase 1 of 4 — "The write, and irreversibility in SQL"
- **Commit reviewed**: `a3454a6`
- **Date**: 2026-09-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 5 observations (plus 1 warning found and fixed mid-review)

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## What was verified clean (recorded rather than left silent)

- **Security**: `security invoker` + `set search_path = ''` with every object schema-qualified
  (`public.care_periods`, `pg_catalog.now()`) — no search_path surface. `care_periods_update_own`
  (`20260905234144:88-92`, `using ((select auth.uid()) = owner_id)` plus matching `with check`) is
  the real boundary; the function body carries no `owner_id` predicate, so flipping it to definer
  would let any authenticated user revoke any period — the header comment guards that choice.
  Grants name the roles, which is what actually closes Supabase's `ALTER DEFAULT PRIVILEGES` door.
  `create or replace` on `regenerate_period_token` kept the signature, so no ACL was recreated for
  `anon`/`service_role`. Uniform failure preserved: a scalar return collapses all misses to one
  NULL, and the change **tightens** the surface rather than widening it.
- **Concurrency / data safety**: under READ COMMITTED a second concurrent
  `update … where revoked_at is null` blocks, re-evaluates the predicate against the updated row,
  matches nothing and returns NULL. Repeat calls are idempotent and the original timestamp
  survives. The migration is additive: one new function, one signature-preserving replace, two
  `comment on` statements — no table rewrite.
- **Postures measured, not assumed** (per `lessons.md`): `revoke_period` EXECUTE is
  anon=false / authenticated=true / service_role=false; `care_periods` UPDATE is
  anon=false / authenticated=true / service_role=true; `rolbypassrls` is true for `service_role`
  only; `pg_attribute.attacl` for `revoked_at` is NULL; `prosecdef` false for both functions.
- **Both new postures are genuinely pinned**, verified by removing each guard from the live
  catalog and re-running: dropping `and revoked_at is null` from `regenerate_period_token` fails
  `tests/rls/invite-token.test.ts` on `expect(data).toBeNull()`; dropping it from `revoke_period`
  fails `tests/rls/revoke-period.test.ts` on the same assertion. Database restored afterwards and
  the suite re-run green.
- **Scope discipline**: zero creep. No route, no island, no `.astro`, nothing under `src/pages/**`
  or `src/components/**`. The migration's only top-level statements are the seven expected ones —
  no `alter table`, no new column, constraint, trigger or index. No un-revoke, no second lifecycle
  state, no bulk release, no notification, no cookie invalidation.
- **Pattern compliance**: no substantive mismatch against `release_slot.sql` /
  `release-slot.test.ts`. The two deltas from the template (the message-level grant assertion and
  the write-once predicate) are both improvements. `database.types.ts` matches the generator's
  own collapsed one-line style for single-argument functions and is in correct alphabetical
  position — not a hand edit.
- **Success criteria**: re-verified from a clean database — `db:reset` exit 0,
  `db:gen-types` exit 0 with a byte-identical result to what was committed, full suite 268/268,
  lint exit 0 with 0 errors (5 pre-existing `no-console` warnings, all outside this phase).

## Findings

### F0 — Column comment described Phase 2 behaviour in the present tense

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `supabase/migrations/20260910120000_revoke_period.sql:181`
- **Detail**: The comment claimed `get_claimed_details` "answers a proven claim-holder
  differently" while all three predicates are still identical — self-contradictory within one
  sentence, since the same line first states the three functions share the predicate. Eight lines
  above, the same file indicts the _previous_ comment for exactly this ("'Written by S-06' —
  future tense about a writer that did not exist"). The registry row for the same column hedged
  it correctly; the SQL comment did not. This is the class `lessons.md` records under
  "Weryfikuj posturę systemu z katalogu", rule for documents.
- **Fix**: Reword to "as of this migration all three are identical (planned, S-06 Phase 2:
  `get_claimed_details` **will** resolve the period WITHOUT this filter …)".
- **Decision**: FIXED — verified through `col_description()` in the live catalog after `db:reset`.

### F1 — `token.ts`'s NULL comment became false

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/pages/api/periods/[id]/token.ts:42-43`
- **Detail**: The comment said NULL means "the period does not exist, or it is not this owner's".
  This phase added a **third** reason (revoked), which the migration itself acknowledges. It is
  the one prose statement this phase made false, and it sits in a file the plan did not list —
  so Phase 4's `grep -rn "S-06"` staleness sweep would not have caught it either, because the
  sentence contains no "S-06".
- **Fix**: Name the third reason in the comment and restate that all three collapse to one 404.
- **Decision**: FIXED
- **Carried forward to Phase 3**: a revoked period now yields
  `404 {"error":"Nie znaleziono wyjazdu"}`, and `RegenerateLinkButton` maps every non-401 failure
  to "Spróbuj ponownie" — a retry prompt for something that can never succeed. Today the `revoked`
  prop hides it; once the revoke control ships, a stale-prop page (revoke in one tab, regenerate
  in another) reaches exactly that dead end. Phase 3 should give that 404 branch a terminal
  message.

### F2 — The registry promised more than the test pins

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `docs/reference/contract-surfaces.md` (`revoke_period` row) +
  `tests/rls/revoke-period.test.ts:138`
- **Detail**: The row claimed the grant is "pinned from both directions … (42501 **and** the
  message naming the function)", but the message assertion covers `anon` only; `service_role`
  asserts the code alone. The plan's text said "anon and service_role **each**". The registry is a
  document later work treats as ground truth. The test-side gap is cosmetic — with EXECUTE
  restored, `service_role` (which holds UPDATE and `rolbypassrls`, both read from the catalog)
  would **succeed** rather than return a different error, so the code-only assertion still fails —
  but the doc-vs-code divergence is not.
- **Fix A ⭐ Recommended**: Narrow the registry to the truth — "42501 for both, plus, for `anon`
  only, the message naming the function", with the measured reason and the `service_role`
  `rolbypassrls` explanation.
  - Strength: the document starts describing fact; no change to a test that already fails for the
    right reason.
  - Tradeoff: leaves an asymmetry between two roles in the same `describe`.
  - Confidence: HIGH — both directions measured in-session.
  - Blind spot: none significant.
- **Fix B**: Add a message assertion for `service_role` to match the registry and the plan's
  literal wording.
  - Strength: removes the asymmetry, satisfies the plan's letter.
  - Tradeoff: `release-slot.test.ts:159` has the identical form, so this diverges the new test
    from its template unless back-ported (see F6).
  - Confidence: MEDIUM.
  - Blind spot: with `rolbypassrls`, a widened grant yields success, so a message assertion there
    would be dead code.
- **Decision**: FIXED via Fix A

### F3 — Assertion forms that can pass vacuously

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (test quality)
- **Location**: `tests/rls/revoke-period.test.ts:149,162,174`; `tests/rls/invite-token.test.ts:298`
- **Detail**: `periodOf` returns `(data ?? [])[0]` — `undefined` when no row comes back — and
  Vitest's `not.toBeNull()` **accepts** `undefined` (`toBeNull` is `Object.is(x, null)`). So the
  "stamp landed" and "original timestamp preserved" pair could pass without ever reading a row.
  The digest comparison in `invite-token.test.ts:298` optional-chains **both** sides, so it would
  pass vacuously if either select returned nothing. The negative assertions (`:117`, `:187`) are
  safe, because `toBeNull()` does reject `undefined` — that asymmetry is what makes this easy to
  miss. Downgraded from WARNING because the postures themselves were measured as pinned: with
  either guard removed, the test fails on `expect(data).toBeNull()` before reaching these lines.
- **Fix**: Make `periodOf` throw when the row is absent (it is always the owning owner reading
  their own row, so absence is a bug, not a case), and anchor the digest baseline with
  `expect(typeof before.data?.token_digest).toBe("string")`.
- **Decision**: PENDING

### F4 — One tautological assertion

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (test quality)
- **Location**: `tests/rls/invite-token.test.ts:301`
- **Detail**: `await expect(resolve(replacement)).resolves.toBeNull()` cannot fail — the period is
  revoked, so a freshly minted token resolves to nothing whether or not the guard worked.
  Measured: with the guard removed the test fails earlier, on `expect(data).toBeNull()`. So this
  line is an illustration standing behind a working assertion, not a false guard.
- **Fix**: Either mark it as illustration, or make it bite by minting against a **non-revoked**
  control period and asserting that one _does_ resolve.
- **Decision**: PENDING

### F5 — "FR-012 shipped as ONE action"

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `supabase/migrations/20260910120000_revoke_period.sql:3`
- **Detail**: A scope decision stated as a shipped state — the function has no caller until Phase 3. The same file is careful elsewhere ("Once the revoke control ships in Phase 3").
- **Fix**: Reword to "is scoped as one action".
- **Decision**: PENDING

### F6 — The new test is stronger than the template it came from

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `tests/rls/release-slot.test.ts:138`; `tests/rls/invite-token.test.ts:216-234`
- **Detail**: Both assert the SQLSTATE only for `anon`, so **both would keep passing with those
  function grants fully widened to `anon`** — the anti-pattern `lessons.md` names. The in-session
  measurement on `revoke_period` (`permission denied for table care_periods` arriving in place of
  the function's own refusal) shows a back-port of the message assertion would close the gap in
  two existing tests. Out of this phase's scope.
- **Fix**: Back-port `expect(error?.message).toContain("function <name>")` to the `anon` cases of
  `release_slot` and `regenerate_period_token`.
- **Decision**: PENDING

### F7 — Irreversibility is a convention, not an enforcement

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: `supabase/migrations/20260910120000_revoke_period.sql:70-74,181`
- **Detail**: `care_periods_update_own` admits every column of an admitted row, so
  `.update({ revoked_at: null })` from the owner's own session un-revokes a trip and resurrects a
  link the owner believed dead. The commit states this honestly in both the column comment and the
  registry, which is defensible for the MVP — but the direct path is well-trodden: the repo's own
  tests revoke by direct UPDATE (`tests/rls/claim-slots.test.ts:136`,
  `tests/api/invite-claim.test.ts:336`). A `before update` trigger raising when
  `old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at` would make it
  real in ~6 lines, but the plan explicitly rules out a schema change in this slice.
- **Fix**: Leave as is for the MVP; the thing to police is that no later slice cites the registry
  row as enforcement.
- **Decision**: PENDING
