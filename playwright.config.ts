import { defineConfig, devices } from "@playwright/test";

// The project's first E2E runner. It exists for ONE class of risk: failures that live in the seam
// between a browser's own machinery and the server — cookie attributes actually enforced by a
// cookie jar, and a page rendered with real data behind a real session. Everything provable below
// that seam belongs in vitest, which already holds 28 files (see context/foundation/test-plan.md §4).
//
// Deliberately NOT wired into `npm run ci:gate`. That script is the Cloudflare Workers Builds build
// command, and the build container has no Docker — so `supabase start` cannot run there and these
// tests would be permanently unrunnable. Same forced split §5 already applies to the integration
// suite: GitHub Actions is the only place either runs, and it can report but not block.

export default defineConfig({
  testDir: "./tests/e2e",

  // `*.spec.ts`, and that extension is load-bearing rather than cosmetic: all three vitest projects
  // select `*.test.ts` / `*.test.tsx` (vitest.config.ts), so the two runners cannot sweep up each
  // other's files. Verified against the config, not assumed.
  testMatch: /.*\.spec\.ts/,

  fullyParallel: true,

  // No retries, anywhere — including CI, where the reflex is to set 2.
  //
  // A retry converts a flaky test into a green one, and this repo's whole testing posture is that a
  // green result is not evidence unless you know why it is green (context/foundation/lessons.md
  // §"Asercja podciągiem trafia we własne uzasadnienie", §"Zdanie o tym, co się stanie po usunięciu
  // bramki…"). A flake here is a signal about test isolation or about a real race, and both are
  // worth reading rather than retrying away. Revisit only with a measured flake rate, not a hunch.
  retries: 0,

  // Fail the run if a `test.only` was committed. Cheap, and the failure mode is a suite that
  // silently stops covering everything else.
  forbidOnly: !!process.env.CI,

  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    // A LOOPBACK host, never a LAN IP — a correctness requirement rather than a preference.
    //
    // The caretaker capability cookie is set `Secure` (src/lib/claim-cookie.ts). Browsers treat
    // loopback — `localhost`, `127.0.0.1` and `[::1]` alike — as a secure context and accept such
    // a cookie over plain http. A dev server reached over `http://192.168.x.x:4321` is NOT one,
    // and Chromium drops the cookie SILENTLY. The symptom is the one that file's own comment
    // describes: the claim succeeds, the reload renders the pre-claim page, and it reads as
    // "it didn't work". A test failing that way says nothing about the risk it was written for.
    //
    // `localhost` specifically, and that is MEASURED rather than stylistic: `astro dev` binds only
    // to `[::1]` on this platform — `netstat` shows a single `[::1]:4321` listener and a request to
    // `127.0.0.1:4321` is refused outright. An earlier revision of this file said `127.0.0.1` and
    // the webServer block below timed out after 120s waiting for a server that had been up in 8.
    baseURL: "http://localhost:4321",

    // Kept on failure only. With `retries: 0` there is no first retry to hang a trace off, so
    // `on-first-retry` — the usual default — would capture nothing, ever.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    // Produces playwright/.auth/owner.json. Split into its own project so the sign-in happens once
    // per run rather than once per test — the pattern Playwright's auth docs prescribe, and the
    // reason no individual spec may log in through the UI.
    { name: "setup", testMatch: /auth\.setup\.ts/ },

    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/owner.json" },
      dependencies: ["setup"],
    },
  ],

  // Attach to a dev server the developer already has running; start one in CI.
  //
  // WARNING worth carrying here rather than only in the plan: `reuseExistingServer` makes
  // context/foundation/lessons.md §"Ubij serwer dev, zanim cokolwiek ruszy node_modules/.vite" MORE
  // likely to bite, not less. `astro dev` and `astro build` share node_modules/.vite, and the
  // pre-commit hook runs `astro check`. So after any build, check or commit, the server this config
  // just attached to is serving URLs that no longer exist — and the failures read as React or SSR
  // bugs (`Invalid hook call`, empty SSR), not as a cache problem. Restart dev before re-running.
  webServer: {
    command: "npm run dev",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
