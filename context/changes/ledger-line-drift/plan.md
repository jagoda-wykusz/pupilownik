# Restore the freshness ledger to its schema and pin the shape

## Overview

Cut §8's first bullet back to the bare date its schema specifies, and add an assertion so it cannot
accrete again.

## Current State Analysis

`context/foundation/test-plan.md` §8 opens with a 1167-character bullet holding 11
semicolon-separated entries across several dates. The schema at
`~/.claude/skills/10x-test-plan/references/test-plan-schema.md:323` specifies:

    - Strategy (§1–§5) last reviewed: <YYYY-MM-DD>

All three ledger bullets are meant to be dates. The other two still are:

| bullet                                  | characters |
| --------------------------------------- | ---------- |
| Strategy (§1–§5) last reviewed          | **1167**   |
| Stack versions last verified            | 41         |
| AI-native tool references last verified | 54         |

Verified before planning to remove anything: every one of the 11 entries duplicates content that
lives elsewhere in the same document. Seven say "§5 gained X" or "§7 gained Y". The four that point
outside §7 were each checked — §3 carries the Phase 2b note and five `complete` phases, §5 carries
the correction about the CI that did not exist, §7 mentions Risk #4 and #5 three times.

## Desired End State

§8's three bullets are three dates. A test fails if any of them grows a parenthetical changelog
again, and its message points at the schema rather than just complaining about length.

## What We're NOT Doing

- Not relocating the 11 entries. They are duplicates; moving them creates a second index.
- Not touching §7, §5, §3 or §2 — the content stays exactly where it already is.
- Not changing the schema. The schema is right; the document drifted from it.
- Not pinning the OTHER two ledger bullets' dates, only their shape. Dates move legitimately.

## Phase 1: Cut the line and pin the shape

### Changes Required

#### 1. The ledger

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the parenthetical with nothing. Keep the date, which is the bullet's whole job.
Add one short sentence under the three bullets saying what this section is and is not, so the next
author sees the contract without leaving the file — the schema lives in a skill they will not open.

**Contract**: `- Strategy (§1–§5) last reviewed: 2026-09-13`, no parenthetical. The explanatory
sentence must name §7 as where the substance goes, since that is where ten of the eleven entries
were pointing anyway.

#### 2. The pin

**File**: `tests/unit/test-plan-shape.test.ts` (new)

**Intent**: Assert each of the three ledger bullets is a date and nothing more. The accretion
happened eleven times against an existing written contract, so the guard has to be executable rather
than advisory.

**Contract**: For each of the three known bullet prefixes, assert the line matches
`/^- <prefix>: \d{4}-\d{2}-\d{2}$/`. Guard the guard: assert all three prefixes were actually found,
so a renamed heading cannot make the suite pass having checked nothing. The failure message must say
that the substance belongs in §7 — a bare "line too long" would invite someone to shorten the prose
rather than move it.

### Success Criteria

#### Automated Verification

- The ledger line is a bare date; §8 holds three bullets, each under 80 characters
- The new test passes
- It fails when a parenthetical is appended to any of the three bullets
- It fails when a bullet is renamed, rather than passing having found nothing
- `npm run ci:gate` passes

#### Manual Verification

- The explanatory sentence reads as a rule, not as an apology

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Cut the line and pin the shape

#### Automated

- [ ] 1.1 §8 holds three bullets, each a bare date under 80 characters
- [ ] 1.2 The new test passes
- [ ] 1.3 It fails when a parenthetical is appended
- [ ] 1.4 It fails when a bullet prefix is renamed
- [ ] 1.5 `npm run ci:gate` passes

#### Manual

- [ ] 1.6 The explanatory sentence reads as a rule
