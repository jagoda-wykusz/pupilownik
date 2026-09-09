import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

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
          // Interactive islands. Needs a DOM, so it cannot live in `unit` (environment: node),
          // and it must NOT load tests/setup.ts — nothing here touches Supabase, and requiring
          // the local stack to test a button would be a false dependency. Runs with Docker
          // down: `npx vitest run --project component`.
          //
          // happy-dom rather than jsdom: faster, and this suite needs events and focus, not
          // layout. Worth stating what that costs — happy-dom computes NO layout, so a CSS
          // overflow like full-plan review F1 is invisible here. This project covers behaviour;
          // appearance stays a manual check.
          name: "component",
          environment: "happy-dom",
          include: ["tests/component/**/*.test.tsx"],
          setupFiles: ["./tests/component/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          // Spread the defaults rather than replacing them: a bare `exclude` drops
          // Vitest's own list (node_modules, dist), which only stays harmless while
          // `include` is narrow.
          // `tests/component/**` is excluded explicitly even though its files are .tsx and the
          // include pattern is .ts: the two only fail to overlap by file extension, which is
          // not a boundary anyone should have to notice when adding a test.
          exclude: [...configDefaults.exclude, "tests/unit/**", "tests/component/**"],
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
