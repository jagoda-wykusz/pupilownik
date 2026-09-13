---
change_id: ledger-line-drift
title: Restore the freshness ledger to its schema and pin the shape
status: impl_reviewed
created: 2026-09-13
updated: 2026-09-13
archived_at: null
---

## Notes

Noticed while closing `doc-link-checking`: §8's first bullet had grown to one paragraph. The
framing was wrong, and measuring corrected it.

## What the measurement changed

The line is **1167 characters** carrying **11 semicolon-separated entries** across several dates,
including one that opens "earlier on 2026-09-11".

But `~/.claude/skills/10x-test-plan/references/test-plan-schema.md:323` defines the contract, and
it is a bare date:

    - Strategy (§1–§5) last reviewed: <YYYY-MM-DD>

So this is not a line that "grew and should be tidied". It is **drift from an existing schema**,
accreted one clause at a time by successive changes — several of them written in this session.

**Nothing unique is lost by restoring it.** All eleven entries were checked against the document:
seven are of the form "§5 gained X" / "§7 gained Y" and point at content that is there; the other
four were verified individually — §3 carries the full Phase 2b note and five phases marked
`complete`, §5 carries the "Correction, recorded because the mistake is instructive" paragraph about
the CI that did not exist, and §7 mentions Risk #4 and #5 three times. The parenthetical is a
duplicate index, not a record.

## Decision (2026-09-13, user)

**Restore the line AND pin its shape with a test.**

The argument for the pin is the accretion itself: the schema already said what this line should be,
and it was ignored eleven times by authors adding "just one clause". A comment in the file is the
same mechanism that already failed — the contract lives in a skill outside the repo, where nobody
editing the document sees it.

Accepted cost: the contract then exists in two places, so changing the schema means changing the
test.

## Not doing

- Not relocating the eleven entries. Measured: every one duplicates content already in §2, §3, §5
  or §7, so moving them would create a second index to maintain.
