// @ts-check
import { defineConfig, envField, fontProviders } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  adapter: cloudflare(),
  // Self-hosted via Astro's font pipeline: the files are downloaded at build time
  // and served from our own origin, so no request reaches Google at render time and
  // no visitor IP leaves for a third party. `latin-ext` is not optional here — it
  // carries the Polish diacritics (ą ę ł ń ó ś ź ż).
  fonts: [
    {
      provider: fontProviders.google(),
      name: "Quicksand",
      cssVariable: "--font-quicksand",
      weights: [400, 700],
      subsets: ["latin", "latin-ext"],
      display: "swap",
      fallbacks: ["ui-rounded", "system-ui", "sans-serif"],
    },
    {
      provider: fontProviders.google(),
      name: "Nunito",
      cssVariable: "--font-nunito",
      weights: [400, 600, 700, 800],
      subsets: ["latin", "latin-ext"],
      display: "swap",
      fallbacks: ["system-ui", "sans-serif"],
    },
  ],
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
