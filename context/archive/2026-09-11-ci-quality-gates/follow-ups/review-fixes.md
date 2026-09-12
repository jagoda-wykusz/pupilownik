# Follow-ups from the full-plan review (2026-09-12)

Five things the full-plan review found that are real, verified, and deliberately NOT fixed inside
`ci-quality-gates`. Each is its own decision or its own change. Ordered by what they cost if
ignored.

## 1. The secret scan cannot see an SSR or island-prop leak (F8)

**Measured**: `dist/client` contains zero HTML files — `astro.config.mjs` sets `output: "server"`,
so every page renders at request time inside the Worker.

So this shape of mistake ships the production key to every browser and the scan reports clean:

```astro
---
import { SUPABASE_KEY } from "astro:env/server";
---

<PetList supabaseKey={SUPABASE_KEY} client:load />
```

Island props are serialized into the HTTP response, not into the client bundle. The scan's header
claims it catches "a key literal pasted into a client island" — true only for a literal typed into
the island's own source, which is the less likely version.

**Closing it needs one of**: an SSR render assertion (request a representative page through the
built worker and assert the body contains neither value), or an ESLint rule forbidding a value
imported from `astro:env/server` from reaching a `client:*` prop. The first is more honest, the
second is cheaper and catches it earlier. Either is its own change — this is rollout phase 3's
Risk #6 reopening at a level the original assertion layer did not reach.

## 2. `npm run build` has a hard network dependency on Google Fonts (F9)

`astro.config.mjs` declares two `fontProviders.google()` families — six weight×subset files,
confirmed as six `.woff2` in `dist/client`. Astro's fetcher throws `AstroError` on any non-ok
response with no fallback branch, and its cache lives in `node_modules/.astro`, which a fresh
Cloudflare container never has. So every deploy makes ~7 requests to Google, and one 429 is a
failed deploy whose error message is about a font file.

**Fix**: vendor the woff2 files into `public/` and serve them locally. Note `astro.config.mjs`
already self-hosts fonts for a privacy reason (`auth-messages.ts` records that `/auth` makes no
third-party requests) — so this is consistent with an existing decision, not a new one.

## 3. `npm run lint` passes with unlimited warnings (F11)

`eslint .` has no `--max-warnings 0`; ten warnings exist today (`no-console`,
`astro/no-unused-css-selector`, `astro/prefer-class-list-directive`). A rule added as `warn` —
the polite default — contributes nothing to the publish gate. Same shape for `astro check`, whose
`minimumFailingSeverity` defaults to `error`.

**Decision needed**: clean up the ten warnings and add `--max-warnings 0`, or accept that warnings
are advisory and stop adding rules at `warn` severity expecting them to bite.

## 4. Nothing ever executes `npm run ci:gate` before Cloudflare does (F12)

The workflow re-implements the chain as separate steps, and the source guard matches strings rather
than running anything. A chain that is syntactically broken, or that names a script which does not
exist, is discovered on the Cloudflare build — at deploy time, on master.

**Fix**: one step (or job) in the workflow that runs `npm run ci:gate`. It duplicates ~2 minutes of
work and is the only place the actual publish command is exercised before publication.

## 5. `wrangler.jsonc` still publishes assets from `./dist` (F4, partially closed)

`assertAssetScope()` in `scripts/check-client-bundle.mjs` now refuses to report clean unless the
generated `dist/server/wrangler.json` scopes assets to `../client`, and production was measured
serving 404 for `/server/*`. But the ROOT config still names `./dist`, the parent of both halves,
and the redirect that makes the generated config win lives in `.wrangler/`, which is gitignored
build state.

**Fix**: change `wrangler.jsonc`'s `assets.directory` to `./dist/client` so the root config is safe
standalone. Deliberately not done here: it is production deploy configuration, and this change had
already spent its budget for surprises in the deploy path.
