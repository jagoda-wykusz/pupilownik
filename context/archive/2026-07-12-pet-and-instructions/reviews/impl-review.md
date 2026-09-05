<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Pet & Instructions (S-01)

- **Plan**: context/changes/pet-and-instructions/plan.md
- **Scope**: Full plan (Phases 1–3)
- **Date**: 2026-08-31
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Unbounded input size (instructions array + string lengths)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/schemas/pet.ts:8-19
- **Detail**: No `.max()` on the instructions array nor on strings (name/title/body). One request can submit a huge array / multi-MB strings, all inserted in a single RPC transaction. DoS vector.
- **Fix**: Add `.max(50)` on instructions and length limits (name/title `.max(120)`, body `.max(2000)`).
- **Decision**: FIXED (src/lib/schemas/pet.ts — .max caps added)

### F2 — Raw DB error message returned to client

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/pets.ts:44-45
- **Detail**: On RPC failure the raw `error.message` is returned, leaking internal DB/constraint/RLS detail.
- **Fix**: Log server-side, return a generic 500 "Nie udało się zapisać zwierzęcia".
- **Decision**: FIXED (src/pages/api/pets.ts — console.error + generic message)

### F3 — RPC missing revoke/grant execute (deviates from F-01 hardening)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260712204748_pets_and_instructions.sql:122
- **Detail**: init_profiles_rls.sql revokes execute from public on its function; this migration relies on the default PUBLIC execute grant. Safe (SECURITY INVOKER — RLS still applies), but deviates from least-privilege posture.
- **Fix**: New migration: `revoke execute on function public.create_pet_with_instructions(...) from public; grant execute … to authenticated;`
- **Decision**: FIXED (migration 20260831203038_harden_create_pet_rpc_grants.sql; db:reset + advisors clean)

### F4 — Out-of-plan changes (benign)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/seed.sql:16-29, eslint.config.js
- **Detail**: Seed GoTrue token-columns fix (justified sign-in enabler, documented in commit dbbb46e) and `.claude/**` eslint ignore (Phase 1 tooling housekeeping). Both intentional, benign.
- **Fix**: No code action; optionally add a plan addendum noting the seed fix.
- **Decision**: ACCEPTED (plan.md — Implementation Addenda section added)

### F5 — Null Supabase client renders empty state instead of error

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/pets/index.astro:27-38
- **Detail**: If createClient returns null (Supabase unconfigured), the page shows the empty state instead of an error — misconfiguration masquerades as "no pets".
- **Fix**: Treat a null client as loadError.
- **Decision**: FIXED (src/pages/pets/index.astro — null client → loadError)

### F6 — breed/age stored as "" instead of NULL (documented)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/pets.ts:39
- **Detail**: Benign — columns nullable, list filters falsy. Cosmetic (empty string vs NULL at rest); documented in code comment.
- **Fix**: Optional — give p_breed/p_age `default null` in the RPC (new migration) and pass null.
- **Decision**: SKIPPED (benign, documented; "" renders correctly)
