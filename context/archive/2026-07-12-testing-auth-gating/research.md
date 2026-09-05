---
date: 2026-07-12T15:45:43+02:00
researcher: jagoda.wykusz
git_commit: 95e91f2ed64b91cea15c01178f127b15d6784d47
branch: master
repository: 10xdev
topic: "Ground Risk 2 (auth gating & session handling) from the test plan Risk Map"
tags: [research, codebase, auth, middleware, gating, session-cookies, workerd, vitest]
status: complete
last_updated: 2026-07-12
last_updated_by: jagoda.wykusz
---

# Research: Risk 2 — Auth gating & session handling

**Date**: 2026-07-12T15:45:43+02:00
**Researcher**: jagoda.wykusz
**Git Commit**: 95e91f2ed64b91cea15c01178f127b15d6784d47
**Branch**: master
**Repository**: 10xdev

## Research Question

Ground **Risk 2** from `context/foundation/test-plan.md` §2 Risk Map:

> "A protected route stops being gated, or signup/signin/session handling lets
> an unauthenticated user reach owner data" — Impact High, Likelihood Med.
> Covered by §3 **Phase 2** (Auth gating & input validation).

Per the Risk Response Guidance for #2, research must ground: **middleware
ordering**, how **`context.locals.user`** resolves, the **session-cookie shape
on the workerd runtime**, and (implicitly) how a Phase 2 test can prove gating
without falling into the anti-pattern of mocking the auth client. Scope is
Risk 2 only; Risk #7 (zod validation), also in Phase 2, is deferred.

## Summary

- **Gating works today and is fail-closed.** A single middleware
  (`src/middleware.ts`) sets `context.locals.user` from a real
  `supabase.auth.getUser()` call and redirects any unauthenticated request
  whose path starts with a `PROTECTED_ROUTES` entry to `/auth/signin`. Even a
  misconfigured Supabase (null client) leaves `user = null`, so protected
  routes still redirect — it fails *closed*, not open.
- **`/dashboard` is the only protected route and the only owner-data page.** No
  unprotected page renders owner-specific data, so there is no current gating
  *gap* in the "forgot to protect a page" sense. The real exposure is
  **regression**: gating lives in one `startsWith` list with no page-level
  defensive guard, and there is **zero automated test** proving it.
- **`getUser()` is the correct choice** (validates the JWT against the auth
  server) — a strength, not a weakness. (One sub-agent flagged it as a gap vs
  `getSession()`; that is backwards for `@supabase/ssr` — see Architecture
  Insights.)
- **The Phase-1 harness cannot test this as-is.** `createOwnerClient()` mints a
  real user but yields an **in-memory `@supabase/supabase-js` session, not
  session cookies**. The middleware reads a `Cookie` header
  (`sb-127-auth-token`, chunked). Phase 2 must build two new primitives:
  (a) capture real session cookies from an `@supabase/ssr` `createServerClient`
  sign-in, and (b) drive a request through Astro's **Container API** (in-process,
  Node, no workerd) to assert redirect-when-absent / success-when-present.
- **Cheapest layer that gives real signal:** Container-API integration test
  against the local Supabase stack, using genuine captured cookies and the real
  `getUser()` path. No running server / workerd needed.

## Detailed Findings

### The gating mechanism (how it works today)

`src/middleware.ts` is a single `onRequest` — no `sequence()`, no second
middleware, no `middlewareMode` config anywhere in `src/` or
`astro.config.mjs`. Ordering is therefore trivial and cannot be reordered to
break gating.

- `PROTECTED_ROUTES = ["/dashboard"]` (`src/middleware.ts:4`).
- Client built per-request: `createClient(context.request.headers, context.cookies)` (`src/middleware.ts:7`).
- Identity: `const { data: { user } } = await supabase.auth.getUser()` → `context.locals.user = user ?? null` (`src/middleware.ts:10-13`); null client → `user = null` (`src/middleware.ts:14-16`).
- Gate: `PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))` and, if `!context.locals.user`, `return context.redirect("/auth/signin")` (`src/middleware.ts:18-22`). Otherwise `return next()` (`src/middleware.ts:24`).

Path matching is **prefix-based** (`startsWith`), so `/dashboard` also covers
`/dashboard/*`. Requirement traces to PRD §Access Control: *"Nieuwierzytelniony
użytkownik trafiający na trasę panelu właściciela jest kierowany do logowania"*
(`context/foundation/prd.md:140`).

### Who consumes `locals.user`

- `src/pages/dashboard.astro:4` — `const { user } = Astro.locals;`, renders `{user?.email}` at line 14. **No page-level null-check / redirect**; relies entirely on middleware. If middleware were bypassed, this renders with `user = null` (app error, not a data breach — there is no owner data beyond the email the session itself carries).
- `src/components/Topbar.astro:2` — reads `user`, but guards with a `user ? …` conditional (`Topbar.astro:9`), so it degrades safely.

No other `src/**` file reads `locals.user`.

### Page / route inventory (gating-gap check)

- Protected: `/dashboard` only (`src/pages/dashboard.astro`).
- Public by design: `index.astro`, `auth/signin.astro`, `auth/signup.astro`, `auth/confirm-email.astro` — none read owner data.
- Auth API routes (all public POST endpoints, intentionally):
  - `src/pages/api/auth/signin.ts` — `signInWithPassword` (line 13); error → `/auth/signin?error=…` (line 16); success → `/` (line 19).
  - `src/pages/api/auth/signup.ts` — `signUp` (line 13); success → `/auth/confirm-email` (line 19).
  - `src/pages/api/auth/signout.ts` — `signOut` only if client non-null (line 7); always redirects `/` (line 9).
  - Session cookies are set/cleared through the client's `setAll` callback (`src/lib/supabase.ts:18-22`).

**No unprotected page renders owner-specific data** → no "forgot to gate a page"
gap exists today. The Risk-2 exposure is regression and the absence of a test.

### Session-cookie shape on the workerd runtime

- Runtime: `@astrojs/cloudflare` v13.5.0 (`package.json:24`), `adapter: cloudflare()` (`astro.config.mjs:16`), `output: "server"` (`astro.config.mjs:11`), `wrangler.jsonc:4-6` (`nodejs_compat`). Production = **workerd**.
- Cookie read: `parseCookieHeader(requestHeaders.get("Cookie") ?? "")` (`src/lib/supabase.ts:13`); write: `cookies.set(name, value, options)` (`src/lib/supabase.ts:21`). `@supabase/ssr` v0.10.3 (`package.json:29`).
- **Cookie name:** default storageKey is `sb-<hostname.split(".")[0]>-auth-token`. For the local stack `http://127.0.0.1:54321` → **`sb-127-auth-token`**. No `cookieOptions.name` override is passed.
- **Chunking:** sessions over ~3180 URL-encoded chars are split into `sb-127-auth-token.0`, `.1`, … and reassembled on read. Real Supabase JWT sessions usually exceed this, so a **single hand-forged cookie under-represents a real session**.
- **Value:** JSON session, possibly `base64-`-prefixed. Correct move is to **capture** what a real `createServerClient` sign-in emits, not hand-craft it.

### The testability crux (how Phase 2 can prove gating)

- **`astro:env/server` is build-only.** `src/lib/supabase.ts:3` imports `SUPABASE_URL`/`SUPABASE_KEY` from `astro:env/server` (declared `optional` in `astro.config.mjs:17-22`). This virtual module only resolves inside Astro's Vite pipeline — importing `middleware.ts`/`supabase.ts` under the current plain vitest config (`vitest.config.ts`) will **fail to resolve it** unless run through Astro's pipeline or shimmed.
- **Three ways to exercise the middleware:**
  - (a) Import `onRequest` + hand-build an `APIContext` — blocked by the `astro:env/server` import above unless stubbed; also reconstructs Astro's context shape by hand. Fragile.
  - (b) **Astro Container API (`experimental_AstroContainer`) — recommended.** Present in Astro 6.3.1; its manifest wires middleware and runs route+middleware in-process on Node (so `astro:env/server` resolves), no workerd, no running server. Assert `/dashboard` without cookie → 302 `/auth/signin`; with a valid cookie → 200.
  - (c) Full `astro dev` / `wrangler dev` HTTP test — exercises real workerd but is heavier and unnecessary; gating logic here is runtime-agnostic.
- **Existing Phase-1 harness (what to reuse vs build):**
  - vitest `environment: "node"` (`vitest.config.ts:9`); `tests/setup.ts` loads `.env.test`, enforces local host, probes `/auth/v1/health` + `/rest/v1/` before tests. `@`→`./src` alias. **Reuse** `getTestEnv()` (`tests/setup.ts:33-40`) and the local-stack guard.
  - `createOwnerClient()` (`tests/helpers/auth.ts:20-38`) builds a plain **anon-keyed `@supabase/supabase-js`** client and `signUp`s a fresh user → `{ client, userId, email, password }`. **Reuse** it to *mint a real user*.
  - **Build new (CRUCIAL):** the harness yields an in-memory session, **not cookies** — it never calls `@supabase/ssr createServerClient`, so nothing emits `sb-127-auth-token`. Phase 2 needs (1) a helper that signs a real user in through `createServerClient` and **captures the emitted cookies**, and (2) a Container-API driver that issues a request with/without those cookies.

## Code References

- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard"]`.
- `src/middleware.ts:10-16` — `getUser()` → `locals.user`; null client → null user.
- `src/middleware.ts:18-22` — `startsWith` gate + redirect to `/auth/signin`.
- `src/lib/supabase.ts:3` — `astro:env/server` import (build-only virtual module).
- `src/lib/supabase.ts:7-9` — null client when `SUPABASE_URL`/`SUPABASE_KEY` missing.
- `src/lib/supabase.ts:13,18-22` — cookie `getAll`/`setAll` (`@supabase/ssr`).
- `src/pages/dashboard.astro:4,14` — reads `locals.user`, renders `user?.email`, no page guard.
- `src/components/Topbar.astro:2,9` — reads `user`, null-safe conditional.
- `src/pages/api/auth/signin.ts:13,16,19` — sign-in handler + redirects.
- `src/pages/api/auth/signup.ts:13,19` — sign-up handler → confirm-email.
- `src/pages/api/auth/signout.ts:6-9` — sign-out (skips if client null).
- `astro.config.mjs:11,16,17-22` — SSR mode, Cloudflare adapter, env schema.
- `wrangler.jsonc:4-6` — workerd entrypoint + `nodejs_compat`.
- `vitest.config.ts:9,19-21` — node env, `@`→`./src`.
- `tests/setup.ts:33-40,44-84` — env loader, local-host guard, readiness probe.
- `tests/helpers/auth.ts:20-38` — `createOwnerClient()` (anon key, in-memory session).
- `tests/harness.smoke.test.ts:13-17` — asserts `getUser()` returns the minted id.

## Architecture Insights

- **`getUser()` vs `getSession()` — the code is correct.** For `@supabase/ssr`
  server code, `getUser()` (revalidates the JWT with the auth server) is the
  recommended, secure pattern; `getSession()` reads unverified cookie state and
  is explicitly *not* trusted server-side. A sub-agent flagged `getUser()` as a
  gap — that is backwards. Keep `getUser()`; a test must exercise it for real.
- **Deny-by-default is the gating philosophy** (mirrors the RLS lesson: the gate
  is absence-of-access, not a granted redirect). Misconfig → null user → still
  redirected. A test should assert this fail-closed property explicitly.
- **Single-point gating is the regression risk.** One `startsWith` list, one
  middleware, no page-level guard on `/dashboard`. This is *why* Risk 2 is
  Med-likelihood: a future refactor (adding a route, changing the prefix,
  reordering) silently drops the gate. A test that hits `/dashboard`
  unauthenticated and asserts the 302 is the cheapest guard.
- **Cost × signal → Container-API integration test.** Not e2e/workerd (gating is
  runtime-agnostic here), not a mocked-auth unit test (asserts the mock, the
  named anti-pattern). Real local stack + real cookies + real `getUser()`.

### Anti-patterns to avoid (from the plan, confirmed against code)

- **Do NOT mock `@supabase/*` or `getUser()`** — the test would assert the mock,
  not real gating (test-plan §2 Risk #2 anti-pattern).
- **Do NOT hand-forge a single `sb-127-auth-token`** — real sessions are JSON,
  may be `base64-`-prefixed, and are usually chunked (`.0`, `.1`, …). Capture
  from a real `createServerClient` sign-in.
- **Do NOT reuse `createOwnerClient`'s in-memory session as if it were a cookie**
  — it emits no cookies and would present as unauthenticated to middleware.
- **A redirect status ≠ data withheld.** Assert both the 302 *and* that no
  owner data is in the body (test-plan §2 "Must challenge").

## Historical Context (from prior changes)

- `context/archive/2026-06-28-testing-rls-owner-isolation/` — Phase 1 harness this phase reuses:
  - `research.md:29-56` — two distinct user JWTs, **anon key only**, never service-role (tautology).
  - `plan.md:73-109` — `createOwnerClient()` contract; `impl-review.md:21-51` — test users accumulate, `npm run db:reset` between runs; reachability probe.
- `context/archive/2026-06-27-owner-data-rls-baseline/` — the data-access spine:
  - `plan.md:238-244` — the *manual* two-user check Phase 2 partially automates for the gating layer.
  - `impl-review.md:50-59` — deny-by-default is the gate, not grants (philosophy mirrored in route gating).
- `context/foundation/prd.md:133-140` — flat two-role model; owner-panel route redirects unauthenticated users to login (the Risk-2 requirement).
- `context/foundation/infrastructure.md:57` — cookie-cache session-leak risk on workerd, mitigated by `@supabase/ssr` ≥ 0.10 + never caching authenticated SSR responses. Adjacent to Risk 2; worth a note in the Phase 2 plan.
- `docs/reference/data-access.md:7-16` — `SUPABASE_KEY` must be the publishable/anon key; no service-role in the request path (the auth path a Phase 2 test must match).

## Related Research

- `context/archive/2026-06-28-testing-rls-owner-isolation/research.md` — Risk 1 (RLS owner isolation), the sibling Phase-1 research.

## Open Questions

- **Container API stability in Astro 6.3.1** — it is `experimental_AstroContainer`. Confirm it renders API routes + middleware the same way production does before committing the plan to it. (Fallback: `astro dev` + real HTTP, heavier.)
- **Cookie capture ergonomics** — cleanest shape for a `signInAndGetCookies()` helper: run `createServerClient` with an in-memory cookie jar and harvest `setAll` writes, or drive a throwaway request. Decide in the plan.
- **Risk #7 (zod input validation)** — same Phase 2, deliberately out of this pass. The auth handlers (`signin`/`signup`) currently read `form.get(...) as string` with **no zod validation** (`src/pages/api/auth/signin.ts:6-7`) — flag for the Risk-7 research pass.
- **`/dashboard` page-level guard** — worth deciding whether to add a defensive `if (!user) return Astro.redirect(...)` as belt-and-suspenders, or keep gating centralized in middleware and rely on the test. Design decision for the plan, not a bug.
