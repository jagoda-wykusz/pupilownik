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
| `createAnonClient()` | `tests/helpers/auth.ts` | An anon-keyed client with **no session**, so it carries the `anon` role — the caretaker's actual identity. The only way to assert what a link-holder can and cannot reach. |

## Application

| Name | File | Contract |
|------|------|----------|
| `PROTECTED_ROUTES` | `src/middleware.ts` | Path prefixes the middleware gates. Exported so the auth-gating suite covers every prefix from this one list — a new route gets regression coverage without editing the test. |
| `createClient(headers, cookies)` | `src/lib/supabase.ts` | The request-scoped, cookie-bound Supabase client. Publishable key only — see `docs/reference/data-access.md`. |
| `create_pet_with_instructions` | `supabase/migrations/` | Security-invoker RPC that writes a pet and its instructions atomically. |
| `create_period_with_slots` | `supabase/migrations/` | Security-invoker RPC that writes a care period and every generated slot atomically. |
| `get_period_by_token` | `supabase/migrations/` | The **only** anon-reachable surface in the schema. Security-definer; resolves at most one active period from a raw invite token and returns it with its slots' free/taken state. Returns NULL for unknown, malformed and revoked tokens alike. Future caretaker capabilities extend this function — never an anon policy. |
| `regenerate_period_token` | `supabase/migrations/` | Security-invoker RPC that replaces a period's token digest, invalidating the previous link. Returns the period id, or NULL when RLS filtered the row out. |
| `generateInviteToken()` / `digestInviteToken()` | `src/lib/invite-token.ts` | Mints a base64url 32-byte token and derives its hex SHA-256. The digest encoding must stay byte-identical to `encode(sha256(convert_to(token,'UTF8')),'hex')` in `get_period_by_token`. |
| `MAX_SPAN_DAYS` / `MAX_TITLE_LENGTH` | `src/lib/period-format.ts` | The period bounds, shared by the zod schema and the create-period island so client and server cannot drift. `MAX_SPAN_DAYS` also equals the database CHECK (`end_date - start_date <= 30`, i.e. 31 inclusive) — change one and you must change all three. Deliberately in a module with no runtime imports, so the island does not pull zod into the browser. |
| `countDays(start, end)` | `src/lib/period-format.ts` | Inclusive day count, UTC-pinned. Three consumers: the zod refine, the island's validation, and the period list. |
| `TIMES_OF_DAY` / `TIME_OF_DAY_LABEL` | `src/lib/period-format.ts` | Display **order** and Polish labels for `public.time_of_day`. The order is the enum's declaration order, which is also what `enum_range` generates — two pages rely on it to render a day's slots consistently. |
| `createPeriodSchema` / `periodIdSchema` | `src/lib/schemas/period.ts` | The server-side gate for the create payload, and the uuid guard shared by `POST /api/periods/[id]/token` and `/periods/[id]`. A page that skips `periodIdSchema` answers differently for a malformed id than for a foreign one. |
| `resolveInviteView(...)` | `src/lib/invite-view.ts` | Decides status, title and which body the caretaker page renders. Holds the uniform-failure rule: unknown, tampered, malformed and revoked tokens must all produce one identical answer. Pinned by `tests/unit/invite-view.test.ts`. |
