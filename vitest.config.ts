import path from "node:path";
import { defineConfig } from "vitest/config";

// Two projects, split by what they need to run.
//
// `integration` carries the Supabase harness: tests/setup.ts loads .env.test and
// fails fast unless the local stack is up. `unit` deliberately has no setup file,
// so pure-logic tests run with Docker down — `npx vitest run --project unit`.
// Astro's Vite config is not reused; the virtual modules the middleware imports
// resolve through the honest shims aliased below.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/unit/**"],
          setupFiles: ["./tests/setup.ts"],
          // Integration tests sign users up against the local Supabase stack; keep them
          // serial-friendly and give the network round-trips room.
          testTimeout: 20000,
          hookTimeout: 20000,
        },
      },
    ],
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
