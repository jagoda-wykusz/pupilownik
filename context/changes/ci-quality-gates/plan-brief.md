# CI Quality Gates — Plan Brief

> Full plan: `context/changes/ci-quality-gates/plan.md`
> Research: `context/changes/ci-quality-gates/research.md`

## What & Why

Every push to `master` builds and publishes, and the only thing that runs between commit and
production is `astro build` — no lint, no tests, no typecheck of `.astro` templates, no secret
scan. A green deploy today means the bundler succeeded and nothing more. This plan puts real
checks in front of the publish, and runs the full suite (including the 22 integration files that
need a database) where it can actually run.

## Starting Point

39 test files / 369 tests exist and pass locally in 6.3 s. Nothing outside a developer's machine
ever runs them. `.husky/pre-commit` is the only automated check in the project and is bypassable
with `--no-verify`; it was silently doing nothing for 75 days because `prepare: husky` was
missing. `.github/` does not exist — the starter workflow was deleted 52 minutes after bootstrap,
on the reasoning that Workers Builds made it redundant.

## Desired End State

A push to `master` runs typecheck, lint, build, the `unit` and `component` projects and the secret
scan before Cloudflare produces a version — a failure means nothing is published. A push to any
branch, and every pull request, additionally runs the integration suite against a real Supabase
stack and reports it. Both gates live in version-controlled files; the dashboard holds one
`npm run ci:gate`. Weakening either breaks a test.

## Key Decisions Made

| Decision                        | Choice                                                         | Why (1 sentence)                                                                                               | Source   |
| ------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------- |
| Where the gates live            | Two: Actions (signal) + Workers Builds build command (blocker) | Only Actions can run Docker; only the build command can stop a publish — neither is sufficient alone.          | Research |
| Gate defined in                 | `package.json` script, not the dashboard field                 | `&&` in the dashboard is undocumented, and a gate in a dashboard is state no checkout or review can verify.    | Research |
| Failing test blocks publication | Yes                                                            | Both fast projects cost 6.3 s; a flaky test stopping a deploy is the cheaper failure.                          | Plan     |
| GitHub plan                     | Stay on Free                                                   | Accepts permanently that a red Actions run cannot block a merge — the plan must not pretend otherwise.         | Plan     |
| Publish chain contents          | check → lint → build → unit+component → secrets                | ~69 s total, and pre-commit is bypassable, so these are the only unbypassable checks.                          | Plan     |
| Actions triggers                | push (all branches) + pull_request                             | Cloudflare builds no branches, so this is the only pre-merge feedback that exists.                             | Plan     |
| Branch builds in Cloudflare     | Off                                                            | Keeps the deploy path narrow; accepted cost is that the blocker fires only once publication is under way.      | Plan     |
| `.nvmrc`                        | 22.23.2                                                        | The old pin matched neither the runner nor the dev machine and cost a Node download on every build.            | Plan     |
| Flake hardening                 | Bounded retry in `tests/setup.ts` now                          | The #1 predicted flake, with a recorded 2026-09-07 incident; a red first run should mean the gate, not a race. | Plan     |
| Integration parallelism         | Capped under `CI` only                                         | 22 files against one Postgres on a 2-vCPU runner, with contention tests on a 20 s timeout.                     | Plan     |
| Guarding the gate itself        | Source test over `package.json` + workflow                     | Deleting one `&&` is invisible in review and has no symptom until it matters.                                  | Plan     |

## Scope

**In scope:** `ci:gate` + `check` npm scripts; `.husky/pre-commit` delegation; `.nvmrc`; retry in
`tests/setup.ts`; CI worker cap in `vitest.config.ts`; `.github/workflows/ci.yml`; a source-guard
test; the dashboard build-command change; corrections to README, `test-plan.md`,
`infrastructure.md`.

**Out of scope:** GitHub Pro; non-production branch builds; integration tests inside Workers
Builds (impossible — no Docker); pre-commit scope changes; `db:reset` in CI; Docker image caching;
Kong 502 and GoTrue rate-limit hardening; notifications.

## Architecture / Approach

```
push → GitHub ──┬─→ Actions: supabase start → check, lint, build, ALL 3 projects, secrets
                │            (signal only — Free plan cannot make it merge-blocking)
                └─→ Workers Builds (master only): npm run ci:gate
                             check → lint → build → unit+component → secrets
                             non-zero exit ⇒ no version ⇒ no deploy
```

The same chain runs in both places; only Actions adds the integration project, and only Workers
Builds can stop anything. In Workers Builds the secret scan sees production env, so it guards the
real host; in Actions the host is passed separately via `SECRET_SCAN_HOSTS`.

## Phases at a Glance

| Phase                     | What it delivers                              | Key risk                                                        |
| ------------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| 1. Compose the gate       | `ci:gate` + `check` scripts, `.nvmrc` aligned | Chain ordering — build must precede the `unit` project          |
| 2. Harden the flake       | Bounded probe retry, CI worker cap            | A retry can mask a real stack failure as a timeout              |
| 3. Actions workflow       | Full suite against a real Supabase stack      | `.env.test` must exist as a FILE; key capture must not hardcode |
| 4. Pin the gates          | Source test over chain + workflow             | Source tests are brittle; cannot see the dashboard at all       |
| 5. Connect + correct docs | Dashboard wired, four documents made true     | The only irreversible-feeling step; reversible in one field     |

**Prerequisites:** access to the Cloudflare dashboard (Phase 5) and the production Supabase host
for `SECRET_SCAN_HOSTS` (Phase 3). Docker running locally for Phase 2 verification.
**Estimated effort:** ~2 sessions across 5 phases; Phase 3 is the only one with slow feedback.

## Open Risks & Assumptions

- **The dashboard half is unguardable from the repo.** Phase 4's test cannot see the build-command
  field; if someone sets it back to `npm run build`, every test still passes. Named in the test
  header rather than papered over.
- **The first workflow run is the first real measurement.** Runtime, flake behaviour and the
  Supabase boot budget are estimates from research until Phase 3 executes.
- **A red gate blocks all deploys, including urgent ones.** Accepted deliberately; escape hatches
  are documented in the plan's Migration Notes, and "edit the build command" is listed last on
  purpose.
- **`SECRET_SCAN_HOSTS` needs manual updating** if the Supabase project ever changes; nothing
  detects a stale value.

## Success Criteria (Summary)

- A commit that fails lint, typecheck, a unit/component test or the secret scan cannot reach the
  live site — demonstrated by pushing one, not by assuming it.
- Every push and pull request gets a full-suite result, integration tests included.
- Removing a step from either gate breaks a test rather than passing quietly.
