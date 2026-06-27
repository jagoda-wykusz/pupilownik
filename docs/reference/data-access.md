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
   make the table reachable; RLS policies decide *which rows*. Without the grant,
   policies never get a chance to run.
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
- Caretaker (link-based, no-login) access is a *different* model introduced later
  (S-02/S-03); it will not reuse these owner policies.

## `SECURITY DEFINER` functions (rare — hardening checklist)

Only when a controlled action must bypass RLS (e.g. the signup trigger). Then:
- `set search_path = ''` and fully-qualify every object (`public.x`, `auth.y`).
- `revoke execute on function public.<fn>() from public` so it is not a callable
  public API endpoint.
- Keep an `auth.uid()` check in the body if it does anything user-scoped.
- Prefer `SECURITY INVOKER` (the default) everywhere else. Never add
  `SECURITY DEFINER` just to silence a permission error.

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
