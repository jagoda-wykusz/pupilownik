<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: CI Quality Gates (full plan)

- **Plan**: `context/changes/ci-quality-gates/plan.md`
- **Scope**: all five phases
- **Date**: 2026-09-12
- **Verdict**: NEEDS ATTENTION — one critical defect in the guard itself, fixed; four risks recorded as follow-ups
- **Findings**: 2 critical, 6 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

Phases 3-5 landed the plan's contract with one justified deviation (`npx supabase` instead of
`supabase/setup-cli@v3`, so the CLI is the lockfile-pinned one) and two benign extras
(`permissions: contents: read`, `timeout-minutes`). The failures are not in what was built but in
what was asserted about it.

## Findings

### F1 — The guard did not guard the gate's most expensive step

- **Severity**: ❌ CRITICAL
- **Dimension**: Safety & Quality
- **Location**: `tests/unit/ci-gate-source.test.ts:47,60,66` (as shipped in `3ac13e9`)
- **Detail**: `toContain("npm run check")` is satisfied by the substring inside
  `npm run check:secrets`, and the ordering test used `indexOf("npm run check ")` — which returns
  `-1` when the typecheck is absent, and `-1 < lint` passes. **Mutation-confirmed**: deleting
  `npm run check &&` from `ci:gate` left all seven assertions green. README and AGENTS.md assert as
  fact that removing a step breaks a test; for the typecheck they were wrong.
- **Fix (applied)**: anchored regex `/npm run check(?![:\w])/`, and every index floored at `> -1`
  before any ordering comparison, with a message naming the step. Re-verified by mutation.
- **Decision**: FIXED

### F2 — The same hole reappeared inside the fix

- **Severity**: ❌ CRITICAL
- **Dimension**: Safety & Quality
- **Location**: `tests/unit/ci-gate-source.test.ts` (the new `vitest.config.ts` assertions)
- **Detail**: The three config lines added in phase 2 (`globalSetup`, `sequence.groupOrder`, the
  CI-conditional `maxWorkers`) were pinned with `toContain("groupOrder")` and
  `toContain("globalSetup")` — both satisfied by the **comments** that explain those very lines.
  Deleting the config and keeping the prose passed. Caught only because the mutation matrix was
  run rather than trusted; the first two mutations came back GREEN.
- **Fix (applied)**: assert the config key (`/groupOrder:\s*\d/`, `/globalSetup:\s*\[/`). Both
  mutations now red.
- **Decision**: FIXED

### F3 — A project name that does not exist runs nothing and exits 0

- **Severity**: ⚠️ WARNING
- **Dimension**: Safety & Quality
- **Location**: `package.json` `ci:gate` + `vitest.config.ts`
- **Detail**: Measured: `npx vitest run --project unit --project nonexistent-xyz` exits 0 having
  run only `unit`. So renaming a project while the gate still names the old one silently removes
  those tests from the publish gate. Asserting the flag string cannot see it — the flag is still
  there.
- **Fix (applied)**: the guard now extracts every `--project <name>` from the chain and requires a
  matching `name: "<name>"` in `vitest.config.ts`. Mutation-confirmed with a typo'd name.
- **Decision**: FIXED

### F4 — The comment explaining why `dist/server` is safe gave the wrong reason

- **Severity**: ⚠️ WARNING
- **Dimension**: Safety & Quality
- **Location**: `scripts/check-client-bundle.mjs` header; `wrangler.jsonc:9`
- **Detail**: The header credited `.assetsignore`. That file lands at `dist/client/.assetsignore`
  and wrangler reads it from the root of the assets directory, so it governs `dist/client/**` and
  cannot reach `dist/server/**` at all. What actually protects the server half — which holds
  `.dev.vars` in plaintext — is directory scoping: the generated `dist/server/wrangler.json` sets
  `assets.directory: "../client"`. The root `wrangler.jsonc` still says `"./dist"`, the parent of
  both halves. A wrong reason in a comment is what licenses the change that breaks the real one.
- **Fix (applied)**: comment corrected, and `assertAssetScope()` added to the scan — it exits 2
  when the generated config publishes anything other than `../client`. Mutation-confirmed.
- **Decision**: FIXED

### F5 — The workflow's key-export step passed silently on failure

- **Severity**: ⚠️ WARNING
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml` (export step)
- **Detail**: GitHub's default shell is `bash -e`, not pipefail, so a failing `supabase status`
  still exited 0 through `tr`; and `echo "$(grep …)"` returns echo's status, so a grep matching
  nothing wrote `SUPABASE_KEY=` and reported success. The step's own comment notes that upstream is
  deprecating these key names — a rename would have turned this green and empty.
- **Fix (applied)**: `set -euo pipefail` plus an explicit non-empty assertion on all three values
  before anything reaches `$GITHUB_ENV`.
- **Decision**: FIXED

### F6 — `test-plan.md` §5 still opened by declaring, in the present tense, that no gate exists

- **Severity**: ⚠️ WARNING
- **Dimension**: Pattern Consistency
- **Location**: `context/foundation/test-plan.md` §5 opening; cost-table `eslint .` row
- **Detail**: Four bolded sentences ("There is a deploy pipeline, and it contains no test",
  "every push publishes, and nothing … executes a single assertion") survived phase 5 and were
  contradicted forty lines later by the same section. The cost table's `eslint .` row still read
  "not in the deploy path" — the exact row the plan named for correction, and the same two tables
  the file itself records getting out of step once before.
- **Fix (applied)**: the paragraph is now explicitly dated history ("Before 2026-09-12") followed
  by what is true now; both table rows corrected.
- **Decision**: FIXED

### F7 — Stale descriptions of files phase 2 restructured

- **Severity**: ⚠️ WARNING
- **Dimension**: Pattern Consistency
- **Location**: `vitest.config.ts` header ("Two projects"; "tests/setup.ts loads .env.test and
  fails fast"); `tests/shims/astro-env-server.ts`; `CLAUDE.md.scaffold` § CI; `AGENTS.md` test
  count; `docs/reference/data-access.md`; `context/foundation/infrastructure.md` archive link
- **Detail**: Three projects, not two. The env loading and the probes moved to `tests/env.ts` and
  `tests/global-setup.ts`. `CLAUDE.md.scaffold` — the file `AGENTS.md` points at as the full
  architecture notes — still said there is no GitHub Actions workflow. The test count was measured
  before phase 4 added a file (40 files / 376 tests, not 39 / 369).
- **Fix (applied)**: all corrected.
- **Decision**: FIXED

### F8 — The secret scan structurally cannot see the most likely real leak

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — this is the gap worth real effort
- **Dimension**: Safety & Quality
- **Location**: `scripts/check-client-bundle.mjs` (scope) + `astro.config.mjs` (`output: "server"`)
- **Detail**: Measured: `dist/client` contains **zero** HTML files. Every page renders at request
  time inside the Worker, so a secret read via `astro:env/server` and passed as a prop to a
  `client:load` island is serialized into the HTTP response — never into the client bundle. The
  scan reports clean on every build. Its header claims to catch "a key literal pasted into a client
  island", which is true only for a literal typed into the island's own source; the more natural
  version of the same mistake is invisible.
- **Decision**: FOLLOW-UP — recorded in `follow-ups/review-fixes.md`. Closing it needs an SSR
  render assertion or a lint rule, which is its own change.

### F9 — `npm run build` has a hard network dependency on Google Fonts

- **Severity**: 📋 OBSERVATION
- **Dimension**: Reliability
- **Detail**: `astro.config.mjs` declares two `fontProviders.google()` families; the fetcher throws
  `AstroError` with no fallback, and the cache lives in `node_modules/.astro`, which a fresh
  container never has. A transient 429 from Google is now a failed deploy rather than a slow one.
- **Decision**: FOLLOW-UP.

### F10 — `NODE_ENV=production` as a build variable would break the gate opaquely

- **Severity**: 📋 OBSERVATION
- **Dimension**: Reliability
- **Detail**: eslint, vitest, typescript and husky are devDependencies. Setting `NODE_ENV` in the
  dashboard — a common reflex — makes `npm ci` omit them and the gate fails with `eslint: not
found`, which points nowhere near the cause. The dashboard is exactly the state the repo cannot
  see.
- **Decision**: FOLLOW-UP (documented in `CLAUDE.md.scaffold` § CI as part of F7's rewrite).

### F11 — `npm run lint` is green with unlimited warnings

- **Severity**: 📋 OBSERVATION
- **Dimension**: Safety & Quality
- **Detail**: `eslint .` has no `--max-warnings 0`, and ten warnings exist today. A rule added as
  `warn` — the polite default — contributes nothing to the publish gate. Likewise `astro check`
  fails only on `error` severity.
- **Decision**: FOLLOW-UP — it is a policy decision with a cleanup cost, not a defect.

### F12 — `ci:gate` itself is never executed by CI

- **Severity**: 📋 OBSERVATION
- **Dimension**: Architecture
- **Detail**: The workflow re-implements the chain as separate steps. Nothing anywhere runs
  `npm run ci:gate`, so a syntactically broken chain is discovered on the Cloudflare build, i.e. at
  deploy time on master. The source guard matches strings, not execution.
- **Decision**: FOLLOW-UP.

## Mutation matrix run after the fixes

| Mutation                                 | Guard  |
| ---------------------------------------- | ------ |
| drop the typecheck from `ci:gate`        | RED    |
| typo a `--project` name                  | RED    |
| delete `sequence: { groupOrder: 1 }`     | RED    |
| delete `globalSetup`                     | RED    |
| delete the CI worker cap                 | RED    |
| widen the generated asset scope to `../` | exit 2 |

The first two of those were green before this review.
