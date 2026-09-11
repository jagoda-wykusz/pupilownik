# CI Quality Gates Implementation Plan

## Overview

Two gates, in two places, for two different failures. A chain of checks in `package.json`
becomes the Workers Builds build command, so a failing check produces no version and therefore
no deploy. A GitHub Actions workflow brings up a local Supabase stack — the only environment
where the 22 integration files can run at all — and reports the full suite as a signal.

Neither alone is sufficient, and the split is forced by the platforms, not chosen: the
Cloudflare build container has no Docker, and a private repo on GitHub Free cannot make any
status check merge-blocking.

## Current State Analysis

**What runs between a commit and production today: `astro build`, and nothing else.** No lint,
no tests, no typecheck of `.astro` templates, no secret scan. A green deploy means the bundler
succeeded.

What exists and is load-bearing:

- `.husky/pre-commit` runs `npx lint-staged` (eslint --fix on staged files) then `npx astro check`
  — the only automated checks in the project, both bypassable with `--no-verify`, and both
  worthless for 75 days because `prepare: husky` was missing (`.husky/pre-commit` records this).
- `package.json:8,17-22` defines `build`, `lint`, `test`, `check:secrets`. **`astro check`
  appears in no npm script** — the hook calls the binary directly.
- `vitest.config.ts:11-61` splits three projects: `unit` (no setup), `component` (happy-dom),
  `integration` (`tests/setup.ts`, needs the local stack).
- `.github/` does not exist. A starter `ci.yml` ran `lint` + `build` — never tests, none existed
  — and was deleted 52 minutes after the bootstrap commit created it.

Three properties that were measured during research and that constrain the ordering:

1. **`npm run build` must precede the `unit` project**, not just `check:secrets`.
   `tests/unit/client-bundle.test.ts:31` fails (deliberately, not skips) without `dist/client`.
2. **The `unit` project needs `SUPABASE_URL` / `SUPABASE_KEY` in env.** `check-client-bundle.mjs`
   exits 2 on a degraded run and `client-bundle.test.ts:55` asserts the absence of `WEAKENED`.
   The project's documented property — "pure logic, runs with Docker down" — quietly stopped
   being true when the secret scan landed.
3. **`astro check` regenerates `.astro/`**, so running it before `lint` makes a separate
   `astro sync` redundant. Without `.astro`, type-aware linting of `src/lib/supabase.ts` and
   `src/middleware.ts` exits 1 with 16 `no-unsafe-*` errors.

And one that constrains the workflow: **`tests/setup.ts:8-16` reads a FILE.** `readFileSync` of
`.env.test` happens before `process.env[key] ??= value`, so exported variables alone do not
satisfy it — CI must produce the file. `.env.test` is gitignored; `.env.test.example` is not.

## Desired End State

- Pushing anything to `master` runs `astro check`, `eslint .`, `astro build`, the `unit` and
  `component` projects and the secret scan **before** Cloudflare produces a version. A failure
  in any of them means nothing is published.
- Pushing any branch, and opening or updating any pull request, runs the same checks **plus the
  22 integration files against a real Supabase stack**, and reports the result on the commit.
- Both gates are defined in files under version control. The Cloudflare dashboard holds a single
  `npm run ci:gate`, so the content of the gate is reviewable from a checkout.
- Weakening either gate breaks a test.

**How to verify**: push a branch with a deliberately broken lint rule and observe the Actions run
go red; push it to `master` and observe the Cloudflare build fail with no new version deployed.
Both are manual steps in Phase 5.

### Key Discoveries:

- `package.json:8,17-22` — the scripts the chain composes; `astro check` is absent from all of them
- `.husky/pre-commit` — calls `npx astro check` directly, so extracting a `check` script removes
  a duplicate definition rather than adding one
- `tests/unit/client-bundle.test.ts:31,50-55` — the build-artifact and env dependency of `unit`
- `tests/setup.ts:8-16` — `.env.test` must exist as a file
- `tests/setup.ts:60-108` — two probes, one 3-second attempt each, no retry; the comment records
  a real 2026-09-07 incident where the schema-cache race failed 13 files while the probe
  reported "ready"
- `tests/unit/invite-source.test.ts` — the source-guard pattern Phase 4 follows, including the
  guards-the-guard assertion that the file was actually parsed
- `context/archive/2026-06-28-testing-rls-owner-isolation/plan.md:59-62` — the original deferral
  this change closes, 75 days later

## What We're NOT Doing

- **Not upgrading GitHub to Pro.** Branch protection stays unavailable; the Actions run is a
  signal, permanently. Nothing in this plan may be written as if a merge gate is coming.
- **Not enabling non-production branch builds in Cloudflare.** Only `master` builds and deploys.
- **Not running integration tests in the Workers Builds chain.** Impossible — no Docker.
- **Not touching the pre-commit hook's scope.** It keeps lint-staged + typecheck; Phase 1 only
  redirects it at a named script.
- **Not adding `db:reset` to CI.** Measured: no integration test depends on seeded identities,
  and `supabase start` on a fresh container applies migrations anyway.
- **Not caching Docker images in Actions.** A known dead end — the Supabase CLI disabled its own
  because re-pulling was faster.
- **Not addressing Kong 502s or the GoTrue rate limit** (flake ranks #2 and #3). Neither is
  reproducible on demand; hardening them now would be writing code against a prediction.
- **Not wiring notifications.** GitHub's default email on a failed run of your own commit is the
  whole of it.

## Implementation Approach

Build the chain first and prove it locally, because it is also what the Actions workflow runs —
getting the ordering wrong once is cheaper in a shell than in a 10-minute CI round trip. Harden
the known flake **before** the workflow's first run, so that the first red build is a measurement
of the gate rather than a measurement of a race. Then the workflow, then the guard that pins both,
then the one manual step that lives outside the repository.

## Critical Implementation Details

**Ordering inside the chain is not stylistic.** `check` → `lint` → `build` → tests → `check:secrets`.
Moving `build` after the tests breaks `client-bundle.test.ts`; moving `lint` before `check`
reintroduces a separate `astro sync` step.

**The same command has different reach in the two environments.** In Workers Builds, the build
variables are the PRODUCTION `SUPABASE_URL` / `SUPABASE_KEY`, so `check:secrets` guards the real
host there. In Actions the same variables point at `127.0.0.1:54321`, because `tests/setup.ts:48`
refuses any non-localhost host — which is why the workflow passes the production host separately
through `SECRET_SCAN_HOSTS`.

## Phase 1: Compose the gate in `package.json`

### Overview

Turn the chain into a single npm script, remove the duplicate `astro check` definition, and align
`.nvmrc` with a Node version the Cloudflare runner already has.

### Changes Required:

#### 1. Named scripts for the chain

**File**: `package.json`

**Intent**: Add a `check` script so `astro check` has one definition instead of living only inside
a git hook, and a `ci:gate` script composing the full publish-blocking chain. npm runs scripts
through a shell by contract, so `&&` is guaranteed here — which is the entire reason the chain
belongs in this file rather than in a dashboard field.

**Contract**: two new entries in `scripts`.

- `check` → `astro check`
- `ci:gate` → `npm run check && npm run lint && npm run build && vitest run --project unit --project component && npm run check:secrets`

The order is load-bearing (see Critical Implementation Details). `ci:gate` is the string that will
be pasted into the Cloudflare build command field in Phase 5, and it must remain runnable
unchanged on a developer machine.

#### 2. Point the hook at the script

**File**: `.husky/pre-commit`

**Intent**: Replace the direct `npx astro check` invocation with `npm run check`, so the hook and
the gate cannot drift apart. The long explanatory comment above it stays — it records why this
hook exists and why it was worth nothing until 2026-09-07.

**Contract**: last line becomes `npm run check`.

#### 3. Align the Node pin with the runner

**File**: `.nvmrc`

**Intent**: `22.14.0` is preinstalled on neither the Cloudflare runner (24.18.0, 22.23.2) nor the
developer machine (24.12.0), so every build downloads a Node build to satisfy a pin that describes
nothing. Move it to the runner's preinstalled patch version.

**Contract**: file content becomes `22.23.2`. The workflow in Phase 3 reads this same file via
`node-version-file`, so the pin then describes both CI environments and only the local machine
diverges — knowingly.

### Success Criteria:

#### Automated Verification:

- The whole chain passes locally: `npm run ci:gate`
- `astro check` is reachable by name: `npm run check`
- The hook still fires on commit (the Phase 1 commit itself is the proof)

#### Manual Verification:

- `npm run ci:gate` is confirmed to be a single string safe to paste into a dashboard field
  (no shell metacharacters beyond `&&`, no relative path assumptions)

**Implementation Note**: kill any running `npm run dev` before this phase — `astro check` and
`npm run build` both rewrite `node_modules/.vite` and will break a live dev server
(`context/foundation/lessons.md`).

---

## Phase 2: Harden the known flake before the first CI run

### Overview

The schema-cache probe is the most likely CI failure and the cheapest to fix. Do it before the
workflow exists, so the first red run means something.

### Changes Required:

#### 1. Bounded retry in the readiness probes

**File**: `tests/setup.ts`

**Intent**: Both probes get one 3-second attempt today. On a CI runner the stack finishes
`supabase start` and is still loading the PostgREST schema cache — exactly the race the file's own
comment documents from 2026-09-07, where 13 files failed while the probe reported ready. Give
`reachable` a bounded retry with backoff instead of a single attempt.

**Contract**: `reachable` gains a retry budget (attempts and delay), applied to both call sites.
Two properties must survive:

- The failure message stays the actionable one (`Run \`npm run db:start\``) — a retry that ends in
  a timeout instead of that sentence makes a stack-down situation harder to diagnose, not easier.
- The `dataApiReady` predicate is unchanged: 200/401/403 mean ready, 404 (PGRST205) does not.

State the cost in the header comment: with the stack down, a local `npm test` now waits the full
budget before failing instead of ~6 seconds. That is the price of the retry and it should be
written down, not discovered.

#### 2. Constrain integration parallelism under CI

**File**: `vitest.config.ts`

**Intent**: 22 integration files run across all cores against one Postgres, with no `maxWorkers`,
`poolOptions` or `fileParallelism` set. The Actions runner has 2 vCPUs, and several files use
deliberate `Promise.all` contention whose round trips must complete inside a 20-second timeout.
Cap workers when `CI` is set; leave local behaviour untouched.

**Contract**: the `integration` project gets a worker cap conditional on `process.env.CI`. Both
Workers Builds and GitHub Actions set `CI=true` automatically, so no workflow plumbing is needed.
Comment why the branch exists — a conditional nobody runs locally is exactly the kind of config
that rots.

### Success Criteria:

#### Automated Verification:

- Integration suite passes unchanged locally: `npx vitest run --project integration`
- The CI branch is exercised rather than assumed: `CI=1 npx vitest run --project integration`
- The retry is proven to bite, not just to exist: with the stack stopped, the run fails with the
  `db:start` guidance and not with an unhandled timeout

#### Manual Verification:

- The measured wall-clock difference between the two runs above is recorded in the phase
  commit message, so the cost of the cap is a number rather than an impression

---

## Phase 3: The GitHub Actions workflow

### Overview

The only place the integration half runs. It is a signal, not a gate, and the plan says so in the
workflow file itself so nobody later reads a green check as an enforced rule.

### Changes Required:

#### 1. The workflow

**File**: `.github/workflows/ci.yml` (new)

**Intent**: Bring up a real Supabase stack, run every check the publish gate runs plus the
integration project, and report. Triggers on push to any branch and on pull requests.

**Contract**: one job on `ubuntu-latest`. The steps, with the non-obvious parts named:

- `actions/checkout`, then `actions/setup-node` with `node-version-file: .nvmrc` and npm caching,
  then `npm ci`.
- `supabase/setup-cli@v3`, then `supabase start`. Migrations in `supabase/migrations/` (19 files)
  and `supabase/seed.sql` are applied by `supabase start` itself — no separate migration step.
  Budget ~3 minutes typical.
- **Produce `.env.test`**: `cp .env.test.example .env.test`. Required because `tests/setup.ts`
  reads the file before consulting real env; exported variables alone do not satisfy it.
- **Capture the stack's real keys**: `supabase status -o env` emits `API_URL`, `ANON_KEY`,
  `SERVICE_ROLE_KEY`; map them onto `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY` in
  `$GITHUB_ENV`. Do not hardcode the well-known local constants — they are stable for the CLI
  version pinned today, and upstream is deprecating that.
- Run `npm run check`, `npm run lint`, `npm run build`, then `npx vitest run` (all three
  projects), then `npm run check:secrets`.
- **`SECRET_SCAN_HOSTS: ifrvrwkisixavvmtnfpg.supabase.co`** at job level, so the scan guards the production
  host here too. Without it the scan's literal checks guard `127.0.0.1:54321` — which is what
  `SUPABASE_URL` must be in this job, because `tests/setup.ts:48` refuses any other host. A
  project ref is not a secret; the script's own header says so.
- A `concurrency` group keyed on the ref, cancelling superseded runs, so a push onto a branch with
  an open PR does not hold two ~10-minute runs open.

The file carries a header comment stating what it is and is not: this repository is private on
GitHub Free, branch protection is unavailable, and **a red run here cannot block a merge**. It is
the only place the integration suite runs; the publish gate is `npm run ci:gate` in the Cloudflare
build command.

### Success Criteria:

#### Automated Verification:

- YAML parses and the run starts (visible in the Actions tab on the phase push)
- The full run is green end to end, including all 39 test files / 369 tests
- `supabase start` + suite completes inside the expected envelope (~9-12 min serial)

#### Manual Verification:

- The run appears on a pull request as well as on a branch push, and only one run is active per
  ref after a rapid second push (concurrency cancellation works)
- The run's log shows the secret scan naming the production host in its summary line, proving
  `SECRET_SCAN_HOSTS` reached the script

---

## Phase 4: Pin both gates so they cannot be quietly hollowed out

### Overview

A gate nothing asserts is the failure mode this project keeps writing down. Deleting one `&&` from
one line in `package.json` is invisible in review and has no symptom until the day it matters.

### Changes Required:

#### 1. Source guard over the chain and the workflow

**File**: `tests/unit/ci-gate-source.test.ts` (new)

**Intent**: Read `package.json` and `.github/workflows/ci.yml` as text and assert the properties
that make the two gates worth having. Follows the pattern of `tests/unit/invite-source.test.ts`,
including its guards-the-guard discipline.

**Contract**: assertions over parsed source, not over behaviour.

- `scripts.ci:gate` contains, in order: `check`, `lint`, `build`, both `--project unit` and
  `--project component`, `check:secrets`. Order is asserted by index, because the ordering is the
  part that silently breaks `client-bundle.test.ts`.
- `.husky/pre-commit` invokes `npm run check` — the hook and the gate share one definition.
- The workflow runs every vitest project (the integration half is its entire reason to exist) and
  sets `SECRET_SCAN_HOSTS`.
- The workflow triggers on both `push` and `pull_request`.
- **Guards-the-guard**: assert each file was actually read and parsed — a non-empty `ci:gate`
  string and a workflow containing at least one `runs-on`. Without it, a renamed file turns every
  assertion above into a vacuous pass, which is exactly the shape `lessons.md` records.

The file states its own limitation in the header: it pins the repository's half. **It cannot see
the Cloudflare dashboard field**, so if someone changes the build command away from `npm run
ci:gate`, this test still passes. That gap is real, it is not closable from inside the repo, and
naming it is the difference between a guard and a decoration.

### Success Criteria:

#### Automated Verification:

- The new test passes: `npx vitest run --project unit ci-gate-source`
- It bites, proven by mutation rather than predicted: remove `check:secrets` from `ci:gate` and
  the test fails; remove the `pull_request` trigger and the test fails; revert both
- Whole unit project still green: `npx vitest run --project unit`

#### Manual Verification:

- The two mutations above were run and their failure messages actually name the missing property
  (a failure that says only "expected true to be false" is a test that will waste someone's hour)

---

## Phase 5: Connect the dashboard, correct the documents

### Overview

One step outside the repository, and the four documents that currently describe a world where none
of this exists.

### Changes Required:

#### 1. The Cloudflare build command (manual, user-performed)

**File**: none — Cloudflare dashboard, Workers & Pages → the project → Settings → Build.

**Intent**: Change the build command from `npm run build` to `npm run ci:gate`. This is the step
that converts the chain from a script anyone can run into the thing that stops a publish. Deploy
command stays at its default.

**Contract**: build command = `npm run ci:gate`. Nothing else in the dashboard changes: branch
builds stay off, build variables stay as they are.

#### 2. README

**File**: `README.md`

**Intent**: The `## CI / CD` section currently reads "Pushes deploy. Nothing tests them." That
stops being true in this phase. Replace it with the two-gate description, including the honest
limit — a red Actions run does not block a merge on this plan.

**Contract**: `## CI / CD` section rewritten.

#### 3. Test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Three corrections, two of which are stale claims rather than new content.

**Contract**:

- §5 — the gate inventory gains the two new gates; the `eslint .` row's "not in the deploy path"
  is no longer true and must change.
- §5 line 177 — the typecheck row still names `npx astro check` for the pre-commit hook; the hook now calls
  `npm run check`.
- Lines 114-115 — "The gate had nowhere to live: there is no CI (see §5)" describes the state this
  change ends. Rewrite to point at the wiring that now exists.
- §3 row for Phase 3 points at `context/changes/testing-secret-leak/`, which has been archived to
  `context/archive/2026-09-11-testing-secret-leak/`. Fix the path.

#### 4. The build-variable dependency, recorded where it bites

**File**: `context/foundation/infrastructure.md` (the build-variables note at line 58) and
`context/deployment/deploy-plan.md:25`

**Intent**: Both documents record that `SUPABASE_URL` / `SUPABASE_KEY` are `optional: true`, so a
build succeeds without them and only production fails at runtime. Phase 1 changed that: the secret
scan exits 2 when they are absent and it is now the last link of the publish gate, so their
absence blocks publication instead. Say so where the old reading lives. Add the one operational
rule that follows: `CLOUDFLARE_INCLUDE_PROCESS_ENV` must never be set in Workers Builds, because
it turns the production key into a plaintext file inside the build output.

**Contract**: annotation at both locations, dated, naming this change. The script header already
carries the same statement (`scripts/check-client-bundle.mjs`, added during the phase-1 review).

#### 5. The documents Phase 1 made stale

**Files**: `README.md:18,187` · `AGENTS.md:25,34` · `docs/reference/data-access.md:324` ·
`context/deployment/deploy-plan.md:14` · `CLAUDE.md.scaffold:46`

**Intent**: Phase 1 renamed the typecheck invocation and moved the Node pin, which falsified seven
lines across six files. They are named here rather than left to the implementer's eye, because a
document that describes a state the system no longer has is the recurring failure this project
keeps recording. Four say `Node v22.14.0`; three say `npx astro check`. `AGENTS.md:34` additionally
says "there is no GitHub Actions workflow", which Phase 3 falsifies.

**Contract**: each line updated to `22.23.2` or `npm run check` respectively.
`context/deployment/deploy-plan.md:14` needs more than a version bump — it also asserts that
22.14.0 matched the Workers Builds default image, which research measured as false (neither
preinstalled version is 22.14.0). Correct the claim, do not just change the number.

#### 6. Infrastructure

**File**: `context/foundation/infrastructure.md`

**Intent**: Line 68's "GitHub unlocks native Workers Builds … no hand-rolled CI needed" is the
sentence that justified deleting the original workflow, and it is now contradicted by this change.
It should not be deleted — it should be annotated with what was learned: Workers Builds cannot run
anything needing Docker, so a hand-rolled workflow is not redundant with it but complementary.

**Contract**: annotation at line 68, dated, naming this change folder.

### Success Criteria:

#### Automated Verification:

- Full chain green before the dashboard is touched: `npm run ci:gate`
- Docs are prettier-clean: `npx prettier --check README.md context/foundation/test-plan.md context/foundation/infrastructure.md`

#### Manual Verification:

- **The blocking property is demonstrated, not assumed**: push a commit that fails one gate
  (a deliberate lint error is cheapest) to `master`, and confirm in the Cloudflare dashboard that
  the build failed and **no new version was deployed** — the live site still serves the previous
  version. Then push the fix.
- The Actions run for that same commit is red, and the merge button on a PR carrying it is still
  enabled — confirming the documented limit is the real behaviour and not an assumption about the
  GitHub plan.
- No claim in the rewritten README or §5 describes something that does not exist at the moment of
  writing (`lessons.md`: verify posture from the artifact, not from the intent).

---

## Testing Strategy

### Unit Tests:

- `tests/unit/ci-gate-source.test.ts` — the chain's contents and order, the hook's delegation, the
  workflow's projects, triggers and `SECRET_SCAN_HOSTS`, plus a guards-the-guard control.

### Integration Tests:

- No new integration tests. The existing 194 gain a new execution environment, which is the point
  of Phase 3 — the test of the workflow is that the existing suite passes in it.

### Manual Testing Steps:

1. Run `npm run ci:gate` locally on a clean checkout; confirm it passes and takes roughly 69 s.
2. Break a lint rule deliberately; confirm `ci:gate` exits non-zero and stops before the build.
3. Push a branch; confirm the Actions run appears, brings up Supabase and runs all three projects.
4. Push a failing commit to `master`; confirm the Cloudflare build fails and the live site is
   unchanged. Push the fix; confirm the deploy resumes.

## Performance Considerations

The publish gate adds ~69 s of compute to a deploy that previously ran ~15 s of build, inside a
20-minute build timeout — not a constraint. The Actions run costs ~20-25 minutes of billable time
per change against 2,000 free minutes/month, i.e. roughly 80-100 changes per month inside the free
tier. If that ceiling is ever approached, the first lever is narrowing the push trigger, not
dropping a check.

## Migration Notes

Rollback is per-phase and cheap. The dashboard step (Phase 5) is reversible in one field: setting
the build command back to `npm run build` restores today's behaviour exactly. If a red gate ever
blocks an urgent fix, the escape hatches are, in order of preference: fix forward, `wrangler
rollback` to the previous version, or a local `wrangler deploy`. Editing the build command to get
around a gate is the option that should feel wrong, because it silently disarms the gate for
everyone afterwards.

## References

- Research: `context/changes/ci-quality-gates/research.md`
- Decisions: `context/changes/ci-quality-gates/change.md` (§ Open questions closed)
- The deferral this closes: `context/archive/2026-06-28-testing-rls-owner-isolation/plan.md:59-62`
- Source-guard pattern: `tests/unit/invite-source.test.ts`
- Gate inventory: `context/foundation/test-plan.md` §5

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Compose the gate in `package.json`

#### Automated

- [x] 1.1 The whole chain passes locally: `npm run ci:gate` — 6d239cd
- [x] 1.2 `astro check` is reachable by name: `npm run check` — 6d239cd
- [x] 1.3 The hook still fires on commit (the Phase 1 commit itself is the proof) — 6d239cd

#### Manual

- [x] 1.4 `npm run ci:gate` confirmed safe to paste into a dashboard field — 6d239cd

### Phase 2: Harden the known flake before the first CI run

#### Automated

- [ ] 2.1 Integration suite passes unchanged locally: `npx vitest run --project integration`
- [ ] 2.2 The CI branch is exercised: `CI=1 npx vitest run --project integration`
- [ ] 2.3 With the stack stopped, the run fails with the `db:start` guidance, not a timeout

#### Manual

- [ ] 2.4 Wall-clock difference between capped and uncapped runs recorded in the commit message

### Phase 3: The GitHub Actions workflow

#### Automated

- [ ] 3.1 YAML parses and the run starts
- [ ] 3.2 The full run is green end to end (39 files / 369 tests)
- [ ] 3.3 `supabase start` + suite completes inside ~9-12 min

#### Manual

- [ ] 3.4 Run appears on both a branch push and a pull request; concurrency cancels superseded runs
- [ ] 3.5 Secret-scan log line names the production host, proving `SECRET_SCAN_HOSTS` arrived

### Phase 4: Pin both gates so they cannot be quietly hollowed out

#### Automated

- [ ] 4.1 New test passes: `npx vitest run --project unit ci-gate-source`
- [ ] 4.2 Two mutations (drop `check:secrets`, drop `pull_request`) each fail the test; both reverted
- [ ] 4.3 Whole unit project still green: `npx vitest run --project unit`

#### Manual

- [ ] 4.4 Mutation failure messages name the missing property, not just "expected true to be false"

### Phase 5: Connect the dashboard, correct the documents

#### Automated

- [ ] 5.1 Full chain green before the dashboard is touched: `npm run ci:gate`
- [ ] 5.2 Docs prettier-clean: `npx prettier --check README.md AGENTS.md docs/reference/data-access.md context/foundation/test-plan.md context/foundation/infrastructure.md context/deployment/deploy-plan.md`

#### Manual

- [ ] 5.3 `npm run ci:gate` run once under Node 22.23.2 (the version `.nvmrc` now pins) before the dashboard is touched
- [ ] 5.4 Build command changed to `npm run ci:gate` in the Cloudflare dashboard
- [ ] 5.5 A failing commit on `master` blocks the deploy; live site unchanged; fix restores it
- [ ] 5.6 The same commit's Actions run is red while the PR merge button stays enabled
- [ ] 5.7 No claim in the rewritten README or §5 describes something that does not yet exist
