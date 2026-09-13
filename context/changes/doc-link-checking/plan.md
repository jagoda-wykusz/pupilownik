# Fail the gate when a document points at a file that no longer exists

## Overview

Add `scripts/check-doc-links.mjs` to the publish gate. It reads the repo's prose and comments,
extracts repo-relative paths, and exits non-zero when one does not exist.

## Current State Analysis

Nothing checks that a cited path is real. Measured across 118 files: 439 path references, 8 unique
dead, **2 genuine** (`AGENTS.md:34` → `src/types.ts`; `test-plan.md:238` → `tests/integration/`). <!-- link-check:ignore -->
Five more were repaired by hand an hour earlier — all five were `context/changes/<id>/` folders
broken by archiving, which is the recurring mechanism this change exists for.

The six non-genuine hits define the work: `@supabase/ssr` (npm scope, not a path),
`supabase/setup-cli@v3` (a GitHub Action), `YYYYMMDDHHmmss_short_description.sql` (a deliberate
template placeholder), and a directory whose name contains a space. A naive checker is ~75% noise.

## Desired End State

`npm run ci:gate` fails when any tracked document cites a path that does not exist. The step is
green today after the two genuine findings are fixed, and it stays quiet — no exclusion is added
without a comment saying which real string forced it.

## What We're NOT Doing

- Not verifying line numbers. Decided: a moved line is the common case and cannot be caught, while
  the rare past-end-of-file case is not worth the false alarms.
- Not checking URLs. That would make the gate depend on the network, which is the failure class the
  last two changes just removed.
- Not scanning `context/archive/**` as a SOURCE. Archived documents are immutable and describe the
  state at their time; a path that has since moved is not an error there. They remain valid
  TARGETS.
- Not auto-fixing. A dead link needs a human decision about what the sentence now means.

## Phase 1: The checker, and the two links it already found

### Changes Required

#### 1. The script

**File**: `scripts/check-doc-links.mjs` (new)

**Intent**: Walk the tracked text files, extract repo-relative path references, report the ones that
do not exist. Mirror the shape of `scripts/check-client-bundle.mjs`: a long header explaining what
it can and cannot catch, exit 1 for findings, exit 2 for "the scan is not reading what it thinks it
is reading".

**Contract**: A path reference is a string starting with a known top-level directory
(`context/`, `src/`, `tests/`, `scripts/`, `docs/`, `supabase/`, `.github/`, `.husky/`). Each
exclusion carries a comment naming the real string that forced it:

- preceded by `@` → an npm scope (`@supabase/ssr`)
- containing `@` after the first segment → a GitHub Action ref (`supabase/setup-cli@v3`)
- containing a glob character → a pattern, not a path
- matching a placeholder shape (`YYYYMMDD`, `<...>`, `short_description`) → a template

**Positive control, non-negotiable**: the scan must assert it found a non-trivial number of LIVE
references before reporting clean. A pattern that matched nothing would otherwise print "clean" and
guard nothing — the failure shape `lessons.md` records. Exit 2 if the count is implausibly low.

#### 2. The two dead links

**Files**: `AGENTS.md`, `context/foundation/test-plan.md`

**Intent**: `AGENTS.md` claims shared types live in `src/types.ts`; find where they actually live and <!-- link-check:ignore -->
say that. `test-plan.md:238` calls `tests/integration/` a directory; it is a vitest project whose <!-- link-check:ignore -->
`include` is `tests/**/*.test.ts` — the sentence needs to name the project, not a path.

### Success Criteria

#### Automated Verification

- The script exits 0 against the repo once both links are fixed
- The script exits 1 when a dead link is planted in a document
- The script exits 2 when its extraction pattern is sabotaged to match nothing
- Each of the six known false positives is still NOT reported
- `npm run lint` and `npm run check` pass

#### Manual Verification

- The two rewritten sentences say something true

---

## Phase 2: Wire it into the gate and pin it

### Changes Required

#### 1. The gate step

**Files**: `package.json`, `.github/workflows/ci.yml`

**Intent**: Add `check:links` and put it in `ci:gate` and in Actions. Position it early — it needs
no build, so failing fast costs nothing.

**Contract**: `"check:links": "node scripts/check-doc-links.mjs"`, added to the `ci:gate` chain and
to the workflow as its own step invoked through the npm script.

#### 2. Pin it

**File**: `tests/unit/ci-gate-source.test.ts`

**Intent**: That file's own comment records that adding a step to `ci:gate` does NOT fail its
existing assertions — a new link in the chain is unguarded until someone writes it down. Write it
down.

**Contract**: Assert `check:links` is present in the gate and that `scripts/check-doc-links.mjs`
exists, following the file's anchoring discipline.

#### 3. The record

**File**: `context/foundation/test-plan.md`

**Intent**: §5 gains a gate row; §7 gains the entry explaining the false-positive taxonomy, so the
next person who wants to "simplify" the exclusions knows which real string each one is for.

### Success Criteria

#### Automated Verification

- `npm run ci:gate` passes with the new step in the chain
- The new pin assertions pass, and each fails when its target is removed — every mutation
- The gate fails when a dead link is planted

#### Manual Verification

- §7 reads correctly to someone who was not part of this session

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: The checker, and the two links it already found

#### Automated

- [x] 1.1 The script exits 0 against the repo
- [x] 1.2 The script exits 1 on a planted dead link
- [x] 1.3 The script exits 2 when its pattern is sabotaged
- [x] 1.4 None of the six known false positives is reported
- [x] 1.5 `npm run lint` and `npm run check` pass

#### Manual

- [x] 1.6 The two rewritten sentences say something true

### Phase 2: Wire it into the gate and pin it

#### Automated

- [ ] 2.1 `npm run ci:gate` passes with the new step
- [ ] 2.2 The new pin assertions pass
- [ ] 2.3 Every new assertion fails when its target is removed
- [ ] 2.4 The gate fails when a dead link is planted

#### Manual

- [ ] 2.5 §7 reads correctly to someone who was not part of this session
