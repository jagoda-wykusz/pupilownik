<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Owner-data RLS baseline (F-01)

- **Plan**: `context/changes/owner-data-rls-baseline/plan.md`
- **Scope**: Phases 1–3 of 3
- **Date**: 2026-06-27
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated success criteria re-run at review time: `npm run db:reset` exit 0 (migration + seed),
`npm run lint` exit 0, `npx astro check` 0 errors, `npm run db:gen-types` produces types. Manual
criteria carry observable evidence (live RLS isolation, trigger, cascade verified via psql/GoTrue).

## Findings

### F1 — Lint-config files not named in the plan

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js, .prettierignore
- **Detail**: Phase 3 added an eslint ignore + .prettierignore to exclude the generated
  src/db/database.types.ts. Not named in the plan, but justified — operationalizes the plan's
  "generated, never hand-edited" rule and keeps `npm run lint` (a success criterion) green.
- **Fix**: Accept as-is (explained in commit body 105638a).
- **Decision**: ACCEPTED

### F2 — Signup trigger not idempotent

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260627125956_init_profiles_rls.sql:49
- **Detail**: handle_new_user() inserted into profiles with no conflict guard; a stray existing
  row would error and roll back the auth.users signup (improbable but on a security-critical path).
- **Fix**: Added `on conflict (id) do nothing` to the insert.
- **Decision**: FIXED

### F3 — Migration comment credits the grant, not RLS, for INSERT/DELETE denial

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/...init_profiles_rls.sql (grant comment) + docs/reference/data-access.md
- **Detail**: Comment framed the missing grant as the protection. Real gate is RLS deny-by-default
  (no policy for the op); Supabase default privileges may already grant ALL on new public tables.
- **Fix**: Reworded the migration comment and the doc's grant note to credit RLS deny-by-default.
- **Decision**: FIXED

### F4 — Redundant .gitkeep in a now-populated migrations dir

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/.gitkeep
- **Detail**: Dir now holds a real migration, so .gitkeep is redundant.
- **Fix**: Removed the file.
- **Decision**: FIXED
