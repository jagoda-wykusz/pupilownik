---
date: 2026-09-12T17:42:43Z
researcher: jagoda.wykusz
git_commit: 5884d8ebd12f593185cfda546bdc1abe93f792ea
branch: master
repository: 10xdev
topic: "Take Google out of the build path so a font request cannot stop a deploy"
tags: [research, codebase, fonts, build, ci, cloudflare, astro]
status: complete
last_updated: 2026-09-12
last_updated_by: jagoda.wykusz
---

# Research: Take Google out of the build path

**Date**: 2026-09-12T17:42:43Z
**Researcher**: jagoda.wykusz
**Git Commit**: 5884d8ebd12f593185cfda546bdc1abe93f792ea
**Branch**: master
**Repository**: 10xdev

## Research Question

`astro build` downloads six woff2 from Google on every cold build. F9 of the CI-gate review
(`context/archive/2026-09-11-ci-quality-gates/reviews/impl-review.md:141-148`) says the fetcher
"throws `AstroError` with no fallback", so "a transient 429 from Google is now a failed deploy rather
than a slow one". Is that true, and if so what is the cheapest way to remove the dependency?

## Summary

**F9 is correct, and it is also incomplete in a way that matters more than the part it got right.**

There are **two** Google hosts in the build path, on **two different code paths**, with **opposite**
failure modes. Both were measured in this session, not read:

| Blocked host                                  | What it carries    | Exit code | Result                                            |
| --------------------------------------------- | ------------------ | --------- | ------------------------------------------------- |
| `fonts.gstatic.com`                           | the woff2 binaries | **1**     | `CannotFetchFontFile`, build dead, no deploy      |
| `fonts.googleapis.com` (+ `fonts.google.com`) | the CSS metadata   | **0**     | zero `@font-face`, site publishes in system fonts |

F9 describes the first row. The second row is the one that should decide this change: it is
**undetectable** — green build, green gate, green deploy, and a site whose typography silently
reverted. Nothing in `npm run ci:gate` looks at whether the build produced any font files.

Measured, cold cache, only `fonts.gstatic.com` blocked:

```
BUILD_EXIT = 1
zablokowanych zadan: 1        <- pierwsza porazka konczy build, zero ponowien
[CannotFetchFontFile] [astro:fonts] An error occurred while fetching the font file from
  https://fonts.gstatic.com/s/quicksand/v37/6xKtdSZaM9iE8KbpRA_hJVQNYuDyP7bh.woff2
woff2 w dist/client: 0
```

Measured, cold cache, **both** hosts blocked:

```
BUILD_EXIT = 0
zablokowanych zadan: 24       <- unifont ponawia CSS-a 3x na rodzine
@font-face w bundlu serwerowym: 0
--font-quicksand: Quicksand-dfd0c0a8d0bb3235, ui-rounded, system-ui, sans-serif
woff2 w dist/client: 0
```

Note the second run never reaches the hard throw: with no CSS metadata there are no font URLs to
fetch, so the binary path is never entered. **The 24 requests and 3 retries are unifont retrying the
CSS call, not Astro retrying the binaries.** The binary path retries zero times.

A third measured fact, unrelated to the outage question but decided by the same change: **38% of the
shipped font payload is downloaded and served for nothing.** `astro.config.mjs` never mentions
`styles`, but `DEFAULTS.styles = ["normal", "italic"]` (`astro/dist/assets/fonts/constants.js:4`) adds
italic anyway. Of the four unique Nunito URLs in the cache, two are italic:

```
italic  XRXX3I6Li01BKofIMNaDRs7nczIH.woff2      41 744 B
italic  XRXX3I6Li01BKofIMNaNRs7nczIHNHI.woff2   39 016 B
normal  XRXV3I6Li01BKofINeaBTMnFcQ.woff2        39 152 B
normal  XRXV3I6Li01BKofIO-aBTMnFcQIG.woff2      35 464 B
```

80 760 B of 210 280 B. The current config has **no way to express "no italic"** — family-level config
has `weights` and `subsets` but no per-style opt-out. A vendored config enumerates variants
explicitly, so dropping italic is simply not listing it: 210 KB to 129 KB.

## Detailed Findings

### The hard-failure path — binaries

`astro/dist/assets/fonts/infra/cached-font-fetcher.js:25-46` is the whole of it — one `try`, one
`throw`, no retry, no fallback branch:

```js
async fetch({ id, url, init }) {
  return await this.#cache(this.#storage, id, async () => {
    try {
      if (isAbsolute(url)) { return await this.#readFile(url); }
      const response = await this.#fetch(url, init ?? void 0);
      if (!response.ok) { throw new Error(`Response was not successful, received status code ${response.status}`); }
      return Buffer.from(await response.arrayBuffer());
    } catch (cause) {
      throw new AstroError({ ...AstroErrorData.CannotFetchFontFile, message: AstroErrorData.CannotFetchFontFile.message(url) }, { cause });
    }
  });
}
```

Note `!response.ok` is converted to a throw, so **a 429 is exactly as fatal as a network partition** —
F9's scenario verbatim. The build caller (`vite-plugin-fonts.js:318-327`, inside `Promise.all` in
`buildEnd`) is unguarded, so it propagates and fails the build. The **dev-server** caller
(`core/font-file-middleware.js:38-54`) _does_ catch it, logs "Cannot download font file" and serves a
500 for that one file — which is why this never shows up locally.

### The silent-failure path — CSS metadata

A different stack entirely: the Google provider is unifont's, and Astro constructs unifont with
`throwOnError: false` — `astro/dist/assets/fonts/infra/unifont-font-resolver.js:56-59`, comment and
all:

```js
unifont: await createUnifont(this.extractUnifontProviders({ families, hasher, root }), {
  storage,
  // TODO: consider enabling, would require new astro errors
  throwOnError: false
}),
```

`unifont/dist/index.mjs:881-894` then `console.error`s and returns `{ fonts: [] }`. Astro reaches
`core/compute-font-families-assets.js:29-41`, warns _"No data found for font family Quicksand. Review
your configuration"_, and `continue`s. Two network calls live here: `fonts.google.com/metadata/fonts`
at provider init (`unifont/dist/index.mjs:488`) and `fonts.googleapis.com/css2` per family
(`:529-531`).

The emitted CSS variable survives with its fallback chain intact — `--font-quicksand:
Quicksand-<hash>, ui-rounded, system-ui, sans-serif` — so the page renders in system fonts rather than
losing `font-family` outright. That is precisely why it is invisible.

### The cache, and why CI never has it

`vite-plugin-fonts.js:76-79` puts the build cache at `settings.config.cacheDir` + `./fonts/` — i.e.
**`node_modules/.astro/fonts/`**, which is gitignored and absent from every clean checkout. Two kinds
of entry share it, with different lifetimes:

| entry               | key                                               | TTL                                             |
| ------------------- | ------------------------------------------------- | ----------------------------------------------- |
| font binaries       | content/URL hash, flat `<hash>.woff2`             | **none — permanent**                            |
| Google CSS metadata | `google-<hash>/.../{meta,<Family>-...-data}.json` | **ONE_WEEK** (`unifont/dist/index.mjs:802,815`) |

Consequence worth stating plainly: **a warm cache masks an outage for at most 7 days**, and after that
the build takes the _silent_ path, not the loud one. Measured here — a warm-cache build with both
hosts blocked made **zero** network calls and exited 0.

Measured cache contents: `meta.json` is **1 547 695 B** — the entire Google Fonts catalogue, fetched
so `listFonts()` can offer a "did you mean...?" suggestion. That is ~88% of the ~1.77 MB cache and has
nothing to do with our two families.

### What vendoring actually costs

The decisive finding: **Astro never subsets or optimises anything.** `grep -rn subset` across
`dist/assets/fonts/*.js` returns only _selection_ sites; there is no `subset-font`, no harfbuzz, no
fonttools in the pipeline. `CachedFontFetcher.fetch` branches on `isAbsolute(url)` to `readFile`, and
`vite-plugin-fonts.js:318-327` writes the buffer out unchanged. A local font file is **copied through
byte-for-byte**. Google's CDN was shipping pre-subset files and Astro was relaying them.

So vendoring does **not** buy a font build step. It is: 6 files (or 4 without italic) into
`src/assets/fonts/` — _not_ `public/`, which would double-copy them (`providers/local.d.ts:11-13`) —
plus a `fontProviders.local()` config block with an explicit `variants` array.

What still works, unchanged:

- **Optimised fallback metrics.** `core/optimize-fallbacks.js:33-38` to `CapsizeFontMetricsResolver`
  reads the same buffer, so `size-adjust` / `ascent-override` / `descent-override` /
  `line-gap-override` are generated exactly as today.
- **Preload links.** `core/collect-font-assets-from-faces.js:31-38` is provider-agnostic, and
  `src/layouts/Layout.astro:26-27` passes bare `preload` (no subset filtering), so nothing changes.
- **The CSS variable name.** Its hash changes (`core/resolve-family.js:12`), but nothing reads it by
  name — `src/styles/global.css:178-179` aliases it to `--font-heading` / `--font-body` and all ~28
  call sites use the role aliases.

What is genuinely lost:

1. **`unicode-range` becomes hand-copied data.** `collect-component-data.js:20` is
   `data.unicodeRange ?? family.unicodeRange`; the local provider passes through only what is
   declared. Omit it and both subsets download on every page. The values are sitting in the cached
   `Nunito-...-data.json` / `Quicksand-...-data.json` and need copying once, with a comment saying
   where they came from.
2. **Adding a subset stops being a one-word change.** `"cyrillic"` today is a config word; vendored,
   it is two more downloads and two more variants.
3. **Font version drift becomes ours.** Google silently ships updated builds; a vendored file is
   frozen. For Latin/Latin-Ext text faces that reads more like a feature.

### Licensing — an obligation that already exists

Nothing about font licensing exists in this repo: `find . -iname "*licen*"` outside `node_modules`
returns zero results, and `public/` holds only `.assetsignore`, `favicon.png`, `template.png`.

Both families are distributed on Google Fonts under **SIL OFL 1.1** — _not verified from upstream in
this session; take the version and the exact copyright lines from `ofl/quicksand/OFL.txt` and
`ofl/nunito/OFL.txt` in `google/fonts`, not from this document._

The reading that matters: the current setup **already redistributes the binaries**. Astro downloads
them at build time and Cloudflare serves them from our origin to every visitor — that is
redistribution exactly as much as committing them would be. So "commit `OFL.txt`" is a fix that is
**due either way**; vendoring makes an existing unmet obligation visible rather than creating a new
one. It should not be priced as a cost of this change.

`.gitattributes:5-13` already declares `*.woff2 binary`, even though the repo contains no woff2 today.
No Git LFS. ~210 KB (or ~129 KB) against a 482 KB `package-lock.json` already tracked — repository
size is not a live concern.

### Why these fonts, and the one sentence that must stay true

The families come from the hi-fi design export, not from a typography decision made here —
`context/foundation/roadmap.md:83`: "fonty **Quicksand** (naglowki) + **Nunito** (tekst)". The
self-hosting decision is recorded in `context/archive/2026-09-05-ui-design-system/plan-brief.md:37`:
_"No third-party request per render, no user IPs sent to Google, `latin-ext` subset for Polish
diacritics."_

One runtime file depends on that property — `src/lib/auth-messages.ts:16-19`:

```
// A `Referer` claim was made here first and withdrawn on review: ... `/auth`
// makes no third-party requests at all — astro.config.mjs self-hosts the fonts precisely so
// that none are made. Browser history is the whole of it, and it is enough.
```

It is load-bearing: it is the stated reason a `Referer`-leak claim was withdrawn. **Vendoring keeps
that sentence true** (the files still come from our origin); reverting to a Google-hosted `<link>`
would falsify it. That option is therefore off the table regardless of build reliability.

### Fonts is one of at least three build-time network dependencies

Removing Google does **not** make the build offline. Also in the deploy path after `npm ci`:

- **`supabase` postinstall to GitHub Releases.** `node_modules/supabase/scripts/postinstall.js:38-52`
  fetches a `.tar.gz` plus checksums from `github.com/supabase/cli/releases`. `supabase` is a
  devDependency (`package.json:75`), and the gate needs devDeps to run at all
  (`context/archive/2026-09-11-ci-quality-gates/reviews/impl-review.md:150-157`, F10), so this
  downloads a Go binary on every cold Cloudflare build — **and the container has no Docker**, so that
  binary can never be used there. Worth its own change.
- **`esbuild`, `workerd`, `sharp`** install hooks — normally resolved from the platform packages
  already in the lockfile, but `esbuild`'s and `sharp`'s scripts contain network fallbacks. Not read
  line by line; flagged as conditional.
- **the npm registry itself**, which is not going away.

## Code References

- `astro/dist/assets/fonts/infra/cached-font-fetcher.js:25-46` — the hard throw, no retry
- `astro/dist/assets/fonts/infra/unifont-font-resolver.js:56-59` — `throwOnError: false`
- `astro/dist/assets/fonts/vite-plugin-fonts.js:76-79` — cache location; `:318-327` — write-through
- `astro/dist/assets/fonts/core/compute-font-families-assets.js:29-41` — the warn-and-continue
- `astro/dist/assets/fonts/providers/local.d.ts:4-44` — the `variants` contract; `:11-13` — not `public/`
- `astro/dist/assets/fonts/constants.js:4` — `DEFAULTS.styles` adds italic
- `astro/dist/core/errors/errors-data.js:487-492` — `CannotFetchFontFile`
- `astro.config.mjs:19-32` — the fonts block and its recorded rationale
- `src/layouts/Layout.astro:26-27` — the only two `<Font>` render sites
- `src/styles/global.css:175-179` — the role aliases every call site actually uses
- `src/lib/auth-messages.ts:16-19` — the no-third-party-request claim that depends on self-hosting
- `.gitattributes:5-13` — `*.woff2 binary`, already declared

## Architecture Insights

- **A dependency's failure mode is a property of its call path, not of the dependency.** The same
  outage, on the same vendor, through two code paths in the same subsystem, produces a dead build and
  a silent green publication. Naming "Google Fonts" as the risk was too coarse to plan against.
- **`throwOnError: false` with a `TODO` is a decision someone made to move on.** It is upstream's to
  change, which means the silent path cannot be fixed by configuration on our side — only by removing
  the call or by asserting on the artifact.
- **The gate has no artifact assertion.** `ci:gate` checks types, lint, tests, renders and a secret
  scan; nothing asserts the build produced what it is supposed to produce. The silent path is the
  first measured instance of a class — a build that succeeds at producing the wrong thing.

## Historical Context (from prior changes)

- `context/archive/2026-09-11-ci-quality-gates/reviews/impl-review.md:141-148` — F9, the observation
  this change came from. Correct about the binary path; silent about the metadata path.
- `context/archive/2026-09-11-ci-quality-gates/follow-ups/review-fixes.md:32-42` — proposes vendoring
  into `public/`, and pre-empts the privacy confusion. Note `public/` is the wrong directory per
  `local.d.ts:11-13`; `src/assets/fonts/` is correct.
- `context/archive/2026-09-05-ui-design-system/plan-brief.md:37` and `plan.md:136-137,390-392` — where
  self-hosting was decided and why.

## Open Questions

1. **Which failure does this change buy insurance against?** Vendoring removes both. An artifact
   assertion in `ci:gate` (e.g. "the build emitted at least 4 woff2") removes only the silent one, but
   is ~5 lines and also guards against future regressions of this class. They are not exclusive.
2. **Italic: drop it or keep it?** Nothing in `src/` requests italic Nunito today, but nothing stops a
   future `<em>` from wanting it. Dropping saves 80.8 KB per visitor; keeping costs nothing but bytes.
3. **Does the Cloudflare build cache cover `node_modules/.astro`?** If Workers Builds has an opt-in
   cache spanning it, that is a third option — but the metadata TTL of one week means it degrades to
   the silent path rather than the loud one, which is the wrong direction.
4. **`supabase` as a devDependency** downloads a binary the Cloudflare container cannot run. Separate
   change; noted so it is not lost.
