import path from "node:path";
import { defineConfig } from "vitest/config";

// Standalone Vitest config for pure-Node Supabase integration tests.
// These tests build their own @supabase/supabase-js clients and never import
// app modules that pull `astro:env/server` (a virtual module that only resolves
// inside Astro's build), so Astro's Vite config is deliberately NOT reused here.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    // Integration tests sign users up against the local Supabase stack; keep them
    // serial-friendly and give the network round-trips room.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      // Mirror the tsconfig path alias so tests can import from "@/..." if needed.
      "@": path.resolve(import.meta.dirname, "./src"),
      // Resolve Astro's build-only virtual modules to honest test shims so the
      // real middleware + Supabase client can be imported in pure-Node tests.
      // These never mock auth — getUser() still runs against the local stack.
      "astro:env/server": path.resolve(import.meta.dirname, "./tests/shims/astro-env-server.ts"),
      "astro:middleware": path.resolve(import.meta.dirname, "./tests/shims/astro-middleware.ts"),
    },
  },
});
