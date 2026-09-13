<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Stop a GitHub Releases outage from killing the Cloudflare build

- **Plan**: context/changes/supabase-cli-build-cost/plan.md
- **Scope**: All 2 phases (8/8 Progress rows complete)
- **Date**: 2026-09-13
- **Verdict**: NEEDS ATTENTION → both warnings and four of six observations FIXED before archive; F7 and F8 recorded
- **Findings**: 0 critical, 2 warnings, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Full MATCH on all eight files, no boundary violated, and the core claim reproduces exactly: a second
reviewer built a scratch package whose postinstall exits 1 and measured `npm ci` at exit 1 as a
devDependency and exit 0 as an optionalDependency — character for character the table this change
recorded. The guard was also verified to be stronger than its comment claims: `node_modules/supabase/bin/supabase`
is the 98,396,160-byte Go binary itself, so `--version` executes the downloaded artifact rather than
a wrapper that could answer from `package.json`.

One nuance neither the plan nor the entry recorded, and it strengthens the change: the optional
failure is **completely silent**. Full `npm ci` output in the failing case was `up to date in 675ms`
— no warning, no mention of the dropped package. That silence is the whole reason the Actions guard
has to exist.

## Findings

### F1 — The guard's position is claimed in prose and unasserted in code

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/unit/ci-gate-source.test.ts:314-317
- **Detail**: Found independently by both reviewers. The assertion
  `toMatch(/^\s*-?\s*run:\s*npx --no-install supabase --version\s*$/m)` matches the line ANYWHERE in
  the workflow. Move the guard below `npx supabase start` and the test stays green while the guard
  is worthless — `start` would already have fetched from the registry, the precise outcome the step
  exists to prevent. Adding `continue-on-error: true` neuters it identically and the regex still
  passes.

  `test-plan.md` says the workflow "now runs `npx --no-install supabase --version` **first**".
  Nothing pins that. And the immediately preceding sibling test — "checks documentation links, first
  in the chain" — does exactly this ordering work and names this exact failure in its own comment.
  The standard is set one screen above and not applied here.

- **Fix**: Mirror the sibling: floor both indices, then assert the guard precedes `supabase start`.
- **Decision**: FIXED

### F2 — Moving to `optionalDependencies` widened what a production install pulls

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: package-lock.json (21 entries)
- **Detail**: `optionalDependencies` is a PRODUCTION section. Measured against `0bce7eb^`: 21
  entries flipped from `"dev": true` to `"optional": true` with no `dev` flag — `supabase` plus 20
  transitives (`tar`, `node-fetch`, `bin-links`, `https-proxy-agent`, …). Confirmed by experiment
  that a package in `optionalDependencies` survives `npm ci --omit=dev` where a devDependency does
  not.

  **Impact today: zero.** Nothing here runs an omit-dev install; no `NODE_ENV` is set outside
  `context/`, and Workers Builds runs a bare `npm ci`.

  **But the change inverts under a state this repo already documented as a likely mistake.**
  `context/archive/2026-09-11-ci-quality-gates/reviews/impl-review.md:150` (F10) records
  `NODE_ENV=production` in the Cloudflare dashboard as "a common reflex". In that state the OLD
  placement skipped `supabase` entirely — no download, no postinstall, so omit-dev was itself a
  complete fix for the original bug — while the NEW placement downloads 98 MB for a binary that
  container still cannot run. The gate would already be broken there for other reasons, so this is
  cost rather than a new outage, but it is a reversal of this change's own goal and it is written
  down nowhere.

- **Fix**: One sentence in the §7 entry naming the widening and the inversion. No code change.
- **Decision**: FIXED

### F3 — "131 optional entries" is the count from BEFORE this change

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:827, tests/unit/ci-gate-source.test.ts:284, change.md:63, plan.md:27
- **Detail**: Verified: `0bce7eb^` has 131 entries with `optional: true`; HEAD has **152**. This
  change added the missing 21. All four sites state 131 in the present tense, and three of them were
  written in phase 2 — after the move. The argument is unaffected (`@cloudflare/workerd-linux-64` is
  confirmed optional, alongside 5 workerd, 52 `@esbuild/*` and 24 `@img/sharp-*`, so the
  `--omit=optional` dead end holds), but this is a document whose authority rests on measured
  numbers, and the next person to re-measure gets 152 and stops trusting the entry.
- **Fix**: State 152 and say that 21 of them arrived with this change, which makes the number
  self-explaining rather than merely current.
- **Decision**: FIXED

### F4 — The one sentence naming the mechanism uses the wrong word

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/lessons.md:231
- **Detail**: "npm traktuje porażkę opcjonalnej zależności jako **nieśmiertelną**" — _immortal_
  where _non-fatal_ (`niefatalną`) was meant. It is the only sentence in the eighth lesson that
  states the mechanism, so it is the one place the word has to be right; as written it does not mean
  anything.
- **Fix**: `nieśmiertelną` → `niefatalną`.
- **Decision**: FIXED

### F5 — An orphaned comment separator in the workflow

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Pattern Consistency
- **Location**: .github/workflows/ci.yml:88
- **Detail**: A bare `#` sits directly under the guard's `run:`, left over from `doc-link-checking`
  moving a step out of this comment block. It reads as if the separator belongs to the step above.
- **Fix**: Delete the line.
- **Decision**: FIXED

### F6 — Local development got no equivalent of the Actions guard

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Safety & Quality
- **Location**: package.json (the six `db:*` scripts)
- **Detail**: The `db:*` scripts call bare `supabase` through `node_modules/.bin`. After this change
  a failed download on a developer machine produces a green `npm ci` — silently, per the measurement
  above — followed later by `supabase: not found` from `npm run db:start`, with nothing in between
  naming the cause. The failure moved from install time to use time. Actions got a guard for exactly
  this; local dev has no comparable place to put one.
- **Fix**: A line in the eighth lesson, whose own rule already asks "who uses it and will they
  notice it missing" and answers it only for Actions.
- **Decision**: FIXED

### F7 — A `devOptional` lockfile shape would fail the assertion for the wrong reason

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Safety & Quality
- **Location**: tests/unit/ci-gate-source.test.ts:309-312
- **Detail**: npm writes `"devOptional": true` instead of `"optional": true` when a package is
  reachable both ways. This repo already has five such entries, so the shape is live. If any
  devDependency ever pulls `supabase` transitively, `expect(lockEntry.optional).toBe(true)` goes red
  while the placement is still correct, and the message ("run `npm install` to regenerate it") sends
  the reader the wrong way. Not reachable today.
- **Fix**: `expect(lockEntry.optional ?? lockEntry.devOptional).toBe(true)`, if it is ever worth it.
- **Decision**: RECORDED — not reachable today; named here and in the code rather than fixed.

### F8 — The guard's failure message is thin read cold

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:87
- **Detail**: The failure prints `npx canceled due to missing packages and no YES option:
["supabase@2.117.0"]`. It does not say why the package is missing, and the version it names is
  npm's registry resolution rather than the pinned `2.98.2` — a reader could conclude the wrong
  version is pinned. The step NAME carries most of the meaning. Separately: during the registry
  outage this defends against, the message is an `ECONNREFUSED` instead, pointing at the network
  rather than at the dropped CLI. Both still fail closed.
- **Fix**: Wrap the command to emit a `::error::` naming the optional-dependency cause, if log
  quality matters more than the extra lines.
- **Decision**: RECORDED — not reachable today; named here and in the code rather than fixed.

## What was checked and found clean

- **The core claim, reproduced independently** in a scratch project: `npm ci` exits 1 for a
  devDependency with a failing postinstall and 0 for an optionalDependency, and the package is
  absent in both cases.
- **The consequence chain in Actions fails closed**: no `continue-on-error`, no `if:`, and
  `npx --no-install` was measured to exit 1 rather than fetch — including with a `supabase` shim
  ahead on `PATH`.
- **The two-layer pin is genuinely two layers**: mutation-tested in both directions — reverting the
  manifest leaves the lockfile assertion true and vice versa, so neither covers for the other.
- **All four "not doing" boundaries held**: no `--omit=optional`, no `--ignore-scripts`, no `.npmrc`
  anywhere, the dependency still present, the download untouched.
- **All six `db:*` scripts** present and still resolving the CLI.
- **The fonts §7 paragraph was corrected** and no longer claims this item is outstanding.
- **The eighth lesson generalises** beyond this package — its Context names four packages with
  install hooks, and its rule is about checking HOW a hook fails before what it does.
- **98 MB is exact**: `stat` on the installed binary reports 98,396,160 bytes.
