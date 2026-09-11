# Repository Guidelines

Astro 6 SSR app (React 19 islands, Tailwind 4, Supabase auth, shadcn/ui) deployed to Cloudflare Workers. See `@CLAUDE.md.scaffold` for the full architecture notes.

## Hard Rules

- API routes and SSR-only pages must export `const prerender = false`. Output is `output: "server"` — nothing is static by default.
- `SUPABASE_URL` / `SUPABASE_KEY` are server-only secrets declared in `astro.config.mjs` `env.schema`; read them via `astro:env/server`, never expose to the client. Never commit `.env` or `.dev.vars`.
- Enable RLS on every new Supabase table with granular per-operation, per-role policies.
- React islands carry no Next.js directives (`"use client"` etc.).

## Build, Test, and Development Commands

- `npm run dev` — dev server on the Cloudflare workerd runtime.
- `npm run build` — production SSR build via `@astrojs/cloudflare`.
- `npm run lint` / `npm run lint:fix` — ESLint with type-checked rules.
- `npm run format` — Prettier (Astro + Tailwind plugins).
- `npx supabase start` — local Supabase stack (requires Docker); see `@README.md`.
- `npx wrangler deploy` — deploy to Cloudflare Workers.

- `npm test` — vitest, all three projects (39 files / 369 tests). The `integration` project needs the local stack.
- `npm run check` — `astro check`; the same script the pre-commit hook and the publish gate call.
- `npm run ci:gate` — the publish gate; see below.

Vitest runs three projects: `unit` (pure logic, no setup file), `component` (happy-dom) and `integration` (needs `npx supabase start`). Run one with `npx vitest run --project <name>` — but verify any change to `vitest.config.ts` with the whole suite, because a single project cannot exhibit a cross-project config conflict and one of those shipped to master already.

## Coding Style & Conventions

- Node v22.23.2 (`.nvmrc`); TypeScript strict (`astro/tsconfigs/strict`). Import via the `@/*` → `./src/*` alias.
- Merge Tailwind classes with `cn()` from `@/lib/utils`; do not concatenate class strings.
- Astro components for static layout; React only when interactive. Add shadcn/ui ("new-york") via `npx shadcn@latest add <name>` into `src/components/ui/`.
- API handlers use uppercase `GET`/`POST` exports and validate input with zod.
- Migrations: `supabase/migrations/YYYYMMDDHHmmss_short_description.sql`.
- Shared types in `src/types.ts`; services/helpers in `src/lib/`. Auth flow lives in `src/lib/supabase.ts` and `src/middleware.ts` (add paths to `PROTECTED_ROUTES` to gate them).

## Commit & CI

Pre-commit (husky + lint-staged) runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`, then `npm run check`. Commit-message convention is not yet established.

**The publish gate is `npm run ci:gate`** (`package.json`), and it is what the Cloudflare Workers Builds _build command_ runs. Four things about it are worth knowing before you touch that line, because JSON cannot carry a comment and this is the only place the reasoning lives in the repo:

- **It decides whether anything publishes.** A non-zero exit produces no version, and no version means no deploy — including on a direct push to `master`.
- **The order is load-bearing**, not stylistic: `check → lint → build → unit + component → check:secrets`. `astro check` regenerates `.astro/`, whose generated types type-aware ESLint needs; and the build must precede the tests because `tests/unit/client-bundle.test.ts` scans `dist/client` and fails — deliberately, rather than skipping — when there is no build.
- **`integration` is excluded on purpose.** The Cloudflare build container has no Docker, so `supabase start` cannot run there. Those 22 files run in GitHub Actions (`.github/workflows/ci.yml`) and nowhere else.
- **Actions cannot block a merge.** This repository is private on GitHub Free, where branch protection is unavailable. A red run there is a signal; the gate above is the only enforcement.

`tests/unit/ci-gate-source.test.ts` asserts both gates still contain what they claim to. It cannot see the Cloudflare dashboard field, so keep that field as the single string `npm run ci:gate` rather than an expanded chain.
