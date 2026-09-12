# Vendor the build fonts — Plan Brief

> Full plan: `context/changes/vendor-build-fonts/plan.md`
> Research: `context/changes/vendor-build-fonts/research.md`

## What & Why

Every Cloudflare build downloads six woff2 from Google, and that reaches two hosts with two opposite
failure modes: `fonts.gstatic.com` kills the build on the first failed request, and
`fonts.googleapis.com` fails **silently** — exit 0, zero `@font-face`, a site published in system
fonts that nothing in the gate notices. We vendor the files so neither can happen, and drop two italic
faces Astro downloads that nothing in the app uses.

## Starting Point

`astro.config.mjs` declares Quicksand and Nunito through `fontProviders.google()`. The build cache
lives in gitignored `node_modules/.astro/fonts/`, so CI is always cold; the metadata half of that cache
expires after seven days anyway. Measured: blocking only the binary host gives exit 1 with zero
retries; blocking the metadata host gives exit 0 and a fontless site.

## Desired End State

`npm run build` completes with both Google hosts unreachable and still emits four woff2. Pages look
identical. `ci:gate` fails if a build produces no fonts. Four woff2 and two `OFL.txt` live in
`src/assets/fonts/`.

## Key Decisions Made

| Decision               | Choice                     | Why (1 sentence)                                                                                                                                          | Source   |
| ---------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Remove or cache        | Vendor the files           | Astro never subsetted anything, so vendoring removes a build step rather than adding one; the Cloudflare cache would degrade toward the _silent_ failure. | Plan     |
| Italic faces           | Drop both                  | Zero `<em>`/`<i>`/`italic` in all of `src/`, and they are 80.8 KB of the 210 KB shipped.                                                                  | Plan     |
| Artifact assertion     | Add it anyway              | After vendoring the silent path is gone, but the assertion guards the class: a build that succeeds at producing the wrong thing.                          | Plan     |
| `OFL.txt`              | Commit both                | We already redistribute the binaries from our own origin, so the obligation exists today and is unmet.                                                    | Plan     |
| Where the files live   | `src/assets/fonts/`        | `public/` would double-copy them; the follow-up that proposed `public/` is wrong on this point.                                                           | Research |
| `unicode-range`        | Hand-copied from the cache | `local.js:44` is a pure pass-through — omit it and every page pulls both subsets.                                                                         | Research |
| Google-hosted `<link>` | Off the table              | `src/lib/auth-messages.ts:16-19` depends on `/auth` making no third-party requests.                                                                       | Research |

## Scope

**In scope:** four vendored woff2; the `fonts:` config block; a source guard against reintroducing the
Google provider; a build-artifact assertion; two `OFL.txt`; corrections to test-plan §7 and the scan
header.

**Out of scope:** `global.css`, `Layout.astro` and the ~28 call sites (all untouched); any reversion to
a Google-hosted `<link>`; a Cloudflare build cache; touching the font bytes; the `supabase`
devDependency that downloads a Go binary the Cloudflare container cannot run.

## Architecture / Approach

Swap the provider, then prove the swap. The families keep their `name`, `cssVariable`, `display` and
`fallbacks`, so nothing downstream changes — only the provider and an explicit `variants` array with
the variable axis range (`"200 1000"` / `"300 700"`), `style: "normal"`, and hand-copied
`unicode-range`. Phase 2 re-runs the blocked-host probe that motivated the change and requires **zero**
blocked requests, not merely a green build.

## Phases at a Glance

| Phase                 | What it delivers                                         | Key risk                                                                |
| --------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1. Vendor + switch    | Four committed woff2, local provider config              | `unicode-range` copied wrong → both subsets download per page           |
| 2. Prove it           | Measurement: cold cache, both hosts blocked, still green | A guard that a comment could satisfy — this repo has shipped that twice |
| 3. Artifact assertion | A fontless build fails the gate                          | Asserting on `dist/client` when SSR puts the CSS in `dist/server`       |
| 4. Licence + docs     | Two `OFL.txt`, corrected §7                              | Copying licence text from research instead of upstream                  |

**Prerequisites:** the font cache must still be warm when Phase 1 runs — the `unicode-range` values
live only there and in Google's CSS, and the cached half expires after seven days.
**Estimated effort:** ~1 session across 4 phases; Phase 1 carries nearly all of the work.

## Open Risks & Assumptions

- OFL 1.1 is assumed to be the licence for both families; `research.md` flags this as **not verified
  from upstream** and Phase 4 must copy the real text rather than trust it.
- Font version drift becomes ours — a vendored file is frozen where Google silently ships updates. For
  Latin/Latin-Ext text faces this reads more like a feature.
- Adding a subset (e.g. Cyrillic) stops being a one-word config change.
- If an `<em>` appears later, the browser synthesises oblique until someone restores the italic file.

## Success Criteria (Summary)

- A Google outage during a Cloudflare build changes nothing about the deploy.
- Visitors download 129 KB of fonts instead of 210 KB, and the pages look the same.
- A build that emits no fonts turns the gate red instead of publishing quietly.
