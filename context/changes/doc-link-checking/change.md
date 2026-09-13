---
change_id: doc-link-checking
title: Fail the gate when a document points at a file that no longer exists
status: implemented
created: 2026-09-13
updated: 2026-09-13
archived_at: null
---

## Notes

Found while closing `supabase-cli-build-cost`: `test-plan.md` carried five references to
`context/changes/<id>/` folders that had been archived, so every one of them was dead. Archiving
a change silently breaks every reference to it, and that will recur on every future archive.

## What the measurement changed about the shape

Scanned 118 files (docs, `src/`, `tests/`, `scripts/`, workflows, hooks — excluding
`context/archive/`, which is immutable and legitimately describes the past). 439 path references,
8 unique dead, of which **only 2 are genuine**:

- `AGENTS.md:34` — "Shared types in `src/types.ts`". No such file. This is the document agents read <!-- link-check:ignore -->
  first.
- `context/foundation/test-plan.md:238` — "Only `tests/integration/` is genuinely non-blocking". <!-- link-check:ignore -->
  No such directory: `integration` is a vitest PROJECT whose `include` is `tests/**/*.test.ts`.
  Written by this session yesterday, in `warnings-block-publication`.

The other six were false positives of the probe's own pattern: `@supabase/ssr` and two siblings
(npm scope names, not paths), `supabase/setup-cli@v3` (a GitHub Action), a
`YYYYMMDDHHmmss_short_description.sql` template placeholder, and a directory whose name contains a
space.

**So the hard part is not finding dead links — it is not crying wolf.** At a 75% false-positive
rate a gate step gets ignored or, worse, blocks on a template placeholder. The exclusions are the
design.

## Decision (2026-09-13, user)

**File existence only; line numbers are not verified.** A `foo.ts:42` whose line has since moved
will pass. The alternative catches only references pointing past end-of-file — the rarest case —
while firing on every substantial edit to a cited file. A gate that never lies is a gate people
read.
