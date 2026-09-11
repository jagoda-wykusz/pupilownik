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
          // Runs ONCE per run, in the main process, before any file is loaded — see
          // tests/global-setup.ts for why the readiness probes had to leave setupFiles.
          globalSetup: ["./tests/global-setup.ts"],
          // Integration tests sign users up against the local Supabase stack; keep them
          // serial-friendly and give the network round-trips room.
          testTimeout: 20000,
          // Back to 20s. It was briefly 30s to fit the readiness probes, which no longer run in a
          // hook at all — they moved to globalSetup, which vitest does not govern with this
          // timeout. Nothing else in the integration suite ever needed the extra room: every
          // beforeAll here is a handful of round trips against the local stack.
          hookTimeout: 20000,
          // CI ONLY: run these 22 files STRICTLY SERIALLY. They share one Postgres, and several
          // create deliberate contention with Promise.all whose round trips must finish inside
          // testTimeout. Local runs are untouched — `undefined` restores vitest's own default.
          //
          // WHY 1 AND NOT 2, corrected during the phase-2 review after the first version had it
          // backwards: vitest's default is NOT "every core", it is `max(numCpus - 1, 1)`
          // (resolveMaxWorkers, vitest/dist/chunks/cli-api.*.js). On the 2-vCPU runner this was
          // written for, that default is already 1 — so `maxWorkers: 2` would have DOUBLED
          // parallelism against that single Postgres while claiming to cap it. At 1 the setting
          // is a genuine ceiling on any runner size. Measured locally: 6s unconstrained (11
          // workers), 12s at 2, 37s at 1. The whole CI job is ~10 minutes, so 25 extra seconds
          // buys determinism cheaply.
          maxWorkers: process.env.CI ? 1 : undefined,

          // NOT COSMETIC, and the reason is non-obvious enough that deleting this line breaks CI
          // silently-looking-loudly: vitest REFUSES to run projects that resolve to different
          // `maxWorkers` inside the same group, with
          // `Projects "component" and "integration" have different 'maxWorkers' but same
          // 'sequence.groupOrder'` (groupSpecs, same file). Since only this project is capped, it
          // needs its own group. A side benefit: group 0 (unit + component, ~6s) now finishes
          // before the slow project starts.
          //
          // VERIFY WITH THE WHOLE SUITE, never one project: `CI=1 npx vitest run`. The phase-2
          // criterion originally used `CI=1 npx vitest run --project integration`, and a single
          // project cannot exhibit a cross-project grouping conflict — which is exactly how this
          // reached a commit.
          sequence: { groupOrder: 1 },
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
