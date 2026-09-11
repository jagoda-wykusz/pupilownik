---
project: Pupilownik
researched_at: 2026-06-27
recommended_platform: Cloudflare Workers
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 (SSR) + React 19
  runtime: Cloudflare workerd (via @astrojs/cloudflare)
---

## Recommendation

**Deploy on Cloudflare Workers.**

The 10x-astro-starter is already wired for Cloudflare: `astro.config.mjs` uses the `cloudflare()` adapter, `wrangler.jsonc` is a valid Workers config (`@astrojs/cloudflare` entrypoint, `nodejs_compat`, observability on), and `npm run dev` runs the real `workerd` runtime. Every alternative requires swapping the Astro adapter and reconfiguring — pure friction against a 3-week, after-hours MVP. Cloudflare scored 5/5 on the agent-friendly criteria, costs **$0** at this traffic (medium users / low QPS), and gives a fully scriptable agent loop (`wrangler deploy` / `rollback` / `tail`) plus GA docs-as-markdown. The interview locked in DX-first, single-region, external data (Supabase), and no platform familiarity — all of which point to "use the platform the stack already targets rather than re-plumbing."

## Platform Comparison

| Platform       | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP/Integration | Total      |
| -------------- | --------- | ------------------ | ------------------- | ----------------- | --------------- | ---------- |
| **Cloudflare** | Pass      | Pass               | Pass                | Pass              | Pass            | **5 Pass** |
| **Netlify**    | Pass      | Pass               | Pass                | Pass              | Pass            | **5 Pass** |
| **Vercel**     | Pass      | Pass               | Pass                | Pass              | Partial         | 4P / 1Pt   |
| **Railway**    | Pass      | Partial            | Pass                | Pass              | Partial         | 3P / 2Pt   |
| **Render**     | Pass      | Pass               | Pass                | Partial           | Partial         | 3P / 2Pt   |
| **Fly.io**     | Pass      | Partial            | Partial             | Pass              | Partial         | 2P / 3Pt   |

- **Cloudflare** — `wrangler deploy`/`rollback [version-id]`/`tail` all GA; edge-serverless (no OS surface); `developers.cloudflare.com/llms.txt`; Cloudflare API MCP GA. Only the data-layer co-location (D1/R2/KV) is irrelevant here — Supabase owns data/auth/realtime.
- **Netlify** — Tied on the matrix: GA `@astrojs/netlify` adapter, `netlify deploy`/unified `netlify logs`, `llms.txt`, **official MCP GA** (June 2025), no commercial-use restriction. Loses on requiring an adapter swap and credit-based pricing that may reach Pro ($19/mo).
- **Vercel** — Best raw DX and scale-to-zero, GA CLI (`vercel rollback`/`logs`), `llms.txt`. Held back by MCP still in **public beta** and the **Hobby tier being non-commercial** (a real product needs Pro $20/mo), plus an adapter swap.
- **Railway** — Great solo DX, GA CLI, but **no scale-to-zero** (always-on container, ~$5/mo floor even at near-zero traffic) and MCP is beta.
- **Render** — Solid, but Starter is $7/mo (free tier spins down with 30–60s cold starts — bad for a calendar app), and its MCP **cannot trigger deploys or rollbacks**.
- **Fly.io** — Powerful (native WebSockets, multi-region) but requires a **Dockerfile** (more ops surface), has no free tier, and an **experimental** MCP — the worst fit for a solo 3-week deadline.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Zero adapter-swap: the stack already targets it, `wrangler.jsonc` is correct, and the dev server already runs `workerd`. $0 cost at projected traffic, full GA agent operability, edge by default (covers single-region with no extra config).

#### 2. Netlify

The only platform tied at 5/5, with a _GA_ MCP (vs Cloudflare's API-scoped one) and no commercial-use limit. The gap is purely the cost of switching the Astro adapter away from a setup that already works.

#### 3. Vercel

Strongest DX and scale-to-zero of the group, but three frictions stack up against an already-Cloudflare-configured project: adapter swap, beta MCP, and the non-commercial Hobby tier forcing Pro ($20/mo) once Pupilownik serves real circles.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **`workerd` ≠ Node.** `@supabase/ssr` pulls Node built-ins (`stream`, `crypto`); without `nodejs_compat` + `node:` prefixes you hit a _"Dynamic require of 'stream'"_ crash that only appears post-deploy. (Mitigated: `nodejs_compat` is already set in `wrangler.jsonc`.)
2. **Stale Pages-era guidance.** `@astrojs/cloudflare` v13+ dropped Cloudflare **Pages** support; the path is now Workers static assets. Tutorials — and `tech-stack.md`'s `deployment_target: cloudflare-pages` line — still say "Pages," steering an agent to a deprecated target.
3. **Cookie-cache session leak.** A cached `Set-Cookie` on an SSR response can leak one user's session to another — a direct breach of the PRD guardrail _"sensitive instructions don't leak outside the invited circle."_ Needs `@supabase/ssr` ≥ 0.10.0 (have 0.10.3 ✓) and never caching authenticated SSR responses.
4. **Two-place env binding.** `astro:env` secrets must exist for both the build and the Workers runtime (`wrangler secret put`); missing one half = silent `undefined` Supabase creds at runtime. With native Workers Builds (GitHub), build-time vars are set in the Cloudflare dashboard build config — easy to forget the runtime half. **Since 2026-09-12 the build half also fails loudly**: `npm run check:secrets` is the last link of the build command and exits 2 without `SUPABASE_URL`/`SUPABASE_KEY`, so a missing build var blocks publication instead of degrading runtime. One operational rule follows from the same wiring: **never set `CLOUDFLARE_INCLUDE_PROCESS_ENV` in Workers Builds** — it makes `@cloudflare/vite-plugin` serialize the process environment, i.e. the production key, into a plaintext `dist/server/.dev.vars` inside the build output.

### Pre-Mortem — How This Could Fail

The solo dev scaffolds against the `cloudflare-pages` line in the hand-off, following a 2024 tutorial. It deploys; the happy path works; the link goes to a real circle of caretakers. Then a caretaker opens the calendar right after another's session was cached by an edge node — and sees a stranger's sensitive feeding instructions (address, door codes). The guardrail the whole product rests on is violated in production, found by a user, not a test, and only reproduces under cache warm-up, costing days to trace. Separately, the GitHub repo auto-deploys every merge via Workers Builds, but the dev never set up a preview/staging environment, so an untested migration ships straight to production and a `Set-Cookie`-caching regression reaches live users before anyone runs the app. The deployment layer "just worked" on day one, which is exactly why these assumptions were never stress-tested.

### Unknown Unknowns

- **`astro dev` already runs `workerd`** in Astro 6 via the Cloudflare Vite plugin — a separate `wrangler dev` is largely redundant. Ignore older guides that insist on it.
- **Pages is maintenance-only for Astro.** Treat "Cloudflare = Workers" as the only forward path; correct the `cloudflare-pages` value in `tech-stack.md` to Workers.
- **GitHub unlocks native Workers Builds.** With the repo on GitHub, connect it in the Cloudflare dashboard for git-integrated builds + per-PR preview URLs — no hand-rolled CI needed. (Build command `npm run build`, deploy via the connected Workers project.) This supersedes the `cloudflare-builds`/Bitbucket note in `tech-stack.md`.
  - **Corrected 2026-09-12 (`ci-quality-gates`).** "No hand-rolled CI needed" is the sentence that justified deleting the starter workflow 52 minutes after it was created, and it is half wrong. Workers Builds cannot run anything that needs Docker, so `supabase start` — and with it all 22 integration test files — is impossible there. A GitHub Actions workflow is therefore not redundant with Workers Builds but complementary: Actions is the only place the integration suite runs, and the build command is the only thing that can block a publication. Both now exist; see `context/archive/`'s `ci-quality-gates` and `README.md` § CI / CD.
- **Cloudflare MCP is API/observability-scoped, OAuth-connected** — it does not replace `wrangler` for the deploy/rollback loop.

## Operational Story

- **Preview deploys**: With the repo on GitHub, connect it as a Workers Builds project — every PR gets an automatic preview URL, and merges to the production branch auto-deploy. (Manual fallback: `wrangler versions upload` for a preview version, promote with `wrangler deploy`.) Protect preview URLs with Cloudflare Access if instructions are loaded there.
- **Secrets**: `SUPABASE_URL` / `SUPABASE_KEY` live as Workers secrets (`wrangler secret put <NAME>`) for runtime, and as build-environment variables in the Cloudflare Workers Builds config for the build step. Never commit `.env` / `.dev.vars` (already gitignored). Rotate by re-running `wrangler secret put` + updating the build var.
- **Rollback**: `wrangler rollback [version-id]` reverts to a prior deployed version in seconds (list via `wrangler deployments list`). Caveat: this reverts code only — Supabase schema/migrations do **not** roll back; run the down-migration separately.
- **Approval**: An agent may deploy previews, `tail` logs, and list versions unattended. Human approval gates: promoting to production, rotating `SUPABASE_KEY`, and any Supabase migration touching the slots/assignments tables (data-loss guardrail).
- **Logs**: `wrangler tail` streams live runtime logs/exceptions; observability is enabled in `wrangler.jsonc` for dashboard logs. Build logs surface in the Bitbucket Pipelines run. All readable non-interactively by an agent.

## Risk Register

| Risk                                                                                                  | Source                              | Likelihood | Impact | Mitigation                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cached `Set-Cookie` leaks a session → sensitive instructions exposed to wrong caretaker               | Devil's advocate / Pre-mortem       | M          | H      | Never cache authenticated SSR responses; keep `@supabase/ssr` ≥ 0.10.0 (have 0.10.3); add a test asserting no `Cache-Control: public` on responses carrying `Set-Cookie`. |
| Following deprecated `cloudflare-pages` path from `tech-stack.md`                                     | Devil's advocate / Unknown unknowns | M          | M      | Correct `deployment_target` to `cloudflare-workers` in `tech-stack.md`; confirm `wrangler.jsonc` Workers config (already correct).                                        |
| No preview/staging env → untested migrations and cookie-cache regressions ship straight to production | Pre-mortem                          | M          | H      | Use Workers Builds per-PR preview URLs (native on GitHub); exercise auth + a slot-claim on the preview before merging; gate Supabase migrations behind approval.          |
| `nodejs_compat` / `node:` import misconfig → runtime crash on Supabase SSR                            | Devil's advocate                    | L          | H      | `nodejs_compat` already set; use `node:`-prefixed imports; smoke-test an auth route on a deployed preview, not just local.                                                |
| Secret bound for runtime but not build (or vice versa) → `undefined` Supabase creds                   | Devil's advocate                    | M          | M      | Set secrets in both `wrangler secret put` and Bitbucket Pipelines variables; add a startup assertion that both env vars are non-empty.                                    |
| Migration rollback gap — `wrangler rollback` reverts code, not Supabase schema                        | Research finding                    | L          | H      | Pair every forward migration with a tested down-migration; never auto-rollback DB during a code rollback (approval-gated).                                                |

## Getting Started

1. **Rename the Worker.** In `wrangler.jsonc`, change `"name": "10x-astro-starter"` to `"name": "pupilownik"` (becomes the `*.workers.dev` subdomain).
2. **Authenticate & set secrets.** `npx wrangler login`, then `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY`. For local dev, keep them in `.dev.vars` (gitignored).
3. **Verify the local runtime.** `npm run dev` — already runs `workerd`; do not add a separate `wrangler dev`. Exercise an `/auth` route to confirm `nodejs_compat` + Supabase SSR cookies work before deploying.
4. **First deploy.** `npm run build && npx wrangler deploy` (the build emits to `./dist`, served via the `ASSETS` binding). Confirm the returned `*.workers.dev` URL.
5. **Wire CI (GitHub → Workers Builds).** In the Cloudflare dashboard, connect the GitHub repo to this Workers project (build command `npm run build`). Merges to the production branch auto-deploy; PRs get preview URLs. Set `SUPABASE_URL` / `SUPABASE_KEY` as build-environment variables there in addition to the runtime `wrangler secret put`.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration
- CI/CD pipeline setup (the Bitbucket Pipelines note above is a pointer, not a built pipeline)
- Production-scale architecture (multi-region, HA, DR)
