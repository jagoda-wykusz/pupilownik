<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Make a warning stop a deploy

- **Plan**: context/changes/warnings-block-publication/plan.md
- **Scope**: All 2 phases (10/10 Progress rows complete)
- **Date**: 2026-09-13
- **Verdict**: NEEDS ATTENTION → both warnings and three of four observations FIXED before archive; F3 refuted
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

The change itself is right and was verified by measurement rather than by reading. `eslint
--print-config` returns `[2, {allow:["error","warn"]}]` for an endpoint, `[1,{}]` for `src/lib` and
for a client component, `[0,{}]` for `scripts/` — so the override lands exactly where intended and
nowhere else. `git diff 672a7c6..HEAD -- src/` is empty: all twelve `console.error` calls are
untouched, which was the whole point. Every finding below is in the GUARDS, not in the change.

## Findings

### F1 — The workflow assertions do not guard what their comment claims

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/unit/ci-gate-source.test.ts:161-176
- **Detail**: Found independently by both reviewers. The block's comment says a direct
  `eslint`/`astro check` call in the workflow "would silently lose the threshold" and that this
  assertion prevents it. It prevents exactly one spelling.

  The negatives require the command on the same line as `run:`. These all slip: `run: |` followed by
  `eslint .` on the next line (and `ci.yml` ALREADY uses `run: |` block scalars in three steps, so
  this is the natural shape, not a contrived one), `npx --yes eslint`, `./node_modules/.bin/eslint`,
  `pnpm eslint`, `yarn eslint`, a PATH-resolved bare `eslint`, and `npx astro   check` with two
  spaces. `npx?` matches "np" or "npx", which is not what the name suggests.

  The positives are worse, and they are the repo's own recurring lesson: `toContain("npm run lint")`
  against raw YAML — and YAML has comments. Replace `run: npm run lint` with `run: pnpm eslint .`,
  leave a comment saying "we used to use npm run lint", and **all four assertions pass**. The plan's
  stated bar was "must not be satisfiable by a comment mentioning the flag". It is met for
  package.json, which is JSON and has no comments, and not met for the workflow half.

  This is `lessons.md`'s "Asercja podciągiem trafia we własne uzasadnienie" appearing inside new
  code written the same day, in a file that cites that lesson.

- **Fix**: Anchor the positives to a real `run:` line (`/^\s*-?\s*run:\s*npm run lint\b/m`), and
  replace the negatives with a token match over the workflow with the `npm run …` lines stripped
  first, so any invocation form is caught rather than one spelling.
- **Decision**: FIXED

### F2 — `MAX_WARNINGS` accepts three strings that tolerate warnings

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/unit/ci-gate-source.test.ts:48
- **Detail**: The regex discriminates the VALUE correctly — measured against 13 spellings, it
  rejects `--max-warnings 10`, `00` and `-1` and accepts both separators. What it cannot see is that
  it is inspecting a string rather than an invocation. Measured:

  | script                                        | eslint exit             | regex            |
  | --------------------------------------------- | ----------------------- | ---------------- |
  | `eslint . --max-warnings 0`                   | 1                       | passes (correct) |
  | `eslint . --max-warnings 0 --max-warnings 10` | **0**                   | **passes**       |
  | `eslint . --max-warnings 0 \|\| true`         | 0 by construction       | **passes**       |
  | `eslint src/pages --max-warnings 0`           | scope silently narrowed | **passes**       |

  The last one matters beyond this change: §5's "drift in files no commit touched" row depends on
  the lint target being `.`, and nothing pins it.

- **Fix**: In the same `it`, add `not.toMatch(/\|\||;/)`, reject a second `--max-warnings`, and
  assert the target is still `.`.
- **Decision**: FIXED

### F3 — The `--quiet` bypass was claimed and is refuted

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Safety & Quality
- **Location**: N/A — recorded so it is not re-raised
- **Detail**: One reviewer reported that `eslint . --quiet --max-warnings 0` exits 0 because
  `--quiet` suppresses warn-severity rules, called it documented ESLint behaviour and ranked it the
  most plausible of three bypasses. Measured against this repo's ESLint with a planted client-side
  `console.error`: `--quiet --max-warnings 0` prints "ESLint found too many warnings (maximum: 0)"
  and **exits 1**. `--quiet` suppresses the DISPLAY; `--max-warnings` still counts. Not a hole here.
- **Fix**: None. Recorded as a refutation.
- **Decision**: RECORDED — refuted by measurement; kept so it is not raised again.

### F4 — A comment points the reader the wrong way

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Pattern Consistency
- **Location**: eslint.config.js:83
- **Detail**: "NARROWER THAN THE `scripts/` BLOCK BELOW" — `scriptsConfig` is defined at :65 and
  spread into the export at :154, both ABOVE `serverRouteConfig`. Trivial in isolation, but this
  file's convention is that its comments are navigable.
- **Fix**: "BELOW" → "ABOVE".
- **Decision**: FIXED

### F5 — An underscore-prefixed helper would inherit the endpoint exemption

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Architecture
- **Location**: eslint.config.js:78, :91
- **Detail**: Raised independently by both reviewers. The block comment asserts "under
  `output: "server"` every `.ts` under src/pages/ is an Astro ENDPOINT". True of this repo today —
  verified, all nine are endpoints and nothing outside `tests/` imports them — but not true of
  Astro: `_`-prefixed files are excluded from routing and are a normal place for helpers. Such a
  file would match `src/pages/**/*.ts`, inherit the console allowance, and could legitimately be
  imported by a client island — quietly defeating the "NOT extended to src/lib" boundary.
- **Fix**: Narrow the glob to exclude `_`-prefixed paths, or state the assumption in the comment.
- **Decision**: FIXED

### F6 — The rule pins the log level, not the payload

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Safety & Quality
- **Location**: eslint.config.js:77-103
- **Detail**: All twelve call sites were reviewed and are clean: every one logs a fixed string or
  `error.code, error.message` — never `error` whole, never `details`, never a body, token, key or
  email. That discipline is documented at the call sites, and it is load-bearing: `src/pages/api/periods.ts:60-78`
  records that RLS suppresses `details` for invoker-owned functions but a `postgres`-owned
  SECURITY DEFINER sees the full row, which is exactly the `claim_slots` path in
  `src/pages/invite/claim.ts:110`. Migrations were also checked — no `raise exception` interpolates
  a token or secret into its message. But `console.error(error)` or `console.error(await
request.text())` in a NEW endpoint passes lint cleanly, and Workers retains logs. Only prose
  guards the payload.
- **Fix**: One sentence in the config comment: the level is linted, the payload is not.
- **Decision**: FIXED

## What was checked and found clean

- **The override lands where intended**: `eslint --print-config` on representatives — endpoint
  `[2,{allow:["error","warn"]}]`, `src/lib/*.ts` and `src/components/ThemeToggle.tsx` `[1,{}]`,
  `src/pages/index.astro` `[1,{}]`, `scripts/*.mjs` `[0,{}]`.
- **Block ordering is inert where it looks risky**: `src/pages/**/*.ts` is disjoint from
  `**/*.astro` and `scripts/**/*.mjs`; the only other block whose glob covers it (`reactConfig`)
  sets no `no-console`.
- **The glob covers all twelve sites and over-covers nothing today**: no client island imports
  anything from `src/pages/`; the only importers are `tests/api/*.test.ts`.
- **"NOT doing" held**: `src/` has no diff across the whole change; no block grants console under
  `src/lib/**` (print-config confirms `[1,{}]` for all eleven files); `.husky/pre-commit` untouched
  and inherits the new threshold through the shared script.
- **`hint` correctly not adopted**: `npm run check` now reports 6 hints / 0 warnings / exit 0,
  independently confirming §7's five-to-six claim.
- **The package.json pins cannot be satisfied by a comment**: they read parsed JSON.
- **No new assertion is vacuous**: `toBeTruthy()` catches the deleted-script case that
  `not.toBe("")` would have passed, and both guards run before the two `toMatch`es.
- **Success criteria re-verified independently**: lint exit 0, check exit 0, guard 14/14, twelve
  `console.error` still present across eight files.
