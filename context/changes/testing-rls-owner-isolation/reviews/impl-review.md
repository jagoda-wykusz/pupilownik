<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: RLS Owner-Isolation Test Harness

- **Plan**: context/changes/testing-rls-owner-isolation/plan.md
- **Scope**: Full plan (Phases 1–2 of 2)
- **Date**: 2026-06-28
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Test-created auth users are never torn down

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: tests/helpers/auth.ts:20-38
- **Detail**: Every createOwnerClient() call permanently signs up an auth.users row (+ profile via trigger) that survives the run. Repeated `npm test` accumulates orphan users in the local DB. Not a correctness or security bug (local-only; host-guard blocks hosted targets), but the local stack drifts dirtier over time.
- **Fix**: Document reliance on `npm run db:reset` between runs, OR add an afterAll teardown that admin-deletes the owners a suite created.
- **Decision**: FIXED — documented db:reset cleanup note in test-plan.md §6.2

### F2 — vitest.config omits the planned `globals: true`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: vitest.config.ts:8-23
- **Detail**: The plan's contract listed test.globals = true. It was omitted — but every test imports describe/it/expect explicitly from "vitest", so behavior is correct and arguably cleaner (keeps strict typecheck happy without a vitest/globals types entry). Benign, self-consistent drift.
- **Fix**: None needed — or add a one-line plan note that explicit imports were chosen over globals.
- **Decision**: FIXED — added impl-note to plan.md Phase 1 §2 (globals left default, explicit imports)

### F3 — Reachability guard probes auth only, not PostgREST

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: tests/setup.ts:59-76
- **Detail**: The guard hits /auth/v1/health only. If auth/Kong is up but PostgREST is still reconnecting, the `from("profiles")` calls fail with a less actionable error than the guard's message. Edge case — the auth probe covers the common "stack down" case (already hardened for the Kong 502).
- **Fix**: Optionally also probe /rest/v1/ in the guard. Low priority.
- **Decision**: FIXED — guard now probes both /auth/v1/health and /rest/v1/ (tests/setup.ts)
