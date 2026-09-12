import { getViteConfig } from "astro/config";
import astroConfig from "./astro.config.mjs";

// A SECOND vitest config, and the reason is not preference — the main one cannot do this job.
//
// `vitest.config.ts` aliases `astro:env/server` to a test shim so pure-Node tests can import the
// real Supabase client. That is exactly wrong here: this suite renders real pages and must see the
// real env module, because the thing under test is whether a secret read through it reaches the
// response. It also has no Astro plugin, so `.astro` files do not compile there at all.
//
// THE REAL CONFIG, MINUS ONE KEY. Both halves of that are load-bearing and both were measured:
//
//   - Keep everything else. A hand-written config omits `fonts`, and then every render dies with
//     `FontFamilyNotFound: No data was found for the "--font-quicksand" family`, because
//     src/layouts/Layout.astro renders Astro's <Font> component. Retyping the config is how this
//     file becomes a maintenance liability that fails for reasons unrelated to what it tests.
//   - Drop `adapter`. @cloudflare/vite-plugin hard-rejects vitest's SSR externals:
//     "The following environment options are incompatible with the Cloudflare Vite plugin".
//     The adapter has nothing to do with env leakage, so dropping it costs no coverage.
//
// One consequence worth knowing before debugging a confusing failure: the per-edit agent hook runs
// `vitest related` with the DEFAULT config, which cannot parse `.astro`. A parse error from a file
// under tests/render/ is that hook asking the wrong config, not a broken test.
const { adapter: _adapter, ...withoutAdapter } = astroConfig;

export default getViteConfig(
  {
    test: {
      name: "render",
      include: ["tests/render/**/*.test.ts"],
      environment: "node",
    },
  },
  // The cast is narrow and deliberate. `astro.config.mjs` is an AstroUserConfig; getViteConfig takes
  // an AstroInlineConfig, which is the same shape plus a few CLI-only keys. Spreading the real
  // config is the whole point of this file — retyping it loses `fonts` and every render dies — so
  // the alternative to this cast is duplicating the config, which is worse.
  { ...withoutAdapter, configFile: false } as Parameters<typeof getViteConfig>[1],
);
