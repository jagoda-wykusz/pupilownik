<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Vendor the build fonts

- **Plan**: context/changes/vendor-build-fonts/plan.md
- **Scope**: All 4 phases (22/22 Progress rows complete)
- **Date**: 2026-09-12
- **Verdict**: NEEDS ATTENTION → all 5 warnings and 2 of 4 observations FIXED before archive
- **Findings**: 0 critical, 5 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

The product half is correct and verified by measurement rather than by reading: the four vendored
files are byte-identical (md5) to the cache entries bearing the source hashes the plan names, the
`unicode-range` arrays are Google's declared arrays verbatim, the build reaches zero Google hosts,
and `ci:gate` is green. Every finding below is in the GUARDS and the PROSE, not in what ships.

## Findings

### F1 — Two assertion loops report nothing when their collection is empty

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/unit/font-assets.test.ts:116-125, :134-143
- **Detail**: Both `for (const rule of withUrl)` loops recompute `withUrl` with no floor, unlike the
  sibling at :111-114. Proven, not theorised: the phase-3 measurement against a zero-font build
  reported `3 failed | 2 passed`, and "kept unicode-range on every real face" was one of the two
  that PASSED — green against the exact failure the file exists to catch. The url() loop is the
  more serious of the two because nothing else covers it: if the `url(...)` extraction stops
  matching (a bundler emitting the chunk double-quoted escapes the CSS quotes), the count
  assertions still pass, the loop iterates zero times, and the file's headline claim — "point at
  files which actually shipped" — silently verifies nothing. `ci-gate-source.test.ts:80-92` floors
  every index for this reason and names it; `lessons.md` carries the rule. This file cites that
  lesson and then does not apply it to itself.
- **Fix**: Floor both collections before iterating, and harden the url() pattern so a non-matching
  rule fails rather than being skipped.
- **Decision**: FIXED

### F2 — `toBeGreaterThanOrEqual` cannot force the maintenance its comment promises

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/unit/font-assets.test.ts:36-39, :96, :114
- **Detail**: The comment says raising `EXPECTED_FONT_FILES` "when a family or subset is added is
  deliberate maintenance — it is the moment someone re-reads what the build now ships". With `>=`,
  nothing forces that. The concrete regression it lets through is this change's own headline
  result: if Astro's `DEFAULTS.styles` pulls the italic faces back in, the build emits 8 woff2, the
  test stays green, and the payload goes from 129,520 B back to 210,280 B. Phase 1's own criterion
  was "emits EXACTLY 4 woff2", and `font-source.test.ts:85` uses exact `toBe(4)` for the same kind
  of count.
- **Fix**: Use `toBe(EXPECTED_FONT_FILES)` with the current message as the too-few branch.
- **Decision**: FIXED

### F3 — "disjoint by construction" is false

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: astro.config.mjs:21-23 (claim), :32-34 and :52-54 (contradicting data)
- **Detail**: The comment rejects fontace's coverage because it "overlaps between the two subsets",
  then asserts "The declared ranges are disjoint by construction — that is the whole point of
  subsetting." Set intersection of the two arrays as committed: `U+0304`, `U+0308`, `U+0329`.
  Google's own declaration overlaps on those three combining marks. The DATA is right; the emphatic
  sentence justifying it is wrong, and the next person re-deriving the arrays will treat
  disjointness as an invariant to check against. `plan.md` carries the same overclaim.
- **Fix**: Say the declared ranges are coarse and near-disjoint, sharing three combining marks that
  upstream ships in both subsets.
- **Decision**: FIXED

### F4 — The config and the README send the next person to a directory with no such files

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: astro.config.mjs:18, :94; src/assets/fonts/README.md (Updating)
- **Detail**: The comment says the ranges were lifted from
  `node_modules/.astro/fonts/**/<Family>-*-data.json`. That directory holds four bare hashed
  `.woff2` and nothing else. The `-data.json` files live in the DEV cache,
  `.astro/fonts/google-<hash>/<hash>/google/`. This matters operationally rather than cosmetically:
  README's "Updating" section instructs whoever refreshes the fonts to go there for the
  `unicode-range` values, and they will find an empty-looking directory.
- **Fix**: Cite `.astro/fonts/google-*/*/google/<Family>-*-data.json` and note that the build cache
  (`node_modules/.astro/fonts/`) holds only binaries.
- **Decision**: FIXED

### F5 — §5 tells a reader the font guards cannot stop a deploy

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/test-plan.md, §5 gate table
- **Detail**: Both new rows carry `Enforced? = "with the suite"`. They are in `tests/unit/`, hence
  the `unit` project, hence `ci:gate`, hence the Cloudflare build command — they block publication
  on every deploy, exactly like the `unit + component` row that says so explicitly. §5 opens with
  "Read the 'Where' column literally", which makes this the precise misreading that section was
  rewritten to prevent: someone planning against the table concludes a fontless build cannot stop a
  deploy, inverting the point of this change. The pre-existing `secret-leak scan` and `env schema
shape` rows understate it the same way, so the fix is one convention rather than one row — and
  §5's own recorded lesson is that fixing a document in one place and believing it fixed is the
  same failure as writing it wrong.
- **Fix**: Give the two font rows the publish-blocking wording, and correct the two older rows in
  the same pass.
- **Decision**: FIXED

### F6 — The comment stripper's stated reason is wrong, and it misses trailing comments

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Safety & Quality
- **Location**: tests/unit/font-source.test.ts:30-38
- **Detail**: The claim "No string literal in this file contains `//`, so a naive line-comment strip
  is safe here" is true today but is not what actually protects the test — the pattern is anchored
  to line start, so an inline `//` inside a string was never at risk. The real gap is the other
  direction and goes unmentioned: a TRAILING comment is not stripped. A line like
  `provider: fontProviders.local(), // never fontProviders.google()` leaves `google` in `code` and
  turns the guard red on its own rationale — the exact failure class this stripper exists to
  prevent, surviving in the half it does not cover.
- **Fix**: State the real reason (line-start anchoring) and the real caveat (trailing comments are
  read as code).
- **Decision**: FIXED

### F7 — The block-comment regex could delete code

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Safety & Quality
- **Location**: tests/unit/font-source.test.ts:37
- **Detail**: The block-comment pattern has no string-literal awareness. A future glob string such
  as `"src/**/*.ts"` contains a `/**/` substring, which the pattern matches and deletes, silently
  mutating `code`. The stripping control floors only total length and `fonts:` surviving, so a
  deletion that happened to remove a Google mention would pass. Low likelihood, real mechanism.
- **Fix**: Note the limitation, or floor the stripping test on `fontProviders.local(` surviving.
- **Decision**: SKIPPED — the mechanism is real but unreachable in the current code; recorded here rather than fixed.

### F8 — The phase 2.4 deviation note is narrower than it reads

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Plan Adherence
- **Location**: context/changes/vendor-build-fonts/plan.md (Progress row 2.4)
- **Detail**: The note records that "the stale Google cache was DELETED rather than restored — 3.5
  MB of binaries and meta.json nothing references". True of `node_modules/.astro/fonts/`. Not true
  of `.astro/fonts/`, the DEV cache, which still holds 27 `.woff2` including 9 italic faces, a
  1,547,684 B `meta.json`, and four `-data.json` carrying live `fonts.gstatic.com` URLs. All
  gitignored, nothing shipped references it, so there is no product impact — but the claim is
  broader than what was done, and this is the same directory F4 should have pointed at.
- **Fix**: Narrow the note to the build cache.
- **Decision**: FIXED

### F9 — Two unanchored string matches in the artifact test

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Safety & Quality
- **Location**: tests/unit/font-assets.test.ts:66-73, :162
- **Detail**: `rule.includes(family)` searches the whole rule text including the `url()` path and
  `format()`, so a family name appearing in an asset path would satisfy it with no matching
  `font-family` declaration. Separately, `firstFamilyOf` splits on the first comma, so a family
  name containing a comma would yield a fragment — and the unanchored `includes` would then match
  on that fragment, a false green. Neither is reachable today: Astro emits the hashed, unquoted
  family first, verified against the live bundle.
- **Fix**: Match `font-family:` plus the family explicitly; note the comma assumption.
- **Decision**: SKIPPED — the mechanism is real but unreachable in the current code; recorded here rather than fixed.

## What was checked and found clean

- **Font bytes**: all four md5-identical to the cache entries bearing the source hashes named in the
  plan. "The exact bytes Google built, unmodified" is verified, not asserted.
- **unicode-range values**: parsed out of the config and compared element-by-element against the
  cached Google data — 19 and 17 entries, equal. Google's declared arrays verbatim, not fontace's
  30-range coverage.
- **Critical Implementation Details**: both honoured. Every variant declares `weight` and `style`,
  so `fontace` never fires.
- **`scripts/check-client-bundle.mjs` skipped deliberately**: refuted as a shortcut. That header
  carries no guard inventory, its two `ci:gate` statements remain true, and it already skips
  `.woff2` as binary. Adding a font row would have created a second inventory competing with §5 —
  the failure §5 itself documents.
- **`src/assets/fonts/README.md` as an unplanned addition**: justified. It carries the provenance,
  the unmodified-bytes claim, the Reserved Font Name analysis (a real OFL clause the plan's "copy
  verbatim" did not cover), and the operational half of the plan's requirement that the
  hand-maintained ranges record where they came from.
- **`ci-gate-source.test.ts` consistency**: `ci:gate` is unchanged; both new files land in the
  already-pinned `unit` project. No step added, no order changed.
- **"What We're NOT Doing"**: no item violated. `global.css` and `Layout.astro` untouched, no Google
  `<link>`, no subsetting, no build-cache adoption, no italic restoration, supabase postinstall
  recorded rather than fixed.
- **Success criteria**: re-verified independently — 4 files / 129,520 B, 11/11 guard assertions,
  zero Google provider occurrences, OFL files byte-identical to upstream, `ci:gate` exit 0.
