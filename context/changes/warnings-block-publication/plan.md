# Make a warning stop a deploy Implementation Plan

## Overview

Re-calibrate `no-console` so it fits server routes instead of fighting them, then make both
`eslint` and `astro check` exit non-zero on a warning — so a rule added at warning severity
actually contributes to the publish gate.

## Current State Analysis

`npm run lint` reports **12 warnings and exits 0**. All twelve are `console.error` in Astro
endpoints: `src/pages/api/auth/{signin,signup}.ts`, `api/periods.ts`, `api/periods/[id]/revoke.ts`,
`api/periods/[id]/slots/[slotId]/release.ts`, `api/periods/[id]/token.ts`, `api/pets.ts`, and
`src/pages/invite/claim.ts`. They are deliberate observability — one sits under the comment
"Never log inviteToken" — and the project has no logging library, so on Workers (observability
enabled in `wrangler.jsonc`) `console.error` is the log sink.

`eslint.config.js:23` sets `no-console: "warn"` in the base block, and `:73` already turns it off
for `scripts/**/*.mjs` with the rationale "A CLI script's output IS its interface." The same
argument applies to endpoints; nobody made it.

`astro check` runs with the default `minimumFailingSeverity: error`. Measured exit codes today:

| threshold         | exit                                                   |
| ----------------- | ------------------------------------------------------ |
| `error` (default) | 0                                                      |
| `warning`         | 0                                                      |
| `hint`            | 1 (five `ts(6387)` deprecations in `eslint.config.js`) |

So `warning` is free right now and `hint` is not.

## Desired End State

`npm run lint` and `npm run check` both exit non-zero on a single warning. The twelve existing
`console.error` calls stay exactly as they are, and are no longer reported. A `console.log` in any
file — endpoint included — fails the build.

## What We're NOT Doing

- Not deleting or rewriting any of the twelve `console.error` calls. They are the feature.
- Not widening the allowance to `src/lib/**` — it is imported by client islands.
- Not clearing the five `ts(6387)` hints, and therefore not raising the check threshold to `hint`.
- Not touching `.husky/pre-commit`, which calls `npm run check` and inherits the new threshold.

## Phase 1: Calibrate the rule and raise both thresholds

### Overview

One eslint block, two npm scripts.

### Changes Required

#### 1. The console rule for endpoints

**File**: `eslint.config.js`

**Intent**: Add a config block for `src/pages/**/*.ts` allowing `console.error` and `console.warn`
only, so deliberate server logging stops being a warning while a stray `console.log` still fails.
Mirror the shape and the comment style of the existing `scripts/**/*.mjs` block, and say why the
allowance is narrower than that one.

**Contract**: `"no-console": ["error", { "allow": ["error", "warn"] }]` scoped to
`files: ["src/pages/**/*.ts"]`. Severity `error`, not `warn` — after this change a warning fails
anyway, so leaving it at `warn` would be a distinction without a difference and would mislead.
The block must be ordered after `baseConfig` so it overrides `:23`.

#### 2. Both gates fail on a warning

**File**: `package.json`

**Intent**: `lint` gains `--max-warnings 0`; `check` gains `--minimumFailingSeverity warning`.

**Contract**: `"lint": "eslint . --max-warnings 0"` and
`"check": "astro check --minimumFailingSeverity warning"`. `lint:fix` keeps its current behaviour —
it is an authoring aid, not a gate. `ci:gate` needs no edit: it calls both by name.

### Success Criteria

#### Automated Verification

- `npm run lint` exits 0 and reports zero problems
- `npm run check` exits 0 with the threshold at `warning`
- A planted `console.log` in an endpoint fails `npm run lint`
- A planted `console.error` in a `.tsx` client component still fails `npm run lint`
- The twelve existing `console.error` calls are unchanged: `git diff --stat src/` is empty
- Full gate passes: `npm run ci:gate`

#### Manual Verification

- Nothing to check in a browser; this phase has no runtime effect

---

## Phase 2: Prove it bites, and record it

### Overview

Mutations, the gate-source guard, and the documents this makes stale.

### Changes Required

#### 1. Pin the flags in the gate guard

**File**: `tests/unit/ci-gate-source.test.ts`

**Intent**: The whole point of this change is that a threshold exists; a threshold nobody pins is
one edit from vanishing, and its absence would look exactly like a clean run. Pin both flags.

**Contract**: Assert `scripts.lint` carries `--max-warnings 0` and `scripts.check` carries
`--minimumFailingSeverity warning`. Follow this file's existing anchoring discipline — the
assertions must not be satisfiable by a comment mentioning the flag.

#### 2. The records

**Files**: `context/foundation/test-plan.md`

**Intent**: §5's gate table describes what stops a bad change; "lint" and "typecheck" now stop more
than they did. Record the closure of follow-up #3 and the reason it was a false choice.

**Contract**: A §7 entry naming the mis-calibration, the measured thresholds, and why `hint` was
not chosen. Update the §5 rows if their wording implies warnings are advisory.

### Success Criteria

#### Automated Verification

- The new guard assertions pass: `vitest run --project unit`
- Each new assertion fails when its flag is removed from `package.json` — run every mutation, not
  one representative
- Full gate passes: `npm run ci:gate`

#### Manual Verification

- §7 reads correctly to someone who was not part of this session

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Calibrate the rule and raise both thresholds

#### Automated

- [x] 1.1 `npm run lint` exits 0 with zero problems
- [x] 1.2 `npm run check` exits 0 at the `warning` threshold
- [x] 1.3 A planted `console.log` in an endpoint fails lint
- [x] 1.4 A planted `console.error` in a client component fails lint
- [x] 1.5 The twelve existing calls are unchanged
- [x] 1.6 Full gate passes: `npm run ci:gate`

### Phase 2: Prove it bites, and record it

#### Automated

- [ ] 2.1 The new guard assertions pass
- [ ] 2.2 Every new assertion fails when its flag is removed
- [ ] 2.3 Full gate passes: `npm run ci:gate`

#### Manual

- [ ] 2.4 §7 reads correctly to someone who was not part of this session
