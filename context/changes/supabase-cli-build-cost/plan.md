# Stop a GitHub Releases outage from killing the Cloudflare build

## Overview

Move `supabase` from `devDependencies` to `optionalDependencies` so a failed CLI download stops
failing `npm ci`, and make GitHub Actions fail loudly when the CLI it needs is absent.

## Current State Analysis

`node_modules/supabase/scripts/postinstall.js` downloads a 98,396,160 B Go binary from GitHub
Releases and ends in a bare `await main()` with no `catch`. Measured with an unroutable proxy:
`POSTINSTALL_EXIT=1`. A failing lifecycle script fails `npm ci`, and on Workers Builds `npm ci` runs
BEFORE the build command — so a GitHub outage or rate-limit kills the deploy before `ci:gate` can
report anything. The container has no Docker, so that binary can never be used there.

The dependency itself is deliberate and must survive: six `db:*` npm scripts use it, and
`.github/workflows/ci.yml:65-67` argues for the devDependency over `supabase/setup-cli@v3`
specifically to avoid "a second, independently drifting copy".

Measured in an isolated npm project, for `npm ci` specifically:

| placement              | `npm ci` with a failing postinstall | package present afterwards |
| ---------------------- | ----------------------------------- | -------------------------- |
| `devDependencies`      | exit 1                              | —                          |
| `optionalDependencies` | **exit 0**                          | **no**                     |

`--omit=optional` was ruled out by measurement: the lockfile has 131 optional entries including
`@cloudflare/workerd-linux-64`, which the build needs.

## Desired End State

A GitHub Releases failure during a Cloudflare build leaves `npm ci` green and lets `ci:gate` run.
The same failure in Actions stops the run with a message naming the cause, rather than skipping the
only tests that exercise RLS. Local `npm ci` is unchanged: the CLI installs and all six `db:*`
scripts work.

## What We're NOT Doing

- Not removing the dependency. The single-version property `ci.yml` defends is worth keeping, and
  six scripts depend on it being present after a plain `npm ci`.
- Not adding `--omit=optional` anywhere — it would strip the platform binaries the build needs.
- Not `--ignore-scripts`: `esbuild`, `sharp` and `workerd` carry install hooks too.
- Not eliminating the 98 MB download. Explicitly out of scope per the decision; it is waste, not a
  hazard, once the failure mode is gone.

## Phase 1: Make the dependency optional and guard its absence

### Changes Required

#### 1. The dependency placement

**File**: `package.json` (and `package-lock.json` as a consequence)

**Intent**: Move the `supabase` entry from `devDependencies` to `optionalDependencies`, keeping the
same version range. The lockfile must be regenerated so the entry carries `"optional": true` —
that flag, not the manifest section, is what npm acts on during `npm ci`.

**Contract**: `optionalDependencies: { "supabase": "^2.23.4" }`, and
`package-lock.json` → `packages["node_modules/supabase"].optional === true`. Regenerate with a plain
`npm install` (no flags) and verify the binary is still present afterwards.

#### 2. Actions must notice a missing CLI

**File**: `.github/workflows/ci.yml`

**Intent**: After `npm ci` and before `npx supabase start`, assert the CLI actually installed. With
the dependency optional, a failed download now yields a green `npm ci` and no package — and `npx`
would quietly fetch a copy from the registry instead of failing, which would let the run continue
with an unpinned version or skip the only tests that cover RLS.

**Contract**: A step running `npx --no-install supabase --version`. `--no-install` is the
load-bearing flag: it makes npx fail rather than fetch. The step needs a comment explaining that
this exists precisely because the dependency is optional.

#### 3. Pin the placement

**File**: `tests/unit/ci-gate-source.test.ts`

**Intent**: The placement is a one-word edit away from reverting, and reverting it restores a
silent deploy-blocking dependency. Pin it, along with the Actions guard step.

**Contract**: Assert `supabase` appears in `optionalDependencies` and NOT in `devDependencies`, and
that the workflow contains the `--no-install` presence check. Follow this file's anchoring
discipline — comments must not be able to satisfy the assertions.

### Success Criteria

#### Automated Verification

- `npm ci` completes and `node_modules/supabase/bin/` still holds the binary
- `package-lock.json` marks the supabase entry `"optional": true`
- The new assertions pass, and each fails when its target is reverted — every mutation, not one
- All six `db:*` scripts still resolve the CLI: `npx --no-install supabase --version` exits 0
- Full gate passes: `npm run ci:gate`

#### Manual Verification

- Nothing to check in a browser

---

## Phase 2: Record it

### Changes Required

#### 1. The records

**Files**: `context/foundation/test-plan.md`, `context/foundation/lessons.md` (only if it earns one)

**Intent**: §7 gains the third build-time third-party entry, closing the list the fonts change
opened. The candidate lesson: an install-time dependency fails BEFORE any gate can speak, so it is
not covered by anything in `ci:gate` — a category, not a package.

**Contract**: A §7 entry with the measured exit codes and the `--omit=optional` dead end, so the
next person does not re-derive it. Update the fonts entry's "not tested, deliberately" paragraph,
which names this item as outstanding.

### Success Criteria

#### Automated Verification

- Full gate passes: `npm run ci:gate`

#### Manual Verification

- §7 reads correctly to someone who was not part of this session

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Make the dependency optional and guard its absence

#### Automated

- [x] 1.1 `npm ci` completes and the CLI binary is present — 0bce7eb
- [x] 1.2 The lockfile marks the supabase entry `"optional": true` — 0bce7eb
- [x] 1.3 The new assertions pass — 0bce7eb
- [x] 1.4 Every new assertion fails when its target is reverted — 0bce7eb
- [x] 1.5 `npx --no-install supabase --version` exits 0 — 0bce7eb
- [x] 1.6 Full gate passes: `npm run ci:gate` — 0bce7eb

### Phase 2: Record it

#### Automated

- [x] 2.1 Full gate passes: `npm run ci:gate`

#### Manual

- [x] 2.2 §7 reads correctly to someone who was not part of this session
