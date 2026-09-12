---
change_id: ci-quality-gates
title: Put a test gate in front of the deploy that already publishes every push
status: implementing
created: 2026-09-11
updated: 2026-09-12
archived_at: null
---

## Notes

Cloudflare Workers Builds is connected: a push builds and publishes. The build step runs `astro build` and nothing else — no lint, no tests, no secret scan, no `astro check`. Every push reaches production with zero assertions executed between commit and deploy.

Wire `npm run lint`, `npm test` and `npm run check:secrets` into the build step. Two known obstacles, both recorded in `context/foundation/test-plan.md` §5:

- `npm test` includes the `integration` project, which needs a running Supabase stack the build runner does not have — so either split by project or gate on the non-integration half first.
- Order matters: `npm run build` must precede `npm test`, because the secret scan inspects `dist/client`.

Also in scope to decide: whether `SUPABASE_URL` / `SUPABASE_KEY` are set as build-environment variables (both are `optional: true`, so a build succeeds without them and fails at runtime instead) — the two-place binding risk `infrastructure.md:58` flagged.

## Dashboard state (from the user, 2026-09-11)

Three facts no file in this repo records, and every one of them narrows the solution:

1. **Build command is the default `npm run build`.** So the gate can be wired in `package.json` — versioned, reviewable, visible in git history — instead of in dashboard state nothing verifies. This is the good case.
2. **Only the production branch deploys. No PR builds, no preview URLs.** So a gate in the build step fires at MERGE time and blocks PUBLICATION, not a bad merge. Whatever is meant to stop bad code from reaching master has to live somewhere else.
3. ~~**`SUPABASE_URL` / `SUPABASE_KEY` are set as build-environment variables.**~~ **WRONG, measured 2026-09-12.** The first build under the new gate failed with `check-client-bundle: no usable value for SUPABASE_URL, SUPABASE_KEY` — the build step cannot see them. They are almost certainly set as the Worker's runtime Variables & Secrets, which is a different tab and a different thing. The two-place binding risk (`infrastructure.md:58`) was NOT satisfied; it simply had no symptom, because `optional: true` means a build succeeds without them.

   Worth keeping as an instance of the rule in `context/foundation/lessons.md` about verifying posture from the catalogue rather than from a statement: this claim was recorded here as dashboard state reported by a person, and it went into the plan, the research and two documents before anything executed against it. The first execution refuted it.

## GitHub state (from the user, 2026-09-11)

- **Plan: Free. Repository: private** (verified independently — unauthenticated access 404s and the owner shows 0 public repos).
- Consequence, documented by GitHub: branch protection rules and rulesets are unavailable on private repositories under Free. **No status check can be made merge-blocking at any price on this plan.** A failing Actions run shows a red X; the merge button stays enabled.

## Direction agreed (2026-09-11)

Two gates, in two places, for two different failures — not duplication:

- **GitHub Actions = the full suite as a SIGNAL.** It is the only environment where the 22 integration files can run at all, because `supabase start` needs a Docker host and the Cloudflare build container is not one. Cannot block a merge on this plan; still the difference between "nothing runs" and "everything runs and reports".
- **Workers Builds build command = the publish blocker.** The fast half only (lint, `--project unit --project component`, build, `check:secrets`). It is the one thing that can stop a bad artifact going live, including on a direct push to master.

## Open questions closed (2026-09-11)

Answers to the four questions the research left for the plan:

1. **A failing test blocks publication.** The `unit` + `component` half runs inside the Workers Builds build command and a red run stops the deploy. Cost is not the argument either way — both projects together are 6.3s — the decision is that a flaky test stopping a deploy is the cheaper failure.
2. **Stay on GitHub Free.** No upgrade to Pro, so branch protection stays unavailable and the Actions run stays a signal, permanently. The plan must not assume a merge gate exists, and should not be written as if one is coming.
3. **No non-production branch builds.** Only `master` builds and deploys. The consequence is accepted deliberately: the publish blocker fires when publication is already under way, so the first signal on a feature branch comes from GitHub Actions alone.
4. **`.nvmrc` → 22.23.2**, the version preinstalled on the Workers Builds runner, so no Node download per build. Note that this still does not match the local dev machine (`v24.12.0`); the pin describes the runner, not the developer, and that is now a knowing choice rather than an accident.
