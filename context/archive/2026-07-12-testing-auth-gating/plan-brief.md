# Auth Gating & Session Handling (Risk 2) — Plan Brief

> Full plan: `context/changes/testing-auth-gating/plan.md`
> Research: `context/changes/testing-auth-gating/research.md`

## What & Why

Test-plan §3 Phase 2 covers Risk Map **#2**: "a protected route stops being gated, or signup/signin/session handling lets an unauthenticated user reach owner data." We add a Vitest integration test that drives the **real** `src/middleware.ts` against the **live local Supabase stack** to prove `/dashboard` is gated — so a future refactor that silently drops the gate fails CI.

## Starting Point

Gating today is one function (`src/middleware.ts:6-25`): a `startsWith(PROTECTED_ROUTES)` check + `supabase.auth.getUser()` + redirect to `/auth/signin`, failing closed. It works but has **zero automated coverage**. The Phase-1 harness (local Supabase, anon key, `createOwnerClient()`) mints users but yields in-memory sessions, **not the `sb-127-auth-token` cookies** the middleware reads.

## Desired End State

`npm test` runs `tests/middleware/auth-gating.test.ts` proving three cases: no cookie → 302 to signin (and the page handler never runs), a real captured cookie → passes through with `locals.user` resolved, and an invalid/expired cookie → 302. The test-plan cookbook §6.4 documents the reusable route-gating recipe.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Test driver | Direct `onRequest` + synthetic `APIContext` | Cheapest, asserts exactly where the gate lives; Container API can't auto-load our middleware | Plan |
| Assertions | no-cookie→redirect, valid→pass, invalid→redirect | Proves gate closes, opens, and *validates* (not just presence-checks) a token | Plan |
| Cookie capture | `@supabase/ssr` sign-in into an in-memory jar | Produces the real (chunked) cookie; hand-forging is the named anti-pattern | Research |
| Virtual modules | Honest shims for `astro:env/server` + `astro:middleware` | Mirror Astro's real behavior; `getUser()` still runs for real (no mocking) | Plan |
| Risk #7 (zod) | Deferred to its own change | Unresearched here; keeps this change focused and shippable | Plan |
| `/dashboard` guard | Middleware-only, no page change | Single source of truth; the test is the regression guard | Plan |

## Scope

**In scope:** virtual-module shims + Vitest alias; a `runMiddleware()` context driver; a `createAuthenticatedCookieHeader()` capture helper; the three-case gating test; test-plan §6.4/§6.6 cookbook updates.

**Out of scope:** Risk #7 zod validation; any `src/**` production-code change; page-level guard; Container/running-server test; caretaker link-only path (S-02/S-03).

## Architecture / Approach

Pure-Node Vitest resolves the two Astro virtual modules via shim aliases, so the test can `import { onRequest } from "@/middleware"` and call it with a fake `APIContext` (request with/without a `Cookie` header, Map-backed cookies, `redirect`, and a `next` spy). The authenticated case captures a genuine session cookie by signing a freshly-minted owner in through `@supabase/ssr` with an in-memory cookie jar. `getUser()` always runs for real against the local stack — the shims never touch auth.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Gating test harness | Shims + alias, `runMiddleware()`, `createAuthenticatedCookieHeader()` | Fake `APIContext` shape drift; cookie chunks not fully serialized |
| 2. Test + cookbook | Three-case `auth-gating.test.ts` + §6.4 recipe | Invalid-cookie construction that reliably fails `getUser()` |

**Prerequisites:** local Supabase stack up (`npm run db:start`); `.env.test` with local URL + anon key (already present from Phase 1).
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Assumes `defineMiddleware` stays an identity wrapper (true in Astro 6.3.1) — if Astro adds behavior there, the shim must follow.
- The `@supabase/ssr` client persists the session via `setAll` on `signInWithPassword` — verified in research; if a version bump changes this, the capture helper needs adjusting.
- Test users accumulate on the local DB (Phase-1 behavior); `npm run db:reset` to tidy.

## Success Criteria (Summary)

- `npm test` green with all three gating cases plus the existing RLS/smoke suites.
- Commenting out the middleware redirect makes the no-cookie case fail (the test genuinely guards the gate).
- §6.4 cookbook gives the next contributor a copy-paste route-gating recipe.
