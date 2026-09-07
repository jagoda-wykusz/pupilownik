# Caretaker Claims Slot Implementation Plan

## Overview

A caretaker arrives through an invite link with no account, sees which pets the trip covers
and the public half of their care instructions, selects one or more free slots, and claims
them in a single all-or-nothing submit — giving their name once. The claim mints a capability
secret that lives in an HttpOnly cookie until the period ends, and that capability is what
reveals the sensitive instruction tier and the trip's caretaker note. This is roadmap slice
S-03, the north star: the first end-to-end path that proves the product works.

## Current State Analysis

- **The caretaker page is read-only by design.** `src/pages/invite/[token].astro` resolves the
  token through `get_period_by_token`, renders a flat day list with three non-interactive
  chips per day, and ends with an explicit placeholder paragraph carrying the comment
  *"Deliberately no claim button: taking a slot is S-03."* `slot.id` is already in scope in
  the per-slot `<li>`, and `byDay` is the natural serializable prop for an island.
- **`get_period_by_token` is `STABLE` and returns `{period, slots}` only.** Verified against
  the newest definition (`supabase/migrations/20260906105815_bound_token_length.sql`): the
  payload carries `period.{id,title,start_date,end_date}` and per-slot
  `{id, slot_date, time_of_day, is_claimed}`. **No pets, no instructions.** S-08 did not touch
  it. Postgres forbids writes in a `STABLE` function, so the claim cannot be an extension of
  this one — that is a hard constraint, not a preference.
- **The claim's atomicity is already 95% solved by S-02's schema.**
  `care_slots_claim_complete` (`20260906094254_claim_columns_paired.sql:23-25`) asserts
  `(claimed_by_name is null) = (claimed_at is null)`, which is what makes
  `claimed_by_name is null` a *truthful* test of freeness. Without it,
  `(claimed_at set, claimed_by_name null)` is representable and a second caretaker overwrites
  a claimed row. `unique (period_id, slot_date, time_of_day)` is adjacent, not load-bearing:
  competing claims contend on the same row, so no unique violation can occur.
- **The relation S-03 was blocked on has landed.** `public.care_period_pets`
  (`20260906165005_period_pets_relation.sql`) makes the path
  `care_periods → care_period_pets → pets → care_instructions` real, so FR-008 is
  implementable. PostgREST resolves the many-to-many automatically; a `pets(...)` embed needs
  no mention of the join table.
- **Sensitivity is a per-ROW flag**, not per field (`care_instructions.is_sensitive`,
  `20260712204748_pets_and_instructions.sql`). The reveal is therefore a row filter, not a
  field mask — the single luckiest thing about S-01's schema for this slice.
- **A period with ZERO pets is representable, by decision.** `create_period_with_slots`
  enforces "at least one pet" and nothing else does, so a raw insert, a pre-relation row, or
  deleting the last linked pet all produce one. The caretaker page must tolerate it.
- **Anon holds no table grants at all** — asserted as SQLSTATE 42501 in
  `tests/rls/invite-token.test.ts:130-143`. Every caretaker capability therefore goes through
  a `SECURITY DEFINER` function whose body is the *entire* authorization boundary; there is no
  RLS behind it. `docs/reference/data-access.md:108-111` sanctions exactly this and names
  S-03.
- **`src/middleware.ts` protects `/invite` on a segment boundary** with
  `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and `/invite` is deliberately
  absent from `PROTECTED_ROUTES` (pinned by `tests/middleware/auth-gating.test.ts`).
- **Astro's `security.checkOrigin` defaults to `true` but skips `application/json`** — it
  returns 403 only for form-like content types or a missing one (read from Astro's source
  during research). A JSON claim route is therefore *not* origin-checked by the framework.
- **The repo has no server-set cookie of its own.** `ThemeToggle.tsx` writes
  `document.cookie` client-side; only `@supabase/ssr` writes server-side. This slice adds the
  first.
- **Two UI gaps.** `src/components/ui/Input.tsx` has no `disabled` prop, and `src/styles/global.css`
  defines `--destructive` but no success/positive token — the design's "Zapisano!" banner has
  nothing to render with.
- **Design coverage is partial.** The caretaker calendar artboard
  (`context/design/Pupilownik Hi-fi.html:541-591`) draws a month grid with `‹ ›` navigation and
  **2 dots per day** against a schema with **3** times of day, a one-tap "Zapisuję się" with
  **no name field**, and **no pre-claim public-instructions block at all**. The post-claim
  artboard draws the success banner "Masz 2 dni: 13 i 16 lipca", an instruction list, and a
  visually separated sensitive callout.

## Desired End State

A caretaker opening a valid invite link sees the trip's pets, the public instruction rows for
those pets, and a month grid of the period with per-slot free/taken dots. They select one or
more free slots, type their name once, and submit. Either the whole selection lands or none of
it does; a slot taken in the meantime produces a refusal that names the conflicting term.
After a successful claim the page shows how many days they hold, the full instruction list
including the sensitive tier, and the trip's caretaker note. A second claim from the same
browser adds slots to the same capability without re-asking the name. A different browser, or
the same person in incognito, sees the pre-claim view again.

**Verification**: `npm run build` passes with no dev server running; `npx vitest run` passes
both projects; a manual pass through the flow on a phone-sized viewport in light and dark
themes; and a `has_function_privilege` sweep confirming the grant posture of all three
functions from the catalog rather than from a migration comment.

### Key Discoveries

- `supabase/migrations/20260905234144_care_periods_and_slots.sql:38-43` — the schema comment
  already prescribes the atomic claim statement: `update … where id = $1 and claimed_by_name is null`.
- `supabase/migrations/20260906003122_invite_token_access.sql:153-165` — the grant recipe to
  copy, naming all four roles because `revoke … from public` does not reach
  `anon`/`authenticated`/`service_role` on Supabase.
- `supabase/migrations/20260906105815_bound_token_length.sql:30` — the 43-character input
  bound to mirror before hashing anything.
- `supabase/migrations/20260906165005_period_pets_relation.sql` §3 — the `drop function` +
  `create` + explicit revoke/grant recipe for a signature change, with the reasoning for why
  `create or replace` and a defaulted extra parameter both fail.
- `src/pages/api/periods.ts` — the route pattern to follow, minus its `locals.user` guard.
- `src/components/periods/RegenerateLinkButton.tsx` — the minimal island model, including a
  "refuse up front" branch that maps onto an already-taken slot.
- `src/lib/invite-view.ts` — owns the uniform-failure rule, pinned by
  `tests/unit/invite-view.test.ts`. Any post-claim page state belongs in that function, not in
  an inline `if` in the template.

## What We're NOT Doing

- **No caretaker accounts, profiles or history.** The capability is a bearer secret, nothing
  more. See "The Non-Goals reading" below.
- **No owner un-claim / release path.** FR-010 stays cut. Consequence recorded as an open
  risk: today nothing can invalidate a single caretaker's capability short of revoking the
  whole period (S-06, not yet built).
- **No caretaker names visible to other caretakers.** That is S-05 / FR-011.
- **No occupancy view for the owner beyond what already exists.** That is S-04 / FR-006.
- **No structured feeding schedule.** PRD Open Question #1, deferred to v2.
- **No waiting list or queueing on a taken slot.** PRD §Non-Goals.
- **No notifications of any kind** when a slot is claimed. PRD §Non-Goals.
- **The design's `pupilownik.pl/o/burek-7f3a` link shape is not resurrected.** The token model
  won; the shipped shape is `/invite/<43-char base64url>`.
- **No `pg` devDependency for a deterministic lock proof.** See Phase 2's testing note.
- **No PRD edit in this change.** The Non-Goals clarification is a follow-up (see below).

## Implementation Approach

Three database functions, not one, because Postgres forces the split: `get_period_by_token`
stays `STABLE` and read-only and grows the pets and *public* instruction rows; a new
`VOLATILE SECURITY DEFINER` function performs the claim; and a third `STABLE` function serves
the sensitive tier against (invite token + claim secret). The third surface is separate rather
than a second parameter on the read function because `docs/reference/data-access.md:91-92`
forbids "a parameter that could widen the result set" on that function.

The caretaker's identity is a **capability, not an account**: the app mints a 32-byte secret
exactly as it mints the invite token (`src/lib/invite-token.ts` is reusable verbatim), stores
only its hex SHA-256 on the claimed slot rows, and returns the raw value once — into an
HttpOnly cookie. "My slots" is then a filter on that digest, which is also how a follow-up
claim attaches new slots to the same caretaker without re-asking their name.

Sequencing puts all database and server work first so that the product is functional before
any design work starts. After Phase 4 a caretaker can complete the whole flow on the existing
flat day list; Phase 5 replaces that with the design's month grid. That is the deliberate cut
line if time runs out.

## Critical Implementation Details

**The claim must be one statement, and the row count is the whole all-or-nothing mechanism.**
A `select` to build a nice error message before the `update` reintroduces read-then-write:
READ COMMITTED holds no lock between statements, and being inside one plpgsql function does
not help. The safe shape is a single `update … where id = any(p_slot_ids) and period_id = v_period.id and claimed_by_name is null`,
then compare `row_count` against `array_length(p_slot_ids, 1)` and `raise` on a mismatch so
the transaction rolls back. Identifying *which* slot conflicted is a read taken **after** the
raise decision, inside the same failed transaction, or recomputed by the client from a fresh
`get_period_by_token`. Do not invert that order.

**The extended CHECK must be dropped and re-added, not amended.** `care_slots_claim_complete`
currently pairs two columns; it becomes a three-column invariant. A constraint cannot be
altered in place.

**`drop function` + `create` is the only safe shape for the signature change, and a trailing
defaulted parameter keeps existing callers valid.** Adding a parameter to a live function
creates a *second* function (an overload) which inherits Supabase's `ALTER DEFAULT PRIVILEGES`
grants and leaves the old signature reachable; `create or replace` preserves grants only when
the argument list is unchanged. Dropping first leaves exactly one function with exactly one
known grant posture — and because the new parameter is `default null`, PostgREST still
resolves the existing 5-argument named calls in `src/pages/api/periods.ts` and the four test
files. **Those call sites do not need editing for the note.**

**Cookie attributes are a contract.** `HttpOnly` (no JS read), `Secure`, `SameSite=Lax`,
`Path=/invite` (so it never rides along on an owner request), and `Max-Age` computed from the
period's `end_date` plus a buffer. `src/middleware.ts` already sends `Cache-Control: no-store`
for this prefix, which is exactly what a cookie-varying response needs — do not remove it.

**Route placement is a token-leak hazard.** The claim route lives at `POST /invite/claim` with
the token in the JSON **body**, not the path. That is the only placement that is both inside
the middleware's `/invite` segment match (so it inherits `no-referrer` and `no-store`) and
free of the token in its own URL. A route at `/api/invite/<token>/claim` would sit outside the
prefix, be cacheable, and leak the token through `Referer`.

**Rule 4 (uniform failure) does not survive a write unchanged.** A claim must distinguish won
from refused, which is a signal a read never emitted. This is a real, small widening of the
token model and `docs/reference/data-access.md` must say so rather than have a reader discover
it.

**The Non-Goals reading, stated deliberately.** `prd.md:144` forbids *"konta i tożsamość
opiekunów … żadnych logowań, profili ani historii."* This plan takes the reading that a
per-claim capability secret is **not** what that forbids: there is no login, no profile and no
history — only a bearer credential, which the invite link already is. That is a reading, not a
neutral fact, and it is recorded here so the tension is visible. A PRD clarification is a
follow-up outside this change.

---

## Phase 1: Schema & RPC signature

### Overview

Add the two columns this slice needs, tighten the claim invariant to cover all three claim
columns, and thread the caretaker note through the create path. No behavior is caretaker-visible
yet.

### Changes Required

#### 1. The caretaker note and the claim digest

**File**: `supabase/migrations/<timestamp>_claim_capability_and_note.sql` (new)

**Intent**: Add `care_periods.caretaker_note` (the design's period-level `NOTATKA`, free text,
sensitive tier) and `care_slots.claim_digest` (the hex SHA-256 of the claiming caretaker's
capability secret). Then replace `care_slots_claim_complete` so the invariant covers the
digest too — a slot is either wholly free or wholly claimed, and "claimed" now includes
"attributable to a capability".

**Contract**: `care_periods.caretaker_note text` (nullable, with a length bound mirroring
`MAX_TITLE_LENGTH`'s pattern); `care_slots.claim_digest text` (nullable). The replaced
constraint:

```sql
alter table public.care_slots drop constraint care_slots_claim_complete;
alter table public.care_slots
  add constraint care_slots_claim_complete
  check (
    (claimed_by_name is null) = (claimed_at is null)
    and (claimed_by_name is null) = (claim_digest is null)
  );
```

An index on `care_slots (period_id, claim_digest)` supports the "my slots" filter Phase 3
reads.

#### 2. The create RPC gains the note

**File**: same migration

**Intent**: Re-create `create_period_with_slots` with a trailing `p_caretaker_note text default null`
so the owner can set the note when creating a trip, and restore the grant posture on the new
signature. Follow `20260906165005_period_pets_relation.sql` §3–4 exactly.

**Contract**: `create_period_with_slots(p_title text, p_start_date date, p_end_date date, p_token_digest text, p_pet_ids uuid[], p_caretaker_note text default null)`,
`security invoker`, `set search_path = ''`. Body unchanged from
`20260906174022_filter_null_pet_ids.sql` except that the period insert carries the note. Then
`revoke execute … from public, anon, service_role` and `grant execute … to authenticated` on
the full new argument list.

#### 3. Owner-side plumbing for the note

**Files**: `src/lib/schemas/period.ts`, `src/pages/api/periods.ts`,
`src/components/periods/NewPeriodForm.tsx`, `src/lib/period-format.ts`

**Intent**: Accept the note on the create payload, validate its length, pass it to the RPC,
and give the create form the design's `NOTATKA` textarea. The note is optional.

**Contract**: `createPeriodSchema` gains an optional `caretaker_note`; a new
`PERIOD_MESSAGES.noteTooLong` entry (the set is a contract pinned by
`tests/unit/period-schema.test.ts`); a `MAX_NOTE_LENGTH` export in `period-format.ts`
alongside the other shared bounds, so schema and island cannot drift.

#### 4. Registry and reference updates

**Files**: `docs/reference/contract-surfaces.md`, `docs/reference/data-access.md`

**Intent**: Update the `create_period_with_slots` row to the new signature and note the
caretaker-note column. `data-access.md` is updated in Phase 3 when the payload actually
changes.

### Success Criteria

#### Automated Verification

- Migration applies cleanly on a reset database: `npm run db:reset`
- Types regenerate and match: `npm run db:gen-types` leaves `src/db/database.types.ts` reflecting the new signature and columns
- Unit tests pass: `npx vitest run --project unit`
- Integration tests pass with the four RPC-seeding suites untouched: `npx vitest run --project integration`
- Type checking and linting pass: `npm run build` (dev server stopped first) and `npm run lint`

#### Manual Verification

- `has_function_privilege` read from the catalog confirms `create_period_with_slots(text,date,date,text,uuid[],text)` is executable by `authenticated` and **not** by `anon`, `public` or `service_role`
- Exactly one `create_period_with_slots` function exists in `pg_proc` — the old 5-argument signature is gone
- A `care_slots` row cannot be written with only two of the three claim columns set (verified in psql, expecting a constraint error)
- Creating a trip through the UI with and without a note both succeed; the note round-trips

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation before proceeding.

---

## Phase 2: The claim function

### Overview

The write path. One new `VOLATILE SECURITY DEFINER` function is the entire authorization
boundary for an anonymous claim, and this phase is where the atomicity guarantee becomes real.

### Changes Required

#### 1. `claim_slots`

**File**: `supabase/migrations/<timestamp>_claim_slots.sql` (new)

**Intent**: Claim a set of slots for one caretaker capability, all-or-nothing, deriving the
period from the invite token so no caller can name a period or reach across periods.

**Contract**: `claim_slots(p_token text, p_slot_ids uuid[], p_claim_digest text, p_name text default null) returns jsonb`,
`language plpgsql`, `security definer`, **`volatile`** (the default — do not copy `stable` from
the read function), `set search_path = ''`.

The body must, in order:

1. Bound `p_token` to exactly 43 characters and return the uniform failure before hashing —
   mirroring `20260906105815_bound_token_length.sql:30`.
2. Bound `p_slot_ids` (non-empty, a sane upper limit) and `p_claim_digest` (64 hex chars) before
   any table access. An anon-callable write must not accept an unbounded array.
3. Derive the period from the token digest with `revoked_at is null`. **Never accept a period id.**
4. Decide the caretaker's name: if `p_claim_digest` already carries claims in this period, reuse
   the stored `claimed_by_name` and ignore `p_name`; otherwise `p_name` is required, trimmed,
   non-empty and length-bounded. `claimed_by_name` is unbounded `text` with no CHECK, so this
   bound is the only thing standing between an anon caller and storage amplification.
5. Perform the single `update` described in Critical Implementation Details, carrying
   `period_id = v_period.id` (the one genuinely new check — a leaked slot uuid from another
   period is a *valid* uuid and only the join stops it), `claimed_by_name is null`, and
   `revoked_at`'s freshness via the derived period.
6. Compare the affected row count to the requested count and `raise` on a mismatch so the
   transaction rolls back.
7. Return `jsonb`, never a plpgsql composite — a composite answers a miss with a row of NULLs
   rather than NULL, which already bit S-02.

Then the grant pair, naming all four roles, per
`20260906003122_invite_token_access.sql:153-165`. `authenticated` gets execute for the same
reason the read function does: a signed-in owner opening their own link must work.

#### 2. Claim-secret minting

**File**: `src/lib/invite-token.ts`

**Intent**: Expose the existing 32-byte base64url generator and hex SHA-256 digester under
claim-secret names so the claim path does not grow a second, subtly different implementation.

**Contract**: The digest encoding must stay byte-identical to
`encode(sha256(convert_to(secret,'UTF8')),'hex')` in Postgres — the same invariant
`contract-surfaces.md` already records for the invite token.

#### 3. Tests

**Files**: `tests/rls/claim-slots.test.ts` (new)

**Intent**: Pin the properties that are invisible from the code — and that this project has a
recorded history of describing without having.

**Contract**: Four groups.

- **Grant posture**, read from `has_function_privilege`, failing if `anon` loses execute or
  `service_role` gains it.
- **IDOR** — a token for period A cannot claim a slot in period B. Fully deterministic; the
  highest-value test here.
- **Revoked period** — a claim through a revoked token is refused.
- **Concurrency invariant** — `Promise.all` over N `createAnonClient()` calls **inside one
  `it()`** (Vitest runs files in parallel but tests within a file serially, so splitting
  claimants across `it()` blocks produces no contention). The assertion is an **invariant, not
  a status count**: exactly one settled result won, N−1 were refused, and reading the final
  state back shows exactly one row carrying a claim whose name matches the winner and whose
  `claimed_at` and `claim_digest` are both non-null.

**A passing concurrency test does not prove the row lock was exercised** — nothing forces the
two UPDATEs to overlap, and the same test would pass against a broken read-then-write
implementation that happened not to interleave. It is a non-flaky outcome check that is
*opportunistically* a mechanism check. Say so in the test file rather than claiming a proof.
`test-plan.md:64` prescribes this shape and names the anti-pattern: *"Testing two sequential
claims and calling it concurrency"*, and *"'Final status 200' ≠ 'only one winner'"*.

### Success Criteria

#### Automated Verification

- New suite passes: `npx vitest run --project integration tests/rls/claim-slots.test.ts`
- Full integration suite still passes: `npx vitest run --project integration`
- Type checking and linting pass: `npm run build` (dev server stopped) and `npm run lint`

#### Manual Verification

- `has_function_privilege` from the catalog confirms `claim_slots` is executable by `anon` and `authenticated`, and not by `public` or `service_role`
- `pg_proc.provolatile` for `claim_slots` is `v` — not `s`
- A partial selection (three free slots plus one already taken) leaves **all four** unclaimed, verified in psql
- The concurrency test is run several times and the invariant holds each time

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: The reveal

### Overview

Both halves of FR-008. The public tier joins the existing read function's payload; the
sensitive tier gets its own function gated on the capability digest.

### Changes Required

#### 1. Extend `get_period_by_token`

**File**: `supabase/migrations/<timestamp>_reveal_instructions.sql` (new)

**Intent**: Add the trip's pets and their **public** instruction rows to the payload, leaving
the function `STABLE` and its signature untouched so `create or replace` preserves grants.

**Contract**: The payload gains `pets: [{ id, name, species, instructions: [{ id, title, body, sort_order }] }]`,
filtered to `is_sensitive = false` and ordered by `sort_order`. `slots` and `period` keep their
existing keys — this is an additive change to a contract three consumers read. **A period with
zero pets must return `pets: []`, not null**, so the page has nothing to crash on.

#### 2. `get_claimed_details`

**File**: same migration

**Intent**: Serve the sensitive tier, the caretaker note and the caretaker's own slots to a
holder of both the invite token and a matching claim secret. A separate function rather than a
parameter on the read function, per `data-access.md:91-92`.

**Contract**: `get_claimed_details(p_token text, p_claim_secret text) returns jsonb`,
`security definer`, `stable`, `set search_path = ''`. Bounds both inputs before hashing,
derives the period from the token, hashes the secret, and returns NULL unless that digest
carries at least one claimed slot in that period. On success returns
`{ name, slots: [...], caretaker_note, pets: [{ …, instructions: [ …sensitive rows… ] }] }`.
Returning NULL for "no matching capability" keeps this surface inside rule 4. Same four-role
grant pair.

#### 3. Payload consumers

**Files**: `src/pages/invite/[token].astro`, `tests/rls/invite-token.test.ts`,
`tests/api/periods.post.test.ts`, `src/db/database.types.ts`, `docs/reference/data-access.md`,
`docs/reference/contract-surfaces.md`

**Intent**: Widen the page's local `TokenPayload` interface, update the two suites that pin the
payload's exact key sets (`invite-token.test.ts:54`, `periods.post.test.ts:218,282-283`),
regenerate types, and correct the reference docs.

**Contract**: `data-access.md`'s rule 2 currently reads *"no instruction rows"* — that becomes
false the moment this ships and must be rewritten to describe the two-function model and the
tier split. The same section's heading *"One SECURITY DEFINER function is the entire
anon-reachable surface"* becomes a statement of history rather than a cap; say so. Rule 4's
widening (a write signals refusal) is recorded here too. `contract-surfaces.md` gains rows for
`claim_slots` and `get_claimed_details`.

### Success Criteria

#### Automated Verification

- Both suites pinning the payload pass with their updated key sets: `npx vitest run --project integration`
- Unit tests pass: `npx vitest run --project unit`
- Type checking and linting pass: `npm run build` (dev server stopped) and `npm run lint`

#### Manual Verification

- `has_function_privilege` confirms the grant posture of `get_claimed_details`; `provolatile` is `s`
- An invite token alone returns public instruction rows and **no** sensitive rows — verified in psql against a period seeded with both
- A period with zero linked pets returns `pets: []` and the page renders without error
- A valid token with a wrong or absent claim secret returns NULL from `get_claimed_details`

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Route, cookie & a working claim

### Overview

The server path and the smallest UI that completes the flow. **After this phase the north star
is delivered** — a caretaker can claim slots and read the sensitive tier, on the existing flat
day list.

### Changes Required

#### 1. The claim route

**File**: `src/pages/invite/claim.ts` (new)

**Intent**: Accept a claim, mint the capability secret, call `claim_slots`, and set the cookie.
Follows `src/pages/api/periods.ts` with two deliberate inversions.

**Contract**: `POST /invite/claim`, JSON in/out. The token, slot ids and name arrive in the
**body**. Two inversions from the existing route pattern, both of which look like bugs and must
be commented as intentional: **no `context.locals.user` guard** (the caretaker has no account),
and **an explicit `Origin` header check** (Astro's `checkOrigin` skips `application/json`, so
the framework provides nothing here). A zod schema mirrors every bound the database function
enforces, so a bad request answers 400 rather than surfacing a `raise` as a 500. On a
follow-up claim the handler reads the existing cookie and passes its digest instead of minting
a new secret.

Refusal mapping: the function's all-or-nothing `raise` becomes a 409 carrying a sentence that
names the conflicting term; an unresolved token becomes the same uniform failure the page uses.
Never log the raw secret or the raw token.

#### 2. The capability cookie

**File**: `src/lib/claim-cookie.ts` (new)

**Intent**: One place that knows how the capability cookie is named, set and read, so the
attribute set cannot drift between the route and the page.

**Contract**: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/invite`, `Max-Age` derived from the
period's `end_date` plus a buffer. A named export for the cookie name so both consumers and the
tests reference one string.

#### 3. Post-claim page state

**Files**: `src/lib/invite-view.ts`, `src/pages/invite/[token].astro`

**Intent**: Teach `resolveInviteView` the post-claim state and have the page read the cookie,
call `get_claimed_details`, and render the sensitive tier when a capability resolves.

**Contract**: A fourth `InviteView` kind for "period, and this visitor holds claims". **It must
not distinguish token failure modes** — the uniform-failure rule is a security property pinned
by `tests/unit/invite-view.test.ts`, and a post-claim branch belongs in this function rather
than an inline `if` in the template. A capability that no longer resolves (revoked period,
cleared claim) degrades silently to the pre-claim view.

#### 4. Minimal claim UI

**File**: `src/components/invite/ClaimSlots.tsx` (new)

**Intent**: A React island over the existing `byDay` structure: checkboxes on free slots, one
name field, one submit. Modelled on `RegenerateLinkButton.tsx` (own `submitting` flag,
status-branched `ServerError`, a "refuse up front" branch) rather than `NewPeriodForm.tsx`.
Deliberately unstyled beyond the existing tokens — Phase 5 owns the design.

**Contract**: Props are the serializable `byDay` plus the token. Taken slots are not
selectable. Do **not** import `FormField` or `PasswordToggle` (both superseded), and copy
nothing visually from `AddPetForm.tsx` (it hardcodes starter colours).

#### 5. Route tests

**File**: `tests/api/invite-claim.test.ts` (new)

**Intent**: Cover the route's own behavior, especially the two inversions.

**Contract**: A claim with no session succeeds (the inversion that matters most); a
cross-origin `Origin` header is rejected; a malformed body answers 400 with a Polish sentence;
a conflicting selection answers 409 and claims nothing; the response sets an `HttpOnly` cookie
and the body does **not** contain the raw secret.

### Success Criteria

#### Automated Verification

- New route suite passes: `npx vitest run --project integration tests/api/invite-claim.test.ts`
- The uniform-failure unit test still passes with the fourth view kind: `npx vitest run --project unit`
- Full suite passes: `npx vitest run`
- Type checking and linting pass: `npm run build` (dev server stopped) and `npm run lint`

#### Manual Verification

- End-to-end on a phone-sized viewport: open a real invite link with no session, select two slots, claim, and see the sensitive callout and the note
- A second claim from the same browser adds a slot **without** re-asking the name, and the day count updates
- The same link in an incognito window shows the pre-claim view — no sensitive rows
- The response carries `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and the capability cookie is `HttpOnly` with `Path=/invite` (checked in devtools)
- The cookie is absent from requests to `/periods` and `/dashboard`
- Claiming a slot that a second browser took a moment earlier refuses the whole selection and names the term

**Implementation Note**: This is the cut line. Pause for manual confirmation; Phase 5 is
design polish on a working flow.

---

## Phase 5: Design layer

### Overview

Bring the caretaker screens to the hi-fi design, on top of a flow that already works.

### Changes Required

#### 1. Shared UI gaps

**Files**: `src/styles/global.css`, `src/components/ui/Input.tsx`

**Intent**: Add a success/positive token trio (light, dark and the third theme) so the
"Zapisano!" banner has something to render with, and give `Input` a `disabled` prop so the
claim form can lock while posting.

**Contract**: Both are shared surfaces, so `context/foundation/lessons.md` applies: enumerate
every consumer before changing them. The token addition is additive — no existing consumer
changes. `Input`'s new prop must default to `false` so its four current call sites are
untouched.

#### 2. The month grid

**File**: `src/components/invite/PeriodCalendar.tsx` (new)

**Intent**: Replace the flat day list with the design's month grid: weekday header, square day
cells, `‹ ›` navigation, a legend, and a selected-day state. **Three dots per day, not the
design's two** — the schema has three times of day, and the design predates that.

**Contract**: Dot states are free (hollow), taken (filled) and day-full (grey). Navigation is
bounded to the months the period actually spans; `MAX_SPAN_DAYS = 31` means at most two, so the
control is often inert and must not render as broken when there is nowhere to go. Selection
state is local to the island. Mobile-first per the PRD's NFR — the caretaker opens this on a
phone.

#### 3. Claim cards and the post-claim screen

**Files**: `src/components/invite/ClaimSlots.tsx`, `src/pages/invite/[token].astro`

**Intent**: Slot cards for the selected day with the design's `WOLNE` pill and accent button,
the success banner with the day count, the instruction list with time chips, and the sensitive
callout as its own emphasized card below the list.

**Contract**: The design draws no taken-slot card state and no pre-claim instruction block —
both are invented here and the invention is recorded, not silent (this is precisely the failure
`lessons.md` catalogues from S-02's dropped pet selector). Public instructions render above the
calendar so a caretaker knows what they are signing up for before selecting.

### Success Criteria

#### Automated Verification

- Full suite passes: `npx vitest run`
- Type checking and linting pass: `npm run build` (dev server stopped) and `npm run lint`

#### Manual Verification

- The caretaker calendar matches the design at a phone width in light, dark and the third theme
- A 31-day period spanning two months navigates correctly; a 3-day period renders without a broken navigation control
- The four existing `Input` call sites (sign-in, sign-up, add pet, new period) are visually unchanged
- The sensitive callout is visually separated from the public instruction list, per the design
- A day with all three slots taken renders the grey day-full state

**Implementation Note**: Final phase. After manual confirmation, close the plan.

---

## Testing Strategy

### Unit Tests

- `resolveInviteView` with the fourth state — including that a resolving capability on an
  unresolvable token still produces the single uniform failure
- `createPeriodSchema` with and without a caretaker note, and the note's length bound; message
  membership in `PERIOD_MESSAGES`
- The claim payload schema, mirroring every database bound
- Claim-secret digest equality against a known-answer hex vector, so app and database cannot
  drift

### Integration Tests

- Grant posture of all three functions, read from `has_function_privilege`
- IDOR: a token for period A cannot claim a slot in period B
- A claim through a revoked token is refused
- The concurrency invariant (see Phase 2 — an outcome check, not a proof of the lock)
- Public tier reachable with the token alone; sensitive tier only with a matching capability
- A period with zero linked pets renders and claims without error
- Route behavior: no session required, cross-origin rejected, 409 claims nothing, secret never
  in the body

### Manual Testing Steps

1. Create a trip covering two pets, one with a sensitive instruction row, and add a caretaker note.
2. Open the invite link in a private window on a phone-sized viewport. Confirm the pets and public
   instructions show and the sensitive rows do not.
3. Select two slots, enter a name, submit. Confirm the success banner, the day count, the full
   instruction list and the note.
4. Claim a third slot. Confirm no name prompt and an updated count.
5. Open the same link in a second private window. Confirm the pre-claim view.
6. From that second window, claim a slot the first window already holds — confirm refusal naming the term.
7. With two windows, submit overlapping selections as close to simultaneously as possible. Confirm one wins
   and the other's selection lands entirely unclaimed.
8. Revoke the period as the owner. Confirm both windows fall back to the uniform failure page.

## Performance Considerations

Row counts at MVP scale are trivial (at most 31 days × 3 slots per period), so no query here
needs tuning. Two bounds exist for abuse rather than performance and must not be dropped: the
43-character token check before hashing, and the array-length bound on `p_slot_ids` — both
guard an unauthenticated caller from making the database work before a guaranteed miss. The
new `care_slots (period_id, claim_digest)` index serves the "my slots" filter; `care_instructions`
has no index for `(pet_id, is_sensitive)` and does not need one at these row counts, but the
reveal query should be written knowing that.

## Migration Notes

`supabase/seed.sql` seeds one owner, one pet, two instructions and **zero periods**, so
`npm run db:reset` gives a clean local slate. But `care_periods` has a live insert path and the
documented workflow includes `npm run db:push` to a hosted project, so unlike S-01 this change
cannot assume "no existing domain data". Both new columns are nullable and the new constraint
is satisfied by any existing row (all three claim columns null on an unclaimed slot), so the
migration is additive for existing data. A pre-existing *claimed* slot would violate the new
three-column CHECK — there are none today, and the migration should fail loudly rather than
coerce them if that ever stops being true. Seeding a period linked to the seeded pet would make
`db:reset` more useful for this flow; treated as optional.

## References

- Research: `context/changes/caretaker-claims-slot/research.md`
- Change identity and inherited decisions: `context/changes/caretaker-claims-slot/change.md`
- The signature-change recipe: `supabase/migrations/20260906165005_period_pets_relation.sql` §3–4
- The grant recipe: `supabase/migrations/20260906003122_invite_token_access.sql:153-165`
- The prescribed atomic claim: `supabase/migrations/20260905234144_care_periods_and_slots.sql:38-43`
- The paired-claim CHECK this extends: `supabase/migrations/20260906094254_claim_columns_paired.sql:23-25`
- Route pattern: `src/pages/api/periods.ts`
- Island pattern: `src/components/periods/RegenerateLinkButton.tsx`
- Token model rules: `docs/reference/data-access.md:80-120`
- Test layers and anti-patterns: `context/foundation/test-plan.md:52-66`
- Design: `context/design/Pupilownik Hi-fi.html:541-591`

## Follow-ups (outside this change)

- **PRD clarification.** `prd.md:144` §Non-Goals should record that a per-claim capability is
  not a caretaker account, per the reading stated above. PRD v2, not this change.
- **`test-plan.md:53` is worded contrary to `:65`.** `:65` ("only to a caretaker who has
  claimed") is authoritative after decision D1; `:53` needs rewording.
- **Nothing can invalidate a single caretaker's capability.** An owner un-claim path (FR-010,
  cut) or period revocation (S-06, `ready`) are the two candidates. Recorded as an open risk.
- **`roadmap.md`'s S-03 prerequisite line** already names S-08; no edit needed.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & RPC signature

#### Automated

- [x] 1.1 Migration applies cleanly on a reset database
- [x] 1.2 Types regenerate and match the new signature and columns
- [x] 1.3 Unit tests pass
- [x] 1.4 Integration tests pass with the four RPC-seeding suites untouched
- [x] 1.5 Type checking and linting pass

#### Manual

- [x] 1.6 `has_function_privilege` confirms the create RPC's grant posture from the catalog
- [x] 1.7 Exactly one `create_period_with_slots` exists in `pg_proc`
- [x] 1.8 A two-of-three claim-column write is rejected by the constraint
- [x] 1.9 Creating a trip with and without a note both succeed; the note round-trips

### Phase 2: The claim function

#### Automated

- [ ] 2.1 New `claim-slots` suite passes
- [ ] 2.2 Full integration suite still passes
- [ ] 2.3 Type checking and linting pass

#### Manual

- [ ] 2.4 `has_function_privilege` confirms `claim_slots` grant posture
- [ ] 2.5 `provolatile` for `claim_slots` is `v`
- [ ] 2.6 A partial selection leaves every requested slot unclaimed
- [ ] 2.7 The concurrency invariant holds across repeated runs

### Phase 3: The reveal

#### Automated

- [ ] 3.1 Both payload-pinning suites pass with updated key sets
- [ ] 3.2 Unit tests pass
- [ ] 3.3 Type checking and linting pass

#### Manual

- [ ] 3.4 `get_claimed_details` grant posture and `provolatile = s` confirmed
- [ ] 3.5 Token alone returns public rows and no sensitive rows
- [ ] 3.6 A zero-pet period returns `pets: []` and renders
- [ ] 3.7 A wrong or absent claim secret returns NULL

### Phase 4: Route, cookie & a working claim

#### Automated

- [ ] 4.1 New route suite passes
- [ ] 4.2 The uniform-failure unit test passes with the fourth view kind
- [ ] 4.3 Full suite passes
- [ ] 4.4 Type checking and linting pass

#### Manual

- [ ] 4.5 End-to-end claim on a phone-sized viewport reveals the sensitive tier and the note
- [ ] 4.6 A second claim from the same browser needs no name and updates the count
- [ ] 4.7 Incognito shows the pre-claim view
- [ ] 4.8 Invite headers present; capability cookie is `HttpOnly` with `Path=/invite`
- [ ] 4.9 The cookie is absent from `/periods` and `/dashboard` requests
- [ ] 4.10 A conflicting selection refuses entirely and names the term

### Phase 5: Design layer

#### Automated

- [ ] 5.1 Full suite passes
- [ ] 5.2 Type checking and linting pass

#### Manual

- [ ] 5.3 Caretaker calendar matches the design at phone width in all three themes
- [ ] 5.4 A two-month period navigates; a short period renders no broken control
- [ ] 5.5 The four existing `Input` call sites are visually unchanged
- [ ] 5.6 The sensitive callout is visually separated from the public list
- [ ] 5.7 A fully-taken day renders the day-full state
