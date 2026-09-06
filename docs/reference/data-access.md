# Data access convention

How every table in this project is created and secured. Established by F-01
(`owner-data-rls-baseline`). Copy this pattern for each new domain table; do not
re-decide it per slice.

## The security boundary: the Publishable key

The app's Supabase client (`src/lib/supabase.ts`) is bound to the user's cookie
session and uses `SUPABASE_KEY`, which **must be the Publishable (anon) key** —
never the Secret (service_role) key. The Secret key bypasses Row-Level Security
(RLS) entirely; a single misconfigured `.env` would void every policy below. There
is no service_role client in the request path, by design.

- Local key: the `Publishable` value printed by `npm run db:start`.
- `.env`: `SUPABASE_URL`, `SUPABASE_KEY=<publishable key>`.

## Every table: owner FK + deny-by-default RLS

1. **Anchor ownership.** Owner-scoped tables carry the owner via a foreign key to
   `auth.users(id)` (directly, or transitively through another owned row). The
   owner identity lives in `public.profiles` (1:1 with `auth.users`, created on
   signup by the `handle_new_user` trigger).
2. **Enable RLS** on the table. With RLS on and no policy, all access is denied —
   this is the correct fail-closed default.
3. **Grant the table** to `authenticated` for the operations the role needs
   (`grant select, insert, update, delete on <table> to authenticated`). Grants
   only make the table *reachable* — they do not restrict operations, and Supabase
   default privileges may already grant ALL on new `public` tables. What actually
   denies an operation is the **absence of an RLS policy** for it (deny-by-default),
   not a withheld grant. Grant the operations you'll write policies for; deny the
   rest by simply not writing a policy.
4. **Write policies** that combine `TO authenticated` with an ownership predicate.
   `TO authenticated` alone is authentication without authorization (BOLA/IDOR).
   Wrap `auth.uid()` in a subselect so the planner evaluates it once.

```sql
create policy "<table>_select_own"
  on public.<table>
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

-- UPDATE needs BOTH using and with check, or a user could reassign owner_id.
create policy "<table>_update_own"
  on public.<table>
  for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
```

Notes:
- An `UPDATE` first needs to `SELECT` the row — a table with no SELECT policy will
  silently update 0 rows. Always pair them.
- Caretaker (link-based, no-login) access is a *different* model — see
  "The token model" below. It does not reuse these owner policies.

## `SECURITY DEFINER` functions (rare — hardening checklist)

Only when a controlled action must bypass RLS (e.g. the signup trigger). Then:
- `set search_path = ''` and fully-qualify every object (`public.x`, `auth.y`).
- `revoke execute on function public.<fn>() from public` so it is not a callable
  public API endpoint.
- Keep an `auth.uid()` check in the body if it does anything user-scoped.
- Prefer `SECURITY INVOKER` (the default) everywhere else. Never add
  `SECURITY DEFINER` just to silence a permission error.

## The token model (link-based, no-login access)

Introduced by S-02. This is the *second* access model in the schema and the only
one that serves a caller with no `auth.users` row. Read this before adding any
caretaker capability.

Every policy above is `TO authenticated` with an `auth.uid()` predicate, so a
caretaker arriving with a link is the `anon` role and RLS denies them
everything. That is the correct fail-closed default — and the reason this needs
a **function**, not an anon policy.

**The four rules:**

1. **Digest-only storage.** The raw invite token is generated in the app
   (`src/lib/invite-token.ts`: 32 bytes, base64url), and only its hex SHA-256
   reaches the database (`care_periods.token_digest`, unique). The raw value is
   returned to the owner exactly once, on the create/regenerate response. It is
   never stored, never logged, and cannot be read back — losing it means
   regenerating, which invalidates the previous link.
2. **One `SECURITY DEFINER` function is the entire anon-reachable surface.**
   `public.get_period_by_token(p_token text)` computes the digest inside the
   function, resolves **at most one** active period, and returns the period plus
   its slots' free/taken state — no instruction rows, no `owner_id`, no
   `token_digest`, and no parameter that could widen the result set. Its body is
   the whole authorization boundary: there is no policy behind it. Hence
   `set search_path = ''`, fully-qualified objects, and an explicit
   `revoke execute … from public, anon, authenticated, service_role` followed by
   `grant execute … to anon, authenticated`.
3. **No anon policy on any table, and no anon table grants.** Supabase's
   `ALTER DEFAULT PRIVILEGES` grants anon SELECT/INSERT/UPDATE/DELETE on every
   new table in `public`, so the S-02 migration explicitly revokes them on
   `care_periods` and `care_slots`. Deny-by-default already returned zero rows,
   but the claim "the function is the only door" should rest on two layers, not
   one. The function still reads those tables because it runs as its owner.
4. **Uniform failure.** Unknown, malformed and revoked tokens all return NULL,
   and the page renders one 404 with one message. A distinct "this link was
   revoked" answer would confirm the period exists. The copy carries the "ask the
   owner for a new link" guidance the response deliberately withholds.

**The rule for future slices:** a new caretaker capability *extends this
function* (or adds another one under the same four rules). It does **not** add an
anon policy to a table. S-03's slot claiming and S-04's occupancy view both land
under this rule.

**Response headers.** The token travels in a URL path segment, because the server
has to resolve it before rendering — a fragment never reaches the server. That
makes the response a second escape route, so `src/middleware.ts` sends
`Referrer-Policy: no-referrer` and `Cache-Control: no-store` for `/invite/*`.
Without the first, the page's first outbound link or third-party asset would send
the full path — token included — in `Referer`. Note what this does *not* fix: the
token is still in browser history and in the access log of anything that proxies
the request. The link is a bearer credential; treat it as one.

**Route gating.** `/invite` must stay out of `PROTECTED_ROUTES`. It is public by
requirement, and `tests/middleware/auth-gating.test.ts` asserts that, so adding
it later fails a test instead of silently bouncing every caretaker to a sign-in
page they have no account for.

## Migration workflow (local-first)

```
npm run db:migration <name>   # create supabase/migrations/<timestamp>_<name>.sql
# edit the SQL
npm run db:reset              # apply all migrations + seed from scratch (verifies clean apply)
npm run db:gen-types         # REGENERATE src/db/database.types.ts from the new schema
npm run db:push              # promote to the hosted project (separate from app deploy)
```

- `src/db/database.types.ts` is **generated, never hand-edited** — it is ignored by
  eslint and prettier. Regenerate it after *every* migration; a stale file silently
  lies to the type checker.
- Verify before committing: `npm run db:reset` (exit 0), `npx astro check`,
  `npm run lint`, and `npx supabase db advisors --type security`.

## Verifying RLS without the app

Simulate an authenticated user in psql:

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"<user-uuid>"}';
select * from public.<table>;  -- should return only that user's rows
commit;
```
