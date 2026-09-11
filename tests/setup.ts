// Per-worker setup for the `integration` project.
//
// It is deliberately thin. Loading `.env.test` and the localhost guard live in `./env` and run on
// import, once per worker process; the readiness probes live in `./global-setup.ts` and run once
// per RUN. That split was made on 2026-09-12 during the `ci-quality-gates` phase-2 review, which
// measured what the previous arrangement cost: the probes sat in a `beforeAll` here, and
// `setupFiles` executes for every test file, so the readiness budget was paid 22 times — about
// 11s per file against an unreachable stack, roughly three minutes of red CI at `maxWorkers: 1`.
//
// `getTestEnv` is re-exported because a dozen test files and both helpers import it from here.
export { getTestEnv } from "./env";
