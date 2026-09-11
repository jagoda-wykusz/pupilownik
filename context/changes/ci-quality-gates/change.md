---
change_id: ci-quality-gates
title: Put a test gate in front of the deploy that already publishes every push
status: new
created: 2026-09-11
updated: 2026-09-11
archived_at: null
---

## Notes

Cloudflare Workers Builds is connected: a push builds and publishes. The build step runs `astro build` and nothing else — no lint, no tests, no secret scan, no `astro check`. Every push reaches production with zero assertions executed between commit and deploy.

Wire `npm run lint`, `npm test` and `npm run check:secrets` into the build step. Two known obstacles, both recorded in `context/foundation/test-plan.md` §5:

- `npm test` includes the `integration` project, which needs a running Supabase stack the build runner does not have — so either split by project or gate on the non-integration half first.
- Order matters: `npm run build` must precede `npm test`, because the secret scan inspects `dist/client`.

Also in scope to decide: whether `SUPABASE_URL` / `SUPABASE_KEY` are set as build-environment variables (both are `optional: true`, so a build succeeds without them and fails at runtime instead) — the two-place binding risk `infrastructure.md:58` flagged.
