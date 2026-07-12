# Pet & Instructions (S-01) Implementation Plan

## Overview

The first domain slice. A logged-in owner defines a pet (name, species, breed, age) and attaches **structured care instructions**, each flagged public or sensitive. Data is persisted under owner-isolation RLS following the F-01 pattern. Because this is the project's first authenticated DB write, it also **establishes the patterns every later slice copies**: server-side zod validation, a React-island form that POSTs JSON to an API route, an atomic `security invoker` RPC for multi-table writes, and transitive RLS for child tables.

The public/sensitive split on instructions is load-bearing for S-03: the caretaker sees public instructions pre-claim and sensitive ones only after claiming a slot. S-01 must get that column right now so S-03 doesn't force a data migration.

## Current State Analysis

- **Data pattern is templated by F-01.** `supabase/migrations/20260627125956_init_profiles_rls.sql` shows the exact shape: table with owner FK → `enable row level security` → `grant` → `(select auth.uid()) = <owner>` policies. `profiles` is the owner anchor (1:1 with `auth.users`). Workflow: `npm run db:migration` → edit SQL → `npm run db:reset` → `npm run db:gen-types`. Seed owner UUID is `33333333-3333-3333-3333-333333333333` (`supabase/seed.sql`).
- **S-01 is the first authenticated DB write.** No `.from()` query exists in `src/**` yet; `src/lib/supabase.ts` exposes `createClient(headers, cookies) → SupabaseClient<Database> | null`. No zod anywhere. No Astro Actions. The only form pattern is auth: HTML form POST → API route → `formData()` → redirect (`src/pages/api/auth/*.ts`).
- **RLS test harness exists** (`testing-rls-owner-isolation`, cookbook §6.5): every new table copies `tests/rls/<table>.isolation.test.ts` asserting all four denial surfaces via `createOwnerClient()` (`tests/helpers/auth.ts`), anon key only.
- **Storage enabled but no bucket** (`supabase/config.toml:109-127`) — pet photos are out of scope (see below).
- **Styling** is oklch design tokens in `src/styles/global.css` + a CVA button (`src/components/ui/button.tsx`); auth forms are React islands (`client:load`). The hi-fi visual system (Quicksand/Nunito, plum `#9C5470`) belongs to **S-07** and is not built — S-01 uses current tokens and S-07 reskins later.

### Key Discoveries:

- Owner-isolation policy shape to mirror: `create policy "<t>_select_own" ... using ((select auth.uid()) = owner_id)`; UPDATE needs both `using` and `with check` (`docs/reference/data-access.md:37-51`).
- `data-access.md:20-22` explicitly sanctions carrying the owner **transitively through another owned row** — the basis for `care_instructions` RLS via `pets.owner_id`.
- The signup trigger uses `security definer set search_path = ''` and `revoke execute ... from public` (`init_profiles_rls.sql:43-57`) — the hardening checklist S-01's RPC follows, except the RPC is `security invoker` (it must respect the caller's RLS).
- `database.types.ts` is generated (`npm run db:gen-types`), never hand-edited; regenerate after the migration or the type checker silently lies (`data-access.md:79-81`).

## Desired End State

A logged-in owner visits `/pets/new`, fills in name/species/breed/age, adds one or more instruction rows (each with a public/sensitive toggle), and saves. The pet and its instructions are written atomically under RLS. They then see the pet on `/pets` (their own pets only). Another owner can never see or modify these rows (proven by RLS isolation tests). Bad input is rejected server-side with a clean 400. Verified by: `npm run db:reset` (exit 0), `npx supabase db advisors --type security` (clean), `npm test` (RLS + API tests green), `npm run build`, `npm run lint`, and a manual two-owner check.

## What We're NOT Doing

- **No pet photo upload** — needs a Storage bucket + storage RLS; not in FR-002. Placeholder avatar only. (Deferred; revisit when the design's photo is prioritized.)
- **No edit / delete of pets or instructions** — S-01 is add + list own. Edit/delete is later scope.
- **No hi-fi reskin** — S-01 uses current tokens; the Quicksand/Nunito/plum system is S-07 (`ui-design-system`).
- **No caretaker/link view of instructions** — the public/sensitive *reveal* is S-03; S-01 only stores the split correctly.
- **No structured feeding schedule** (hours/grams/chambers) — parked to v2 (PRD Open Questions #1). Instruction `body` is free text.
- **No care-period / slot tables** — S-02/S-03.

## Implementation Approach

Three phases, data → API → UI, each independently verifiable. Phase 1 lands the schema, RLS, atomic write path, and RLS isolation tests (the security spine). Phase 2 introduces zod and the validated JSON API endpoint over the atomic RPC. Phase 3 builds the React-island form and the owner's pet list, wired into the protected-route set. Every phase mirrors an existing pattern (F-01 migration, auth API route, auth React island) so the slice reads like the surrounding code.

## Critical Implementation Details

- **Atomic multi-table write.** A pet and its instructions must be inserted in one transaction — S-01 has no edit path, so a pet saved without its instructions is unrecoverable. Use a `security invoker` Postgres function `public.create_pet_with_instructions(...)` called via `supabase.rpc(...)`; `security invoker` means the caller's RLS still applies (no bypass). This is the atomic-write precedent S-02/S-03 will lean on.
- **Child-table RLS is transitive.** `care_instructions` has no `owner_id`; its policies gate on ownership of the parent pet via `exists (select 1 from public.pets p where p.id = pet_id and (select auth.uid()) = p.owner_id)`. Single source of truth for ownership stays on `pets`.
- **Regenerate types after the migration.** `src/db/database.types.ts` must be regenerated (`npm run db:gen-types`) so the new tables, the species enum, and the RPC signature are typed; a stale file passes `astro check` while lying.

## Phase 1: Schema, RLS & atomic write path

### Overview

Create `pets` and `care_instructions` with deny-by-default owner-isolation RLS, the atomic create RPC, a seed, regenerated types, and RLS isolation tests proving all four denial surfaces on both tables.

### Changes Required:

#### 1. Migration — pets + care_instructions + RLS + RPC

**File**: `supabase/migrations/<timestamp>_pets_and_instructions.sql` (via `npm run db:migration pets_and_instructions`)

**Intent**: Define the first domain tables and lock them to their owner, mirroring the F-01 pattern, plus the atomic write function. This is the security-sensitive core.

**Contract**: One migration containing, in order:

- Species type: Postgres enum `public.pet_species as enum ('dog','cat','other')`.
- `public.pets`: `id uuid primary key default gen_random_uuid()`, `owner_id uuid not null references auth.users(id) on delete cascade`, `name text not null`, `species public.pet_species not null`, `breed text`, `age text`, `created_at timestamptz not null default now()`. (breed/age nullable; age is free text per decision.)
- `public.care_instructions`: `id uuid primary key default gen_random_uuid()`, `pet_id uuid not null references public.pets(id) on delete cascade`, `title text not null`, `body text`, `is_sensitive boolean not null default false`, `sort_order integer not null default 0`, `created_at timestamptz not null default now()`.
- `enable row level security` on both tables.
- Grants: `grant select, insert, update, delete on public.pets, public.care_instructions to authenticated` (deny still comes from absence of policy per `data-access.md`).
- **pets policies** (all four, `to authenticated`): `pets_select_own`/`insert`/`update`/`delete` on `(select auth.uid()) = owner_id`; UPDATE carries `with check` too.
- **care_instructions policies** (all four, `to authenticated`) gating transitively on parent ownership. INSERT/UPDATE use `with check` on the same `exists` predicate.
- `public.create_pet_with_instructions(p_name text, p_species public.pet_species, p_breed text, p_age text, p_instructions jsonb)` — `language plpgsql security invoker`. Inserts the pet with `owner_id = auth.uid()`, then bulk-inserts instructions from the jsonb array, returns the new pet row. RLS applies because it is `security invoker`.

**Contract snippet** (the transitive child policy + invoker RPC are the non-obvious parts other slices will copy):

```sql
create policy "care_instructions_select_own"
  on public.care_instructions for select to authenticated
  using (exists (
    select 1 from public.pets p
    where p.id = care_instructions.pet_id and (select auth.uid()) = p.owner_id
  ));

create function public.create_pet_with_instructions(
  p_name text, p_species public.pet_species, p_breed text, p_age text, p_instructions jsonb
) returns public.pets
language plpgsql security invoker
as $$
declare new_pet public.pets;
begin
  insert into public.pets (owner_id, name, species, breed, age)
  values ((select auth.uid()), p_name, p_species, p_breed, p_age)
  returning * into new_pet;

  insert into public.care_instructions (pet_id, title, body, is_sensitive, sort_order)
  select new_pet.id, i->>'title', i->>'body',
         coalesce((i->>'is_sensitive')::boolean, false),
         coalesce((i->>'sort_order')::int, 0)
  from jsonb_array_elements(coalesce(p_instructions, '[]'::jsonb)) as i;

  return new_pet;
end;
$$;
```

#### 2. Seed a pet for the test owner

**File**: `supabase/seed.sql`

**Intent**: Give `db:reset` deterministic domain data and a known pet for the manual two-owner check, owned by the existing seed owner.

**Contract**: Append an insert of one pet (owner `33333333-…`) plus 2 instructions (one public, one sensitive). Keep it minimal; comment that it belongs to S-01.

#### 3. Regenerate DB types

**File**: `src/db/database.types.ts` (generated)

**Intent**: Type the new tables, the `pet_species` enum, and the RPC so queries and the `.rpc()` call are type-checked.

**Contract**: Output of `npm run db:gen-types` after `db:reset`. Generated — never hand-edited.

#### 4. RLS isolation tests for both tables

**File**: `tests/rls/pets.isolation.test.ts`, `tests/rls/care-instructions.isolation.test.ts`

**Intent**: Prove owner isolation on the new tables per test-plan §6.5 — the deny-by-default gate lives on INSERT/DELETE, not just SELECT.

**Contract**: Mirror `tests/rls/profiles.isolation.test.ts` using `createOwnerClient()` for owners A and B (anon key only, never service-role). Seed each owner a pet (+ instructions) via the app insert path / RPC. Assert all four surfaces: SELECT (A sees only A's), UPDATE (A→B's row affects 0 / unchanged), INSERT (writing a row under B's pet is rejected), DELETE (A cannot delete B's). For `care_instructions`, the probe rides on the parent pet's ownership.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly from scratch: `npm run db:reset` exits 0
- Security advisors clean: `npx supabase db advisors --type security`
- Types regenerate non-empty and typecheck: `npm run db:gen-types` then `npx astro check`
- RLS isolation tests pass: `npm test`
- Lint passes: `npm run lint`

#### Manual Verification:

- In Supabase Studio, `pets` and `care_instructions` show RLS enabled with the four policies each
- Two-owner check: as owner A, `.from("pets").select()` returns only A's pets; B's are invisible; same for instructions via the parent
- `create_pet_with_instructions` inserts pet + instructions atomically (a failing instruction rolls back the pet)

**Implementation Note**: Load-bearing security phase — do not proceed until the two-owner isolation check passes by hand. Requires Docker + local stack. Pause for manual confirmation before Phase 2.

---

## Phase 2: Validated API endpoint

### Overview

Introduce zod and a POST `/api/pets` endpoint that validates input server-side and performs the atomic create via the RPC. Establishes the server-side validation precedent (test-plan Risk #7).

### Changes Required:

#### 1. Add zod + the pet input schema

**File**: `package.json`, `src/lib/schemas/pet.ts` (new)

**Intent**: Introduce zod as the server-side validation library and define the pet-creation contract once, reusable by the API route (and later the client).

**Contract**: Add `zod` dependency. Export a `createPetSchema`: `name` non-empty string, `species` enum `["dog","cat","other"]`, `breed`/`age` optional strings, `instructions` array of `{ title: non-empty string, body?: string, is_sensitive: boolean, sort_order?: number }`. Export the inferred TS type.

#### 2. POST /api/pets handler

**File**: `src/pages/api/pets.ts` (new)

**Intent**: Accept the form's JSON, reject bad input server-side, and perform the atomic owner-scoped create. The first domain API route — the pattern for all later ones.

**Contract**: `POST` handler: require `context.locals.user` (else 401 JSON); build the client via `createClient(headers, cookies)` (401/500 if null); parse `await request.json()`; `createPetSchema.safeParse(...)` → on failure return 400 with a compact error body; on success call `supabase.rpc("create_pet_with_instructions", {...})`; return 201 with the new pet, or 500 on DB error. JSON in/out (not formData) — the pattern chosen for structured payloads.

#### 3. API handler tests

**File**: `tests/api/pets.post.test.ts` (new)

**Intent**: Prove the handler validates and persists per test-plan §6.4 — assert zod rejection of bad input AND the successful insert side-effect, not just a 200.

**Contract**: Exercise the handler against the local stack with an authenticated owner (reuse `createAuthenticatedCookieHeader()` from the auth-gating harness, or drive the route with a real session): malformed body (missing name / bad species / non-array instructions) → 400 and nothing inserted; valid body → 201, and the pet + instructions exist for that owner via a follow-up query. Never mock the Supabase client.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Lint passes: `npm run lint`
- API tests pass (zod rejection + happy-path insert side-effect): `npm test`
- Build passes: `npm run build`

#### Manual Verification:

- `curl`/REST a malformed payload → 400 with a readable error; DB unchanged
- A valid payload → 201; the pet + instructions appear for the owner

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Add-pet form & pet list UI

### Overview

Build the React-island add-pet form (fields + dynamic instruction list) and the owner's pet list, on protected routes, using current design tokens.

### Changes Required:

#### 1. Protect the /pets routes

**File**: `src/middleware.ts`

**Intent**: Gate the new owner pages so unauthenticated requests redirect to signin (same gate as `/dashboard`).

**Contract**: Add `"/pets"` to `PROTECTED_ROUTES`. No other middleware change.

#### 2. Add-pet React island

**File**: `src/components/pets/AddPetForm.tsx` (new)

**Intent**: The interactive form — name/species(segmented)/breed/age plus a dynamic list of instruction rows (add/remove, title/body, public/sensitive toggle) — submitting JSON to `/api/pets`.

**Contract**: A default-exported React component (hydrated `client:load`). Local state for fields + an instructions array (add/remove rows). Client-side validation for UX (mirrors `SignInForm`'s approach), but the server is the source of truth. On submit: `fetch("/api/pets", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload) })`; on 201 redirect to `/pets`; on 400 surface field errors; on other errors show a server-error banner (reuse `ServerError.tsx`). Reuse `FormField`, `SubmitButton`, `ui/button`. Species is a segmented control (dog/cat/other). No photo control.

#### 3. Pages: new + list

**File**: `src/pages/pets/new.astro`, `src/pages/pets/index.astro` (new)

**Intent**: Host the form island and list the owner's pets (proving the write landed and is owner-scoped).

**Contract**:
- `pets/new.astro`: protected page wrapping `<AddPetForm client:load />` in `Layout`, with a back link to `/pets`.
- `pets/index.astro`: protected page; in frontmatter build the server client via `createClient(Astro.request.headers, Astro.cookies)` and `.from("pets").select("*, care_instructions(*)").order(...)` — RLS scopes it to the owner. Render the pet cards (name, species, breed/age, instruction count; sensitive items visually marked) and a "Dodaj zwierzę" link to `/pets/new`. Empty state when the owner has no pets.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Full test suite still green: `npm test`

#### Manual Verification:

- Logged in, `/pets/new` → add a pet with 2 instructions (one sensitive) → redirected to `/pets`, pet visible with correct fields
- The sensitive instruction is stored with `is_sensitive = true` (checked in Studio or the list marking)
- Logged out, visiting `/pets` or `/pets/new` redirects to `/auth/signin`
- A second owner does not see the first owner's pets in their `/pets` list

**Implementation Note**: After automated verification passes, pause for manual confirmation. This completes S-01.

---

## Testing Strategy

### Unit Tests:

- zod schema is exercised through the API handler test (not asserted in isolation — avoid mirroring the schema's own shape, per test-plan §7 tautology guidance).

### Integration Tests:

- RLS isolation for `pets` and `care_instructions` (all four denial surfaces) against local Supabase.
- `/api/pets` handler: zod rejection of malformed input + happy-path insert side-effect, with a real authenticated session (no mocked auth client).

### Manual Testing Steps:

1. `npm run db:start` + `npm run db:reset`; confirm clean apply and seeded pet.
2. Sign in as the seed owner; `/pets` shows the seeded pet.
3. `/pets/new` → add a pet with a public and a sensitive instruction → redirected to `/pets`, new pet visible.
4. In Studio, confirm the sensitive row has `is_sensitive = true`.
5. Sign in as a second owner → `/pets` does not show owner A's pets.
6. Logged out → `/pets` redirects to signin.

## Performance Considerations

None material at MVP scale (medium users, low QPS). RLS predicates are index-backed (`pets.owner_id`, `care_instructions.pet_id`). The list query's `care_instructions(*)` embed is a single round-trip.

## Migration Notes

- Additive migration; no existing domain data. Local-first: `db:migration` → edit → `db:reset` → `db:gen-types`, then `db:push` to promote (separate from app deploy).
- `zod` is a new runtime dependency.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-01)
- PRD: `context/foundation/prd.md` (FR-002, FR-003, US-01, Access Control)
- Data-access pattern: `docs/reference/data-access.md`; F-01 migration `supabase/migrations/20260627125956_init_profiles_rls.sql`
- RLS test recipe: `context/foundation/test-plan.md` §6.5; `tests/rls/profiles.isolation.test.ts`
- Auth API + island patterns: `src/pages/api/auth/signin.ts`, `src/components/auth/SignInForm.tsx`
- Design reference (visual target, reskin in S-07): `context/design/Pupilownik Hi-fi.html` ("Dodaj zwierzę + instrukcje")

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, RLS & atomic write path

#### Automated

- [x] 1.1 Migration applies cleanly from scratch: `npm run db:reset` exits 0
- [x] 1.2 Security advisors clean: `npx supabase db advisors --type security`
- [x] 1.3 Types regenerate non-empty and typecheck: `npm run db:gen-types` then `npx astro check`
- [x] 1.4 RLS isolation tests pass: `npm test`
- [x] 1.5 Lint passes: `npm run lint`

#### Manual

- [x] 1.6 Studio shows RLS enabled + four policies on each table
- [x] 1.7 Two-owner check: A sees only A's pets/instructions; B's invisible
- [x] 1.8 `create_pet_with_instructions` inserts atomically (failing instruction rolls back the pet)

### Phase 2: Validated API endpoint

#### Automated

- [ ] 2.1 Type checking passes: `npx astro check`
- [ ] 2.2 Lint passes: `npm run lint`
- [ ] 2.3 API tests pass (zod rejection + happy-path insert side-effect): `npm test`
- [ ] 2.4 Build passes: `npm run build`

#### Manual

- [ ] 2.5 Malformed payload → 400, DB unchanged
- [ ] 2.6 Valid payload → 201, pet + instructions appear for the owner

### Phase 3: Add-pet form & pet list UI

#### Automated

- [ ] 3.1 Type checking passes: `npx astro check`
- [ ] 3.2 Lint passes: `npm run lint`
- [ ] 3.3 Build passes: `npm run build`
- [ ] 3.4 Full test suite still green: `npm test`

#### Manual

- [ ] 3.5 Add a pet with 2 instructions (one sensitive) → redirected to `/pets`, pet visible with correct fields
- [ ] 3.6 Sensitive instruction stored with `is_sensitive = true`
- [ ] 3.7 Logged out → `/pets` and `/pets/new` redirect to `/auth/signin`
- [ ] 3.8 A second owner does not see the first owner's pets
