<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: CI Quality Gates

- **Plan**: `context/changes/ci-quality-gates/plan.md`
- **Scope**: Phase 1 of 5 — "Compose the gate in `package.json`"
- **Date**: 2026-09-11
- **Verdict**: NEEDS ATTENTION (all findings triaged; none left open)
- **Findings**: 0 critical, 4 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

All three planned changes verified MATCH, byte-for-byte against the plan's contract strings. One
benign EXTRA: a six-line comment added to `.husky/pre-commit` explaining the indirection, which is
the rationale the plan itself gives one section earlier. `npm run ci:gate` re-run at review time:
exit 0, 17 files / 175 tests, secret scan clean.

Cross-platform behaviour was verified rather than assumed: `npm config get script-shell` is null,
so npm uses `cmd.exe` on Windows and `sh` on Linux, and `&&` carries identical short-circuit
semantics in both. Husky propagates the script's exit code unmodified.

## Findings

### F1 — Asset bucket points at `./dist` while `.assetsignore` sits one level deeper

- **Severity**: ⚠️ WARNING (would have been CRITICAL on a 200)
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `wrangler.jsonc:9`
- **Detail**: The root config declares `"directory": "./dist"` — the parent of both build halves —
  while the adapter-generated `dist/server/wrangler.json` narrows it to `"../client"`.
  `.assetsignore` exists only at `dist/client/.assetsignore`, never at `dist/.assetsignore`, and
  wrangler reads it from the root of the assets directory. On the root config's reading,
  `dist/server/**` would be inside the upload scope, and `check:secrets` could never catch it
  because it scans `dist/client` only, by design. Pre-existing, not introduced by Phase 1 — filed
  here because Phase 1 puts a gate in front of exactly this deploy path.
- **Fix A ⭐ (applied)**: Probe the live worker instead of reasoning about it.
- **Outcome**: **MEASURED CLEAN.** Against `https://pupilownik.jagoda-wykusz.workers.dev`:
  `/server/entry.mjs`, `/server/wrangler.json` and `/server/.dev.vars` all return 404, identical to
  a nonsense path. Positive control: `/_astro/Layout.kpZpCGeQ.css` returns 200 from the same host —
  and it is the same content hash as the local build, so production is current and the probe can
  demonstrably see served files. Without that control, "all 404" would have been equally consistent
  with querying the wrong host. The live deploy therefore uses the adapter-generated scope, not the
  root config's `./dist`.
- **Decision**: FIXED via Fix A (measured; no change needed)

### F2 — A missing build variable stopped degrading and started blocking publication

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `scripts/check-client-bundle.mjs:153-160`
- **Detail**: The script exits 2 when `SUPABASE_URL` / `SUPABASE_KEY` are absent or shorter than 8
  characters. Both are `optional: true` in `astro.config.mjs`, and `infrastructure.md:58` records
  that as "a build succeeds without them; production fails at runtime instead". As of Phase 1 that
  reading is wrong: the scan is the last link of the publish gate, so their absence blocks
  publication entirely. The dashboard has both set today (recorded in `change.md`), so nothing
  fires — but the consequence of their removal changed and no document said so.
- **Fix (applied)**: Statement added to the script's own header, plus a new Phase 5 contract item
  covering `infrastructure.md:58` and `deploy-plan.md:25`. The header also records the operational
  rule that follows: `CLOUDFLARE_INCLUDE_PROCESS_ENV` must never be set in Workers Builds, because
  it makes `@cloudflare/vite-plugin` serialize the process environment — the production key — into
  a plaintext `dist/server/.dev.vars` inside the build output.
- **Decision**: FIXED

### F3 — Seven live lines across six documents now describe a state the repo no longer has

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `README.md:18,187` · `AGENTS.md:25,34` · `docs/reference/data-access.md:324` ·
  `context/deployment/deploy-plan.md:14` · `context/foundation/test-plan.md:177` ·
  `CLAUDE.md.scaffold:46`
- **Detail**: Four say `Node v22.14.0`; three name `npx astro check`. Phase 5's contract covered
  exactly one of them. `deploy-plan.md:14` is doubly wrong — it also asserts that 22.14.0 matched
  the Workers Builds default image, which research measured as false. Verified by direct grep, not
  taken from the review agent's report.
- **Fix (applied)**: Phase 5 gained an explicit contract item naming every file and line, including
  the instruction that `deploy-plan.md:14` needs its claim corrected rather than its number bumped.
  Phase 5's prettier criterion widened to cover the added files.
- **Decision**: FIXED (scheduled into Phase 5 by name)

### F4 — The gate has never executed on the Node version it now pins

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `.nvmrc:1`
- **Detail**: Local Node is v24.12.0; the pin is now 22.23.2. Every `ci:gate` verification so far —
  including the run that proved the chain blocks — executed on Node 24. The first execution on
  22.23.2 would otherwise happen inside the publish path. `package.json` declares no `engines`
  field, so nothing warns about the mismatch.
- **Fix (applied)**: New Phase 5 manual criterion 5.3 — run `ci:gate` once under 22.23.2 before the
  dashboard is touched.
- **Decision**: FIXED (scheduled into Phase 5)

### F5 — The secret scan runs twice per gate execution

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Architecture
- **Location**: `package.json:19` + `tests/unit/client-bundle.test.ts:38`
- **Detail**: The `unit` project already runs `scripts/check-client-bundle.mjs` through
  `execFileSync` with the same cwd and env, and asserts strictly more than the bare script does
  (the `clean` marker, the control line, a file floor, a pattern floor, absence of `WEAKENED`).
  Step 5 of the chain adds no coverage — about 1 s and a second exit-2 site. Kept deliberately: the
  standalone run is what Phase 4's source guard pins, and losing it would make the gate's last link
  depend on a test file continuing to exist.
- **Decision**: ACCEPTED (documented, not changed)

### F6 — The gate's definition carries no "why", in a repo that comments everything else

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: `package.json:19`
- **Detail**: `.husky/pre-commit` spends 24 lines explaining one command; `check-client-bundle.mjs`
  opens with a 36-line header stating what it cannot do. Against that standard the single string
  that decides whether anything publishes ships as an uncommented JSON value, with its reasoning
  only in a plan document that a checkout never reads. JSON cannot carry a comment, so the fix
  belongs in `AGENTS.md`.
- **Decision**: SCHEDULED — folded into Phase 5's `AGENTS.md` edit (F3's contract item), which will
  state the build command, the load-bearing order, and why `integration` is excluded.

### F7 — Script-naming shapes now read inconsistently

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: `package.json:17-18`
- **Detail**: The repo's `:` convention was consistent — `lint` / `lint:fix` (suffix specializes a
  base), `db:start` / `db:stop` (prefix names a tool). With `check` = `astro check` sitting directly
  above `check:secrets`, the latter now reads as "typecheck, for secrets", which it is not.
- **Decision**: SKIPPED — a rename churns a script name that appears in docs, a test and a plan, for
  a readability gain; not worth it mid-change.

### F8 — The plan brief's cost figure is unverified

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Location**: `context/changes/ci-quality-gates/plan-brief.md`
- **Detail**: The brief says the chain takes "roughly 69 s", summed from research's per-step
  measurements. The chain measured 109 s at review time — but that run shared the machine with two
  review agents, so both numbers are suspect. Nothing depends on it yet; Phase 5 rewrites README and
  test-plan §5, which is where a wrong number would become a claim.
- **Decision**: ACCEPTED — re-measure on an idle machine before Phase 5 writes any figure down.

## Verified clean (no finding)

- **The scan cannot print a secret.** Every output path builds pattern names from `${name}`, never
  `${value}`; the one name carrying a literal is `configured host ${host}`, sourced only from
  `SECRET_SCAN_HOSTS`, which is a project ref by design.
- **No build-time substitution.** Both vars are `context: "server", access: "secret"`; the generated
  `dist/server/wrangler.json` carries `"vars":{}`.
- **`unit` and `component` need no Docker, database or network.** `unit` loads no setup file;
  `component` loads a nine-line cleanup; all component suites stub `fetch`.
- **The test's floors have ~4× margin** against a fresh CI build (21 scannable files against a floor
  of 5; 6 patterns against a floor of 2), and are derived deterministically from source.
- **`eslint .` skips `dist/`** via `includeIgnoreFile(gitignorePath)`, so the chain is safe both
  cold and warm.
