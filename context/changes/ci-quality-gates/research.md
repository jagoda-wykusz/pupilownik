---
date: 2026-09-11T22:25:43+02:00
researcher: jagoda.wykusz
git_commit: 71becae145ee4c8603c18cec03ded649ff4e6423
branch: master
repository: pupilownik
topic: "Where can a quality gate live, given that Workers Builds publishes every push and runs only the build command?"
tags: [research, ci, cloudflare-workers-builds, github-actions, quality-gates, supabase, vitest]
status: complete
last_updated: 2026-09-11
last_updated_by: jagoda.wykusz
---

# Research: wiring a test gate in front of a deploy that already publishes

**Date**: 2026-09-11T22:25:43+02:00
**Researcher**: jagoda.wykusz
**Git Commit**: `71becae`
**Branch**: master
**Repository**: pupilownik

## Research Question

Cloudflare Workers Builds is connected: a push builds and publishes, and the build step runs `astro build` and nothing else. Where can `npm run lint`, `npm test` and `npm run check:secrets` be wired so that something actually checks a change before it reaches production?

## Summary

**Two platform constraints decide the answer, and neither is a preference.**

1. **The Cloudflare build runner has no Docker.** Its documented image carries curl, git, build-essential and a set of `-dev` libraries — no Docker, no containerd, no way to bind ports or run a daemon. `supabase start` cannot run there. That makes the 22 integration test files — every RLS isolation assertion, every `/api/*` handler test, the auth-gating middleware test — **permanently unrunnable in Workers Builds**, not merely awkward.
2. **This is a private repository on GitHub Free, so branch protection and rulesets are unavailable.** A GitHub Actions run can execute and report; it cannot be made merge-blocking at any price on this plan. Verified independently: unauthenticated access 404s and the owner shows zero public repositories; the plan is the user's own answer.

So neither placement alone is sufficient, and the split is forced:

- **GitHub Actions = the full suite as a signal.** The only environment where the integration half runs at all. It cannot block a merge here, but it is the difference between nothing running and everything running.
- **Workers Builds build command = the publish blocker.** The fast half — lint, `unit` + `component`, build, `check:secrets`. The only thing that can stop a bad artifact going live, including on a direct push to master.

**Everything is cheaper than assumed.** The whole gate chain measures **~69 s of compute**: lint 28.1 s, `astro check` 18.0 s, build 15.4 s, all 369 tests 6.3 s, secret scan 1.0 s. Nothing exceeds 60 s. On a cold runner, `npm ci` and Supabase image pulls dominate everything in that table.

**One number in `test-plan.md` §5 is stale and this research supersedes it**: the cost table says `eslint .` is `~110s` (measured 2026-09-07). Measured today: **28.1 s**. The `astro check` row (~38 s) is likewise now 18.0 s.

## Detailed Findings

### 1. Workers Builds — what the build step can and cannot do

**The model is two commands, not one.** A build command (optional) runs first; a deploy command runs after and defaults to `npx wrangler deploy`. A failed build produces no version, and no version means no deploy — so a non-zero exit in the build command does block publication. (The exit-code rule is documented explicitly for Cloudflare Pages and stated as a consequence for Workers.)

**`&&` in the dashboard field is NOT documented.** No Cloudflare page says the Workers Builds command is shell-interpreted. The `sh`/`cmd` quote that turns up in search belongs to **Wrangler Custom Builds**, a different feature that Workers Builds explicitly ignores. The clean way around this: put the chain in a `package.json` script and set the build command to a single `npm run <script>`. npm runs scripts through a shell by its own contract, so `&&` is guaranteed — **and the gate then lives in the repository, in git history, visible in review**, instead of in dashboard state nothing verifies. Given that the current build command is the default `npm run build`, this is a one-line change to `package.json`.

**Runner**: Ubuntu 24.04 x86_64, Node 24.18.0 default (22.23.2 also preinstalled), 20-minute build timeout, 1 concurrent build on free / 6 on paid, 2 vCPU, 8 GB RAM. Build cache is opt-in and Astro-aware (`node_modules/.astro`, npm cache).

**`.nvmrc` pins 22.14.0**, which is neither preinstalled version — so every build downloads a Node build. Worth either aligning to 22.23.2 or accepting the cost knowingly.

**Build variables are disjoint from runtime secrets.** Cloudflare states it plainly: build variables are not accessible at runtime, and the converse holds — a build cannot read runtime secrets. `WORKERS_CI_BRANCH`, `WORKERS_CI_COMMIT_SHA` and `CI=true` are injected automatically.

**Non-production branch builds are an opt-in checkbox, free**, and their deploy command defaults to `npx wrangler versions upload` — which creates a version **without promoting it**. That is a documented "build on branches without deploying" path. It is currently **off** for this project (only the production branch deploys). Note the limit: builds trigger on push events to branches, not on `pull_request` events, and a red Workers build is not a merge gate — enforcing it as one is a GitHub branch-protection setting, which this plan cannot use (see §2).

### 2. GitHub Actions — what it would cost and cover

**What was deleted was smaller than it sounds.** `.github/workflows/ci.yml` ran `npm ci → astro sync → npm run lint → npm run build` — **lint and build only, never tests**, because no tests existed yet. It was the starter template's file, created by the bootstrap commit `1242a53` at 10:10 and deleted by `b1fd059` at 11:02 **the same day**, never edited in between. Whether it ever executed a run is not observable from the repo. The stated reason is `infrastructure.md:68`: "GitHub unlocks native Workers Builds … no hand-rolled CI needed." The same commit's `## Out of Scope` says "CI/CD pipeline setup … not a built pipeline" — it deleted a pipeline while declaring pipeline setup out of scope.

**Docker is preinstalled on `ubuntu-latest`** (Docker Client/Server 28.0.4, Compose 2.38.2), daemon running, no setup step. This is the whole asymmetry with Workers Builds.

**Starting Supabase is a supported, documented path**: `supabase/setup-cli@v3` then `supabase start`. That brings up db, kong, gotrue, postgrest and the rest, and applies `supabase/migrations/` (19 files) plus `supabase/seed.sql` automatically — no separate migration step. Budget **~3 minutes typical, ~5 worst case**; image pulls are sequential and excluded services are still pulled, so `-x` saves boot time, not download time. Docker-image caching is a known dead end (the CLI disabled its own because it was slower than re-pulling).

**Whole-job estimate: ~9–12 min serial, ~7–9 min if `supabase start` is backgrounded to overlap with `npm ci` and lint.**

**Cost is not the constraint.** Private repo on Free: 2,000 included minutes/month, Linux overage $0.006/min. At ~20–25 min per change that is ~80–100 changes/month inside the free tier.

**The constraint is authority.** GitHub documents branch protection as available "in public repositories with GitHub Free" and in private repositories only on Pro/Team/Enterprise. Rulesets likewise. On this plan, a failing Actions run is a red X next to an enabled merge button. Upgrading to Pro ($4/mo) is the only way to make it a gate — a decision outside the code.

### 3. In-repo mechanics, measured

| Gate                 | Command                 | Wall       | Notes                         |
| -------------------- | ----------------------- | ---------- | ----------------------------- |
| Lint                 | `npm run lint`          | **28.1 s** | whole project, type-aware     |
| Typecheck            | `npx astro check`       | **18.0 s** | 115 files, 0 errors           |
| Build                | `npm run build`         | **15.4 s** | client 1.95 s + server 11.9 s |
| Secret scan          | `npm run check:secrets` | **1.0 s**  | 21 files, 6 patterns          |
| Vitest `unit`        | `--project unit`        | **3.1 s**  | 14 files / 145 tests          |
| Vitest `component`   | `--project component`   | **5.5 s**  | 3 files / 30 tests            |
| Vitest `integration` | `--project integration` | **7.0 s**  | 22 files / 194 tests          |
| All tests            | `npm test`              | **6.3 s**  | 39 files / 369 tests          |
| `astro sync`         | `npx astro sync`        | **9.9 s**  | only needed pre-lint          |
| `db:reset`           | `npm run db:reset`      | **27.3 s** | 19 migrations + seed          |

**Ordering constraints, each measured rather than assumed:**

- **`astro sync` must precede `npm run lint`.** `.astro/` is gitignored; `src/lib/supabase.ts` and `src/middleware.ts` import `astro:env/server` / `astro:middleware`, whose types live only in generated `.astro/*.d.ts`, and ESLint here is type-aware. With `.astro` moved aside, linting those two files exits 1 with 16 `no-unsafe-*` errors. **But `astro check` regenerates `.astro` itself** — so if lint runs after `astro check`, the sync step is redundant.
- **`npm run build` must precede the `unit` project**, not only `check:secrets`. `tests/unit/client-bundle.test.ts` scans `dist/client` and fails rather than skips without it.
- **The `unit` project now needs `SUPABASE_URL` / `SUPABASE_KEY` in env.** Measured: blanking them fails that test, because the scan exits 2 on a degraded run and the test asserts the absence of the `WEAKENED` marker. This is a direct consequence of the guard added in `testing-secret-leak` and it means the "Docker-free, no-setup" `unit` project is no longer env-free.
- **`npm run build` needs neither Supabase nor real secrets** — both vars are `optional: true` and the lookup is a runtime binding.
- **`src/db/database.types.ts` is committed**, so CI needs neither the stack nor `db:gen-types` to lint or typecheck.

**`tests/setup.ts` demands a FILE.** It `readFileSync`s `.env.test` from the working directory and throws if absent; exported env alone is not enough, because the file must still be readable (`process.env[key] ??= value` means real env wins, but the read happens first). CI must `cp .env.test.example .env.test` or write one. It then rejects any non-localhost host and runs two health probes.

**Seed data is not a dependency.** No integration test reads seeded identities — every fixture is self-created through `tests/helpers/auth.ts`. Verified by running the integration project four times consecutively against a database accumulating rows (auth.users 41 → 161), all green. **CI does not need `db:reset`**; `supabase start` on a fresh container applies migrations anyway.

### 4. A contradiction between sources, resolved

Two agents disagreed about local Supabase keys, and both were right within their scope:

- The Supabase documentation states that a local stack "mints its own keys" per `supabase start`, and an upstream issue confirms the service-role key is regenerated.
- Measured on this machine, `supabase status` prints **fixed, well-known local constants**, and the repo's `.env.test` holds the legacy demo-signed JWTs, which are published constants.

**Resolution**: with the CLI version this project pins, the values are stable and safe to hardcode — but that is a property of the current CLI, not a contract. The robust CI step captures them instead: `supabase status -o env` emits `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, which the workflow maps onto `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`. Same effort, no dependency on a constant that upstream is actively deprecating.

### 5. Flakiness risk in CI, ranked

1. **The schema-cache probe has no retry loop.** `tests/setup.ts` allows one 3-second attempt per probe; a slow start throws and fails the entire project. Its own comment records a real 2026-09-07 incident of exactly this shape (13 files / 6 tests). This is the single most likely CI flake and the cheapest to harden.
2. **Kong 502 under load** — observed once in this session (`invalid response from upstream server` while seeding). Nothing retries it.
3. **GoTrue signup rate limit.** `supabase/config.toml` sets 30 sign-ins/sign-ups per 5 minutes per IP. One integration run performs ~40 signups; four runs inside five minutes produced 160 with zero 429s, so it is not enforced against the local stack today — but it is one CLI upgrade from being the flakiest thing in the suite.
4. **Parallelism is unconstrained.** `vitest.config.ts` sets no `maxWorkers`, `poolOptions` or `fileParallelism`; 22 integration files run across all cores against one Postgres. On a 2-core runner that is safer but slower, and several files use deliberate `Promise.all` contention whose round trips must fit a 20 s timeout.

## Code References

- `vitest.config.ts:11-61` — the three-project split; `unit` has no setup file by design, `integration` loads `tests/setup.ts`
- `tests/setup.ts:8-16,44-108` — the `.env.test` file requirement, the localhost guard, the two health probes and the incident they exist to absorb
- `tests/unit/client-bundle.test.ts:31-38,56` — fails without `dist/client`; asserts the scan is not `WEAKENED`, which makes the `unit` project env-dependent
- `scripts/check-client-bundle.mjs` — scans `dist/client`; exits 2 on a missing artifact or a degraded env
- `astro.config.mjs:41-46` — both vars `optional: true`, so builds are green without them
- `package.json:8,17-22` — `build`, `lint`, `test`, `check:secrets`; the build command Workers Builds runs
- `.husky/pre-commit` — `lint-staged` then `astro check`; **`astro check` exists in no npm script**
- `.nvmrc` — 22.14.0, neither preinstalled Node on the Cloudflare runner
- `wrangler.jsonc` — no build field; the build command is dashboard state (confirmed default)

## Architecture Insights

- **The two gates guard different failures and are not duplication.** Only Actions can run the integration half; only the Workers Builds command can stop a publish, including on a direct push to master. Running lint and build twice costs a few minutes of free compute; dropping either loses one property entirely.
- **Putting the chain in `package.json` moves the gate into the repository.** This is the structural lesson of the whole CI episode in this project: a gate configured in a dashboard is state no file records, no review sees, and no one can verify from a checkout — which is exactly how the repo spent months believing the opposite of the truth in both directions.
- **`astro build` is not a quality gate.** It does not lint, does not run tests, and does not typecheck `.astro` templates — the reason `astro check` was promoted to pre-commit in the first place. A green deploy today means only that the bundler succeeded.
- **The `unit` project quietly acquired two dependencies** (a build artifact and env vars) when the secret scan landed. Worth naming: its documented property was "pure logic, runs with Docker down".

## Historical Context (from prior changes)

- `context/foundation/infrastructure.md:68,73,96,103` — the recommendation that led to deleting the workflow, the "no hand-rolled CI needed" line, the setup step that was later misread as an inventory, and the `## Out of Scope` line that contradicts the deletion.
- `context/archive/2026-06-28-testing-rls-owner-isolation/plan.md:59-62` — the original deferral: "No CI-gate wiring … running tests in CI needs a Supabase stack in the build env, a non-trivial problem worth its own change. Recorded as a fast follow." `research.md:210` left it as an open question. **This change is that fast follow, 75 days later.**
- `context/archive/2026-09-11-testing-secret-leak/research.md:146` and its review — concluded "there is no CI at all". **Wrong, and superseded by `test-plan.md` §5.** Recorded here because that archived document is otherwise a natural thing to quote.
- `context/foundation/test-plan.md` §5 — the current verified gate inventory, and the correction of the "no CI" mistake.

## Related Research

- `context/archive/2026-09-11-testing-secret-leak/research.md` — the "where can a gate live" analysis this one continues, including why a failing check must exit inside the build command to block a deploy
- `context/foundation/infrastructure.md` — the platform decision this inherits

## Open Questions

1. **Should a failing test block publication?** Chaining gates into the build command means a red gate stops all deploys until it is fixed. The escape hatches are `wrangler rollback` (restores a previous version, does not ship a new fix), a local `wrangler deploy`, or temporarily editing the build command. This is a genuine product-operations tradeoff and belongs to the plan, not to research.
2. **Is GitHub Pro worth $4/mo here?** It is the only way to make the Actions run merge-blocking on a private repository. Without it, bad code reaches master and is stopped only at the publish step.
3. **Should non-production branch builds be enabled in Cloudflare?** Free, opt-in, and they would run the same gate on branch pushes without promoting a version — giving pre-merge feedback that does not depend on the GitHub plan.
4. **Should `.nvmrc` move to 22.23.2** to match a preinstalled runner version, or is the per-build Node download acceptable?
5. **Should `tests/setup.ts`'s probes gain a bounded retry** before CI proves it necessary, given its own recorded incident and the absence of any retry today?
