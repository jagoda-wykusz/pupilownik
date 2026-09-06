# Care Period & Invite Link (S-02) Implementation Plan

## Overview

An owner creates a care period over a date range; the system atomically generates one slot
per day per time-of-day (morning / afternoon / evening) and mints a single-use-display invite
link. A caretaker opens that link with no account and sees what the period is and which slots
are free. This slice introduces the unguessable-token access model that S-03 will claim slots
on top of, and S-04 will read occupancy from.

## Current State Analysis

- **Every policy in the schema is `to authenticated` with an `auth.uid()` predicate** —
  `20260627125956_init_profiles_rls.sql:33-45` (profiles) and
  `20260712204748_pets_and_instructions.sql:57-119` (pets, care_instructions). A caretaker
  arriving with a token is the `anon` role with no `auth.users` row, so RLS denies everything.
  This is the correct fail-closed default and the reason a function is needed, not a policy.
- `docs/reference/data-access.md` already anticipated this: *"Caretaker (link-based, no-login)
  access is a different model introduced later (S-02/S-03); it will not reuse these owner
  policies."* It also forbids the alternative — *"There is no service_role client in the
  request path, by design"* — which rules out minting scoped JWTs.
- **Exactly one `SECURITY DEFINER` function exists today** (`handle_new_user`), and it is not
  callable by an untrusted role (`revoke execute … from public`). This slice adds the first one
  that `anon` may call.
- **The atomic-RPC pattern is established**: `create_pet_with_instructions`
  (`20260712204748_pets_and_instructions.sql:122-155`) is `SECURITY INVOKER`, so the caller's
  RLS still applies, with `set search_path = ''` and fully-qualified objects.
- **The test harness has no anonymous client.** `createOwnerClient()`
  (`tests/helpers/auth.ts:19-40`) always signs up; there is no primitive for "anon-keyed client
  with no session", which is exactly what the token tests need.
- **`PROTECTED_ROUTES` gates by prefix** (`src/middleware.ts:6`, matched with `startsWith`), so
  a caretaker route under `/pets/…` would be silently redirected to sign-in.
- **Routes are English even though the UI is Polish** (`/pets`, `/pets/new`).
- The S-07 component layer (`src/components/ui/`) is available: `Input`, `Button`,
  `ScreenHeading`. `AddPetForm.tsx` still imports the superseded `FormField` — new forms must
  not copy that.

## Desired End State

A logged-in owner opens `/periods/new`, picks a date range, and lands on `/periods/[id]`
showing the generated slots and the invite link, with an explicit warning that the link is
shown once. Pasting that link into a logged-out browser renders the period and its free slots.
A tampered, unknown or revoked token renders the same "link nieaktywny" page. `npm test` proves
owner isolation on both new tables and proves the token function returns one period, refuses a
revoked one, and that `anon` cannot reach the tables directly.

### Key Discoveries:

- **Materialised slot rows make S-03 correct by construction.** With one row per slot plus
  `unique (period_id, slot_date, time_of_day)`, claiming becomes
  `UPDATE … WHERE id = $1 AND claimed_by IS NULL` — a single row-locked statement where the
  loser of a race updates 0 rows and gets a clean "already taken". No advisory locks, no
  retries. Computing slots on read would move that guarantee to a unique constraint on an
  inserted claim row and leave "which slots are free" as a generated-series join on every read.
- **Postgres 17** (`supabase/config.toml:36`) has `sha256()` in core and the Workers runtime has
  Web Crypto, so hashing the token needs no extension on either side. `gen_random_bytes` would
  have required `pgcrypto`, whose availability is unverified here.
- **Dates, not timestamps.** A slot is "the morning of 13 July" in the owner's calendar sense.
  Storing an instant would drag timezone conversion into every read and make slot identity
  ambiguous across DST.
- **S-01's impl-review findings apply almost verbatim** and should be designed in, not
  rediscovered: unbounded input as a DoS vector (F1), raw DB error returned to the client (F2),
  missing `revoke`/`grant execute` on the RPC (F3), null Supabase client rendering an empty
  state instead of an error (F5).

## What We're NOT Doing

- **No slot claiming.** Writing a caretaker's name into a slot is S-03. This slice's landing
  page is read-only.
- **No instructions on the caretaker page.** FR-008's public/sensitive reveal rule is S-03's
  guardrail and deserves its own slice; the token function must not return instruction rows.
- **No occupancy view for the owner.** Showing who took which slot is S-04 (FR-006).
  `/periods/[id]` lists slots and their free/taken state, not caretaker identities.
- **No "revoke period" UI.** FR-012 is S-06. The `revoked_at` column and the function's check
  land here (see Critical Implementation Details), but the only way to invalidate a link in this
  slice is regenerating it.
- **No period editing or deletion.** Out of scope; no FR covers it.
- **No email/notification of the link.** PRD §Non-Goals — the owner copies and sends it.
- **No reskin of `/pets` or `AddPetForm`.** They keep their starter styling; S-01 owns that debt.
- **No concurrency test.** There is nothing to claim yet.

## Implementation Approach

Bottom-up, four phases, each independently verifiable. Phase 1 builds the owner-side data layer
by copying S-01 almost line for line — the only new idea is slot generation. Phase 2 adds the
part that has no precedent in this codebase: a function untrusted callers may invoke, isolated
into its own phase so its verification is not diluted by UI work. Phase 3 puts the owner
interface on top. Phase 4 exercises the token from the outside, which is the only way to prove
the contract actually holds end to end.

Access is layered deliberately: grants make a table reachable, the absence of a policy denies an
operation, the policy predicate authorizes the owner — and for the caretaker, a function body
authorizes instead. That fourth layer is a widening of the model in `data-access.md` and is
recorded there as part of this slice.

## Critical Implementation Details

**The token function is the entire authorization boundary for `anon`.** No RLS policy backs it
up; if its body is wrong, it leaks. It must resolve exactly one period by digest, return no
instruction rows, refuse a period with `revoked_at` set, and never accept a parameter that could
widen the result set. `set search_path = ''` with fully-qualified objects is mandatory, and
`revoke execute … from public` followed by an explicit `grant … to anon, authenticated` is what
keeps it from being reachable by roles that should not have it.

**Uniform failure is a security property, not a UX preference.** Unknown, malformed and revoked
tokens must be indistinguishable to the caller — a distinct "this link was revoked" response
confirms the period exists. The page copy has to carry the "ask the owner for a new link"
guidance that the response deliberately withholds.

**Slot generation and period creation must be one transaction.** There is no edit path, so a
period without slots is unusable and unrecoverable — the same reasoning that made
`create_pet_with_instructions` atomic.

**The raw token exists exactly once.** It is generated in the app, its digest is stored, and it
is returned to the caller only on the create/regenerate response. It must never be logged (see
S-01 impl-review F2 — the same handler that leaked a DB error would leak this) and never
re-read from the database, because it isn't there.

## Phase 1: Schema, RLS & atomic period creation

### Overview

The owner-side data layer: two tables, deny-by-default RLS following the F-01 pattern, and an
atomic RPC that creates a period together with its generated slots.

### Changes Required:

#### 1. Migration: enum, tables, RLS, generation RPC

**File**: `supabase/migrations/<timestamp>_care_periods_and_slots.sql` (new, via `npm run db:migration`)

**Intent**: Establish the period and slot tables with owner-isolation RLS, and make period
creation atomic so a period can never exist without its slots.

**Contract**:
- `public.time_of_day` enum `('morning','afternoon','evening')`, mirroring how
  `public.pet_species` is declared.
- `public.care_periods`: `id`, `owner_id → auth.users(id) on delete cascade`, `title text`,
  `start_date date`, `end_date date`, `created_at timestamptz`. A `CHECK` that `end_date >=
  start_date` and that the span is at most 31 days — the bound that caps how many rows one
  transaction can generate.
- `public.care_slots`: `id`, `period_id → care_periods(id) on delete cascade`, `slot_date date`,
  `time_of_day public.time_of_day`, plus the nullable columns S-03 will fill
  (`claimed_by_name text`, `claimed_at timestamptz`). `unique (period_id, slot_date,
  time_of_day)` — this is what makes generation idempotent and double-booking impossible at the
  storage layer. Index `period_id` (Postgres does not index FKs automatically, and both the
  period read and the cascade need it).
- RLS enabled on both; `grant select, insert, update, delete … to authenticated`; four policies
  per table with `(select auth.uid())` in a subselect. `care_slots` anchors ownership
  transitively through `care_periods.owner_id`, exactly as `care_instructions` does through
  `pets.owner_id`. UPDATE carries both `using` and `with check`.
- `public.create_period_with_slots(p_title text, p_start_date date, p_end_date date,
  p_token_digest text) returns public.care_periods` — `SECURITY INVOKER`, `set search_path = ''`.
  Inserts the period with `owner_id = (select auth.uid())`, then generates the cartesian product
  of `generate_series(p_start_date, p_end_date, interval '1 day')` and the three enum values in
  one `INSERT … SELECT`. Followed immediately by `revoke execute … from public` and
  `grant execute … to authenticated` — written here rather than as a follow-up migration, which
  is what S-01's impl-review F3 had to correct after the fact.

The token digest parameter is present from the first migration so the column is `not null` and
no period can exist without one; the value's provenance is Phase 2's concern.

#### 2. Regenerate the generated types

**File**: `src/db/database.types.ts`

**Intent**: Keep the type checker honest about the new tables, enum and function.

**Contract**: Output of `npm run db:gen-types`. Generated, never hand-edited.

#### 3. Owner-isolation tests for both tables

**File**: `tests/rls/care-periods.isolation.test.ts`, `tests/rls/care-slots.isolation.test.ts` (new)

**Intent**: Prove owner A cannot reach owner B's periods or slots on any of the four surfaces.

**Contract**: Follow `context/foundation/test-plan.md` §6.5 and mirror
`tests/rls/pets.isolation.test.ts`: two owners from `createOwnerClient()`, seeded through the
app's own insert path, asserting SELECT / UPDATE / INSERT / DELETE denial plus the with-check
reassignment case. Never assert through a service-role client.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly from scratch: `npm run db:reset` exits 0
- Security advisors clean: `npx supabase db advisors --type security`
- Types regenerate and typecheck: `npm run db:gen-types` then `npx astro check`
- Isolation tests pass: `npm test`
- Linting passes: `npm run lint`

#### Manual Verification:

- Studio shows RLS enabled with four policies on each new table.
- Creating a 5-day period yields exactly 15 slots, one per day per time-of-day, with no gaps or
  duplicates.
- A 32-day range is rejected by the CHECK constraint rather than generating rows.
- A failed slot insert rolls back the period (nothing half-written).

**Implementation Note**: After automated verification passes, pause for manual confirmation
before Phase 2.

---

## Phase 2: The token model

### Overview

The part with no precedent in this codebase: storing only a digest, resolving a period from a
raw token through a `SECURITY DEFINER` function callable by `anon`, and regenerating a token.

### Changes Required:

#### 1. Token utilities

**File**: `src/lib/invite-token.ts` (new)

**Intent**: Mint a high-entropy token and derive its digest, in one place, so the app and the
database agree on the encoding and nothing else has to think about it.

**Contract**: `generateInviteToken(): string` — 32 bytes from `crypto.getRandomValues`, encoded
base64url (URL-safe, no padding). `digestInviteToken(token: string): Promise<string>` — hex
SHA-256 via `crypto.subtle.digest`, matching what Postgres `encode(sha256(...), 'hex')` would
produce so a value written by the app can be compared against one computed in SQL. Both run on
the Workers runtime; neither depends on a Postgres extension.

#### 2. Migration: digest column, revocation, resolution and regeneration

**File**: `supabase/migrations/<timestamp>_invite_token_access.sql` (new)

**Intent**: Give the period a token digest and a revocation marker, and expose exactly one
function to anonymous callers.

**Contract**:
- `care_periods.token_digest text not null` with a unique index (lookup is by digest, and two
  periods must never share one), plus `revoked_at timestamptz` nullable.
- `public.get_period_by_token(p_token text)` — `SECURITY DEFINER`, `set search_path = ''`,
  fully-qualified objects. Computes the digest inside the function from the raw token, resolves
  **at most one** period, returns NULL/empty when the period is missing or `revoked_at` is set.
  Returns period fields plus its slots and their free/taken state — and **no instruction rows**
  (FR-008 belongs to S-03). `revoke execute … from public` then `grant execute … to anon,
  authenticated`.
- `public.regenerate_period_token(p_period_id uuid, p_token_digest text)` — `SECURITY INVOKER`
  so the owner's RLS decides whether they may touch the row. Replaces the digest, which
  invalidates the previous link. `revoke … from public`, `grant … to authenticated`.

The two functions differ in security mode on purpose: the caretaker has no identity for RLS to
key on, the owner does. Adding `SECURITY DEFINER` to the second would be exactly the
"never add `SECURITY DEFINER` just to silence a permission error" case that
`docs/reference/data-access.md` warns against.

#### 3. Anonymous test client

**File**: `tests/helpers/auth.ts`

**Intent**: The harness can only produce authenticated clients; the token tests need a caller
with no session at all.

**Contract**: Add `createAnonClient(): SupabaseClient<Database>` — an anon-keyed client with no
`signUp` and no session, so it carries the `anon` role. Sits beside `createOwnerClient()` and
uses the same `getTestEnv()`. Register it in `docs/reference/contract-surfaces.md`.

#### 4. Token-model tests

**File**: `tests/rls/invite-token.test.ts` (new)

**Intent**: Cover the one thing RLS does not defend. The function bypasses RLS by design, so the
§6.5 isolation recipe does not reach it — these assertions are its only automated guard.

**Contract**: Using `createAnonClient()`:
- a valid token returns exactly one period, and it is the right one;
- owner B's token never returns owner A's period;
- a token whose period has `revoked_at` set returns nothing;
- an unknown / malformed token returns nothing, and does so indistinguishably from the revoked
  case;
- the returned payload carries no instruction rows;
- **`anon` selecting `care_periods` or `care_slots` directly returns nothing** — proving the
  function is the only door, not merely the intended one;
- after `regenerate_period_token`, the old token stops resolving and the new one starts.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:reset` exits 0
- Security advisors clean: `npx supabase db advisors --type security`
- Types regenerate and typecheck: `npm run db:gen-types` then `npx astro check`
- All token-model assertions pass, plus the Phase 1 suite: `npm test`
- Linting passes: `npm run lint`

#### Manual Verification:

- A digest produced by `digestInviteToken()` matches `encode(sha256(...),'hex')` computed in
  psql for the same raw token — the app and the database genuinely agree.
- `revoke`/`grant` are visible on both functions in Studio; `public` holds no execute grant.
- Calling `get_period_by_token` from psql as `anon` with a valid token returns the period, and
  selecting the tables directly as `anon` returns nothing.

**Implementation Note**: After automated verification passes, pause for manual confirmation
before Phase 3.

---

## Phase 3: Owner API & UI

### Overview

The owner's flow: create a period, see the link once, come back to the period, regenerate the
link if it was lost.

### Changes Required:

#### 1. Validation schema

**File**: `src/lib/schemas/period.ts` (new)

**Intent**: One server-side gate for the create payload, with the bounds S-01's impl-review F1
established as a habit.

**Contract**: `createPeriodSchema` — `title` (1–120 chars), `start_date` and `end_date` as ISO
date strings, refined so `end_date >= start_date` and the span is at most 31 days. The zod bound
duplicates the database CHECK deliberately: the CHECK is the guarantee, the zod bound is what
turns a violation into a clean 400 instead of a 500.

#### 2. API routes

**File**: `src/pages/api/periods.ts`, `src/pages/api/periods/[id]/token.ts` (new)

**Intent**: Create a period (returning the raw token exactly once) and regenerate its token.

**Contract**: Both follow `src/pages/api/pets.ts`: 401 when `context.locals.user` is absent, 500
when `createClient` returns null, JSON in/out, zod before any DB call, and a generic Polish error
message on failure with the real error logged server-side (S-01 impl-review F2). `POST
/api/periods` generates the token, passes only the digest to `create_period_with_slots`, and
returns `{ period, inviteToken }` with 201. `POST /api/periods/[id]/token` regenerates and
returns the new raw token. **Neither may log the raw token.**

#### 3. Owner screens

**File**: `src/pages/periods/index.astro`, `src/pages/periods/new.astro`,
`src/pages/periods/[id].astro` (new)

**Intent**: List periods, create one, and view a period with its slots and invite link.

**Contract**: SSR reads go through `createClient(Astro.request.headers, Astro.cookies)` with no
owner filter — RLS scopes them. A null client renders an error state, not an empty one (S-01
impl-review F5). `/periods/[id]` shows the generated slots grouped by date with their free/taken
state, and the invite link when one was just minted. Built on `src/components/ui/` — `Input`,
`Button`, `ScreenHeading` — and **not** on the superseded `FormField`.

#### 4. Create-period form island

**File**: `src/components/periods/NewPeriodForm.tsx` (new)

**Intent**: The client-side form, mirroring `AddPetForm`'s shape but on the S-07 components.

**Contract**: React island posting JSON to `/api/periods`, client-side validation mirroring the
zod schema for UX only, Polish messages. On success it must surface the returned raw token
prominently with an explicit warning that it is shown once — this is the only moment it exists.

#### 5. Gate the new routes

**File**: `src/middleware.ts`

**Intent**: `/periods` is owner data and must be gated.

**Contract**: Add `"/periods"` to `PROTECTED_ROUTES`. The auth-gating suite drives `it.each` over
that array, so coverage follows automatically — no test edit. `/invite` must **not** be added.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Full suite green, including auth-gating now covering `/periods`: `npm test`

#### Manual Verification:

- Creating a period redirects to `/periods/[id]`, which shows the right number of slots and the
  invite link with its one-time warning.
- Reloading `/periods/[id]` no longer shows the link — the raw token is genuinely gone.
- Regenerating produces a new link and the previous one stops working.
- Logged out, `/periods` and `/periods/new` redirect to sign-in.
- A second owner does not see the first owner's periods.
- The screens match the design's "Nowy wyjazd + link" in all three themes.

**Implementation Note**: After automated verification passes, pause for manual confirmation
before Phase 4.

---

## Phase 4: Caretaker landing page

### Overview

The outside view: an anonymous visitor opens the link and sees the period, proving the access
contract end to end.

### Changes Required:

#### 1. The invite route

**File**: `src/pages/invite/[token].astro` (new)

**Intent**: Resolve the token server-side and render the period read-only, or the uniform
inactive-link page.

**Contract**: SSR calls `get_period_by_token` through the ordinary anon-keyed client — an
anonymous visitor's session is absent, so the call runs as `anon` and no new client type is
needed. Renders the period title, date range, and its slots grouped by date with free/taken
state. No claiming, no instructions. Unknown, malformed and revoked tokens all render the same
"link nieaktywny" page, whose copy carries the "poproś właściciela o nowy link" guidance the
response deliberately withholds. Built on the S-07 components; must render in all three themes.

#### 2. Prove the route is not gated

**File**: `tests/middleware/auth-gating.test.ts`

**Intent**: `/invite` being public is a requirement, not an accident. A future edit adding
`"/invite"` — or a broader prefix — to `PROTECTED_ROUTES` would break the product silently, and
nothing currently catches it.

**Contract**: Add one case driving `runMiddleware({ pathname: "/invite/whatever" })` with no
cookie and asserting `nextCalled === true` and no redirect. Uses the existing helper; no new
harness.

#### 3. Record the widened access model

**File**: `docs/reference/data-access.md`, `context/foundation/test-plan.md`

**Intent**: The contract file promised caretaker access would be "a different model introduced
later". This is that model; leaving it undocumented means the next slice re-derives it.

**Contract**: Add a section describing the token model — digest-only storage, one
`SECURITY DEFINER` function as the sole anon-reachable surface, no anon policies on any table,
uniform failure — and the rule that any future caretaker capability extends that function rather
than adding an anon policy. In `test-plan.md`, add a §6.6 note for this slice and update Risk #5
("the link-only path grants more than its scope") to point at the new test file.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Full suite green, including the new non-gating case: `npm test`

#### Manual Verification:

- A valid link opens in a logged-out browser and shows the period and its slots.
- Tampering with one character of the token yields the same page as an unknown token.
- A regenerated link invalidates the old one for the anonymous visitor too.
- The page renders correctly in all three themes at mobile and desktop width.
- Signing in as the owner and opening the same link still works (the grant covers
  `authenticated` too).

**Implementation Note**: After automated verification passes, pause for manual confirmation.
Then the slice is ready for `/10x-impl-review`.

---

## Testing Strategy

### Unit Tests:

- `src/lib/invite-token.ts` — token length and alphabet, and that `digestInviteToken` is stable
  for a given input. Runs in the `unit` project, so it needs no Supabase.

### Integration Tests:

- Owner isolation on `care_periods` and `care_slots`, all four surfaces (§6.5).
- The token model: valid / foreign / revoked / unknown token, no instruction rows in the
  payload, direct anon table access denied, and regeneration invalidating the old token.
- The existing auth-gating suite, extended with the `/invite` non-gating case and picking up
  `/periods` automatically from `PROTECTED_ROUTES`.

### Manual Testing Steps:

1. `npm run db:start` (or the reduced service set), then `npm test`.
2. Create a 5-day period; confirm 15 slots and the one-time link warning.
3. Copy the link, open it in a private window; confirm the period renders.
4. Regenerate the link; confirm the old one now shows "link nieaktywny".
5. Change one character of a valid token; confirm the same page appears.
6. Try a 32-day range; confirm it is refused with a clean message, not a 500.

## Performance Considerations

Slot generation is bounded by the 31-day CHECK: at most 93 rows in one `INSERT … SELECT`, well
inside a single transaction. `/periods/[id]` and the invite page each read one period plus up to
93 slots — the `period_id` index keeps both an index scan. The token lookup is a unique-index
hit on the digest.

## Migration Notes

Two additive migrations; no existing data is touched. Nothing depends on `care_periods` yet, so
a rollback is a `drop`. The `token_digest` column is `not null` from the first migration, so
there is no window in which a period can exist without one.

## References

- Research: `context/changes/care-period-and-invite-link/research.md`
- Access contract this slice widens: `docs/reference/data-access.md`
- Pattern to copy: `context/archive/2026-07-12-pet-and-instructions/plan.md` and its migration
- Findings to design in, not rediscover:
  `context/archive/2026-07-12-pet-and-instructions/reviews/impl-review.md` (F1, F2, F3, F5)
- RLS test recipe: `context/foundation/test-plan.md` §6.5
- Middleware prefix gating: `src/middleware.ts:6,18-22`
- Component layer: `src/components/ui/`
- Recurring rule: `context/foundation/lessons.md`

## Implementation Addenda

Adaptations made during implementation, recorded so a later review can tell drift
from decision.

### Phase 1 — `token_digest` landed here, not in Phase 2

The plan contradicted itself: Phase 1's note and the Migration Notes both said the column is
`not null` from the first migration, while Phase 2's contract listed it as something Phase 2
adds. Implemented per the two-against-one reading, which is also the only one that avoids a
window where a period could exist without a digest. Phase 2 therefore adds only the unique
index on it, plus `revoked_at` and the functions.

### Phase 1 — `revoke ... from public` was never enough, in three places

The migration originally copied S-01's hardening line verbatim. Verification showed it did not
achieve what it claimed: `has_function_privilege('anon', ...)` still returned true, and anon
genuinely entered the function body, failing only later on RLS.

Cause: Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to `anon`, `authenticated` and
`service_role` on every new function in `public`, separately from the PUBLIC pseudo-role.
Revoking PUBLIC leaves those three untouched — the roles have to be named.

Three functions were affected. Fixed all three in this migration, agreed with the user:

| Function | Before | After |
| --- | --- | --- |
| `create_period_with_slots` (this slice) | anon had execute | anon, service_role revoked |
| `create_pet_with_instructions` (S-01) | anon had execute | anon, service_role revoked |
| `handle_new_user` (F-01, SECURITY DEFINER) | anon, authenticated, service_role had execute | all revoked |

None was exploitable. The two RPCs are SECURITY INVOKER, so RLS stopped anon one step later;
`handle_new_user` returns `trigger`, which Postgres refuses to call directly. But S-01's
impl-review F3 was closed as fixed while describing a posture the database did not have, and
Phase 2 introduces a SECURITY DEFINER function that anon may genuinely call — where a revoke
that silently misses roles is the difference between a controlled door and an open one.

The trigger keeps firing with no grants at all (it runs as the table owner): verified by the
suite, which signs up a fresh user per test, and by `auth.users` and `public.profiles` holding
equal counts afterwards.

### Phase 1 — how the manual checks were actually evidenced

Worth recording, because three of the four were not confirmed the way the plan assumed:

- **1.6** — Studio is excluded from the reduced Supabase service set this project runs (the
  full `npm run db:start` fails on unhealthy analytics/storage containers). Confirmed instead
  from the catalog: `pg_policies` joined to `pg_tables` shows 4 policies and `rowsecurity` true
  on both new tables — stronger evidence than reading a GUI.
- **1.7 and 1.8** now have automated coverage that did not exist when the plan was written.
  `care-slots.isolation.test.ts` asserts a 3-day period generates 9 slots with complete date and
  time-of-day sets; `care-periods.isolation.test.ts` asserts the 31-day CHECK and the
  ordered-dates CHECK. The manual step was a confirmation, not the only evidence.
- **1.9 was not demonstrated.** Atomicity here is a language guarantee — a plpgsql function is
  one transaction — rather than something this migration implements, and forcing a mid-function
  failure would need a contrived schema break. Accepted on that basis rather than proven.

### Phase 2 — `regenerate_period_token` returns `uuid`, not the period row

Written first as `returns public.care_periods`, mirroring `create_period_with_slots`. The
cross-owner test caught why that is wrong here: a plpgsql function returning a composite
answers `return null` with a *row of NULLs*, not NULL, so "RLS filtered the row out, nothing
was regenerated" arrived at the caller as an object with eight null fields — a miss that looks
like a hit. A scalar keeps the miss honestly null. Nothing is lost: the API route's response
carries the raw token, which never came from the database.

### Phase 2 — `anon` did hold table grants; Phase 1's comment said otherwise

Phase 1's migration states there is "deliberately NO grant to anon" on `care_periods` and
`care_slots`. Verifying manual check 2.8 showed that was not true — Supabase's ALTER DEFAULT
PRIVILEGES had granted anon SELECT/INSERT/UPDATE/DELETE on both, the same mechanism the Phase 1
addendum documented for *functions*. It is the table-level twin of that gap, missed because the
comment was written from intent rather than from the catalog.

Nothing leaked: no policy names anon, so deny-by-default returned zero rows, which is precisely
the model `docs/reference/data-access.md` describes. But this slice's premise is that
`get_period_by_token` is the only door, and that claim should not rest on one layer while the
code describes two. `revoke all on table ... from anon` on both tables now makes it two.
`get_period_by_token` is SECURITY DEFINER and runs as its owner, so the revoke does not reach
it — confirmed by the suite and by the psql probe below.

### Phase 2 — how the manual checks were evidenced

Studio is still excluded from this project's reduced Supabase service set (see the Phase 1
addendum), so 2.7 and 2.8 were evidenced from the catalog and from psql instead:

- **2.6** — `select encode(sha256(convert_to('abc','UTF8')),'hex')` in psql returns
  `ba7816bf…20015ad`, byte-identical to what `digestInviteToken("abc")` asserts in
  `tests/unit/invite-token.test.ts`. App and database genuinely agree, and the agreement is now
  pinned by a unit test rather than by a one-off comparison.
- **2.7** — `has_function_privilege` over `pg_proc` for all five public functions:
  `public` holds execute on none; anon holds it only on `get_period_by_token`; `service_role`
  on none.
- **2.8** — `set role anon` in psql: `get_period_by_token('<valid>')` returns the period with
  its six slots, an unknown token returns NULL, and `select count(*) from public.care_periods`
  returns 0 (and, after the revoke above, is refused outright).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, RLS & atomic period creation

#### Automated

- [x] 1.1 Migration applies cleanly from scratch: `npm run db:reset` exits 0 — 246863d
- [x] 1.2 Security advisors clean: `npx supabase db advisors --type security` — 246863d
- [x] 1.3 Types regenerate and typecheck: `npm run db:gen-types` then `npx astro check` — 246863d
- [x] 1.4 Isolation tests pass: `npm test` — 246863d
- [x] 1.5 Linting passes: `npm run lint` — 246863d

#### Manual

- [x] 1.6 Studio shows RLS enabled with four policies on each new table — 246863d
- [x] 1.7 A 5-day period yields exactly 15 slots, no gaps or duplicates — 246863d
- [x] 1.8 A 32-day range is rejected by the CHECK constraint — 246863d
- [x] 1.9 A failed slot insert rolls back the period — 246863d

### Phase 2: The token model

#### Automated

- [x] 2.1 Migration applies cleanly: `npm run db:reset` exits 0
- [x] 2.2 Security advisors clean: `npx supabase db advisors --type security`
- [x] 2.3 Types regenerate and typecheck: `npm run db:gen-types` then `npx astro check`
- [x] 2.4 Token-model assertions and Phase 1 suite pass: `npm test`
- [x] 2.5 Linting passes: `npm run lint`

#### Manual

- [x] 2.6 App digest matches `encode(sha256(...),'hex')` computed in psql
- [x] 2.7 `revoke`/`grant` correct on both functions; `public` holds no execute grant
- [x] 2.8 As `anon` in psql: the function returns the period, direct table selects return nothing

### Phase 3: Owner API & UI

#### Automated

- [ ] 3.1 Type checking passes: `npx astro check`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Build passes: `npm run build`
- [ ] 3.4 Full suite green including auth-gating on `/periods`: `npm test`

#### Manual

- [ ] 3.5 Creating a period shows the right slots and the one-time link warning
- [ ] 3.6 Reloading `/periods/[id]` no longer shows the link
- [ ] 3.7 Regenerating produces a new link and kills the previous one
- [ ] 3.8 Logged out, `/periods` and `/periods/new` redirect to sign-in
- [ ] 3.9 A second owner does not see the first owner's periods
- [ ] 3.10 Screens match the design in all three themes

### Phase 4: Caretaker landing page

#### Automated

- [ ] 4.1 Type checking passes: `npx astro check`
- [ ] 4.2 Linting passes: `npm run lint`
- [ ] 4.3 Build passes: `npm run build`
- [ ] 4.4 Full suite green including the `/invite` non-gating case: `npm test`

#### Manual

- [ ] 4.5 A valid link opens logged-out and shows the period and slots
- [ ] 4.6 A tampered token yields the same page as an unknown token
- [ ] 4.7 A regenerated link invalidates the old one for the anonymous visitor
- [ ] 4.8 The page renders correctly in all three themes, mobile and desktop
- [ ] 4.9 The owner, signed in, can open the same link
