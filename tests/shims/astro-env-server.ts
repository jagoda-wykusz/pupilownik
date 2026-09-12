// Test-only shim for Astro's `astro:env/server` virtual module, which only
// resolves inside Astro's build pipeline. Vitest aliases the specifier to this
// file (see vitest.config.ts) so the real `src/lib/supabase.ts` can be imported
// in pure-Node integration tests.
//
// Values come from process.env, populated by tests/env.ts (which loads
// .env.test before any test module evaluates). This is an honest stand-in for
// Astro's validated env, NOT a mock of auth — the Supabase client built from
// these values still talks to the real local stack.
export const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "";
