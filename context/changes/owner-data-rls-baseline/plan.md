# Owner-data RLS baseline (F-01) Implementation Plan

## Overview

Establish Pupilownik's **data-access contract** so every future slice persists data the same safe way. This foundation wires a working local Supabase migration loop, demonstrates the **owner-isolation Row-Level Security (RLS) pattern** on a real `profiles` table (1:1 with `auth.users`, auto-created on signup), generates and wires a **typed Supabase client**, and lands a **minimal seed** — all without building any domain tables (pets, care periods, slots belong to S-01+).

The single non-negotiable goal is owner isolation: a logged-in owner can read/write only their own rows, enforced by RLS keyed on `auth.uid()`. Getting this wrong means cross-tenant data leak, which the PRD's guardrails ("pełny dostęp wyłącznie do własnych danych", "instrukcje nie wyciekają poza krąg") forbid.

## Current State Analysis

- **Auth is fully wired.** `src/lib/supabase.ts:9` builds a cookie-bound SSR client via `@supabase/ssr` `createServerClient` using `SUPABASE_URL` + `SUPABASE_KEY` from `astro:env/server`. `src/middleware.ts` resolves `context.locals.user` from `supabase.auth.getUser()` and guards `/dashboard`. Owner identity already lives in `auth.users`.
- **The data layer is empty.** `supabase/` contains only `config.toml`. There is **no** `supabase/migrations/` directory, no migration, no `seed.sql`, no generated DB types.
- **Migration tooling is present but unwired.** `config.toml` has `[db.migrations] enabled = true` and `[db.seed] enabled = true` pointing at `./seed.sql`; the `supabase` CLI (`^2.23.4`) is a devDependency — but `package.json:5-13` has **no** db scripts. The dev loop does not exist yet.
- **The Supabase client is untyped.** `createServerClient(...)` is called without a `<Database>` generic, so all queries return `any`. No `src/db/database.types.ts`.
- **No test framework.** No vitest/jest installed. Today's only automated gates are `eslint` (`npm run lint`) and `astro check` (typecheck via `@astrojs/check`).
- **Security boundary depends on the key.** RLS only protects data if the SSR client uses the **anon / publishable** key (so the user's JWT from the cookie is the identity). A `service_role` key would bypass RLS entirely. `SUPABASE_KEY` must be the anon key.

## Desired End State

A developer can run `npm run db:start` then `npm run db:reset` and get a clean local Postgres with the `profiles` table, its RLS policies, the signup trigger, and the seed applied. Signing up a new user (via the existing auth flow against the local stack) creates exactly one `profiles` row automatically. A query for profiles returns only the caller's own row; another user's row is invisible. `src/db/database.types.ts` exists and `src/lib/supabase.ts` is typed as `createServerClient<Database>`, so `astro check` passes with typed query surface. A short convention doc tells slice authors how to add the next table the same way.

### Key Discoveries:

- SSR client RLS-respecting path confirmed at `src/lib/supabase.ts:9` — keep the anon key; do **not** introduce a service_role client in this foundation.
- `config.toml:53-65` already enables migrations + seed (`./seed.sql`), so wiring is config-complete; only the `migrations/` dir, `seed.sql`, and npm scripts are missing.
- Profile-on-signup is best done with a Postgres `security definer` trigger on `auth.users` (canonical Supabase pattern) — it works regardless of which code path (API route, future OAuth) created the user, so it cannot be bypassed by app code.
- Type generation pattern: `supabase gen types typescript --local` reads the local DB; it must be re-run after every migration (fold into the workflow + convention doc).

## What We're NOT Doing

- **No domain tables** — `pets`, `instructions`, `care_periods`, `slots`, `slot_assignments` are S-01+ work. This foundation only establishes the pattern and the `profiles` anchor.
- **No invite-link / caretaker access model** — that token-based, no-login path is introduced in S-02/S-03, not here.
- **No service_role client, no admin bypass, no RPC layer.**
- **No new test framework / RLS automated harness** — verification is `db reset` + typecheck/lint + a manual two-user check (decided for speed; revisit when table count grows).
- **No CI wiring for migrations** — deploy/CI is a separate concern; this plan covers the local dev loop and the `db:push` escape hatch only.
- **No owner profile attributes beyond identity** — `profiles` stays minimal (id + created_at); display names etc. are future.

## Implementation Approach

Three phases, ordered tooling → security spine → typing/docs, each independently verifiable:

1. **Migration workflow & local stack** — make the dev loop exist before there's anything to migrate.
2. **`profiles` + owner-isolation RLS + signup trigger + seed** — the security spine; this is the part that must be correct.
3. **Typed client & convention doc** — turn the schema into a typed contract and document the pattern slices copy.

## Critical Implementation Details

- **Anon key is the security boundary.** The signup trigger uses `security definer` to insert into `profiles` (bypassing RLS for that one controlled insert), but all client-facing access goes through the anon-keyed SSR client where RLS is enforced. Never wire a service_role key into the request path. `.env.example` must state that `SUPABASE_KEY` is the anon/publishable key.
- **RLS is deny-by-default.** Enabling RLS on a table with no policy denies all access. The migration must enable RLS **and** add explicit `select`/`update` policies on `profiles`, or the app (and the manual test) will see zero rows — which is the correct, fail-closed default to document for slices.
- **Trigger runs in the `auth` insert transaction.** `handle_new_user` fires `after insert on auth.users`; if it errors, signup fails. Keep it minimal (insert id + created_at) so it can't break the auth flow.
- **Types must be regenerated after every migration.** `database.types.ts` is generated, not hand-edited; a stale file silently lies to the type checker. The convention doc and the workflow both call this out.

## Phase 1: Migration workflow & local stack

### Overview

Wire the Supabase CLI into npm scripts and establish `supabase/migrations/` so there is a deterministic, repeatable local dev loop before any schema exists.

### Changes Required:

#### 1. Database npm scripts

**File**: `package.json`

**Intent**: Give the project a one-command dev loop for the database so migrations, resets, type generation, and remote push are discoverable and consistent. This is the workflow every later phase and slice depends on.

**Contract**: Add `scripts` entries (names are the contract other docs/slices will reference):

- `db:start` → `supabase start`
- `db:stop` → `supabase stop`
- `db:reset` → `supabase db reset`
- `db:migration` → `supabase migration new`
- `db:push` → `supabase db push`
- `db:gen-types` → `supabase gen types typescript --local > src/db/database.types.ts`

#### 2. Migrations directory

**File**: `supabase/migrations/` (new directory; first migration file added in Phase 2)

**Intent**: Establish the canonical location the Supabase CLI reads/writes migrations from, matching `config.toml`'s already-enabled migration support.

**Contract**: Directory exists and is tracked by git (add a `.gitkeep` if empty after this phase). Created via `npm run db:migration <name>` in Phase 2.

### Success Criteria:

#### Automated Verification:

- Local stack boots: `npm run db:start` succeeds and reports local API + DB URLs
- Clean reset works on empty schema: `npm run db:reset` exits 0
- Lint passes: `npm run lint`

#### Manual Verification:

- `supabase/migrations/` exists and is git-tracked
- Local Supabase Studio is reachable (default `http://127.0.0.1:54323`) and the DB is empty (no domain tables)

**Implementation Note**: Requires Docker running locally. After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: profiles table + owner-isolation RLS + signup trigger + seed

### Overview

The security spine. Create the `profiles` table as the owner anchor, enforce owner-only access via deny-by-default RLS, auto-create a profile on signup with a `security definer` trigger, and add a minimal seed for manual verification.

### Changes Required:

#### 1. Initial migration — profiles + RLS + trigger

**File**: `supabase/migrations/<timestamp>_init_profiles_rls.sql` (create via `npm run db:migration init_profiles_rls`)

**Intent**: Define the owner-identity table that every future domain table will FK to, and lock it down so an owner can read/write only their own row. Establish the exact RLS shape slices will replicate.

**Contract**: One migration containing, in order:

- `profiles` table: `id uuid primary key references auth.users(id) on delete cascade`, `created_at timestamptz not null default now()`. (Minimal by decision — no email/display_name in MVP.)
- `alter table profiles enable row level security;`
- Policy `profiles_select_own`: `for select using (auth.uid() = id)`.
- Policy `profiles_update_own`: `for update using (auth.uid() = id) with check (auth.uid() = id)`.
- No insert/delete policy for clients (insert handled by trigger; delete cascades from `auth.users`).
- Function `public.handle_new_user()` `language plpgsql security definer set search_path = public` that inserts `new.id` into `profiles`.
- Trigger `on_auth_user_created` `after insert on auth.users for each row execute function public.handle_new_user()`.

Snippet (the trigger is the non-obvious, security-sensitive part other slices will not re-derive):

```sql
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

#### 2. Minimal seed

**File**: `supabase/seed.sql`

**Intent**: Give `db:reset` deterministic end-to-end behavior and provide a known owner for the manual RLS check, without seeding domain data.

**Contract**: A header comment documenting the seed convention plus one seeded test owner sufficient to verify RLS manually. Because `auth.users` rows are created through the auth system (and the trigger then creates the profile), the seed should create a test auth user via the supported SQL path (insert into `auth.users` with a known UUID/email) so a corresponding `profiles` row exists after reset. Keep it to a single owner; comment that domain seed rows are added by slices.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly from scratch: `npm run db:reset` exits 0 with the migration + seed applied
- Lint passes: `npm run lint`

#### Manual Verification:

- In Supabase Studio, `profiles` exists with RLS enabled and exactly the two policies
- Signing up a new user against the local stack (existing `/auth/signup` flow) creates exactly one matching `profiles` row (trigger fires)
- Two-user isolation: authenticated as user A, a `select * from profiles` returns only A's row; user B's row is not visible (RLS enforced via anon-keyed client)
- Deleting a user in `auth.users` cascades and removes their `profiles` row

**Implementation Note**: This is the load-bearing phase — do not proceed until the two-user isolation check passes by hand. Pause for manual confirmation before Phase 3.

---

## Phase 3: Typed client & convention doc

### Overview

Turn the live schema into a typed contract and document the pattern so slice authors add the next table the same way.

### Changes Required:

#### 1. Generated DB types

**File**: `src/db/database.types.ts` (generated)

**Intent**: Produce the TypeScript `Database` type from the local schema so all Supabase queries are type-checked.

**Contract**: Output of `npm run db:gen-types`. Generated artifact — never hand-edited. Contains the `Database` type including the `profiles` row/insert/update shapes.

#### 2. Wire the typed client

**File**: `src/lib/supabase.ts`

**Intent**: Make the existing SSR client generic over `Database` so downstream queries inherit type safety, with zero behavior change to the auth/cookie wiring.

**Contract**: Import `Database` from `@/db/database.types` and change `createServerClient(...)` to `createServerClient<Database>(...)`. No change to key handling, cookie adapter, or the null-guard. (Optionally export a `type AppSupabaseClient = ReturnType<typeof createClient>` for slices to annotate against.)

#### 3. Data-access convention doc

**File**: `docs/reference/data-access.md` (new)

**Intent**: Capture the repeatable recipe so every slice's new table is created the safe way without re-deciding it.

**Contract**: A short doc covering: (a) every table FKs owner via `owner_id uuid references auth.users(id)` (or `profiles(id)`) and enables RLS deny-by-default with explicit `auth.uid()` policies; (b) the migration workflow (`db:migration` → edit SQL → `db:reset` → `db:gen-types`); (c) the rule that `database.types.ts` is regenerated after every migration and never edited by hand; (d) the anon-key / no-service_role-in-request-path constraint.

#### 4. `.env.example` clarification

**File**: `.env.example`

**Intent**: Prevent a future contributor from pasting a service_role key and silently disabling RLS.

**Contract**: Annotate `SUPABASE_KEY` with a comment that it must be the anon / publishable key (RLS-enforced), and note where the local key comes from (`supabase start` output).

### Success Criteria:

#### Automated Verification:

- Types generate without error: `npm run db:gen-types` produces a non-empty `src/db/database.types.ts`
- Type checking passes with the typed client: `npx astro check`
- Lint passes: `npm run lint`

#### Manual Verification:

- A sample typed `from("profiles").select()` call surfaces the correct row type in the editor (no `any`)
- `docs/reference/data-access.md` reads clearly enough that S-01 can add `pets` by following it
- `.env.example` states the anon-key requirement

**Implementation Note**: After automated verification passes, pause for manual confirmation. This completes F-01.

---

## Testing Strategy

### Unit Tests:

- None added (no framework, by decision). Type checking via `astro check` is the standing automated guard for the typed query surface.

### Integration Tests:

- `npm run db:reset` is the de-facto integration check: it proves the migration + trigger + seed apply together from scratch.

### Manual Testing Steps:

1. `npm run db:start` then `npm run db:reset` — confirm clean apply.
2. Sign up a new user against the local stack via `/auth/signup`; confirm exactly one `profiles` row appears (trigger).
3. As user A, query `profiles` — confirm only A's row returns.
4. Repeat as user B — confirm B cannot see A's row (owner isolation).
5. Delete A in `auth.users` — confirm A's `profiles` row cascades away.

## Performance Considerations

None material at MVP scale (target: medium users, low QPS). RLS policies on a single-column `auth.uid() = id` predicate are index-backed by the primary key.

## Migration Notes

- Migrations are local-first: author with `npm run db:migration`, validate with `npm run db:reset`, then promote to the hosted project with `npm run db:push` (separate from app deploy).
- This is the first migration in the project; it is additive only (no existing data to migrate).

## References

- Roadmap: `context/foundation/roadmap.md` (F-01)
- PRD: `context/foundation/prd.md` (Access Control; NFR — wrażliwe dane nie wyciekają)
- Tech stack: `context/foundation/tech-stack.md`
- Existing SSR client: `src/lib/supabase.ts:9`
- Auth middleware: `src/middleware.ts`
- Supabase config (migrations/seed enabled): `supabase/config.toml:53-65`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration workflow & local stack

#### Automated

- [x] 1.1 Local stack boots: `npm run db:start` succeeds and reports local API + DB URLs — bb3917f
- [x] 1.2 Clean reset works on empty schema: `npm run db:reset` exits 0 — bb3917f
- [x] 1.3 Lint passes: `npm run lint` — bb3917f

#### Manual

- [x] 1.4 `supabase/migrations/` exists and is git-tracked — bb3917f
- [x] 1.5 Local Supabase Studio reachable and DB empty (no domain tables) — bb3917f

### Phase 2: profiles table + owner-isolation RLS + signup trigger + seed

#### Automated

- [x] 2.1 Migration applies cleanly from scratch: `npm run db:reset` exits 0 with migration + seed applied
- [x] 2.2 Lint passes: `npm run lint`

#### Manual

- [x] 2.3 `profiles` exists in Studio with RLS enabled and exactly the two policies
- [x] 2.4 Signup creates exactly one matching `profiles` row (trigger fires)
- [x] 2.5 Two-user isolation: A sees only A's row; B's row invisible
- [x] 2.6 Deleting a user in `auth.users` cascades and removes their `profiles` row

### Phase 3: Typed client & convention doc

#### Automated

- [ ] 3.1 Types generate without error: `npm run db:gen-types` produces non-empty `src/db/database.types.ts`
- [ ] 3.2 Type checking passes with typed client: `npx astro check`
- [ ] 3.3 Lint passes: `npm run lint`

#### Manual

- [ ] 3.4 Sample typed `from("profiles").select()` surfaces correct row type (no `any`)
- [ ] 3.5 `docs/reference/data-access.md` lets S-01 add `pets` by following it
- [ ] 3.6 `.env.example` states the anon-key requirement
