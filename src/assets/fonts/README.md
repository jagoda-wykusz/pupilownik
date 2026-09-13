# Vendored fonts

Four woff2 files, committed rather than downloaded at build time. `astro.config.mjs` declares them
through `fontProviders.local()`; nothing here is imported by application code.

## Why they are committed

Fetching them at build time reached two Google hosts with two opposite failure modes — one that
killed the deploy on a single 429, and one that exited 0 having emitted no `@font-face` at all and
published the site in system fonts. Both measured 2026-09-12; see
`context/archive/2026-09-12-vendor-build-fonts/research.md` and `context/foundation/test-plan.md` §7.

## Provenance

Downloaded by Astro's font pipeline from Google Fonts and copied out of the build output
**unmodified** — Astro does not subset, re-encode or otherwise touch font bytes, so these are
exactly the files Google serves. Both families are variable fonts.

| File                        | Family        | Axis       | Subset    | Bytes  |
| --------------------------- | ------------- | ---------- | --------- | ------ |
| `quicksand-latin.woff2`     | Quicksand v37 | `300 700`  | latin     | 28 336 |
| `quicksand-latin-ext.woff2` | Quicksand v37 | `300 700`  | latin-ext | 26 568 |
| `nunito-latin.woff2`        | Nunito v32    | `200 1000` | latin     | 39 152 |
| `nunito-latin-ext.woff2`    | Nunito v32    | `200 1000` | latin-ext | 35 464 |

`latin-ext` is not optional: it carries the Polish diacritics (ą ę ł ń ó ś ź ż).

Italic faces are deliberately absent. Astro's `DEFAULTS.styles` requested them even though the
config never did, and nothing in `src/` uses `<em>`, `<i>`, `font-style` or an italic class — they
were 80 760 B of the 210 280 B previously shipped to every visitor.

## Licence

Both families are under the **SIL Open Font License 1.1**. The licence text and the copyright line
for each family are in `OFL-Quicksand.txt` and `OFL-Nunito.txt`, copied verbatim from
`google/fonts` (`ofl/quicksand/OFL.txt`, `ofl/nunito/OFL.txt`). The two files differ only in their
copyright header, which is why there are two.

The obligation is not new to vendoring: these binaries were already redistributed from our own
origin to every visitor, Astro simply stored them in `node_modules` between builds instead of in
git. Committing the licence text makes an existing obligation visible.

Quicksand carries a **Reserved Font Name** ("Quicksand"); Nunito declares none. The reserved name
bars distributing a _modified_ font under that name — serving these files unmodified under
content-hashed filenames is not a rename. If anyone ever subsets or re-encodes them, re-read that
clause first.

## Updating

Do not edit these files. To take a newer upstream build, re-download through the Google provider
once, copy the emitted woff2 out of `dist/client/_astro/fonts/`, and refresh the `unicode-range`
arrays in `astro.config.mjs` from the dev cache — they live in `.astro/fonts/google-*/*/google/<Family>-*-data.json`, NOT in `node_modules/.astro/fonts/`, which holds only binaries — and they are hand-maintained and never inferred
(`astro/dist/assets/fonts/providers/local.js:44`). `tests/unit/font-assets.test.ts` will fail if
they go missing.
