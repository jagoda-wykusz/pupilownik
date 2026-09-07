<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Caretaker Claims Slot

- **Plan**: `context/changes/caretaker-claims-slot/plan.md`
- **Scope**: Phase 1 of 5
- **Date**: 2026-09-07
- **Commits reviewed**: `3f20b91` (phase 1), `07ec413` (approved follow-up)
- **Verdict**: NEEDS ATTENTION → all 7 findings triaged and fixed 2026-09-07
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated criteria, re-verified from scratch

| Criterion | Result |
|---|---|
| 1.1 migration applies on a reset database | PASS |
| 1.2 types in sync | PASS — regeneration produced an empty diff |
| 1.3 / 1.4 tests | PASS — 141/141, 17 files |
| 1.5 lint + build | PASS — 0 errors (3 pre-existing `no-console` warnings) |
| 1.6 / 1.7 catalog posture | PASS — 1 overload; `authenticated=true anon=false service_role=false` |

## Ruled out (checked, not findings)

- No screen does `select("*")` on `care_periods` — both owner screens list columns explicitly.
- `get_period_by_token` builds its payload with a named `jsonb_build_object`, so adding
  `caretaker_note` to the table did **not** expose it to caretakers.
- The four RPC-seeding suites needed no signature edit: the trailing parameter is defaulted,
  so PostgREST still resolves five-argument named calls.

## Not covered by tests

The note read-back on `/periods/[id]` has no test. The repo has no infrastructure for
rendering `.astro` pages and the existing render on that screen is untested too. Verified
with the page's exact select instead. This is a coverage gap, not a finding.

## Findings

### F1 — Schema permits one capability secret with two identities

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `supabase/migrations/20260907065515_claim_capability_and_note.sql` §3
- **Detail**: `care_slots_claim_complete` ties the three claim columns per ROW, but nothing
  ties them ACROSS rows. Verified in psql: the same `claim_digest` accepted `claimed_by_name`
  = "Ania" on one slot and "Basia" on another within one period; both UPDATEs succeeded.
  "One capability = one person" is an assumption two later phases rest on —
  `get_claimed_details` (Phase 3) returns a single `name` for the capability, and Phase 4's
  follow-up claim reads the stored name back. This is the class S-02 added its paired CHECK
  for: a representable state that makes a predicate lie.
- **Fix A ⭐ Recommended**: Enforce in Phase 2's function, pin with a test, and document it as
  the only enforcement layer.
  - Strength: Has an explicit precedent here — "at least one pet" is enforced ONLY inside
    `create_period_with_slots` and is documented that way in the migration and in
    contract-surfaces. Practical exposure is low: anon holds no table grants, so the only
    writer will be the SECURITY DEFINER function.
  - Tradeoff: The owner DOES hold grants on `care_slots`, so a direct UPDATE can still create
    the incoherent state — in their own trip, so low-stakes, but possible.
  - Confidence: HIGH — the precedent is explicit and documented.
  - Blind spot: Did not check whether S-04's occupancy view will also assume one name per
    capability.
- **Fix B**: Add a trigger enforcing the invariant now.
  - Strength: `20260906094254`'s own comment argues that "a constraint in the database
    outranks a requirement in a document", and the table is still empty — the same free window
    that migration used.
  - Tradeoff: First trigger in this schema; the invariant is multi-row so a CHECK cannot
    express it. Adds a surface nobody here maintains yet.
  - Confidence: MEDIUM — not written, so ordering behaviour under Phase 2's multi-slot UPDATE
    is unverified.
  - Blind spot: A per-row trigger on the same UPDATE that claims N slots may observe partial
    state.
- **Decision**: FIXED via Fix A — recorded as plan addendum A1 (Phase 2 is the only enforcement layer; residual owner-UPDATE risk accepted knowingly) and in contract-surfaces.md's claim-columns row.

### F2 — Contract registry documents a function that does not exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `docs/reference/contract-surfaces.md:28-29`
- **Detail**: Row 29 states `caretaker_note` is "served only by `get_claimed_details`" — that
  function ships in Phase 3. Row 28 states `claim_digest` "answers is this slot mine?" —
  nothing writes it yet. Same class `lessons.md` names explicitly ("a described posture the
  system does not have"), and the same mistake flagged today in the roadmap's S-07 entry — so
  it was repeated on the same day.
- **Fix**: Mark both rows as taking effect in Phase 3 (e.g. "planned — S-03 Phase 3; nothing
  reads/writes this yet") instead of describing them in the present tense.
- **Decision**: FIXED — both contract-surfaces rows now state present-tense facts only and mark the Phase 3 contract as intended-not-yet-built.

### F3 — Index is not partial; 198 of 198 rows carry a NULL digest

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (performance)
- **Location**: migration §3, `care_slots_period_claim_digest_idx`
- **Detail**: Measured: all 198 `care_slots` rows have `claim_digest IS NULL`, and most slots
  are never claimed, so that ratio stays lopsided. Phase 3's lookup always supplies a non-null
  digest, so `WHERE claim_digest IS NOT NULL` would index materially fewer rows at identical
  usefulness.
- **Fix**: Add the partial predicate to the index.
- **Decision**: FIXED — 20260907122450_partial_claim_digest_index.sql; partial predicate verified from pg_indexes.

### F4 — Two unplanned changes not recorded in the plan

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/components/ui/Textarea.tsx`, `src/pages/periods/[id].astro`
- **Detail**: Both were approved in conversation (Textarea disclosed at the phase gate, the
  note read-back explicitly requested), so this is not silent scope creep. But the plan does
  not contain them, so the next review will flag them again.
- **Fix**: Add both to the plan as an addendum.
- **Decision**: FIXED — recorded as plan addendum A2, including the still-open 'note cannot be edited'.

### F5 — Progress row 1.4 does not describe what happened

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `plan.md`, Progress → 1.4
- **Detail**: "four RPC-seeding suites untouched" — their seeding calls were indeed untouched,
  but `care-slots.isolation.test.ts` was edited in its CHECK assertions. Convention forbids
  renaming step titles, so the correction belongs in an addendum rather than the row.
- **Fix**: Record the nuance in the plan's addendum.
- **Decision**: FIXED — recorded as plan addendum A3 with the grep-the-constraint-name lesson; row title left as authored.

### F6 — Plan states a stale seed inventory

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `plan.md`, `## Migration Notes`
- **Detail**: Says the seed carries "one owner, one pet, two instructions and zero periods".
  `supabase/seed.sql:74-96` also seeds a period and its pet link (added by S-08). Inherited
  from research written 2026-09-06, before that change.
- **Fix**: Correct the plan text.
- **Decision**: FIXED — recorded as plan addendum A4; the section's actual argument is unaffected.

### F7 — Note received a database CHECK where the plan said "mirroring MAX_TITLE_LENGTH"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: migration §1
- **Detail**: `MAX_TITLE_LENGTH`'s pattern is zod-only, with no database CHECK. The note got a
  CHECK as well — one layer more than the plan announced. A superset, disclosed at the phase
  gate and in the commit body. Recorded for completeness, not for reversal.
- **Fix**: None needed; keep as a recorded deviation.
- **Decision**: FIXED — recorded as plan addendum A5 as an accepted, disclosed superset.
