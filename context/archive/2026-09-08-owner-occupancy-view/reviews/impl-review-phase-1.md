<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Owner Occupancy View — Phase 1

- **Plan**: `context/changes/owner-occupancy-view/plan.md`
- **Scope**: Phase 1 of 3 ("Names on the page")
- **Date**: 2026-09-08
- **Commit under review**: `106ea26`
- **Verdict**: NEEDS ATTENTION → all findings fixed in place the same day
- **Findings**: 0 critical, 6 warnings, 4 observations

## What passed cleanly

- **The digest boundary holds.** Verified exhaustively: the page carries two islands
  (`ThemeToggle`, `RegenerateLinkButton`) and neither receives `caretakers`, `claimedByDay`,
  `slots` or `period`. `Chip` renders without a `client:` directive, so its props are not
  serialized. `Layout.astro` has no `define:vars` and no inline script. `claim_digest` appears
  in the interface, the select string and comments — never after the frontmatter fence. The
  type-level guard (`CaretakerLabel` has no digest field) is doing the real work.
- **The grid is byte-identical.** The diff adds only lines after its closing `</ul>`.
- **`whitespace-pre-line` is absent** from the new markup, present only on the owner's own note.
- **Empty days render the grid alone** — no list, no border, no heading.
- **The `data-access.md` correction is accurate and replaces rather than deletes**, and contains
  no present-tense claim about the unshipped `release_slot` — the `lessons.md` trap was avoided.
- **Ordinal stability holds** against PostgREST's unordered rows: sort-then-build, `Array.sort`
  stable since ES2019, `Map` insertion order.
- **Pattern compliance is clean** — naming, export style, purity and comment density all match
  `period-format.ts` / `invite-view.ts`; the test file matches its siblings.

## Findings and dispositions

### F1 — The invisible-character range table was materially incomplete

- **Severity**: WARNING · **Dimension**: Safety & Quality · `src/lib/caretaker-name.ts:33-40`
- Six hand-written numeric ranges missed most of the invisible set. Verified empirically that
  all of these survived and returned non-null: Hangul fillers (U+3164, U+115F, U+1160, U+FFA0),
  soft hyphen (U+00AD), Arabic letter mark (U+061C), Mongolian vowel separator (U+180E),
  invisible operators (U+2061-2064), variation selectors (U+FE00-FE0F), combining grapheme
  joiner (U+034F), interlinear annotation (U+FFF9-FFFB), Braille blank (U+2800), and Unicode
  **tag characters** (U+E0000-E007F) — the last being a channel for smuggling arbitrary hidden
  ASCII onto the owner's screen. A soft-hyphenated "Ania" was also a _different Map key_ from
  "Ania", so it evaded the collision logic the module exists for.
- **Fixed**: replaced the table with `\p{Default_Ignorable_Code_Point}` plus explicit extras for
  U+FFF9-FFFB and U+2800. Verified the property covers all six original ranges and 14 of the 17
  survivors, and matches none of the whitespace the `\s` collapse relies on.

### F5 — No Unicode normalization, so one rendered name could be two keys

- **Severity**: WARNING · **Dimension**: Safety & Quality · `src/lib/caretaker-name.ts:82`
- `"e" + U+0301` and `U+00E9` both render as "é" but were distinct Map keys — two caretakers
  shown as one name with no ordinal, which the module's own tests call "the worst outcome".
- **Fixed**: `.normalize("NFC")`, applied _after_ stripping so a combining grapheme joiner
  cannot block composition.

### F6 — `localeCompare` on machine strings

- **Severity**: WARNING · **Dimension**: Pattern Consistency · `src/lib/caretaker-name.ts:147`
- No wrong ordering was demonstrated, but `localeCompare` with no locale resolves the host
  default and uses whatever ICU the Node build ships, applying variable weighting to exactly the
  punctuation ISO-8601 timestamps and uuids are made of. For an ordering the plan calls
  load-bearing, "stable until someone upgrades Node" is the wrong guarantee for zero benefit.
- **Fixed**: a `byCodePoint` comparator.

### F9 — `truncate` clipped the ordinal, defeating disambiguation

- **Severity**: WARNING · **Dimension**: Safety & Quality · `src/pages/periods/[id].astro:267-277`
- The ordinal span was a **child** of the `truncate` element and positioned after the label, so
  two caretakers who both typed an 80-character name rendered as two identical ellipsised rows
  with both ordinals clipped — the page showing two people as one, the single outcome the
  ordinal exists to prevent. `title` carried the label without the ordinal, so hovering did not
  recover it. Trivially reachable on purpose, since a caretaker picks their own name.
- **Fixed**: the ordinal is now a `shrink-0` sibling of the truncating element.

### F11 — Bidi reordering only half-solved

- **Severity**: WARNING · **Dimension**: Safety & Quality · `src/pages/periods/[id].astro:270-276`
- Stripping explicit overrides is necessary but not sufficient: strong-RTL characters still
  reorder surrounding neutrals, dragging the parenthesised ordinal to the visual left of the
  name it belongs to.
- **Fixed**: the label renders inside `<bdi>`, which isolates its direction.
- **Not fixed, accepted**: a caretaker can still type a literal `Ania (2)` or `bez imienia` and
  mimic the system's own rendering. The muted colour and the now-separated ordinal span are the
  only signals. Recorded rather than solved — the alternative is escaping or reformatting a
  person's actual name.

### F12 — `STORED_NAME_MAX` duplicated an existing constant

- **Severity**: WARNING · **Dimension**: Pattern Consistency · `src/lib/caretaker-name.ts:24`
- `MAX_CLAIMANT_NAME_LENGTH` already exists in `period-format.ts:110`, whose comment reads
  "Change one and you must change both" about the guard inside `claim_slots`. There were three.
- **Fixed**: deleted; the test imports from `period-format`.

### F13 — Four load-bearing behaviours had no test

- **Severity**: WARNING · **Dimension**: Success Criteria · `tests/unit/caretaker-name.test.ts`
- The 17 tests were genuine — none passed for the wrong reason — but the `id` tie-break was
  untested despite being the _common_ path (`claim_slots` writes several slots in one
  transaction with a single `now()`), as were a three-way collision, an empty stored name, a
  digest with a null `claimed_at`, and an over-length name.
- **Fixed**: seven tests added, 17 → 24.

### Observations, not fixed

- **F3** — stripping ZWJ and variation selectors degrades emoji sequences to component glyphs,
  and ZWNJ removal is orthographically destructive in Persian/Indic. Accepted as the right
  trade for a Polish-language product against an invisible-text channel; now recorded in the
  module's docstring rather than left implicit.
- **F8** — a caretaker who literally types `bez imienia` collides with the unusable-name
  fallback and both get ordinals. Arguably correct behaviour; left alone.
- **F10** — layout is safe: `truncate` works because the span is a flex item, and Zalgo ink is
  clipped by the span's own `overflow:hidden`.
- The `claimedByDay` entries carry an `id` the template never reads. Harmless; left in place for
  Phase 3, which will need it for the release control.

## Verification after fixes

`npm run lint` exit 0 (4 pre-existing `no-console` warnings) · `npx vitest run` 224 passed
(22 files) · `npm run build` exit 0. All unpiped.

## Note on the review itself

One agent claim was wrong and was caught before it reached the report: it reported "the commit
message says 17 tests; the file has 16". Both `grep -c` and vitest confirm 17, and the total
moved 200 → 217. The commit message was accurate.
