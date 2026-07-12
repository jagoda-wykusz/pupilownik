# Auth Gating & Session Handling (Risk 2) — Implementation Plan

## Overview

Prove **Risk 2** from the test plan: an unauthenticated (or invalid-session) request to a protected route is redirected to `/auth/signin` and never reaches owner data, while a request carrying a real session opens the gate. We do this with a Vitest integration test that drives the **real** `src/middleware.ts` `onRequest` against the **live local Supabase stack** — the exact place the gate lives — extending the Phase-1 harness rather than replacing it.

## Current State Analysis

- The entire gate is one function: `src/middleware.ts:6-25`. `PROTECTED_ROUTES = ["/dashboard"]` (line 4); it resolves identity via `supabase.auth.getUser()` → `context.locals.user` (lines 10-16) and, for any path that `startsWith` a protected route, redirects to `/auth/signin` when there is no user (lines 18-22). It fails **closed**: a null Supabase client (missing env) still yields `user = null` → redirect.
- `/dashboard` is the only protected route and the only owner-data page (`src/pages/dashboard.astro:4,14`). No page-level guard exists; gating is centralized in middleware (a deliberate design we keep — see "What We're NOT Doing").
- The Phase-1 harness (`vitest.config.ts`, `tests/setup.ts`, `tests/helpers/auth.ts`) runs pure-Node integration tests against local Supabase with the **anon key only**. `createOwnerClient()` mints a fresh user and returns an in-memory `@supabase/supabase-js` session — **but no cookies** (`tests/helpers/auth.ts:20-38`).
- The middleware reads a `Cookie` header via `@supabase/ssr` `parseCookieHeader` (`src/lib/supabase.ts:13`); the session cookie is `sb-127-auth-token` for the local host `127.0.0.1`, and real sessions are usually **chunked** (`.0`, `.1`, …) past ~3180 chars. A test must therefore capture real cookies, not hand-forge one.
- `vitest.config.ts:4-7` deliberately does not reuse Astro's Vite pipeline, so `astro:env/server` (imported by `src/lib/supabase.ts:3`) and `astro:middleware` (imported by `src/middleware.ts:1`) do not resolve out of the box.

### Key Discoveries:

- Astro's Container API does **not** auto-load `src/middleware.ts`; running our middleware through it requires a hand-built manifest and there is no public `addMiddleware` (`node_modules/astro/dist/container/index.js:17-20,117-120`). This is why we drive `onRequest` directly instead.
- `defineMiddleware` is an identity wrapper — shimming `astro:middleware` to `(fn) => fn` matches Astro's real behavior exactly, so the test still exercises the genuine gate.
- `getUser()` is the **correct** SSR call (it revalidates the JWT with the auth server). The invalid-cookie assertion depends on this: a tampered/expired token makes `getUser()` return no user → redirect.
- `tests/setup.ts` already loads `.env.test` into `process.env` at module-eval and guards local-host + stack-reachability. Our `astro:env/server` shim reads from that same `process.env`, so no new env wiring is needed.

## Desired End State

`npm test` runs a new `tests/middleware/auth-gating.test.ts` that passes three cases against the local stack:
1. **No cookie** → `onRequest` returns a 302 to `/auth/signin` and `next()` is never called.
2. **Valid session cookie** (captured from a real `@supabase/ssr` sign-in) → `next()` is called and `context.locals.user.id` equals the signed-in user.
3. **Invalid/expired cookie** → 302 to `/auth/signin`, `next()` not called.

Verified by: `npm run lint`, `npm run build`, and `npm test` all green with the local stack up; test-plan §6.4 cookbook filled in with the route/middleware recipe.

## What We're NOT Doing

- **No zod / input-validation work (Risk #7).** It shares test-plan Phase 2 but is unresearched here; it becomes its own `/10x-research` + `/10x-plan` pass.
- **No page-level guard on `dashboard.astro`.** Gating stays centralized in middleware; the new test is the regression guard. Duplicating the check risks drift and the page never renders today anyway (middleware redirects first).
- **No Container API or running-server (dev/wrangler) test.** Gating logic is runtime-agnostic; a full workerd HTTP test is heavier without added signal (test-plan §1 cost × signal).
- **No production-code changes** to `src/**`. This change is test + test-harness + docs only.
- **No caretaker/link-only path (S-02/S-03).** Out of scope until those slices exist.

## Implementation Approach

Two phases. Phase 1 adds the reusable machinery to exercise Astro middleware in pure-Node Vitest: two honest virtual-module shims, a `runMiddleware()` context driver, and a `signInAndGetCookieHeader()` cookie-capture helper. Phase 2 writes the three-case gating test and documents the recipe. The anon-key-only, local-stack-only, never-mock-the-auth-client discipline from Phase 1 carries over unchanged.

## Critical Implementation Details

- **Env shim must not shadow the RLS suite.** The `astro:env/server` / `astro:middleware` aliases are additive; the existing `tests/rls/*` tests import neither, so they are unaffected. Keep the alias keys exact-match strings.
- **`getUser()` may call `cookies.set` during a refresh.** The fake `AstroCookies` passed into `runMiddleware()` must implement `set(name, value, options)` (and `get`/`delete`) without throwing, or the valid-cookie case can error mid-refresh.
- **Cookie serialization must round-trip chunks.** The captured jar may hold `sb-127-auth-token.0`, `.1`, …; serialize **all** entries into the `Cookie` header, URL-encoding values, so `parseCookieHeader` + `combineChunks` reassemble the session.

## Phase 1: Gating test harness

### Overview

Add the virtual-module shims + Vitest alias, a middleware context driver, and a real-cookie capture helper — the primitives the gating test (and any future route/middleware test) builds on.

### Changes Required:

#### 1. Astro virtual-module shims for Vitest

**File**: `tests/shims/astro-env-server.ts`, `tests/shims/astro-middleware.ts`

**Intent**: Let pure-Node Vitest resolve the two Astro virtual modules the real middleware transitively imports, without pulling in Astro's build pipeline. Honest shims that mirror Astro's own behavior — not mocks of app logic.

**Contract**:
- `astro-env-server.ts` exports `SUPABASE_URL` and `SUPABASE_KEY` read from `process.env` (populated by `tests/setup.ts`). Use lazy getters so evaluation order can't capture `undefined`.
- `astro-middleware.ts` exports `defineMiddleware = (fn) => fn` (identity, matching Astro). Add `sequence` only if some import needs it (current middleware does not).

#### 2. Wire the shims into Vitest resolution

**File**: `vitest.config.ts`

**Intent**: Map the two virtual specifiers to the shim files via exact-match aliases, alongside the existing `@` alias.

**Contract**: Extend `resolve.alias` with `"astro:env/server"` → `tests/shims/astro-env-server.ts` and `"astro:middleware"` → `tests/shims/astro-middleware.ts`. Existing keys and `test` block unchanged.

#### 3. Middleware context driver

**File**: `tests/helpers/middleware.ts`

**Intent**: Provide a single function that runs the real `onRequest` against a synthetic request and reports what the gate did, so tests read as `runMiddleware({ pathname, cookieHeader })` → `{ response, nextCalled, locals }`.

**Contract**: `runMiddleware(opts: { pathname: string; cookieHeader?: string })` builds a minimal `APIContext`:
- `request`: `new Request("http://127.0.0.1" + pathname, { headers })` where `headers` carries `Cookie` when `cookieHeader` is given.
- `cookies`: a Map-backed fake `AstroCookies` implementing `get`/`set(name,value,options)`/`delete` without throwing.
- `url`: `new URL(request.url)`; `locals`: `{}`; `redirect(path, status = 302)`: returns `new Response(null, { status, headers: { Location: path } })`.
- `next`: a spy resolving to a sentinel `Response`; record whether it was invoked.

It imports `onRequest` from `@/middleware`, calls `await onRequest(context, next)`, and returns `{ response, nextCalled, locals: context.locals }`. No snippet needed beyond this contract; the implementer follows the `APIContext` shape used in `src/middleware.ts`.

#### 4. Real-cookie capture helper

**File**: `tests/helpers/session.ts`

**Intent**: Mint a fresh owner and return the exact `Cookie` header a browser would send after signing in, so the valid-session assertion presents a genuine (possibly chunked) `sb-127-auth-token`.

**Contract**: `createAuthenticatedCookieHeader()` → `Promise<{ cookieHeader: string; userId: string; email: string }>`:
- Reuse `createOwnerClient()` (`tests/helpers/auth.ts`) to sign up a fresh user and get `userId`/`email`/`password`.
- Build an `@supabase/ssr` `createServerClient(url, anonKey, { cookies })` whose `getAll`/`setAll` read/write an in-memory `Map` jar (mirrors `src/lib/supabase.ts:11-23`).
- `await client.auth.signInWithPassword({ email, password })` so the ssr client persists the session into the jar.
- Serialize every jar entry into a `Cookie` header (`name=encodeURIComponent(value)` joined by `; `) and return it with `userId`/`email`.
- Also export `corruptCookieHeader(header: string)` (or document constructing an invalid header) for the invalid-token case: tamper the token payload so `getUser()` fails to validate.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (runs `astro check` via `@astrojs/check`)
- Linting passes: `npm run lint`
- A temporary smoke import of `onRequest` from `@/middleware` under Vitest resolves (no `astro:env/server` / `astro:middleware` resolution error) — confirmed by Phase 2's test running; no standalone command needed.
- Existing RLS suite still passes: `npm test` (with local stack up)

#### Manual Verification:

- With the local stack down, `npm test` still fails fast with the existing setup guidance (shims didn't mask the reachability guard).
- Inspecting a captured `cookieHeader` shows one or more `sb-127-auth-token` entries (chunked when the session is large).

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Auth-gating integration test + cookbook

### Overview

Write the three-case gating test using the Phase-1 helpers, then fill in the test-plan cookbook so the recipe is reusable for future protected routes.

### Changes Required:

#### 1. The gating integration test

**File**: `tests/middleware/auth-gating.test.ts`

**Intent**: Assert the Risk-2 protection contract directly on the real middleware against the local stack, covering the three security cases decided during planning.

**Contract**: A `describe("auth gating (middleware)")` with three `it`s, mirroring the style of `tests/rls/profiles.isolation.test.ts`:
- **no cookie → redirect**: `runMiddleware({ pathname: "/dashboard" })` → `response.status === 302`, `response.headers.get("Location") === "/auth/signin"`, `nextCalled === false`, `locals.user` falsy.
- **valid cookie → pass**: `const { cookieHeader, userId } = await createAuthenticatedCookieHeader()`; `runMiddleware({ pathname: "/dashboard", cookieHeader })` → `nextCalled === true`, no redirect, `locals.user?.id === userId`.
- **invalid/expired cookie → redirect**: a tampered/expired `sb-127-auth-token` → `response.status === 302`, `Location === "/auth/signin"`, `nextCalled === false`.

No code snippet required; the assertions follow the helper contracts from Phase 1.

#### 2. Fill in the cookbook recipe

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.4 "TBD — see §3 Phase 2" placeholder with the concrete route/middleware-gating recipe, and add a §6.6 per-phase note capturing what the phase taught (virtual-module shims; capture-don't-forge cookies; direct-`onRequest` over Container API).

**Contract**: Edit §6.4 to describe: reuse `createAuthenticatedCookieHeader()` + `runMiddleware()`; assert redirect-when-absent, pass-when-valid, redirect-when-invalid; never mock the Supabase auth client (the named anti-pattern). Append a §6.6 bullet for this phase. Leave the §3 status table for the orchestrator.

#### 3. Register load-bearing names (if a registry entry is warranted)

**File**: `docs/reference/contract-surfaces.md`

**Intent**: If the file tracks test-harness entry points, add `runMiddleware()` and `createAuthenticatedCookieHeader()` so future route tests discover them.

**Contract**: One row/line each naming the helper and its file. Skip if the registry is not used for test helpers.

### Success Criteria:

#### Automated Verification:

- All three gating cases pass: `npm test` (local stack up)
- Existing RLS + smoke suites still pass in the same run: `npm test`
- Linting passes: `npm run lint`
- Type checking / build passes: `npm run build`

#### Manual Verification:

- Temporarily broadening `PROTECTED_ROUTES` or removing the redirect in `src/middleware.ts` makes the "no cookie → redirect" test fail (the test actually guards the gate) — then revert.
- The valid-cookie case genuinely round-trips a chunked cookie (spot-check by logging the header length once).

**Implementation Note**: After automated verification passes, pause for manual confirmation. Then hand back to the test-plan orchestrator to flip §3 Phase 2 status.

---

## Testing Strategy

### Unit Tests:

- None — the gate has no pure-logic seam worth isolating; its value is the real `getUser()` round-trip.

### Integration Tests:

- The three-case `auth-gating.test.ts` against the local Supabase stack (the whole deliverable).

### Manual Testing Steps:

1. `npm run db:start`, ensure `.env.test` has the local URL + anon key.
2. `npm test` — all suites green.
3. Break the gate in `src/middleware.ts` (comment the redirect), rerun — the no-cookie case fails. Revert.

## Performance Considerations

Each authenticated case does a signUp + signInWithPassword + getUser round-trip to local Supabase; within the existing 20s test timeout. Test users accumulate on the local DB (same as Phase 1) — `npm run db:reset` to tidy.

## Migration Notes

None — additive test + harness + docs only; no schema or production-code change.

## References

- Related research: `context/changes/testing-auth-gating/research.md`
- Gate under test: `src/middleware.ts:4,10-22`
- SSR cookie shape: `src/lib/supabase.ts:11-23`
- Harness to extend: `tests/helpers/auth.ts:20-38`, `tests/setup.ts:33-84`, `vitest.config.ts:8-23`
- Canonical test style: `tests/rls/profiles.isolation.test.ts`
- Container API limitation: `node_modules/astro/dist/container/index.js:17-20,117-120`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Gating test harness

#### Automated

- [x] 1.1 Type checking passes: `npm run build` — 73f4da8
- [x] 1.2 Linting passes: `npm run lint` — 73f4da8
- [x] 1.3 `onRequest` resolves under Vitest (no virtual-module resolution error) — 73f4da8
- [x] 1.4 Existing RLS suite still passes: `npm test` — 73f4da8

#### Manual

- [x] 1.5 Local stack down → `npm test` still fails fast with setup guidance — 73f4da8
- [x] 1.6 Captured `cookieHeader` shows `sb-127-auth-token` entries (chunked when large) — 73f4da8

### Phase 2: Auth-gating integration test + cookbook

#### Automated

- [x] 2.1 All three gating cases pass: `npm test`
- [x] 2.2 Existing RLS + smoke suites still pass: `npm test`
- [x] 2.3 Linting passes: `npm run lint`
- [x] 2.4 Type checking / build passes: `npm run build`

#### Manual

- [x] 2.5 Breaking the gate makes the no-cookie test fail (then revert)
- [x] 2.6 Valid-cookie case round-trips a chunked cookie
