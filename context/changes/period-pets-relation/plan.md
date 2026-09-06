# Period ↔ Pets Relation Implementation Plan

## Overview

A care period must cover the owner's chosen pet(s). Today nothing links the two, so the
caretaker's invite link cannot reach `care_instructions` and FR-008 is unimplementable. This
change adds the relation through a join table, threads pet selection through the create path,
and shows a trip's pets on both owner screens. It unblocks S-03 and closes scope that S-02
shipped without.

## Current State Analysis

- **`public.care_periods` has no pet reference of any kind** —
  `supabase/migrations/20260905234144_care_periods_and_slots.sql:20-33`: `id`, `owner_id`,
  `title`, `start_date`, `end_date`, `token_digest`, `revoked_at`, `created_at`. No `pet_id`,
  no join table.
- **`public.pets`** (`20260712204748_pets_and_instructions.sql`) is
  `(id, owner_id → auth.users, name, species public.pet_species, breed, age, created_at)`,
  RLS enabled with four `to authenticated` policies on `owner_id`, granted to `authenticated`,
  and **no index beyond the primary key**.
- **`public.care_instructions`** hangs off `pets` with per-row `is_sensitive boolean not null
  default false`. Sensitivity is a row flag, not a field mask — the eventual reveal is a row
  filter.
- **`create_period_with_slots(text, date, date, text)`** is `security invoker`,
  `set search_path = ''`, and inserts the period plus the cross-product of
  `generate_series(start,end)` × `enum_range(time_of_day)` in one transaction
  (`20260905234144:148-178`). Its grant posture is `revoke execute … from public, anon,
  service_role` then `grant execute … to authenticated` (`:189-192`).
- **`care_slots` has no `pet_id`** and carries `unique (period_id, slot_date, time_of_day)`. A
  slot therefore belongs to the *period*, covering all of its pets.
- **`supabase/seed.sql`** seeds one owner, one pet (`Burek`, fixed UUID
  `44444444-…`), two instructions (one public, one sensitive) and **zero care periods**. Its
  header states the convention: domain rows are added by their owning slice.
- **Existing period tests, verified by grep** (this corrects `research.md` §6, which said all
  four files seed through the RPC):
  - `tests/rls/care-slots.isolation.test.ts` — 2 occurrences, in one `seedPeriod` helper
  - `tests/rls/invite-token.test.ts` — 2 occurrences (its `seedPeriod` helper, and the
    "anon cannot execute the owner-only RPCs" assertion)
  - `tests/api/periods.post.test.ts` — 0 RPC calls; it posts to `/api/periods`, so it is the
    payload that changes
  - `tests/rls/care-periods.isolation.test.ts` — 3 **raw** `.from("care_periods").insert(…)`
    and 0 RPC calls, so the signature change does not reach it
- **No test creates a pet through the period path.** `tests/rls/pets.isolation.test.ts:21` is
  the raw-insert precedent for making one.
- **`/periods` list was just narrowed to aggregates** (`src/pages/periods/index.astro`) by
  S-02's impl-review F8, specifically to stop pulling every slot row to compute two integers.

## Desired End State

An owner creating a trip picks which of their pets it covers, from a chip multi-select
matching the design's `KTÓRE ZWIERZĘTA` control. The period cannot be created without at least
one pet. `/periods` and `/periods/[id]` both name the trip's pets. The database refuses to link
a period to a pet the caller does not own, and refuses to link another owner's period to
anything. `npm test` proves all four denial surfaces on the new table plus both with-check
cases, and the existing suite passes against the new RPC signature.

The caretaker's page is deliberately unchanged — S-03 owns the whole of FR-008.

### Key Discoveries

- **Ownership must be checked against BOTH parents.** A join row is only legitimate when the
  caller owns the period *and* the pet. Checking one parent would leave an IDOR: owner A could
  attach their own period to owner B's pet, which would then leak B's instructions through A's
  invite link once S-03 ships. This is the security-critical line of the migration.
- **A signature change is drop-and-recreate, not an added parameter.** An added parameter
  creates a *second* function (an overload) which inherits Supabase's `ALTER DEFAULT
  PRIVILEGES` execute grants to `anon`/`authenticated`/`service_role`, and leaves the old
  signature reachable with its existing grant. `create or replace` preserves grants only when
  the argument list is unchanged — the sole precedent
  (`20260906105815_bound_token_length.sql:13-14`) says exactly that.
- **New tables get anon grants by default.** `20260906003122_invite_token_access.sql:23-24` and
  `20260906094254_claim_columns_paired.sql` had to revoke them on five tables. The join table
  needs the same revoke or the repo regains a sixth instance of a gap it has closed twice.
- **Postgres does not index foreign keys** — the migration at `20260905234144:59-60` states the
  rule. A composite PK `(period_id, pet_id)` serves period-leading lookups; `pet_id` needs its
  own index for the reverse direction and for the cascade.
- **Pets-per-period is bounded and small**, unlike slots-per-period (up to 93). Embedding pet
  names in the `/periods` list query is therefore *not* a repeat of impl-review F8 — that
  finding was about row count scaling with slots, and this one does not.

## What We're NOT Doing

- **No instructions anywhere.** `get_period_by_token` is untouched, `/invite/[token]` is
  untouched, and no instruction row reaches a caretaker. All of FR-008 — public on arrival and
  sensitive after the claim — belongs to S-03 as one coherent reveal.
- **No `NOTATKA` field.** The design's period-level free-text note is assigned to **S-03**,
  recorded in `context/changes/caretaker-claims-slot/change.md`. Its content overlaps
  `is_sensitive` and it needs a reveal rule, which is S-03's to write.
- **No "at least one pet" database constraint.** Enforced in `create_period_with_slots` only.
  See Critical Implementation Details — a petless period stays representable, deliberately.
- **No backfill of existing petless periods.** They are left as pre-relation artifacts.
- **No per-pet slots.** `care_slots` keeps `unique (period_id, slot_date, time_of_day)`; one
  slot covers every pet on the trip, matching the design's single `Rano · 7:30` card and its
  one merged instruction list. Slot generation is unchanged.
- **No period editing.** An owner cannot change a trip's pets after creating it; no FR covers
  period editing and no slice owns it.
- **No pet search or scrolling in the selector.** Every pet renders as a chip.
- **No reskin of `/pets` or `AddPetForm`.** They keep S-01's styling; that debt is S-01's.

## Implementation Approach

Three phases, bottom-up, mirroring S-02's shape. Phase 1 is deliberately large and cannot be
split: the join table without the RPC is unusable, and the RPC signature change breaks two test
files the moment it lands, so schema, function, types and test repair are one atomic unit.
Phase 2 threads pet selection through the write path. Phase 3 puts pets on the read screens and
settles the contracts and the hand-off to S-03.

Ownership is enforced by RLS on the join table under `security invoker`, not by a check in the
handler. That way "you cannot put someone else's pet on your trip" is a database guarantee, and
a foreign pet id rolls the whole create back — the same reasoning that kept
`create_period_with_slots` security-invoker in the first place.

## Critical Implementation Details

**A petless period is representable, and that is a decision.** Enforcement of "at least one
pet" lives only in `create_period_with_slots`. Three paths still produce a period with no pets:
a raw insert (which `care-periods.isolation.test.ts` does three times), a pre-existing row from
before this change, and deleting the last linked pet (the join row cascades). Nothing is
corrupt in that state — the period is merely useless. It is called out here because S-03's
caretaker page must tolerate it rather than assume at least one pet, and because it is the
opposite posture to `20260906094254_claim_columns_paired.sql`, which argued a constraint in the
database outranks a requirement in a document. The difference: that invariant was expressible
as a column CHECK; this one is not, and the alternatives (a deferred constraint trigger, or
`on delete restrict` on pets) each cost more than the state costs.

**The grant posture must be re-established, not assumed.** Dropping and recreating
`create_period_with_slots` produces a function with fresh Supabase default privileges. The
migration must re-state `revoke execute … from public, anon, service_role` and
`grant execute … to authenticated` with the **new full argument type list**, and Phase 1's
verification must read the answer back from `has_function_privilege` rather than trusting the
migration text. This repo has three recorded instances of a described grant posture that the
database did not actually have.

## Phase 1: Schema, RLS & the RPC signature change

### Overview

The data layer: a join table with owner-isolation RLS keyed on both parents, an index, the
anon revoke, a drop-and-recreate of the generation RPC taking pet ids, regenerated types, a new
isolation suite, and repair of the two test files that call the old signature.

### Changes Required

#### 1. Migration: join table, RLS, and the RPC signature

**File**: `supabase/migrations/<timestamp>_period_pets_relation.sql` (new, via
`npm run db:migration`)

**Intent**: Let a period name the pets it covers, with the database — not the handler —
refusing any link where the caller does not own both sides.

**Contract**:

- `public.care_period_pets`: `period_id uuid not null references public.care_periods (id) on
  delete cascade`, `pet_id uuid not null references public.pets (id) on delete cascade`,
  `created_at timestamptz not null default now()`, `primary key (period_id, pet_id)`. The
  composite PK also makes the link idempotent. Index `pet_id` separately.
- RLS enabled; `grant select, insert, update, delete … to authenticated`;
  `revoke all on table public.care_period_pets from anon` (new tables inherit anon's default
  grants — see Key Discoveries).
- Four policies, `to authenticated`, each with `(select auth.uid())` in a subselect. **The
  predicate is a conjunction over both parents** — the caller must own the period AND the pet:

  ```sql
  exists (select 1 from public.care_periods p
          where p.id = care_period_pets.period_id and (select auth.uid()) = p.owner_id)
  and
  exists (select 1 from public.pets t
          where t.id = care_period_pets.pet_id and (select auth.uid()) = t.owner_id)
  ```

  INSERT and UPDATE carry it as `with check`; UPDATE carries it as both `using` and
  `with check`. A single-parent predicate is an IDOR, not a simplification.
- `drop function public.create_period_with_slots(text, date, date, text);` then a fresh
  `create function public.create_period_with_slots(p_title text, p_start_date date, p_end_date
  date, p_token_digest text, p_pet_ids uuid[]) returns public.care_periods` — still
  `security invoker`, still `set search_path = ''`, still one transaction. It inserts the
  period, then the join rows from `unnest(p_pet_ids)`, then the unchanged slot cross-product.
  It raises if `p_pet_ids` is null or empty.
- Immediately after: `revoke execute on function public.create_period_with_slots(text, date,
  date, text, uuid[]) from public, anon, service_role;` and `grant execute … to authenticated;`
  — the new signature, spelled in full.
- Order matters: insert the join rows **before** the slots is not required, but inserting them
  at all before returning is — a foreign `pet_id` must fail the whole transaction, so the join
  insert must be inside this function, not a follow-up call from the route.

#### 2. Seed a period for the test owner

**File**: `supabase/seed.sql`

**Intent**: Give `db:reset` a period linked to the seeded pet, so the relation is visible
without clicking through the app and the manual checks have a stable target.

**Contract**: One `care_periods` row with a fixed UUID owned by `33333333-…`, one
`care_period_pets` row linking it to `Burek` (`44444444-…`), and its slots. Follow the file's
existing `on conflict (id) do nothing` idempotence. The token digest can be any fixed hex
string — the raw token is not recoverable and is not needed for a seeded row.

#### 3. Regenerate the generated types

**File**: `src/db/database.types.ts`

**Intent**: Keep the type checker honest about the new table and the new RPC signature.

**Contract**: Output of `npm run db:gen-types`. Generated, never hand-edited.

#### 4. Isolation tests for the join table

**File**: `tests/rls/care-period-pets.isolation.test.ts` (new)

**Intent**: Prove all four denial surfaces plus — the interesting part — that neither parent
alone is enough to authorize a link.

**Contract**: Follow `context/foundation/test-plan.md` §6.5 and mirror
`tests/rls/care-slots.isolation.test.ts`: two owners, each with a pet and a period. Assert
SELECT / UPDATE / INSERT / DELETE denial, remembering that UPDATE and DELETE denial under RLS
is **silent** (0 rows, no error) so those cases assert the row survives. Then the two
with-check cases that matter:

- owner A linking **A's period to B's pet** is refused;
- owner A linking **B's period to A's pet** is refused.

Never assert through a service-role client.

#### 5. Test-harness primitive for an owner with a pet

**File**: `tests/helpers/auth.ts`

**Intent**: Every period now needs a pet, and no helper produces one. Without this, three test
files each grow their own pet-seeding boilerplate.

**Contract**: Add `createOwnerWithPet(): Promise<OwnerContext & { petId: string }>` — an owner
from `createOwnerClient()` plus one pet inserted through that owner's own client (the raw-insert
pattern at `tests/rls/pets.isolation.test.ts:21`), never service-role. Register it in
`docs/reference/contract-surfaces.md` in Phase 3.

#### 6. Repair the call sites of the old signature

**Files**: `tests/rls/care-slots.isolation.test.ts`, `tests/rls/invite-token.test.ts`,
`tests/api/periods.post.test.ts`

**Intent**: The signature change breaks these the moment the migration lands.

**Contract**: Each file's `seedPeriod` helper (and `periods.post.test.ts`'s request payload)
gains pet ids, sourced from `createOwnerWithPet()`. `invite-token.test.ts` has a second hit in
its "anon cannot execute the owner-only RPCs" assertion — the argument list there must match
the new signature or the call fails for the wrong reason and the test passes vacuously.
`tests/rls/care-periods.isolation.test.ts` uses raw inserts only and needs **no** change; its
three petless periods are the deliberate proof that a raw insert can still make one.

### Success Criteria

#### Automated Verification

- Migration applies cleanly from scratch: `npm run db:reset` exits 0
- Security advisors clean: `npx supabase db advisors --type security`
- Types regenerate with no drift: `npm run db:gen-types` then `npx astro check`
- Full suite passes, including the new isolation file: `npm test`
- Linting passes: `npm run lint`

#### Manual Verification

- `has_function_privilege` confirms the recreated RPC: `public` no execute, `anon` no execute,
  `service_role` no execute, `authenticated` execute — and no leftover 4-argument overload
- `information_schema.role_table_grants` shows no `anon` grant on `care_period_pets`
- `pg_policies` shows RLS enabled with four policies on the new table
- A 3-day period created through the RPC yields 9 slots and one join row per pet id passed
- Linking a pet the caller does not own rolls the entire create back — no orphan period

**Implementation Note**: After automated verification passes, pause for manual confirmation
before Phase 2.

---

## Phase 2: Owner API & the pet selector

### Overview

Thread pet selection through the write path: the validation schema, the create route, and a
chip multi-select in the create form.

### Changes Required

#### 1. Validation schema

**File**: `src/lib/schemas/period.ts`

**Intent**: Reject a create payload with no pets before any DB call, so the RPC's raise is
never the thing the user sees.

**Contract**: `createPeriodSchema` gains `pet_ids: z.array(z.uuid()).min(1).max(<bound>)` with
a Polish message. The bound exists for the same reason the title and span bounds do — an
unbounded array is a DoS vector (S-01 impl-review F1). Follow the module's established
practice of importing shared bounds from `src/lib/period-format.ts` rather than inlining a
magic number, so the island and the schema cannot drift.

#### 2. Create route

**File**: `src/pages/api/periods.ts`

**Intent**: Pass the selected pet ids to the RPC.

**Contract**: Unchanged structure — 401 without a session, 500 on a null client, 400 on bad
JSON, zod before any DB call, `console.error(error.code, error.message)` only, generic Polish
message, and the raw token still returned exactly once and never logged. The `rpc(...)` call
gains `p_pet_ids`. An RLS refusal on a foreign pet id arrives as a DB error → the existing
generic 500 branch; that is correct behaviour and needs no new mapping, because zod cannot know
who owns a pet.

#### 3. Pet chip multi-select in the create form

**File**: `src/components/periods/NewPeriodForm.tsx`

**Intent**: The design's `KTÓRE ZWIERZĘTA` control.

**Contract**: A new `pets` prop (`{ id, name, species }[]`), SSR-supplied. Renders every pet as
a toggleable chip; selected chips carry the accent border and tinted fill the design uses,
unselected ones the muted variant. Client-side validation mirrors the schema — at least one pet
— surfaced through the same per-field error map the other fields use. It keeps the existing
`submitting` guard and the in-place success view; do **not** reintroduce `SubmitButton`, whose
`useFormStatus` is inert for a preventDefaulted fetch form (recorded in the file's header).
Built on `src/components/ui/`; **not** on the superseded `FormField`.

#### 4. Supply the owner's pets to the form

**File**: `src/pages/periods/new.astro`

**Intent**: The page currently builds no Supabase client at all; it must now read the owner's
pets.

**Contract**: `createClient(Astro.request.headers, Astro.cookies)` with no owner filter — RLS
scopes it. A null client renders an error state, not an empty selector (S-01 impl-review F5).
An owner with **zero** pets is a real state and must get a clear route out ("add a pet first"),
not a form that cannot be submitted.

### Success Criteria

#### Automated Verification

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Full suite green, including the repaired route test: `npm test`

#### Manual Verification

- Creating a trip with one pet selected succeeds and produces the right join rows
- Creating a trip with two pets selected produces two join rows and the same slot count
- Submitting with no pet selected is refused client-side, with a field-level message
- An owner with no pets sees a route to add one, not a dead form
- The selector matches the design's chip states in all three themes

**Implementation Note**: After automated verification passes, pause for manual confirmation
before Phase 3.

---

## Phase 3: Owner read screens, contracts & the S-03 hand-off

### Overview

Show a trip's pets where the owner looks for them, then update the registries and record what
S-03 inherits.

### Changes Required

#### 1. Pets on the period list

**File**: `src/pages/periods/index.astro`

**Intent**: The design's owner panel names a trip's pets ("Burek & Mru"); the list is where a
trip is recognised.

**Contract**: The existing select gains an embed of the linked pets' names alongside the
`total`/`taken` aggregates, keeping `.limit(PERIODS_PAGE_SIZE)` and the aggregate counts. This
does **not** reintroduce impl-review F8's problem: F8 was about a row count that scaled with
slots (up to 93 per period), and pets-per-period is small and bounded. Say so in a comment, or
the next reviewer will read it as a regression.

#### 2. Pets on the period detail

**File**: `src/pages/periods/[id].astro`

**Intent**: Same, on the screen that shows the trip's composition.

**Contract**: The select gains the same embed. Rendered near the title and date range, before
the slot grid. Keep reading `claimed_at` rather than `claimed_by_name` — that substitution was
deliberate (a page that cannot see a name cannot leak one) and must not be undone.

#### 3. Register the new surfaces

**File**: `docs/reference/contract-surfaces.md`

**Intent**: The file's own preamble asks for a row when a shared entry point ships.

**Contract**: Update the `create_period_with_slots` row for the new signature. Add rows for
`care_period_pets` (naming the both-parents ownership predicate as the load-bearing part) and
for `createOwnerWithPet()`.

#### 4. Record the slice note and the hand-off

**Files**: `context/foundation/test-plan.md`,
`context/changes/caretaker-claims-slot/change.md`

**Intent**: Two things S-03 must not rediscover.

**Contract**: In `test-plan.md`, add a §6.6 note for this change — the both-parents predicate
and why a single-parent one is an IDOR, and the fact that a petless period is representable by
design. In the S-03 change file, record that it inherits (a) the `NOTATKA` field decision and
(b) the requirement that its caretaker page tolerate a period with zero pets. Do **not** edit
`context/foundation/roadmap.md` — this change has no roadmap item and S-03's `Prerequisites`
line is stale; both belong to `/10x-roadmap`.

### Success Criteria

#### Automated Verification

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Full suite green: `npm test`

#### Manual Verification

- `/periods` names each trip's pets without the list query regressing visibly
- `/periods/[id]` shows the trip's pets near its title
- A trip whose only pet was deleted renders without crashing on either screen
- Both screens render correctly in all three themes at mobile and desktop width

**Implementation Note**: After automated verification passes, pause for manual confirmation.
Then the change is ready for `/10x-impl-review`.

---

## Testing Strategy

### Unit Tests

- Nothing new. The added bound in `createPeriodSchema` is exercised through the route test; the
  shared constant follows the existing `period-format.ts` pattern already covered by
  `tests/unit/period-format.test.ts`.

### Integration Tests

- **New**: `tests/rls/care-period-pets.isolation.test.ts` — all four denial surfaces plus both
  with-check cases (A's period + B's pet, and B's period + A's pet). These two are the reason
  this file exists; the four standard surfaces are the §6.5 baseline.
- **Repaired**: `care-slots.isolation.test.ts`, `invite-token.test.ts`,
  `periods.post.test.ts` — new signature and payload. `periods.post.test.ts` gains a case for
  an empty `pet_ids` (400) and one for a pet the caller does not own (500 with a generic body,
  and no period written).
- **Unchanged and load-bearing**: `care-periods.isolation.test.ts` keeps its raw inserts, which
  now double as the proof that a petless period is still representable.

### Manual Testing Steps

1. `npm run db:reset`, then `npm test`.
2. Log in as the seeded owner; confirm `/periods` shows the seeded trip with `Burek`.
3. Create a trip with two pets; confirm two join rows and the same slot count as one pet.
4. Try to submit with no pet selected; confirm a field-level refusal, not a 500.
5. Delete a pet that is on a trip; confirm the trip survives and both screens render.
6. In psql, run the `has_function_privilege` sweep and confirm no 4-argument overload remains.

## Performance Considerations

The join table is read on two owner screens and written once per period create. Row counts are
bounded by pets-per-owner, which is small. The composite PK serves period-leading lookups and
the `pet_id` index serves the reverse direction and the cascade. The `/periods` list keeps its
`.limit()` and its aggregate slot counts; the pet embed adds a small, bounded number of rows
per period, unlike the slot rows impl-review F8 removed.

## Migration Notes

One additive migration plus a seed addition. `db:reset` is clean because `seed.sql` seeds no
periods today. Existing periods in any long-lived database — including anything promoted with
`npm run db:push` — keep zero pets and are left alone by decision; they will show no pets on
the owner screens and would serve no instructions to a caretaker. Rollback is
`drop table public.care_period_pets` plus restoring the 4-argument RPC, which means restoring
its grant posture too.

## References

- Research (covers this scope in §1 and §6): `context/changes/caretaker-claims-slot/research.md`
- Blocked slice this unblocks: `context/changes/caretaker-claims-slot/change.md`
- Pattern to copy: `supabase/migrations/20260905234144_care_periods_and_slots.sql`
- Grant-posture history: `20260831203038`, `20260905234144:180-208`, `20260906003122:153-165`
- `create or replace` grant caveat: `20260906105815_bound_token_length.sql:13-14`
- RLS test recipe: `context/foundation/test-plan.md` §6.5
- Access contract: `docs/reference/data-access.md`
- Recurring rule: `context/foundation/lessons.md`

## Implementation Addenda

Adaptations made during implementation, recorded so a later review can tell drift
from decision.

### Phase 1 — the zod schema and the API route were pulled in from Phase 2

The plan put `pet_ids` in `createPeriodSchema` and `p_pet_ids` in `POST /api/periods` in
Phase 2, but made "full suite passes" a Phase 1 criterion. Those cannot both hold:
`tests/api/periods.post.test.ts` drives the real route, the route calls
`create_period_with_slots`, and dropping the 4-argument signature breaks it immediately.
Phase 1 therefore also lands the schema field, the route argument, and
`MAX_PETS_PER_PERIOD` in `period-format.ts` — agreed with the user rather than papered over.

Phase 2 is now purely the UI layer: the chip multi-select island and supplying the owner's
pets to the form. That leaves the two phases better balanced than the plan had them.

### Phase 1 — the both-parents predicate was mutation-tested, not just asserted

`lessons.md` says a test that passes when the layer is removed is not a test of that layer.
So the conjunction was verified by breaking it, twice, against the local database:

| Mutation | Result |
| --- | --- |
| INSERT policy reduced to the period half only | 2 failures — "refuses A's period + B's pet" and "the RPC rolls the whole create back"; the other 9 tests still passed |
| INSERT policy reduced to the pet half only | 1 failure — "refuses B's period + A's pet" |

Both halves are therefore genuinely load-bearing and genuinely guarded. The policy was
restored with `db:reset` and re-verified from `pg_policies` before continuing.

### Phase 1 — the verification query had the bug, not the migration

The first catalog check reported that none of the four policies referenced `pets`, which
looked like a broken conjunction. Dumping the stored predicate showed the policies were
correct and the `LIKE '%pets p%'` pattern was wrong — Postgres deparses the alias as
`pets t`. Worth recording because the instinct on a red check is to edit the migration; the
right first move was to read the actual `qual` / `with_check` text.

### Phase 1 — two smaller decisions

- **Duplicate pet ids are deduplicated, not rejected.** `select distinct` in the RPC. A
  repeated id in the array is a client slip, and the set is the meaning; the composite PK
  would otherwise raise a unique violation the caller cannot act on.
- **The pet-seeding guards check `error`, not `data`.** supabase-js types `data` as non-null
  in the no-error branch, so `if (!data)` is statically dead and
  `@typescript-eslint/no-unnecessary-condition` rejects it — the same rule that reverted F7
  in the S-02 review.

### Phase 1 — impl-review fixes (reviews/impl-review-phase-1.md)

Nine findings, all triaged. Seven fixed, one deliberately skipped with the reason recorded,
one justified in place.

**The critical one was mine, and it was the unpriced half of the phase-boundary adaptation.**
Pulling the zod field and the route argument into Phase 1 made the suite pass, but it moved
the SERVER-side requirement ahead of its CLIENT-side supplier: `NewPeriodForm.tsx` still
posted three fields, so every submit from `/periods/new` got a 400 on `pet_ids`. Reproduced
through HTTP with the island's exact body before fixing. Both review agents found it
independently; the suite could not, because nothing tests the island's request shape.

The fix pulled Phase 2's items 3 and 4 forward as well — the pet selector and supplying the
owner's pets to the form — because every alternative invented data (all pets, or the first
pet) and that is what the backfill decision explicitly rejected. **Phase 2 is now reduced to
design polish**: chip styling against the hi-fi reference and the three-theme check. Verified
through HTTP: an owner with no pets gets a route out rather than a dead form, an owner with
two pets gets both chips, creating with two pets yields 2 links and 9 slots, and an empty
selection is refused with a 400.

Other fixes:

- **F2** — `care_period_pets` joined the anon-denial assertions. Without it, removing
  `revoke all … from anon` left all 100 tests passing; mutation-tested by granting anon
  SELECT back, which now fails the test. That was the sixth instance of the pattern
  `lessons.md` was written for, inside a commit whose migration comment claimed the gap
  closed.
- **F3** — the two route cases the plan's Testing Strategy required now exist, and the route
  maps 42501 / 23503 / 23502 / P0001 from this RPC to **400**, not 500. A pet that is not
  yours is bad input, not a server fault, and zod cannot catch it because it does not know
  who owns a pet.
- **F4** — the empty-list test pins `P0001` and the raise's message rather than "some error",
  and covers `[NULL]` too. A new migration filters NULLs BEFORE the count: the naive fix
  (`where pid is not null` on the insert) would have made `[NULL]` insert zero rows and leave
  a petless period — silently worse than the policy violation it replaced.
- **F6** — removed a secondary assertion that read through the victim's own client, whose
  SELECT policy would filter the illicit row out under either mutation. It could never see
  the leak its comment claimed to check.
- **F7** — `createAuthenticatedOwnerWithPet()` in `session.ts` replaces two inline copies of
  the pet-seeding block, which is the duplication `createOwnerWithPet` existed to prevent.
- **F8** — the `MAX_PETS_PER_PERIOD = 20` choice is now justified in a comment, including why
  the RPC has no upper bound of its own.
- **F9** — the `create_period_with_slots` row in `contract-surfaces.md` describes the new
  five-argument signature; the rest of the registry work stays in Phase 3.

**F5 skipped, with the cost recorded.** Pinning the SELECT and DELETE halves of the
conjunction needs a row whose two parents have different owners, and the application cannot
produce one — INSERT and UPDATE both refuse it and there is no pet-ownership-transfer path.
The only producers are a `service_role` write, which widens a fence `test-plan.md` §6.6
records as existing for exactly one call in one file, or a deliberately invalid row in
`seed.sql`, which reaches every developer's database. Recorded in `test-plan.md` §7 with that
reasoning rather than left as an unexplained gap.

### Phase 2 — reduced to design polish, because the F1 fix absorbed items 1-4

Phase 2's four Changes Required had already landed by the time this phase opened: items 1
and 2 (the zod field and the route argument) in Phase 1 by the documented adaptation, and
items 3 and 4 (the chip selector and supplying the owner's pets to the form) in the phase-1
impl-review F1 fix, because every alternative there invented data. What remained was the one
thing neither of those touched: whether the selector actually matches the design.

**It did not, in one respect.** The design's `KTÓRE ZWIERZĘTA` chip is a pill —
`border-radius: 24px`, `padding: 9px 14px`, `flex` with an `8px` gap — and mine used the
shared `rounded-lg` (`--radius`, 16px) with `px-4 py-2`. Colours were already exact: the
design's `rgb(246,234,239)` and `rgb(156,84,112)` are `--secondary` and `--primary`
verbatim. Geometry corrected against the extracted design values.

Three things recorded rather than fixed:

- **No shared chip component exists.** `src/components/ui/` has AuthScreen, ScreenHeading,
  LibBadge, button and Input — no chip, despite S-07's roadmap outcome naming one among the
  components it established. S-07 shipped only what the auth screens needed. The chip stays
  inline: one consumer does not justify creating a shared surface, and `lessons.md` cautions
  in exactly that direction.
- **The design's chip holds a circular pet photo.** `public.pets` is
  `(id, owner_id, name, species, breed, age, created_at)` — no photo column. That half of the
  chip is not implementable and is out of scope here; it would need a schema change plus
  storage, which no FR covers.
- **The design draws only the SELECTED chip state** (both its chips are picked), so the
  unselected variant is ours: the muted counterpart on the same tokens.

Verified through HTTP in all three themes plus the no-choice default: the chip renders with
the corrected geometry, both pet names appear, and the theme class lands on `<html>`
(`light` / `dark` / `contrast`). Note the limit of that evidence — SSR only ever renders the
UNSELECTED state, because selection is client-side. The selected chip is verified by token
derivation, not by render; manual check 2.9 is what closes it.

### Phase 2 — how the manual checks were evidenced, and one defect they surfaced

- **2.5, 2.6, 2.8** were proved through HTTP against the running dev server before the gate:
  one pet yields one join row; two pets yield two join rows and the same 9 slots; an owner
  with no pets gets the "Dodaj pierwsze zwierzę" route out and no selector.
- **2.7 and 2.9 rest on the owner's eye, not on evidence I could gather.** The client-side
  refusal happens before any request, and the selected chip state never renders server-side
  (selection is client-side), so SSR only ever shows the unselected variant. Its colours were
  derived from tokens — the design's `rgb(246,234,239)` and `rgb(156,84,112)` are `--secondary`
  and `--primary` verbatim — but nobody had seen it rendered. Confirmed by the user.

**A defect surfaced during the gate, and it was mine.** The owner reported "Dane są
niepoprawne — sprawdź pola i spróbuj ponownie" after filling the form and asked whether that
was expected. It was not: the phase-1 review's F3 fix added specific server-side messages
(most importantly "Wybrane zwierzę nie należy do Ciebie albo nie istnieje", which only RLS can
determine) and the island discarded them for a generic sentence. The owner could not see what
was wrong.

Fixing the passthrough exposed a second layer: for a MISSING key zod emits its own English
default ("Invalid input: expected string, received undefined"), because a custom `.min(1, …)`
message only fires once the key is present. Rendering `error` verbatim would therefore have
put English internals in front of an owner. Messages are now set at the TYPE level too, and
`tests/unit/period-schema.test.ts` pins the contract across 13 rejection paths — this is the
kind of property that breaks silently, since adding a field without a type-level message would
regress it and nothing else would notice.

### Phase 2 — impl-review fixes (reviews/impl-review-phase-2.md)

Nine findings; seven fixed, one recorded as another slice's debt, one recorded here.

**The two that matter are both self-inflicted, and both of the same kind.**

`F1` — the contract "every 400 from this route carries a Polish sentence" was written into two
comments and was false. Type-level messages were added to the four FIELDS but not to the object
SHAPE, so a body that is valid JSON but not an object (`null`, `"x"`, `42`, `[]`) produced zod's
English default with an empty path, and the island rendered it. `"Invalid JSON body"` was the
second English branch. Both now answer in Polish; the route prefers a field-level issue and
falls back to the shape's message.

`F2` — `tests/unit/period-schema.test.ts` was written specifically to prevent English messages
reaching an owner, and it was built on a heuristic that misses zod's whole `invalid_format`
family: `z.uuid()` defaults to "Invalid UUID" and `z.iso.date()` to "Invalid ISO date", neither
matching any of its three regexes. Deleting a message argument left the test green. It now
asserts MEMBERSHIP in `PERIOD_MESSAGES`, exported from the schema, which fails on every zod
default — known or not. Mutation-tested three ways: removing the uuid message fails 1 case, the
date message 3, the object message 4.

Worth recording about that mutation run: the third mutation was at first a **no-op** — prettier
had reformatted the multi-argument `.object(…)` call, so the search string never matched and the
test "passed". Verifying that the mutation had actually been applied is what stopped a false
conclusion that the test did not guard the shape.

Also fixed: the chip group is now `role="group"` with `aria-labelledby` and `aria-describedby`,
its error carries `role="alert"`, and the chip has a `focus-visible` ring — all patterns
`AddPetForm`, `ui/Input` and `ui/button` already had (`F3`). The row gap is the design's 10px,
not the 8px I had, and the chip label is `font-heading` (Quicksand) as the design specifies
rather than the inherited Nunito (`F4`) — the geometry pass this phase existed for had left the
one visible gap wrong while its comment justified the chip's INNER gap, which is inert because
the chip has a single child. Error-code mapping now answers "Wybierz co najmniej jedno zwierzę"
for `P0001`/`23502` instead of telling an owner a pet is not theirs (`F7`), and the island
validates the response body's `error` instead of casting it (`F8`). The unused `issues` array
was dropped from the 400 body (`F6`).

**Recorded, not fixed:**

- `F5` — `/api/pets` and `/api/periods/[id]/token` still answer `"Validation failed"`, and
  `AddPetForm` discards it for a generic sentence: the same defect, still live. Not fixed here
  because copying the passthrough alone would leak English — `schemas/pet.ts` carries messages
  on two fields only. Recorded in `test-plan.md` §7 as S-01's debt with the reason.
- `F9` — `PetOption` is `{ id, name }` where the plan's Phase 2 contract said
  `{ id, name, species }[]`. The narrowing landed in the Phase 1 F1 fix and was never recorded.
  `species` has nowhere to appear: the design puts a circular pet photo in the chip and `pets`
  has no photo column, so the chip shows the name alone.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, RLS & the RPC signature change

#### Automated

- [x] 1.1 Migration applies cleanly from scratch: `npm run db:reset` exits 0 — 0553bd1
- [x] 1.2 Security advisors clean: `npx supabase db advisors --type security` — 0553bd1
- [x] 1.3 Types regenerate with no drift: `npm run db:gen-types` then `npx astro check` — 0553bd1
- [x] 1.4 Full suite passes including the new isolation file: `npm test` — 0553bd1
- [x] 1.5 Linting passes: `npm run lint` — 0553bd1

#### Manual

- [x] 1.6 `has_function_privilege` confirms the recreated RPC and no leftover 4-arg overload — 0553bd1
- [x] 1.7 No `anon` grant on `care_period_pets` — 0553bd1
- [x] 1.8 `pg_policies` shows RLS enabled with four policies on the new table — 0553bd1
- [x] 1.9 A 3-day period yields 9 slots and one join row per pet id — 0553bd1
- [x] 1.10 Linking a pet the caller does not own rolls the entire create back — 0553bd1

### Phase 2: Owner API & the pet selector

#### Automated

- [x] 2.1 Type checking passes: `npx astro check` — bd93988
- [x] 2.2 Linting passes: `npm run lint` — bd93988
- [x] 2.3 Build passes: `npm run build` — bd93988
- [x] 2.4 Full suite green including the repaired route test: `npm test` — bd93988

#### Manual

- [x] 2.5 Creating a trip with one pet produces the right join rows — bd93988
- [x] 2.6 Creating a trip with two pets produces two join rows and the same slot count — bd93988
- [x] 2.7 Submitting with no pet selected is refused client-side with a field message — bd93988
- [x] 2.8 An owner with no pets sees a route to add one, not a dead form — bd93988
- [x] 2.9 The selector matches the design's chip states in all three themes — bd93988

### Phase 3: Owner read screens, contracts & the S-03 hand-off

#### Automated

- [ ] 3.1 Type checking passes: `npx astro check`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Build passes: `npm run build`
- [ ] 3.4 Full suite green: `npm test`

#### Manual

- [ ] 3.5 `/periods` names each trip's pets without a visible query regression
- [ ] 3.6 `/periods/[id]` shows the trip's pets near its title
- [ ] 3.7 A trip whose only pet was deleted renders without crashing on both screens
- [ ] 3.8 Both screens render correctly in all three themes, mobile and desktop
