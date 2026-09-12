// @ts-check
import { defineConfig, envField, fontProviders } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// THE ONLY HAND-MAINTAINED DATA IN THE FONT SETUP, and the one thing that can silently regress.
//
// `LocalFontProvider.resolveFont` passes `unicodeRange` straight through
// (astro/dist/assets/fonts/providers/local.js:44) — it is never inferred. `fontace` runs there
// too, but only for `weight` and `style`, and only when one of them is omitted. So dropping these
// arrays does not break the build: it emits @font-face rules with no `unicode-range`, and every
// page then downloads BOTH subsets instead of the one it needs.
//
// The values are Google's declared ranges for its standard latin / latin-ext split, lifted from
// the build cache (`node_modules/.astro/fonts/**/<Family>-*-data.json`) while it was still warm.
// Both families declare the same two sets, which is why these are shared rather than repeated.
//
// Deliberately NOT the coverage `fontace` reports from the files themselves: that is finer-grained
// (30 ranges vs 19) and overlaps between the two subsets, which would defeat the split. The
// declared ranges are disjoint by construction — that is the whole point of subsetting.
const LATIN = /** @type {[string, ...string[]]} */ ([
  "U+0000-00FF",
  "U+0131",
  "U+0152-0153",
  "U+02BB-02BC",
  "U+02C6",
  "U+02DA",
  "U+02DC",
  "U+0304",
  "U+0308",
  "U+0329",
  "U+2000-206F",
  "U+20AC",
  "U+2122",
  "U+2191",
  "U+2193",
  "U+2212",
  "U+2215",
  "U+FEFF",
  "U+FFFD",
]);

const LATIN_EXT = /** @type {[string, ...string[]]} */ ([
  "U+0100-02BA",
  "U+02BD-02C5",
  "U+02C7-02CC",
  "U+02CE-02D7",
  "U+02DD-02FF",
  "U+0304",
  "U+0308",
  "U+0329",
  "U+1D00-1DBF",
  "U+1E00-1E9F",
  "U+1EF2-1EFF",
  "U+2020",
  "U+20A0-20AB",
  "U+20AD-20C0",
  "U+2113",
  "U+2C60-2C7F",
  "U+A720-A7FF",
]);

// Both files are VARIABLE fonts, verified with `fontace` against the committed bytes. One variant
// per subset therefore covers every weight the app uses — Quicksand at 400/700 and Nunito at
// 400/600/700/800 all sit inside these axes. Stating the range explicitly also skips the
// `readFileSync` + parse that `local.js:52-59` would otherwise do on every build to infer it.
const QUICKSAND_AXIS = "300 700";
const NUNITO_AXIS = "200 1000";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  adapter: cloudflare(),
  // Self-hosted from files committed to this repo: nothing reaches Google at build time OR at
  // render time, and no visitor IP leaves for a third party. `latin-ext` is not optional here —
  // it carries the Polish diacritics (ą ę ł ń ó ś ź ż).
  //
  // WHY THESE ARE VENDORED RATHER THAN FETCHED, measured 2026-09-12 (see
  // context/changes/vendor-build-fonts/research.md). The Google provider reaches two hosts on two
  // code paths with opposite failure modes. `fonts.gstatic.com` (the binaries) throws
  // `CannotFetchFontFile` on the FIRST failure with no retry, and the build caller is unguarded:
  // a 429 is exit 1, no deploy. `fonts.googleapis.com` (the CSS metadata) goes through unifont,
  // which Astro constructs with `throwOnError: false` — so a failure there is a warning, an empty
  // family list, and a build that EXITS 0 having emitted zero @font-face. The second is the one
  // that motivated this: it publishes a site in system fonts and nothing in the gate notices.
  //
  // The cache that would otherwise mask this lives in gitignored `node_modules/.astro/fonts`, so
  // every Cloudflare build is cold; its metadata half expires after a week regardless.
  fonts: [
    {
      provider: fontProviders.local(),
      name: "Quicksand",
      cssVariable: "--font-quicksand",
      display: "swap",
      fallbacks: ["ui-rounded", "system-ui", "sans-serif"],
      options: {
        variants: [
          {
            src: ["./src/assets/fonts/quicksand-latin.woff2"],
            weight: QUICKSAND_AXIS,
            style: "normal",
            unicodeRange: LATIN,
          },
          {
            src: ["./src/assets/fonts/quicksand-latin-ext.woff2"],
            weight: QUICKSAND_AXIS,
            style: "normal",
            unicodeRange: LATIN_EXT,
          },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: "Nunito",
      cssVariable: "--font-nunito",
      display: "swap",
      fallbacks: ["system-ui", "sans-serif"],
      options: {
        variants: [
          {
            src: ["./src/assets/fonts/nunito-latin.woff2"],
            weight: NUNITO_AXIS,
            style: "normal",
            unicodeRange: LATIN,
          },
          {
            src: ["./src/assets/fonts/nunito-latin-ext.woff2"],
            weight: NUNITO_AXIS,
            style: "normal",
            unicodeRange: LATIN_EXT,
          },
        ],
      },
    },
  ],
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
