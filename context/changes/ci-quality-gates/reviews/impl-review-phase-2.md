<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: CI Quality Gates

- **Plan**: `context/changes/ci-quality-gates/plan.md`
- **Scope**: Phase 2 of 5 — "Harden the known flake before the first CI run"
- **Date**: 2026-09-12
- **Verdict**: REJECTED as committed (`fdf407a`), all findings fixed in the follow-up commit
- **Findings**: 1 critical, 3 warnings, 5 observations

## Verdicts

| Dimension           | Verdict (as committed in `fdf407a`) |
| ------------------- | ----------------------------------- |
| Plan Adherence      | PASS                                |
| Scope Discipline    | WARNING                             |
| Safety & Quality    | FAIL                                |
| Architecture        | WARNING                             |
| Pattern Consistency | PASS                                |
| Success Criteria    | FAIL                                |

Phase 2 shipped the contract the plan asked for and still failed, which is the useful thing about
this review: both dimensions that failed did so because **the verification was narrower than the
claim it supported**. Criterion 2.2 ran one vitest project, so it structurally could not see a
cross-project config conflict. The cost measurement ran one test file, so it could not see that
the cost is paid per file. Neither is a slip in the code; both are a slip in what was measured.

## Findings

### F1 — The readiness budget was paid per test FILE, not per run

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality
- **Location**: `tests/setup.ts:44` (as committed)
- **Detail**: The probes lived in a `beforeAll` inside a `setupFiles` module, and vitest executes
  setup files for every test file. With 22 integration files the 8-second budget was spent 22
  times. Measured against a dead port: ~11s for a single file; under `CI` with one worker that is
  roughly three minutes of red build, while the header comment I had just written claimed "the run
  fails in ~8s". The failure message stayed correct — it was simply printed 22 times, slowly.
- **Fix (applied)**: The probes moved to a new `tests/global-setup.ts`, wired as the `integration`
  project's `globalSetup`, which runs once in the main process before any file loads. Env loading
  and the localhost guard moved to `tests/env.ts` so the global setup can reuse them without
  importing a module that registers `beforeAll`; `tests/setup.ts` is now a re-export.
- **Measured after**: a dead stack fails the whole run in **33s**, message printed **once**. The
  budget was raised 8s → 30s precisely because it is now paid once, which is strictly better for
  the slow-CI-start case this phase exists for.
- **Decision**: FIXED

### F2 — `CI=1 npx vitest run` refused to start

- **Severity**: ⚠️ WARNING (blocking for Phase 3)
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Location**: `vitest.config.ts:73` (as committed)
- **Detail**: vitest refuses projects that resolve to different `maxWorkers` inside the same
  `sequence.groupOrder` group (`groupSpecs`, `vitest/dist/chunks/cli-api.*.js:3824`). Capping only
  `integration` created exactly that. Reproduced: `Projects "component" and "integration" have
different 'maxWorkers' but same 'sequence.groupOrder'` — zero tests run. Phase 3's workflow runs
  all three projects, so its first run would have failed on configuration rather than on a test.
  Criterion 2.2 used `--project integration`, and a single project has no sibling to conflict with.
- **Fix (applied)**: `sequence: { groupOrder: 1 }` on the integration project, with a comment
  saying why deleting it breaks CI. New criterion 2.5 added to the plan: verify with the whole
  suite, never one project.
- **Decision**: FIXED

### F3 — The worker cap doubled parallelism instead of capping it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Architecture
- **Location**: `vitest.config.ts:73` (as committed)
- **Detail**: vitest's default is not "every core" as my comment claimed, but
  `max(numCpus - 1, 1)` (`resolveMaxWorkers`, same file). On the 2-vCPU runner the plan targets,
  that default is **1** — so `maxWorkers: 2` would have doubled concurrent load on the single
  Postgres while the comment said it was protecting it. The local 6s → 12s measurement confirmed
  the setting bites on a 12-core machine, i.e. in the environment the comment declares untouched.
- **Fix (applied)**: `maxWorkers: 1` under CI — a genuine ceiling on any runner size — and the
  comment rewritten to state the real default and the measured costs (6s / 12s / 37s at 11, 2 and
  1 workers).
- **Decision**: FIXED

### F4 — The auth probe was a liveness check sold as a readiness check

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality
- **Location**: `tests/setup.ts:127` (as committed)
- **Detail**: `/auth/v1/health` returns static version metadata the moment GoTrue is listening and
  says nothing about whether it can reach Postgres — the structurally identical mistake the same
  file already documents for PostgREST, and the half of the CI race this phase set out to close.
  A GoTrue that is up with a dead DB pool passed the probe and then failed every `createOwnerClient`.
- **Fix (applied)**: probe `POST /auth/v1/token?grant_type=password` with a random address. It
  reaches the database and creates nothing — a password grant is a login, not a signup. 400 ("invalid
  login credentials") means ready; 500 ("database error querying schema") means listening but not
  ready. Verified against the live stack: 400.
- **Decision**: FIXED

### F5 — The retry was proven to bite, twice, by mutation

- **Severity**: 📋 OBSERVATION (positive)
- **Dimension**: Success Criteria
- **Detail**: Against a fake stack answering 500/404 for its first five seconds and healthily
  afterwards, the new probes pass (0 readiness errors). With `READY_BUDGET_MS` mutated to 0 — the
  previous single-attempt behaviour — the same fake stack fails at the auth probe (1 readiness
  error). The retry is load-bearing for the exact race it was written for, and this was re-verified
  after the probe shape changed in F4 rather than carried over from the earlier run.
- **Decision**: N/A — evidence, not a defect.

### F6 — The data-API probe cannot tell a valid key from a bogus one

- **Severity**: 📋 OBSERVATION
- **Dimension**: Correctness
- **Location**: `tests/global-setup.ts` (`dataApiReady`)
- **Detail**: A correct key, a bogus key and no key at all all produce 401 on `pets`, so a stale
  `SUPABASE_KEY` in `.env.test` passes readiness and then fails every test. Pre-existing, not
  introduced here.
- **Decision**: ACCEPTED — named explicitly in the probe's comment as a known limit rather than
  silently left. Fixing it means probing a table anon may read, which does not exist today.

### F7 — Probe failures discard their diagnosis

- **Severity**: 📋 OBSERVATION
- **Dimension**: Pattern
- **Location**: `tests/global-setup.ts` (`attempt`'s bare `catch`)
- **Detail**: `ECONNREFUSED`, our own abort and a DNS failure all collapse to `false`, and the user
  is told to run `npm run db:start` — advice that is wrong when the real cause is a mistyped port.
- **Decision**: SKIPPED — real but minor, and the budget now costs 30s once rather than 8s × 22, so
  the misdiagnosis is cheaper than it was.

### F8 — `hookTimeout` had widened twenty other hooks

- **Severity**: 📋 OBSERVATION
- **Dimension**: Scope Discipline
- **Location**: `vitest.config.ts:62` (as committed)
- **Detail**: Raising it to 30s gave every `beforeAll` in the 22 integration files 50% longer to
  hang before reporting. None of them relied on the 20s ceiling, so nothing broke — but the raise
  existed only to fit the probes.
- **Decision**: FIXED — reverted to 20s, since `globalSetup` is not governed by `hookTimeout` at all.

### F9 — GoTrue's sign-up rate limit is not in force locally

- **Severity**: 📋 OBSERVATION
- **Dimension**: Reliability
- **Detail**: One full integration run performs roughly 60 rate-limitable auth requests against a
  configured limit of 30 per 5 minutes; two consecutive runs produced no 429. Serializing files does
  not make this more likely — the limiter counts per window, and both shapes fit inside one window.
  If it is ever enforced, the lever is `auth.rate_limit.sign_in_sign_ups` in `supabase/config.toml`,
  not restructuring tests.
- **Decision**: ACCEPTED — no action.

## Measurements after the fixes

| Run                                         | Result                        |
| ------------------------------------------- | ----------------------------- |
| `npx vitest run --project integration`      | 22 files / 194 tests, **12s** |
| `CI=1 npx vitest run --project integration` | 22 / 194, **35s**             |
| `CI=1 npx vitest run` (all three projects)  | 39 / 369, **31s**             |
| Dead port, `CI=1`, all 22 files             | fails in **33s**, one message |
