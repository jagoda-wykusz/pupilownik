# Contract surfaces

Load-bearing names other code and tests depend on. A rename here is a breaking
change: grep the registry before touching one, and add a row when a new shared
entry point ships.

## Test harness

| Name | File | Contract |
|------|------|----------|
| `createOwnerClient()` | `tests/helpers/auth.ts` | Signs up a fresh, distinct owner and returns `{ client, userId, email, password }` — an anon-keyed client under that owner's RLS. Never service-role. |
| `createAuthenticatedCookieHeader()` | `tests/helpers/session.ts` | Mints a fresh owner and returns the genuine (possibly chunked) `sb-<host>-auth-token` Cookie header a browser would send. |
| `createAuthenticatedOwner()` | `tests/helpers/session.ts` | As above, plus the owner's anon-keyed client, so a test can drive an authenticated route and verify its DB side-effect as the same owner. |
| `corruptCookieHeader(header)` | `tests/helpers/session.ts` | Turns a captured header into a present-but-invalid session, keeping the captured cookie name so the negative case cannot pass for the wrong reason. |
| `runMiddleware({ pathname, cookieHeader })` | `tests/helpers/middleware.ts` | Drives the real `src/middleware.ts` `onRequest` and returns `{ response, nextCalled, locals }`. |

## Application

| Name | File | Contract |
|------|------|----------|
| `PROTECTED_ROUTES` | `src/middleware.ts` | Path prefixes the middleware gates. Exported so the auth-gating suite covers every prefix from this one list — a new route gets regression coverage without editing the test. |
| `createClient(headers, cookies)` | `src/lib/supabase.ts` | The request-scoped, cookie-bound Supabase client. Publishable key only — see `docs/reference/data-access.md`. |
| `create_pet_with_instructions` | `supabase/migrations/` | Security-invoker RPC that writes a pet and its instructions atomically. |
