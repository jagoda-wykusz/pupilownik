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

There is no test runner configured yet.

## Coding Style & Conventions

- Node v22.14.0 (`.nvmrc`); TypeScript strict (`astro/tsconfigs/strict`). Import via the `@/*` → `./src/*` alias.
- Merge Tailwind classes with `cn()` from `@/lib/utils`; do not concatenate class strings.
- Astro components for static layout; React only when interactive. Add shadcn/ui ("new-york") via `npx shadcn@latest add <name>` into `src/components/ui/`.
- API handlers use uppercase `GET`/`POST` exports and validate input with zod.
- Migrations: `supabase/migrations/YYYYMMDDHHmmss_short_description.sql`.
- Shared types in `src/types.ts`; services/helpers in `src/lib/`. Auth flow lives in `src/lib/supabase.ts` and `src/middleware.ts` (add paths to `PROTECTED_ROUTES` to gate them).

## Commit & CI

Pre-commit (husky + lint-staged) runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`. GitHub Actions (`.github/workflows/ci.yml`) runs lint + build on push/PR to `master`; commit-message convention is not yet established.
