<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Caretaker Claims Slot

- **Plan**: `context/changes/caretaker-claims-slot/plan.md`
- **Scope**: Phase 3 of 5
- **Date**: 2026-09-07
- **Commits reviewed**: `7477535` (phase 3)
- **Verdict**: NEEDS ATTENTION → all 10 findings triaged and fixed 2026-09-07
- **Findings**: 0 critical, 4 warnings, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Automated criteria, re-verified from scratch

| Criterion                                | Result                                                |
| ---------------------------------------- | ----------------------------------------------------- |
| 3.1 payload-pinning suites               | PASS — integration 106/106, 19 files                  |
| 3.2 unit tests                           | PASS — 65/65                                          |
| 3.3 `npm run lint`                       | PASS — `EXIT=0`, 3 pre-existing `no-console` warnings |
| 3.3 `npm run build`                      | PASS — `EXIT=0`                                       |
| types in sync                            | PASS — `db:gen-types` produced an empty diff          |
| `npx astro check` (not a plan criterion) | **FAIL at the commit — 3 errors (F1)**                |

Every exit code was read without a pipeline, per the lesson recorded in Phase 2.

## Ruled out (checked from the live catalog and by probe, not findings)

- **No security defect in the tier split.** `care_instructions.is_sensitive` is `not null default false`,
  so `= false` / `= true` partition the set with no tri-state hole.
- Grant posture, read from `has_function_privilege`: all three doors are
  `anon=t authenticated=t service_role=f public=f`, each `security definer` with `search_path=""`.
  `get_period_by_token` is `STABLE`, `get_claimed_details` is `STABLE`, `claim_slots` is `VOLATILE`.
- **The migration's claim that `CREATE OR REPLACE` preserved `get_period_by_token`'s grants HOLDS** —
  verified from the catalog rather than from the comment.
- `information_schema.role_table_grants` returns **zero rows** for `anon` in `public`: the
  SECURITY DEFINER readers have no table-grant escape route behind them.
- A cross-owner pet link is unrepresentable: `care_period_pets`' policies are a conjunction over
  both parents, and `create_period_with_slots` (SECURITY INVOKER) is the only writer of link rows.
- jsonb edge cases probed live inside a rolled-back transaction: zero pets → `pets: []` in both
  functions; a pet with only public rows → reveal returns `instructions: []` and still lists the
  pet; `NULL caretaker_note` → key present with JSON null; a digest holding slots in two periods
  returned only the addressed period's slot. No `null`-where-an-array-is-expected exists.
- `caretaker_note` is unreachable through `get_period_by_token` by any route.
- XSS: the page uses only `{expression}` interpolation, which Astro escapes. No `set:html`.
- Performance: no finding. The three relevant indexes serve the three lookups; at ~20 pets × a
  handful of rows no tuning is justified.
- Addenda A18–A21 are all accurate. A18's claim that `periods.post.test.ts` was misnamed as a
  payload consumer was verified against the file. A21's claim that the plan contradicts itself
  was verified: `plan.md:417` (contract line) vs `plan.md:74-75` (Desired End State) — the
  implementation followed the contract line, which is the better resolution.
- Phase-2 findings F1–F10 are all still resolved; none regressed.

## Findings

### F1 — A type error shipped, and the gate that should have caught it was never installed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency / Success Criteria
- **Location**: `src/pages/pets/index.astro:18,89`; `.husky/pre-commit`; `package.json`
- **Detail**: The species-label migration changed `SPECIES_LABEL[pet.species] ?? pet.species` (a
  local `Record<string, string>`) to `SPECIES_LABEL[pet.species]` (`Record<Species, string>`), but
  the page's hand-written `interface PetRow` still declared `species: string` — `ts(7053)`,
  indexing an enum-keyed Record with a widened type. The commit body's "lint clean, build passes"
  was true and irrelevant: `astro build` does not typecheck.
  Why it escaped is the larger half. `.husky/pre-commit` ran `npx tsc --noEmit`, which does not
  read `.astro` templates — its own comment predicted this verbatim ("promote `astro check` if a
  template type error ever slips through"). And the hook had **never run at all**:
  `git config core.hooksPath` was unset, `.git/hooks/` held only `.sample` files, and
  `package.json` had no `prepare` script, so husky was never installed. Three type errors reached
  main across two commits — one here, two from `dc931fc` (`tests/rls/claim-slots.test.ts:405,493`).
- **Fix**: Already applied during this review at the user's instruction. (1) `PetRow.species`
  narrowed to `Species`. (2) Both test casts given `| null` / an explicit guard. (3)
  `"prepare": "husky"` added and `npx husky` run — `core.hooksPath` now points at `.husky/_`.
  (4) The hook promoted from `npx tsc --noEmit` to `npx astro check`, which covers templates AND
  `.ts` files, so it replaces tsc rather than being added alongside it (~40s vs ~26s per commit).
  Verified by deliberately breaking a type: `husky - pre-commit script failed (code 1)`,
  `COMMIT_EXIT=1`. Sabotage reverted; `astro check` now `EXIT=0`, 0 errors.
- **Decision**: FIXED

### F2 — The migration claims a test asserts a grant posture that only one of four roles is covered by

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (documents)
- **Location**: `supabase/migrations/20260907180022_reveal_instructions.sql:299-301`
- **Detail**: The comment says "tests/rls/invite-token.test.ts asserts that back rather than
  trusting this sentence (context/foundation/lessons.md)". Every caller of `get_period_by_token`
  in `tests/` goes through `createAnonClient()`, so `anon` EXECUTE is covered behaviourally — but
  nothing asserts `authenticated` EXECUTE, which the invite page explicitly depends on
  (`[token].astro:18`), and nothing asserts `service_role` and `public` are refused.
  `claim-slots.test.ts` and `reveal-instructions.test.ts` both ship the full three-role block;
  `get_period_by_token` is the one door that never got one. The posture is in fact correct, so
  this is a claim that outruns its evidence — the exact shape the lesson names.
- **Fix**: Add the `authenticated` and `service_role` cases to `invite-token.test.ts`, copying the
  block from `reveal-instructions.test.ts`; or downgrade the comment to say only the anon half is
  asserted.
- **Decision**: FIXED — `invite-token.test.ts` gained the read door's three-role block (anon via every existing call, `authenticated` explicitly, `service_role` refused with 42501). The migration comment is now true. The new test also guards something nothing else did: `create or replace` preserves grants only while the signature is unchanged.

### F3 — Deleting `period_id` from the reveal's slots subquery fails no test

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260907180022_reveal_instructions.sql:237`;
  `tests/rls/reveal-instructions.test.ts:138,262`
- **Detail**: `period_id` scopes two queries in `get_claimed_details`: the authorization lookup and
  the caretaker's-own-slots subquery. The first is well pinned — the cross-trip test would go red
  at once. The second is unguarded: no digest in the suite ever holds slots in two periods
  (`aSecret` claims once on A; the revoked-link test mints a fresh secret), so
  `where s.period_id = ... and s.claim_digest = ...` and `where s.claim_digest = ...` are
  observationally identical. Phase 4's cookie is precisely the mechanism that makes one browser
  present one capability against two trips.
- **Fix**: In the cross-trip test, claim a slot on B's period with the SAME secret string, then
  assert the reveal for A returns exactly one slot and not B's. That makes both `period_id`
  predicates load-bearing.
- **Decision**: FIXED — a new test claims a slot on TWO periods with the SAME secret string, then asserts each reveal carries only its own trip's slot, note and pets. Falsified: removing `period_id` from the slots subquery makes it fail (2 slots instead of 1) while the other 14 pass, so it pins that predicate and nothing else.

### F4 — `data-access.md` says "three" and "Both" in one sentence, and rule 3 was left behind

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (documents)
- **Location**: `docs/reference/data-access.md:99-100`, `:132`
- **Detail**: The Phase 3 edit was an insertion rather than a rewrite, so "there are now two … There
  are three as of S-03 Phase 3. **Both** carry `set search_path = ''`" contradicts itself in the
  lines this commit touched. Rule 3 was not touched at all and still reads "**Both functions**
  still reach those tables — `get_period_by_token` reads them, `claim_slots` reads and writes
  them", omitting `get_claimed_details` from a rule about which functions bypass RLS — the fact
  Phase 3 made most security-relevant. The same paragraph's revoke enumeration names only
  `care_periods` and `care_slots`, while the anon-reachable read surface now spans five tables;
  the revokes for `pets` / `care_instructions` and `care_period_pets` live in other migrations and
  are now asserted by `reveal-instructions.test.ts`.
- **Fix**: "All three carry"; rule 3 → all three functions, naming which read and which writes; and
  enumerate all five revoked tables with the migrations that revoked them.
- **Decision**: FIXED — rule 2 leads with "There are **three**" and "All three carry"; rule 3 names all three functions and which read vs write, states plainly that RLS applies inside none of them, and enumerates all five revoked tables with the migrations that revoked them. The claim that both suites assert the 42501 refusal on all five was verified before writing it.

### F5 — `contract-surfaces.md`'s `get_period_by_token` row still counts two doors

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (documents)
- **Location**: `docs/reference/contract-surfaces.md:30`
- **Detail**: "…until S-03 Phase 2 added `claim_slots`; **both** live under the same four rules" —
  while the row directly below it is the third door added by this very commit.
- **Fix**: "…added `claim_slots` and Phase 3 added `get_claimed_details`; all three live under the
  same four rules".
- **Decision**: FIXED — the registry row now reads "…added `claim_slots` and Phase 3 added `get_claimed_details`; all three live under the same four rules".

### F6 — The authorization decision is `v_name is null`, not `not found`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `supabase/migrations/20260907180022_reveal_instructions.sql:205-217`
- **Detail**: "Does this capability hold a slot here?" is answered by whether a column VALUE came
  back non-null, not by whether a ROW came back. Those are the same question only because
  `care_slots_claim_complete` guarantees `(claimed_by_name is null) = (claim_digest is null)`. The
  gate is correct, but correct by way of a constraint in a different migration — and
  `contract-surfaces.md` warns in bold that the owner can still write these columns directly.
- **Fix**: `if not found then return null; end if;`, keeping `v_name` purely for the payload and
  keeping the `order by`.
- **Decision**: FIXED — `20260907193000_claimed_details_row_gate.sql` replaces the gate with `if not found`, so authorization turns on a matched ROW rather than on a non-null column value and no longer borrows correctness from `care_slots_claim_complete`. `create or replace` on an unchanged signature; grants and `provolatile = s` re-verified from the catalog.

### F7 — The 43-char bounds have no failing test, and unlike `claim_slots` the file does not admit it

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `tests/rls/reveal-instructions.test.ts:244-245`
- **Detail**: `reveal("too-short", …)` expects `null` — which is also what the function returns with
  the length guard deleted, since a short string hashes to a digest matching nothing. These pin the
  uniform-failure ANSWER, not the DoS bound. Phase 2's F7 recorded exactly this limitation and the
  fix was to state it in-file; `claim-slots.test.ts` carries that admission and this file does not.
- **Fix**: One comment naming what the two cases do and do not cover, matching the sibling's wording.
- **Decision**: FIXED — the two wrong-length cases now carry the same admission `claim-slots.test.ts` does: they pin the uniform-failure ANSWER, not the 43-character bound, which is not observable through PostgREST. What they do catch is the bound being turned into a raise, which would hand a prober an oracle.

### F8 — The reveal's nested key sets are unpinned, and one stated invariant has no test

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `tests/rls/reveal-instructions.test.ts:220-225`; migration `:270-274`
- **Detail**: The exact-key-set test pins the top level and `slots[0]` but not `pets[0]` or
  `pets[0].instructions[0]`, so `is_sensitive`, `owner_id` or `created_at` could join the reveal's
  pet objects without a red test — while the read door's equivalents ARE pinned, which makes the
  asymmetry look accidental. Separately the migration states "a pet with no sensitive rows still
  appears, with `instructions: []`" — both seeded pets carry a sensitive row, so the case never
  occurs in the suite. Phase 4's composition step depends on that invariant.
- **Fix**: Add the two `Object.keys` assertions, and seed a second pet on A's trip with only public
  rows, asserting it appears in the reveal with `instructions: []`.
- **Decision**: FIXED — the reveal's `pets[0]` and `pets[0].instructions[0]` key sets are now pinned symmetrically with the read door's, and a new test seeds a second pet with only public rows, asserting it appears in the reveal with `instructions: []` and that both payloads agree on the pet set.

### F9 — Two page notes contradict each other, and one is inside the wrong guard

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/pages/invite/[token].astro:184`, `:220`
- **Detail**: Line 184 tells the caretaker some instructions unlock "po zapisaniu się na termin";
  line 220 tells them "Zapisywanie się na terminy będzie dostępne wkrótce". Until Phase 4 lands the
  page points at an action it does not offer. Line 184 also sits INSIDE the `pets.length > 0`
  guard, so a petless trip loses the explanation entirely.
- **Fix**: Merge the two notes into one sentence now, or reword line 220 when Phase 4 ships. Decide
  whether the unlock hint belongs outside the pets guard.
- **Decision**: FIXED — the two contradicting notes merged into one sentence, moved OUTSIDE the `pets.length > 0` guard so a petless trip keeps the explanation. Phase 4 replaces the paragraph with the claim UI.

### F10 — §Testing Strategy's zero-pet bullet is only half covered

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `plan.md` §Testing Strategy → Integration Tests
- **Detail**: The bullet reads "A period with zero linked pets **renders and claims** without
  error". The read half is pinned (`reveal-instructions.test.ts`); "renders" is manual criterion
  3.6; "claims without error" is covered nowhere — `claim-slots.test.ts` has no zero-pet case. This
  is a Phase 2/4-shared bullet rather than strictly a Phase 3 miss, but it is an unfulfilled
  Testing Strategy claim with no addendum against it.
- **Fix**: Carry into Phase 4 as an explicit requirement, or add the case to `claim-slots.test.ts`.
- **Decision**: FIXED — `claim-slots.test.ts` gained a zero-pet claim case, closing the §Testing Strategy bullet in this change rather than carrying it to Phase 4.
