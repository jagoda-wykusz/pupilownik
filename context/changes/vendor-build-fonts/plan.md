# Vendor the build fonts Implementation Plan

## Overview

Replace `fontProviders.google()` with `fontProviders.local()` and commit four woff2 files, so that no
Google host appears in the build path. Drop the two italic Nunito files Astro downloads on its own
initiative. Add an artifact assertion so a build that produces no fonts fails instead of publishing.

## Current State Analysis

`astro.config.mjs:19-38` declares two Google-provided families. On a cold build — which is every
Cloudflare build, because the cache lives in gitignored `node_modules/.astro/fonts/` — this reaches
two hosts on two code paths with **opposite** failure modes, both measured in `research.md`:

- `fonts.gstatic.com` (the binaries) → `CachedFontFetcher` throws `AstroError` on the first failure,
  no retry, unguarded in `buildEnd`. **Exit 1, no deploy.** A 429 is as fatal as a partition.
- `fonts.googleapis.com` (the CSS metadata) → unifont is constructed with `throwOnError: false`, so a
  failure yields a warning and `{ fonts: [] }`. **Exit 0, zero `@font-face`, site publishes in system
  fonts.** Nothing in `ci:gate` notices.

The second is the one that motivates the change: it is invisible, and a warm cache masks it for at
most seven days (the metadata TTL) while the binaries cache forever.

Two further facts settle the design:

- **Astro never subsets or optimises anything.** `CachedFontFetcher.fetch` branches on
  `isAbsolute(url)` → `readFile`, and `vite-plugin-fonts.js:318-327` writes the buffer out unchanged.
  Vendoring does not acquire a font build step; it removes one.
- **`DEFAULTS.styles = ["normal","italic"]`** (`astro/dist/assets/fonts/constants.js:4`) adds italic
  that the config never requested. Measured: zero `<em>`, `<i>`, `font-style` or `italic` in all of
  `src/`. Two of the six shipped files, 80 760 B of 210 280 B, exist for nothing, and the current
  family-level config has no way to opt out.

## Desired End State

`npm run build` completes with both Google hosts unreachable and still emits four woff2. The rendered
pages are visually identical to today. `npm run ci:gate` fails if the build emits no font files.
`src/assets/fonts/` holds four committed woff2 plus the two upstream `OFL.txt` files.

Verified by: the blocked-host probe from Phase 2 exiting 0 with four files present, and by the new
assertion failing when pointed at a fontless build.

### Key Discoveries

- `astro/dist/assets/fonts/providers/local.js:44` — `unicodeRange: variant.unicodeRange`, a pure
  pass-through. `fontace` fires **only** for `weight`/`style`, only when one is `undefined`, only for
  `src[0]` (`local.js:37,52-59`). So `unicode-range` is hand-declared or absent — and absent means
  every page downloads both subsets.
- Measured with `fontace` against the built files: all six are **variable**. Nunito is
  `weight: "200 1000"`, Quicksand is `"300 700"`. The config's current `weights` all sit inside those
  ranges, so one variant per subset replaces four faces.
- `providers/local.d.ts:11-13` — local files must **not** live in `public/`; Astro's public-dir copy
  would duplicate them alongside the pipeline's own output. `src/assets/fonts/` is the documented home.
  (Note: `context/archive/2026-09-11-ci-quality-gates/follow-ups/review-fixes.md:32-42` proposes
  `public/` — that part of the follow-up is wrong.)
- `tests/unit/client-bundle.test.ts:22-30` already resolves `dist/client` and **fails rather than
  skips** when the artifact is missing, with the rationale this project keeps re-learning. The new
  assertion copies that shape.
- `src/lib/auth-messages.ts:16-19` records that `/auth` makes no third-party requests, "precisely so"
  that the fonts are self-hosted. Vendoring keeps that sentence true; it is the reason a Google-hosted
  `<link>` is not on the table regardless of build reliability.
- Nothing reads the CSS variables by family name: `src/styles/global.css:178-179` aliases them to
  `--font-heading`/`--font-body`, and all ~28 call sites use the role aliases. The variable's internal
  hash changes; nothing observes it.

## What We're NOT Doing

- Not touching `src/styles/global.css`, `src/layouts/Layout.astro`, or any of the ~28 call sites. The
  `<Font>` component and both `cssVariable` names stay exactly as they are.
- Not reverting to a Google-hosted `<link>`. That would falsify `auth-messages.ts:16-19`.
- Not adopting a Cloudflare build cache for `node_modules/.astro`. Its one-week metadata TTL degrades
  toward the _silent_ failure, which is the wrong direction.
- Not subsetting, re-encoding or otherwise touching the font bytes. They ship exactly as Google built
  them.
- Not addressing `supabase`'s postinstall download of a Go binary the Cloudflare container cannot run
  (no Docker). Separate change; recorded in `research.md` so it is not lost.
- Not adding italic back "just in case". If an `<em>` ever appears, the browser synthesises oblique
  from the variable font and restoring the real file is a two-line config change.

## Implementation Approach

Vendor first and prove it second. Phase 1 makes the swap and checks the build still looks right;
Phase 2 is the phase that earns the change, by re-running the measurement that motivated it and
showing the build no longer cares whether Google exists. Phase 3 adds the artifact assertion that
would have caught the silent failure. Phase 4 closes the licensing and documentation debt.

## Critical Implementation Details

**Lift the `unicode-range` values before the cache expires.** They exist in exactly two places: the
Google CSS (gone once the provider changes) and `node_modules/.astro/fonts/**/*-data.json`, which
carries a **seven-day TTL**. Copy them into the config in Phase 1, from the cache as it stands now.
Take the values the CSS declares — _not_ the coverage `fontace` reports from the file, which is
finer-grained (30 ranges vs 19) and overlapping between subsets. The declared ranges are disjoint by
construction, which is the whole reason the split is useful.

**Declare `weight` and `style` explicitly on every variant.** Omitting either triggers a
`readFileSync` + `fontace` parse per build (`local.js:52-59`), and what it infers for a variable font
is the full axis range — which is what we want anyway, so state it and skip the work.

## Phase 1: Vendor the files and switch the provider

### Overview

Commit four woff2 and rewrite the `fonts:` block to use the local provider.

### Changes Required

#### 1. The font binaries

**Files**: `src/assets/fonts/{quicksand,nunito}-{latin,latin-ext}.woff2` (4 new)

**Intent**: Commit the exact bytes Google built, taken from the current `dist/client/_astro/fonts/`
(content-hashed names) and renamed to something a human can read. The two italic Nunito files are
deliberately not copied.

**Contract**: Source mapping, established with `fontace` and byte sizes:

| Committed name              | Source hash        | Family / axis              | Subset    | Bytes  |
| --------------------------- | ------------------ | -------------------------- | --------- | ------ |
| `nunito-latin.woff2`        | `8b5e0071147613a6` | Nunito `200 1000` normal   | latin     | 39 152 |
| `nunito-latin-ext.woff2`    | `9b76b581b5365374` | Nunito `200 1000` normal   | latin-ext | 35 464 |
| `quicksand-latin.woff2`     | `d95047227dd0a96f` | Quicksand `300 700` normal | latin     | 28 336 |
| `quicksand-latin-ext.woff2` | `88391e50e8f58c5c` | Quicksand `300 700` normal | latin-ext | 26 568 |

`.gitattributes:5-13` already declares `*.woff2 binary`, so no new git config is needed.

#### 2. The font configuration

**File**: `astro.config.mjs`

**Intent**: Swap both families to `fontProviders.local()` with an explicit `variants` array, one
variant per subset. Keep `name`, `cssVariable`, `display` and `fallbacks` byte-identical — they are
what the rest of the app consumes. Rewrite the block comment: the privacy sentence it carries is still
true and still load-bearing, but "downloaded at build time" stops being true.

**Contract**: `weights`/`subsets` become dead config for a local family (`local.js:35-64` reads only
`options.variants`) and must be removed rather than left to mislead. Each variant declares `src`,
`weight` (the axis range, quoted), `style: "normal"` and `unicodeRange` copied from the cached
`-data.json`. The comment must record where the ranges came from and that they are hand-maintained.

### Success Criteria

#### Automated Verification

- Type checking passes: `npm run check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- The build emits exactly 4 woff2: `find dist/client -name "*.woff2" | wc -l`
- Total font payload is ~129 KB, down from ~210 KB
- The render sweep still passes: `npm run test:render`

#### Manual Verification

- Headings and body text look identical to before the change in a local dev session
- Polish diacritics (ą ę ł ń ó ś ź ż) render in the webfont, not a fallback
- DevTools Network shows two woff2 requested on a normal page, not four

---

## Phase 2: Prove the build no longer needs Google

### Overview

Re-run the measurement that motivated the change. This phase produces no product code; its output is
evidence.

### Changes Required

#### 1. The blocked-host probe

**File**: scratchpad only — not committed

**Intent**: Run `npm run build` with a `--import` preload that makes every `fetch` to
`fonts.googleapis.com` and `fonts.gstatic.com` throw, against a **cold** cache
(`node_modules/.astro/fonts` moved aside). Before this change the same probe produced exit 1 on the
binary host and a fontless exit 0 on the metadata host; it must now produce neither.

**Contract**: Pass condition is all three together — exit 0, **zero** blocked requests recorded, and
four woff2 in `dist/client`. Zero blocked requests is the load-bearing part: a build that succeeds
_having made and survived_ a Google request has not removed the dependency. Restore the cache
afterwards and rebuild clean.

#### 2. A source-level guard against reintroduction

**File**: `tests/unit/ci-gate-source.test.ts` (extend) or a sibling

**Intent**: Pin that `astro.config.mjs` names no Google font provider, so the dependency cannot come
back unnoticed via a config edit.

**Contract**: Assert on the config source that `fontProviders.google` does not appear and
`fontProviders.local` does. Follow the anchoring discipline this file already carries — the project has
twice shipped a substring assertion that matched its own rationale, so the pattern must not be
satisfiable by a comment mentioning the old provider.

### Success Criteria

#### Automated Verification

- Cold-cache build with both hosts blocked: exit 0, **0** blocked requests, 4 woff2 emitted
- The new source guard passes: `vitest run --project unit`
- The guard fails when mutated — restore `fontProviders.google()` in a scratch copy and confirm red
- Cache restored and a clean build still emits 4 woff2

#### Manual Verification

- The probe output is recorded in the phase commit message, so the claim has a measurement attached

---

## Phase 3: Fail the build when it produces no fonts

### Overview

Add the artifact assertion. After Phase 1 the silent path is gone — a bad local path throws in
`readFile` — so this guards the _class_, not a live hole: a build that succeeds at producing the wrong
thing.

### Changes Required

#### 1. The assertion

**File**: `tests/unit/font-assets.test.ts` (new)

**Intent**: Assert that a build on disk emitted the expected font files. Lives in the `unit` project,
which `ci:gate` runs after `build`, so it sees a real artifact.

**Contract**: Three assertions, and the third is what makes the first two mean anything:

1. `dist/client` exists — **fail, never skip**, mirroring `tests/unit/client-bundle.test.ts:29-30`.
2. At least 4 woff2 under `dist/client`, each above a size floor (a truncated or zero-byte file is a
   different failure that would otherwise pass a count check).
3. A stated floor per family — both `--font-quicksand` and `--font-nunito` resolve to a family that has
   at least one `@font-face` in the emitted CSS. Under `output: "server"` that CSS is in
   `dist/server`, not `dist/client`; this was measured the hard way and the test must carry a comment
   saying so, or the next reader will grep the wrong directory.

### Success Criteria

#### Automated Verification

- The new test passes against a good build: `vitest run --project unit`
- The new test **fails** against a fontless build — produced by blocking both hosts on a cold cache,
  which is the exact scenario it exists for
- Full gate passes: `npm run ci:gate`

#### Manual Verification

- The failure message names what was missing and where to look, not just a failed count

---

## Phase 4: Licensing and documentation

### Overview

Close the OFL obligation and correct the records this change makes stale.

### Changes Required

#### 1. Licence files

**Files**: `src/assets/fonts/OFL-Quicksand.txt`, `src/assets/fonts/OFL-Nunito.txt` (new)

**Intent**: Satisfy the OFL 1.1 redistribution clause. Framed honestly in the commit: we already
redistribute these binaries — Cloudflare serves them from our origin to every visitor — so this is an
existing unmet obligation becoming visible, not a cost of vendoring.

**Contract**: Copy the text and the copyright lines verbatim from upstream `google/fonts`
(`ofl/quicksand/OFL.txt`, `ofl/nunito/OFL.txt`). One file per family; the copyright holders differ.
Do **not** take the version or the holder names from `research.md` — it flags them as unverified.

#### 2. Correct the records

**Files**: `context/foundation/test-plan.md`, `scripts/check-client-bundle.mjs` (header)

**Intent**: Record the two-paths finding, because "Google Fonts is a build dependency" was too coarse
to plan against and the next reader deserves the sharper version. Note the new font assertion in the
gate inventory.

**Contract**: A §7 entry stating both failure modes, which one F9 described, and which one actually
motivated the change. Update the `ci:gate` step inventory in §5 if the step list changed.

#### 3. A lesson, if it earns one

**File**: `context/foundation/lessons.md`

**Intent**: The candidate rule: _a dependency's failure mode is a property of its call path, not of the
dependency_ — the same vendor, the same subsystem, two paths, one loud and one silent. Add it only if
it generalises beyond fonts; otherwise leave the §7 entry to carry it.

### Success Criteria

#### Automated Verification

- Full gate passes: `npm run ci:gate`
- `npm run check:secrets` still reports clean

#### Manual Verification

- The OFL files match upstream byte-for-byte, with the correct per-family copyright lines
- §7 reads correctly to someone who was not part of this session

---

## Testing Strategy

### Unit Tests

- `tests/unit/font-assets.test.ts` — the build emitted fonts, they are non-trivial in size, and both
  families have a face
- `tests/unit/ci-gate-source.test.ts` — no Google provider in the config

### Manual Testing Steps

1. `npm run dev`, open `/`, `/auth/signin` and `/periods` — typography unchanged
2. Confirm Polish diacritics render in the webfont (check a heading with ą/ę/ł)
3. DevTools Network: two woff2 on a normal page, both from our origin, none from `gstatic.com`
4. Throttle to Slow 3G and confirm `display: swap` still behaves as before

## Performance Considerations

Shipped font payload drops from 210 280 B to 129 520 B per cold visitor — a 38% cut, entirely from
removing italic faces nothing requests. Build time drops by however long seven Google round-trips take
on a cold container. Repository grows by ~129 KB against a 482 KB `package-lock.json` already tracked.

## Migration Notes

None. No data, no schema, no runtime behaviour change. Rollback is `git revert` of the config commit;
the vendored files are inert once the config stops pointing at them.

## References

- Research: `context/changes/vendor-build-fonts/research.md`
- Decisions: `context/changes/vendor-build-fonts/change.md` § Decyzje
- Upstream observation: `context/archive/2026-09-11-ci-quality-gates/reviews/impl-review.md:141-148` (F9)
- The self-hosting decision: `context/archive/2026-09-05-ui-design-system/plan-brief.md:37`
- Assertion pattern to follow: `tests/unit/client-bundle.test.ts:22-30`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Vendor the files and switch the provider

#### Automated

- [ ] 1.1 Type checking passes: `npm run check`
- [ ] 1.2 Linting passes: `npm run lint`
- [ ] 1.3 Build succeeds: `npm run build`
- [ ] 1.4 The build emits exactly 4 woff2
- [ ] 1.5 Total font payload is ~129 KB, down from ~210 KB
- [ ] 1.6 The render sweep still passes: `npm run test:render`

#### Manual

- [ ] 1.7 Headings and body text look identical to before the change
- [ ] 1.8 Polish diacritics render in the webfont, not a fallback
- [ ] 1.9 DevTools Network shows two woff2 on a normal page

### Phase 2: Prove the build no longer needs Google

#### Automated

- [ ] 2.1 Cold-cache build with both hosts blocked: exit 0, 0 blocked requests, 4 woff2
- [ ] 2.2 The new source guard passes
- [ ] 2.3 The guard fails when mutated back to `fontProviders.google()`
- [ ] 2.4 Cache restored and a clean build still emits 4 woff2

#### Manual

- [ ] 2.5 The probe output is recorded in the phase commit message

### Phase 3: Fail the build when it produces no fonts

#### Automated

- [ ] 3.1 The new test passes against a good build
- [ ] 3.2 The new test fails against a fontless build
- [ ] 3.3 Full gate passes: `npm run ci:gate`

#### Manual

- [ ] 3.4 The failure message names what was missing and where to look

### Phase 4: Licensing and documentation

#### Automated

- [ ] 4.1 Full gate passes: `npm run ci:gate`
- [ ] 4.2 `npm run check:secrets` still reports clean

#### Manual

- [ ] 4.3 The OFL files match upstream with the correct per-family copyright lines
- [ ] 4.4 §7 reads correctly to someone who was not part of this session
