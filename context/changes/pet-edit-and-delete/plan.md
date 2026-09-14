# Pet edit + delete (S-09) Implementation Plan

## Overview

The owner can finally change a pet after creating it, and remove one no live trip covers.
Editing is the point: `prd.md:48` promises the caretaker always sees the current feeding
instructions, and today that promise cannot be kept — there is no write path, so a wrong
portion size is permanent. Deleting is the smaller half, and it exists mainly to be
_refused_ safely: the schema cascades a pet out of a running trip without a word to anyone.

Both writes go through named `security invoker` RPCs, because each carries an invariant RLS
cannot express — atomic parent+children sync, the `is_sensitive` freeze, and the live-trip
refusal.

## Current State Analysis

Measured 2026-09-13 against the local stack and the catalog, not read from comments
(`research.md` §1–2 carries the full transcripts).

**The capability already exists; only the guard is missing.** Role `authenticated` holds
`SELECT, INSERT, UPDATE, DELETE` on `pets`, `care_instructions` and `care_period_pets`, and
all four per-operation policies exist on each. `update public.pets … where id = <own>`
answered `UPDATE 1` under the owner's own JWT. So this slice adds a **guard, not a
capability** — the same position `revoke_period` was in
(`docs/reference/contract-surfaces.md:52`).

**The cascade's real failure mode is worse than "the pet disappears".** With an active trip,
both pets linked and one term claimed by "Ania", deleting a pet gave: caretaker's view 2
pets → 1; that pet's 2 instruction rows (one sensitive) → 0; **claim, slot, trip and invite
link all untouched**. The volunteer keeps a shift for an animal that is no longer on the
trip, with the instructions gone, and there is no mechanism by which she could learn it.

**The with-check defence exists and nothing pins it.** Re-pointing an own instruction at
another owner's pet answered `ERROR: new row violates row-level security policy`. No test
covers it, and no test covers any _positive_ owner path either — today's suite stays green
if `pets_update_own` and `pets_delete_own` are dropped entirely.

**No non-POST/GET verb exists anywhere in `src/pages/api/`.** This slice ships the first
`PUT` and the first `DELETE` in the codebase.

### Key Discoveries

- `create_pet_with_instructions` (`supabase/migrations/20260712204748_pets_and_instructions.sql:118-152`)
  is the shape to mirror: `security invoker`, `set search_path = ''`, `owner_id` taken from
  `(select auth.uid())` and never from a parameter, children inserted from
  `jsonb_array_elements(coalesce(p_instructions, '[]'::jsonb))`.
- **A guarded write must return a scalar, never a composite**
  (`20260906003122_invite_token_access.sql:123-126`): a plpgsql function returning a
  composite answers a miss with a ROW OF NULLS rather than NULL, so the route's 404 branch
  would never fire.
- **A business-rule refusal is `raise ... using errcode = 'PT409'`** — PostgREST maps
  `PTxxx` onto the HTTP status, which is what keeps the refusal out of the NULL→404 path
  (`src/pages/invite/claim.ts:112-118`, `20260907171514_claim_secret_not_digest.sql:251-254`).
  `DETAIL` carries a JSON string the route parses, never prose.
- **`revoke ... from public` is not enough on Supabase** — `ALTER DEFAULT PRIVILEGES` grants
  EXECUTE to `anon`, `authenticated` and `service_role` separately, so the roles must be
  named (`20260909090000_release_slot.sql:88-97`).
- **`/api/pets/[id]` is ungated by middleware.** `PROTECTED_ROUTES` (`src/middleware.ts:8`)
  matches `startsWith` on `/dashboard`, `/pets`, `/periods`; `/api/pets` matches none. The
  handler's own 401 is the only gate.
- **A JSON body escapes Astro's CSRF check.** `security.checkOrigin` only inspects a
  non-safe request carrying **no** `Content-Type` (`src/pages/invite/claim.ts:13-15`), so
  `PUT` must carry the explicit three-line Origin check.
- **Ground and primitives are one decision.** `bg-cosmic` is a fixed gradient with no theme
  variant (`src/styles/global.css:207-209`); `ui/Input` renders its label _outside_ the box
  as `text-muted-foreground`, which on navy is ≈3.4:1 in the default light theme and
  near-black-on-near-black in `.contrast`.
- `src/pages/periods/[id].astro` is the only detail-page template, and it is entirely
  token-based — there is no navy detail page to copy.
- `tests/render/island-props.test.ts:80` pins `/src/pages/pets/index.astro: 0` islands.

## Desired End State

An owner opens `/pets`, taps a pet card, and lands on `/pets/<id>`: a form pre-filled with
the pet's data and its instruction rows, and below it a delete zone. Saving rewrites the pet
and its instruction set atomically; a caretaker holding the invite link sees the new text on
their next page load, with no cache to bust. Toggling `is_sensitive` on a row is refused
while any slot on a live trip covering that pet is claimed. Deleting is refused while any
live trip covers the pet, with a sentence naming the remedy — revoke the trip first.

Verify: the Progress section's automated items all pass, and the manual walkthrough in
Testing Strategy is confirmed by a human at the end of each phase.

## What We're NOT Doing

- **Not migrating `/pets` or `/pets/new` off `bg-cosmic`.** _(Superseded 2026-09-14 — see
  Deviations in Progress. Both screens moved, and `AddPetForm` with them.)_ They stay navy and keep their
  missing theme toggle until S-01's own reskin. `/pets/<id>` ships on `bg-background` with
  a working toggle. **This is a deliberate, temporary inconsistency** — the alternative was
  a token form on a themeless ground, which is broken in two of three themes.
- **Not touching `AddPetForm.tsx`, `pets/new.astro`, `auth/FormField` or
  `auth/PasswordToggle`.** _(Superseded 2026-09-14 — see Deviations in Progress.)_ No shared-component refactor; `EditPetForm` is a new, separate
  component. The only edit to `/pets` is wrapping the card in an anchor.
- **Not revoking the table-level `UPDATE`/`DELETE` grants.** The RPCs are the _intended_
  writer, not the enforced one — the same posture `contract-surfaces.md:36` records for
  `release_slot`. A determined owner can still write directly with PostgREST. Stated here so
  it is a decision, not an oversight.
- **Not making the `is_sensitive` freeze hard.** Delete + re-add reproduces the reveal in
  two deliberate steps. Accepted: the block defends against an accidental click and a silent
  contract change, not against the owner's intent — they authored the data. Both closure
  variants were considered and rejected (`change.md`).
- **No date predicate anywhere.** "The trip has ended" is not a concept in this product
  (`prd.md` Open Question #4); introducing one here would be the first derived-from-date
  state in the codebase.
- **No new E2E spec.** Four stale prose claims get corrected; the browser path is covered by
  manual verification. E2E is deliberately outside `ci:gate` (no Docker in the Cloudflare
  build container), so a spec here would not gate anything.
- **No bulk revoke, no un-revoke, no period editing.** Out of scope; each is its own slice.
- **No cascade test for pets→`care_instructions`, no `pet_species`↔zod enum drift test.**
  Real gaps from `research.md` §4, but untouched by this slice — they belong to a test-only
  change.

## Implementation Approach

Two phases, each ending in a runnable product. Phase 1 delivers editing end to end, which is
what makes the PRD guardrail true and produces the page Phase 2's button stands on. Phase 2
adds the delete and its refusal.

Inside each phase the order is forced by dependencies: migration first (routes cannot
typecheck against an RPC that does not exist), then `npm run db:gen-types`, then schema,
route, page, island, tests, registry.

Two predicates do similar-sounding work and **must not be conflated** — the plan names them
separately and so should the code:

| Name           | Guards                  | Predicate                                                                                   |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------------- |
| _freeze_       | `is_sensitive` on a row | a covering period with `revoked_at is null` **and** some slot `claimed_by_name is not null` |
| _delete-block_ | deleting the pet        | a covering period with `revoked_at is null` (no claim condition)                            |

## Critical Implementation Details

**The freeze must compare against the stored row, not trust the payload.** The RPC receives
the desired instruction set; the flag it must protect is the one currently in the table. So
the freeze check is a join between incoming rows (matched by `id`) and their stored
counterparts, raising when `is_sensitive` differs and the freeze predicate holds. A check
written against the incoming value alone is a no-op that looks like a guard.

**Instruction ids are owner-supplied input and must be treated as such.** An `id` naming a
row under another owner's pet must not be adoptable. RLS's with-check already refuses it
(measured), but the RPC should also carry the redundant `pet_id = p_pet_id` predicate on
every child write — the same deliberate redundancy `release_slot` documents at
`20260909090000:43-47`, so the route's URL and the guard agree.

**Rows absent from the payload are deletions.** That is what makes `PUT` the honest verb: the
body is the complete desired state of the pet and its instruction set, not a patch.

## Phase 1: Editing, end to end

### Overview

The owner can change a pet's fields and its instruction set; a caretaker sees the result on
their next load. The `is_sensitive` freeze ships with this phase because it is a property of
the update path.

### Changes Required:

#### 1. Roadmap row

**File**: `context/foundation/roadmap.md`

**Intent**: Register S-09 before work starts, so the slice exists in the index the rest of
the project reads.

**Contract**: A row in the At-a-glance table, a Streams entry, a `### S-09` section with the
standard fields, and a Backlog Handoff row. Take the next free number and place it by
dependency — the S-08 precedent. Write `Outcome` as what the slice _will_ do, and keep it
honest: `/10x-archive` copies that field verbatim into `## Done`, which is how an aspirational
sentence becomes a false historical record (`lessons.md`).

#### 2. The update function

**File**: `supabase/migrations/<ts>_update_pet_with_instructions.sql`

**Intent**: Replace a pet's scalar fields and synchronise its instruction set in one
transaction, refusing an `is_sensitive` flip on a row whose pet is covered by a live trip
with a claimed slot.

**Contract**: `public.update_pet_with_instructions(p_pet_id uuid, p_name text, p_species
public.pet_species, p_breed text, p_age text, p_instructions jsonb) returns uuid`.
`security invoker`, `set search_path = ''`, body fully qualified (`pg_catalog.*`).
Never accepts `owner_id`. Returns the pet id, or NULL when the pet does not exist or RLS
filtered it out. Incoming instruction objects carry an optional `id`: present → update that
row (matched additionally on `pet_id = p_pet_id`), absent → insert, stored rows whose id is
absent from the payload → delete. `sort_order` comes from array position. Raises
`errcode = 'PT409'` with `DETAIL` carrying a JSON array of the offending instruction ids
when the freeze predicate holds and a matched row's `is_sensitive` differs from storage.
Carries the prose header this repo expects (why the RPC exists, which alternatives were
rejected), a `comment on function` enumerating every NULL reason and the calling route, and
the revoke/grant pair naming `public, anon, service_role` → `authenticated`.

#### 3. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Regenerate so the route typechecks against the new RPC.

**Contract**: `npm run db:gen-types`. Generated, never hand-edited.

#### 4. Schemas

**File**: `src/lib/schemas/pet.ts`

**Intent**: Add the id schema and the update payload, and give pet validation the Polish
message table the newer routes rely on.

**Contract**: `petIdSchema = z.guid()` — **`guid()`, not `uuid()`**, for the reason recorded
at `src/lib/schemas/period.ts:51-53`; do not tighten it. `updateInstructionSchema` = the
existing instruction shape plus `id: z.guid().optional()`. `updatePetSchema` mirrors
`createPetSchema`'s bounds and reuses `textField` (its NUL rejection is load-bearing — a NUL
answered 500 before it existed). A `PET_MESSAGES` table on the model of `PERIOD_MESSAGES`,
including type-level and object-level messages, so a missing key or a non-object body
produces Polish rather than zod's English default. Export it so a unit test can assert
membership.

#### 5. The update route

**File**: `src/pages/api/pets/[id].ts`

**Intent**: The first `PUT` in the codebase. Validate, call the RPC, map its refusals.

**Contract**: `export const PUT: APIRoute`. Order: 401 when `!context.locals.user`;
**explicit `Origin` check → 403** (mandatory here — the JSON body lands in Astro's no-check
branch); client or 500; `petIdSchema` on the path param → 400; `request.json()` in
`try/catch` → 400; `updatePetSchema.safeParse` → 400 carrying the first field issue's Polish
message (the `periods.ts:42` convention, not `pets.ts:29`'s raw `issues`); RPC; on error log
**code and message only** with the corrected rationale — not `pets.ts:45-48`'s superseded
wording; map `PT409` → 409, `22003` → 400, `22P05`/`22021` → 400, else 500; `!data` → 404;
success → **200** `{ petId: data }`. Local `jsonResponse` helper, duplicated per file as
every route does.

#### 6. The detail page

**File**: `src/pages/pets/[id].astro`

**Intent**: The owner's screen for one pet, on the token ground.

**Contract**: Follows `src/pages/periods/[id].astro` move for move: resolve the theme cookie
and pass it to `AppBar`; `petIdSchema.safeParse(Astro.params.id)` **before** the query (an
unvalidated param raises Postgres `22P02` and the page answers 200 with a load-failure
message, which tells a probe its input was well-formed); one `.select(...).eq("id",
petId).maybeSingle()` with no owner filter (RLS scopes it); three outcomes — load error,
not-found with `Astro.response.status = 404`, or the pet; derivations in frontmatter, not in
the template; `bg-background min-h-screen px-5 py-8` → `mx-auto w-full max-w-2xl`; back link
in the `AppBar` slot. Island props are ids and already-rendered labels only — Astro
serialises them into the HTML, so **no `is_sensitive` body text may become a prop** beyond
what the form must edit.

#### 7. The edit form

**File**: `src/components/pets/EditPetForm.tsx`

**Intent**: A new island on the design-system primitives, seeded from the server.

**Contract**: Props carry the pet and its instruction rows including their ids. Built on
`ui/Input`, `ui/Textarea`, `ui/button`, `ui/Chip` — **not** `auth/FormField`. Follows
`NewPeriodForm.tsx`: a named `clearError(field)` helper, one error key per server field name,
a type-checked read of `body.error` on 400, its own `submitting` state, `ServerError` for the
server message. **Instruction rows keyed by `care_instructions.id` for persisted rows and a
generated client id for new ones — never by array index**, which is where `AddPetForm`'s
approach breaks once rows can be removed and reordered. Submits `PUT` with
`Content-Type: application/json`; on 200 reloads, on 401 redirects to `/auth/signin`, on 409
shows the freeze sentence as terminal (not "spróbuj ponownie"), on 404 says the pet is gone
and to refresh.

#### 8. The list becomes navigable

**File**: `src/pages/pets/index.astro`

**Intent**: Make the card reach the detail page.

**Contract**: Wrap the existing `<li>` content in `<a href={\`/pets/${pet.id}\`}>`—`pet.id`
is already selected and currently unused. **The page must stay at zero islands.** No nested
interactive element inside the anchor.

#### 9. Registry and island map

**Files**: `docs/reference/contract-surfaces.md`, `tests/render/island-props.test.ts`

**Intent**: Register the new shared entry point and the new island-bearing page.

**Contract**: A registry row for `update_pet_with_instructions` in the house shape (what it
does · security posture and which policy is the boundary · what the return value means,
enumerating every NULL reason · the calling route). Add `/src/pages/pets/[id].astro` to the
island floor map with its expected count; `/src/pages/pets/index.astro` stays `0`.

#### 10. Tests

**Files**: `tests/rls/pets.isolation.test.ts`, `tests/rls/care-instructions.isolation.test.ts`,
`tests/rls/update-pet.test.ts` (new), `tests/api/pets.put.test.ts` (new),
`tests/unit/pet-schema.test.ts` (new)

**Intent**: Pin the positive paths the suite has never covered, the freeze, and the route's
error mapping.

**Contract**: RLS — an owner updates their own pet and the row changes; an owner updates and
deletes their own instruction row; re-pointing an instruction's `pet_id` at another owner's
pet is refused (pins the measured with-check); `anon` executing the new function gets `42501`
**and the error message names the function** — a code-only assertion keeps passing with the
grant fully widened. Freeze — a flip is refused with `PT409` while a claim exists on a live
covering trip, and permitted once that trip is revoked; text edits succeed in both states.
Route — drive `PUT` by importing the handler and building a real `Request`, as
`tests/api/pets.post.test.ts` does, with a genuine session cookie; every negative case pairs
the status with a DB-untouched probe. Schema — `PET_MESSAGES` membership, so an English zod
default cannot reach an island. **No substring assertions on source text** — anchor to shape
(`lessons.md`).

### Success Criteria:

#### Automated Verification:

- Database rebuilds from migrations cleanly: `npm run db:reset`
- Security advisors clean: `npx supabase db advisors --type security`
- Types regenerated and committed: `npm run db:gen-types` leaves no diff
- Typecheck passes: `npm run check`
- Lint passes with zero warnings: `npm run lint`
- Build passes: `npm run build`
- Unit + component projects pass: `npx vitest run --project unit --project component`
- Integration project passes: `npx vitest run --project integration`
- Render sweep passes: `npm run test:render`
- The publish gate passes end to end: `npm run ci:gate`
- Mutation check: removing the freeze predicate turns the freeze test red, and removing the
  `pet_id = p_pet_id` child predicate turns the cross-owner instruction test red — each
  asserted separately, not one representative mutation

#### Manual Verification:

- Editing a pet's name, species, breed and age persists and re-renders
- Adding, editing, reordering and removing instruction rows produces exactly the intended
  set, with no row's text landing on a neighbour
- A caretaker holding a live invite link sees edited public instruction text on reload
- Toggling `is_sensitive` on a pet with a claimed live trip is refused with an actionable
  Polish sentence; the same toggle succeeds after the trip is revoked
- `/pets/<id>` renders correctly in light, dark and contrast themes, and at 400px width
- `/pets` cards navigate to the detail page; keyboard focus order is sane

**Implementation Note**: After completing this phase and all automated verification passes,
pause for the human to confirm manual testing before starting Phase 2.

---

## Phase 2: Deleting, and refusing to

### Overview

The owner can remove a pet, and cannot remove one a live trip covers. The refusal is a SQL
predicate, because a handler check is bypassable by the same browser that renders the page.

### Changes Required:

#### 1. The delete function

**File**: `supabase/migrations/<ts>_delete_pet.sql`

**Intent**: Delete a pet, refusing while any unrevoked period covers it.

**Contract**: `public.delete_pet(p_pet_id uuid) returns uuid`. `security invoker`,
`set search_path = ''`, fully qualified. Returns the deleted pet id, or NULL when the pet
does not exist or RLS filtered it out — the two collapse deliberately, as every other owner
route's misses do. Raises `errcode = 'PT409'` **before** deleting when a covering period has
`revoked_at is null`, with `DETAIL` carrying a JSON array of the blocking periods' ids and
titles so the route can name them. Header comment must state that the cascade is what makes
this guard necessary, cite the measurement, and re-state S-08's rejected `on delete restrict`
together with **why that rejection no longer applies**: it rested on "no slice owns period
editing", and S-06's `revoke_period` gives the owner a way out. `comment on function` plus
the revoke/grant pair naming the roles.

#### 2. The delete route

**File**: `src/pages/api/pets/[id].ts` (extend)

**Intent**: The first `DELETE` in the codebase, in the file that already owns this path.

**Contract**: `export const DELETE: APIRoute`, same order as `PUT` minus body parsing.
Carries the explicit `Origin` check even though a bodiless `DELETE` would inherit Astro's
default — the default is not a control this file owns, and this is the irreversible action
(`revoke.ts:42-61`). `PT409` → 409 with the blocking trips named; `!data` → 404; success →
200 `{ petId: data }`.

#### 3. The delete island

**File**: `src/components/pets/DeletePetButton.tsx`

**Intent**: A two-step destructive control at the bottom of the detail page.

**Contract**: Copies `RevokePeriodButton.tsx`: `armed`/`error`/`pending` state; **escape
button rendered first** so a fast double-tap lands on the way out, not on the confirm; the
`idleRef`/`confirmRef`/`mounted` focus effect, which both moves focus and announces the state
change (there is no live region); `disabled` on both while pending plus `aria-busy` on the
confirm; the deliberately non-disarming `finally`; **no `aria-label` on the confirm** — the
control is alone on its page, so the visible text is the best accessible name and satisfies
WCAG 2.5.3 by construction; a consequence sentence under the idle button; `ServerError` last,
in a `min-w-0` column so a long sentence wraps inside the card.

Sends `fetch(url, { method: "DELETE" })` with **no headers and no body** — a security
property, not a style choice, and unobservable from the server side.

**The one thing with no precedent**: on success this is the first action in the repo that
destroys its own page, so it navigates — `window.location.href = "/pets"` — rather than
reloading into a 404. 409 is terminal and names the remedy ("odwołaj wyjazd…"), 404 says the
pet is already gone and to refresh.

#### 4. Wiring

**File**: `src/pages/pets/[id].astro` (extend)

**Intent**: Mount the delete zone below the form.

**Contract**: A visually separated section after the form. Island count in
`tests/render/island-props.test.ts` rises accordingly.

#### 5. Four stale claims

**Files**: `tests/e2e/auth.setup.ts`, `tests/e2e/fixtures/owner.ts`, `tests/e2e/seed.spec.ts`,
`docs/reference/e2e-rules.md`

**Intent**: Correct four comments that assert no pet delete affordance and that `/api/pets`
is POST-only. All four are prose, so nothing fails when they go false — which is exactly why
they must be corrected by hand.

**Contract**: Each says what is true after this slice. Teardown keeps going through the
Supabase client (unchanged) — but the comment must now say that this is a deliberate choice
_because_ the product path can refuse, not because no product path exists.

#### 6. Registry

**File**: `docs/reference/contract-surfaces.md`

**Contract**: A row for `delete_pet` in the house shape, naming the PT409 refusal and the
NULL cases.

#### 7. Tests

**Files**: `tests/rls/delete-pet.test.ts` (new), `tests/api/pets.delete.test.ts` (new),
`tests/component/delete-pet-button.test.tsx` (new), `tests/rls/pets.isolation.test.ts`

**Contract**: RLS — an owner deletes their own uncovered pet and the row is gone (the
positive path, today only incidental); a pet covered by a live trip is refused with `PT409`
and **still exists afterwards**; the same pet deletes once the trip is revoked; a pet covered
only by an already-revoked trip deletes; `anon` gets `42501` with the function named. Route —
409 body carries the blocking trip; 404 for a stranger's id; every negative paired with a
row-count probe. Component — fake `fetch` with a real `Response`; assert the request has
**no headers and no body**; assert `href === "/pets"` after success rather than `reload`;
two-tap confirm, escape-first DOM order, focus movement, and the 409 terminal sentence.

### Success Criteria:

#### Automated Verification:

- Database rebuilds from migrations cleanly: `npm run db:reset`
- Security advisors clean: `npx supabase db advisors --type security`
- Types regenerated and committed: `npm run db:gen-types` leaves no diff
- Typecheck passes: `npm run check`
- Lint passes with zero warnings: `npm run lint`
- Build passes: `npm run build`
- Unit + component projects pass: `npx vitest run --project unit --project component`
- Integration project passes: `npx vitest run --project integration`
- Render sweep passes: `npm run test:render`
- The publish gate passes end to end: `npm run ci:gate`
- Mutation check: dropping the `revoked_at is null` condition from the delete guard turns the
  refusal test red, and the pet is actually deleted in that run — proving the test observes
  the block rather than the status code alone

#### Manual Verification:

- Deleting a pet with no trips works and lands back on `/pets`
- Deleting a pet on a live trip is refused, names the blocking trip, and the pet is still
  there after a reload
- Revoking that trip then deleting the pet succeeds
- A double-tap on the delete button does not delete — the second tap lands on the escape
- Keyboard: focus moves to the confirm on arming and back to idle on cancel; a screen reader
  announces the change
- The delete zone renders correctly in light, dark and contrast themes, and at 400px width

**Implementation Note**: Pause for human confirmation of the manual items before closing the
slice.

---

## Testing Strategy

### Unit Tests

- `PET_MESSAGES` membership, so no English zod default can reach an island
- The route's SQLSTATE→status mapping, driven with a mocked client so it runs Docker-free
  (`tests/unit/pets-error-mapping.test.ts` is the template, and its header records why it
  exists: deleting the whole mapping left the route test green)

### Integration Tests

- Both RPCs against the local stack under two distinct real users, always through each
  owner's own anon-key client — **never the service-role client**, which bypasses RLS and
  makes every assertion a tautology
- Positive and negative sides of every policy this slice leans on
- The freeze and the delete-block, each also asserted by mutation

### Manual Testing Steps

1. Create a pet with one public and one sensitive instruction.
2. Create a trip covering it; open the invite link in a private window; claim a term.
3. Edit the public instruction's text; reload the caretaker window — the new text is there.
4. Try to flip the sensitive row to public — refused, with a sentence that says why.
5. Try to delete the pet — refused, naming the trip.
6. Revoke the trip. The flip now succeeds; the delete now succeeds and lands on `/pets`.
7. Repeat step 6's delete with a double-tap to confirm the escape-first ordering.
8. Walk all of it once at 400px width and once in each of the three themes.

## Performance Considerations

Nothing here is hot. The instruction sync touches a handful of rows behind
`care_instructions_pet_id_idx`; the guards are single existence checks over a household-sized
set. The one thing worth not doing is a per-row round trip from the client — the whole reason
the write is one RPC call.

## Migration Notes

Migrations are single-apply and never edited once applied; a correction ships as a new
statement. Both functions are new signatures, so each needs its own revoke/grant pair — and
if either ever gains a parameter it is `DROP` + `CREATE` + a fresh pair, never an overload,
because grants are keyed to the full argument type list. Run `npm run db:gen-types` after
each migration; a stale `database.types.ts` silently lies to the type checker.

No data migration: nothing about existing rows changes.

## References

- Research: `context/changes/pet-edit-and-delete/research.md`
- Decisions and rejected variants: `context/changes/pet-edit-and-delete/change.md`
- Route template: `src/pages/api/periods/[id]/revoke.ts`
- Island template: `src/components/periods/RevokePeriodButton.tsx`
- Detail-page template: `src/pages/periods/[id].astro`
- Form template: `src/components/periods/NewPeriodForm.tsx`
- RPC templates: `supabase/migrations/20260909090000_release_slot.sql`,
  `supabase/migrations/20260910120000_revoke_period.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Editing, end to end

#### Automated

- [x] 1.1 Database rebuilds from migrations cleanly: `npm run db:reset`
- [x] 1.2 Security advisors clean: `npx supabase db advisors --type security`
- [x] 1.3 Types regenerated and committed: `npm run db:gen-types` leaves no diff
- [x] 1.4 Typecheck passes: `npm run check`
- [x] 1.5 Lint passes with zero warnings: `npm run lint`
- [x] 1.6 Build passes: `npm run build`
- [x] 1.7 Unit + component projects pass
- [x] 1.8 Integration project passes
- [x] 1.9 Render sweep passes: `npm run test:render`
- [x] 1.10 The publish gate passes end to end: `npm run ci:gate`
- [x] 1.11 Mutation check: freeze predicate and child `pet_id` predicate each turn a test red

#### Manual

- [x] 1.12 Editing a pet's scalar fields persists and re-renders — walkthrough 2026-09-14
- [x] 1.13 Add/edit/reorder/remove instruction rows produces exactly the intended set — walkthrough 2026-09-14
- [x] 1.14 A caretaker on a live link sees edited public text on reload — walkthrough 2026-09-14
- [x] 1.15 `is_sensitive` flip refused with a claim present, permitted after revoke — walkthrough 2026-09-14
- [x] 1.16 `/pets/<id>` correct in all three themes and at 400px — re-checked 2026-09-14 after the reskin
- [x] 1.17 `/pets` cards navigate; focus order is sane — re-checked 2026-09-14 after the reskin

> 1.12-1.15 confirmed by the owner's manual walkthrough on 2026-09-14 ("testy manualne są ok").
> 1.16 and 1.17 were reopened after that pass, because the reskin and the AppBar navigation
> recorded under Deviations below landed later and changed exactly what those two items look
> at. Both were walked again on the current UI the same day and confirmed. Phase 1 is closed.

### Deviations from the plan (2026-09-14)

Recorded here rather than left for impl-review to discover. Both came out of the owner's
manual walkthrough of Phase 1 and were accepted in conversation on the day.

- **`/pets` and `/pets/new` DID move off `bg-cosmic`**, against "What We're NOT Doing" above.
  The plan's reasoning stands on its own terms — a token form on a themeless ground is broken
  in two of three themes — but it assumed the inconsistency would go unnoticed until S-01. It
  did not: the first thing the walkthrough reported was that `/pets` does not look like
  `/periods`. Both screens are now on `bg-background` with a working theme toggle, and
  `AddPetForm` was reskinned onto `ui/Input` / `ui/Textarea` / `ui/button` to follow them.
  `auth/FormField` and `auth/PasswordToggle` were deleted: `AddPetForm` was their last
  consumer, which is the condition `context/archive/2026-09-05-ui-design-system/plan.md:324`
  set for removing them. `bg-cosmic` survives for `/dashboard` alone.
- **`AppBar` gained the product's navigation.** Also out of plan, and the same walkthrough's
  second finding: the two halves of the app had no route between them, so an owner on `/pets`
  reached `/periods` only by editing the URL. Two links, active section marked with
  `aria-current`, no new island.

Consequences for the Progress list: the island floor for `/src/pages/pets/index.astro` rose
from 0 to 1 and `/src/pages/pets/new.astro` from 1 to 2 (both the AppBar's theme switch), and
`tests/render/island-props.test.ts` was updated with the reason. Phase 1's automated items were
re-run green after the change; 1.16 and 1.17 were reopened rather than re-ticked.

### Phase 2: Deleting, and refusing to

#### Automated

- [ ] 2.1 Database rebuilds from migrations cleanly: `npm run db:reset`
- [ ] 2.2 Security advisors clean: `npx supabase db advisors --type security`
- [ ] 2.3 Types regenerated and committed: `npm run db:gen-types` leaves no diff
- [ ] 2.4 Typecheck passes: `npm run check`
- [ ] 2.5 Lint passes with zero warnings: `npm run lint`
- [ ] 2.6 Build passes: `npm run build`
- [ ] 2.7 Unit + component projects pass
- [ ] 2.8 Integration project passes
- [ ] 2.9 Render sweep passes: `npm run test:render`
- [ ] 2.10 The publish gate passes end to end: `npm run ci:gate`
- [ ] 2.11 Mutation check: dropping `revoked_at is null` turns the refusal test red and the pet is actually deleted

#### Manual

- [ ] 2.12 Deleting an uncovered pet works and lands on `/pets`
- [ ] 2.13 Deleting a covered pet is refused, names the trip, pet survives a reload
- [ ] 2.14 Revoke then delete succeeds
- [ ] 2.15 Double-tap does not delete — second tap lands on the escape
- [ ] 2.16 Focus moves to confirm on arming and back on cancel
- [ ] 2.17 Delete zone correct in all three themes and at 400px
