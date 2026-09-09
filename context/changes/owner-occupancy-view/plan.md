# Owner Occupancy View Implementation Plan

## Overview

Two things land on the owner's period detail screen: **who** holds each claimed term, and the
ability to **release** one. The second is the product's first inverse for its only anonymous
write, and it ships here by decision rather than being deferred again.

## Current State Analysis

`/periods/[id]` already renders the period, its pets, its note, a `grid-cols-3` free/taken map
per day, and the regenerate-link island. What it does not render is any identity, and that is a
deliberate, repeatedly-restated boundary — `src/pages/periods/[id].astro:31-34` says so in a
comment that names S-04 as the slice allowed to remove it.

Established by research (`context/changes/owner-occupancy-view/research.md`), verified against
the live catalog rather than inferred from comments:

- **The owner can already read `claimed_by_name`.** Four policies on `care_slots`, all
  `TO authenticated`, none column-aware; table-level grants only; every `pg_attribute.attacl`
  NULL. An impersonated select returns names today. The column is withheld solely by the
  `.select()` string at `[id].astro:69`.
- **The owner can already null the claim columns.** `care_slots_update_own` predicates on
  ownership of the parent period and says nothing about columns; all-three-null is the free
  state and passes `care_slots_claim_complete`. A release is therefore a guarded surface over
  existing permissions, not a schema capability.
- **`claimed_by_name` is written by `anon`** through `claim_slots`, which is granted to `anon`,
  so `src/lib/schemas/claim.ts` is a UX layer and the function body is the whole guarantee.
  That body's entire name validation is btrim + reject-empty + reject-over-80. No character
  class — unlike the `token` field on the same schema, which has one.
- **`btrim` strips U+0020 only** (verified: `tab:1 | nbsp:1 | zwsp:1 | space:0 | newline:1`), so
  a name that renders blank is storable and rows like it may already exist.
- **Nothing makes a name unique.** Two capabilities can both be "Ania"; only `claim_digest`
  distinguishes them, and `20260907171514_claim_secret_not_digest.sql:14-19` names "S-04's
  occupancy payload" verbatim as the disclosure to avoid.

## Desired End State

An owner opening a trip sees, under each day's free/taken grid, a list of that day's claimed
terms with the caretaker's name beside each, and — when two different caretakers in that period
typed the same name — a disambiguating ordinal. The header line reports how many distinct
caretakers hold the trip alongside the existing taken/total count. Each claimed term carries a
release control that asks once and then frees the term, after which it is immediately claimable
again through the invite link and the releasing owner's page reflects it.

**Verification**: `npm run build` with no dev server running; `npx vitest run` green; a manual
pass on a phone-sized viewport covering the two-tap confirm, a released term becoming claimable,
and a view-source check that no 64-character hex string appears in the HTML.

### Key Discoveries

- `src/pages/periods/[id].astro:69` — the select to widen; `:31-34` is the comment that
  authorises it and must be rewritten rather than left asserting a state that no longer holds.
- `src/pages/api/periods/[id]/token.ts` — the owner-side route precedent end to end: its own
  `context.locals.user` check, `periodIdSchema` validation, a SECURITY INVOKER RPC, NULL → 404,
  and an error log that deliberately omits `error.details` because PostgREST echoes offending
  values into it.
- `supabase/migrations/20260906003122…:127-169` — `regenerate_period_token`: the RPC shape to
  mirror, including _returns a scalar, not a composite_ ("a plpgsql function returning a
  composite answers a miss with a row of NULLs, not NULL") and the three-line grant posture.
- `PROTECTED_ROUTES = ["/dashboard", "/pets", "/periods"]` (`src/middleware.ts:8`) matches on
  `startsWith`, so `/api/periods/...` is **not** middleware-gated. Route-level auth is the
  handler's job.
- `src/components/periods/RegenerateLinkButton.tsx` — the owner-action island pattern: own
  `pending` flag, `ServerError`, reload on success.
- `src/components/periods/InviteLinkPanel.tsx:48` — `min-w-0 flex-1 truncate` plus `title=`, the
  repo's one precedent for displaying a long string without letting it break layout.

## What We're NOT Doing

- **No caretaker-facing name visibility.** That is S-05 / FR-011, and `roadmap.md:193-194`
  records its privacy question as unresolved and owned by the user. Nothing here may pre-empt
  it: both anon doors keep returning no other-caretaker names.
- **No names on the `/periods` list page.** `src/pages/periods/index.astro:45-46` keeps them off
  by aggregating, and that stays — scoped out by decision.
- **No change to `claim_slots`.** Hostile-text handling is display-side only (see Phase 1). The
  anon write door keeps its current grant posture and its suite untouched.
- **No bulk release**, no "release all of this caretaker's terms", no undo, and no notification
  to the caretaker that a term was freed.
- **No realtime.** The NFR's "niemal natychmiast" is met by a reload after the owner's own
  action; another browser's claim still needs a refresh to appear.
- **No PRD edits.** `prd.md:122`'s NFR promising a release confirmation, and FR-010's cut text
  assuming a manual owner remedy, are both real defects — routed to Open Questions, not fixed
  here.

## Implementation Approach

Phase 1 delivers FR-006 on its own and is independently shippable; if the slice is cut short,
the last must-have is still done. That is the deliberate cut line, and it is why the release
work sits behind it rather than in front.

The release then lands function-first: a SECURITY INVOKER RPC so RLS remains the authorization
boundary exactly as it is for `regenerate_period_token`, then the route and island that call it.
Putting the guard in a named database surface — rather than an inline `.update()` — is what
earns it a `contract-surfaces.md` row and stops a later slice widening it by accident, which
that file already warns is possible for these columns.

## Critical Implementation Details

**`claim_digest` may be read in Astro frontmatter and must not travel one step further.** The
grouping that produces collision ordinals needs it, and reading it server-side is legitimate —
the frontmatter runs on the server. It becomes a disclosure the moment it reaches an island
prop, a `data-` attribute, or any rendered text, because Astro serializes island props into the
HTML. The helper in Phase 1 therefore takes the digest as _input_ and its return type does not
carry it; the release island in Phase 3 takes ids only. The manual view-source check for a
64-hex string exists to catch a regression here.

**A claimed row is stable while claimed, which is why the release needs no optimistic
concurrency.** `claim_slots` writes only `where claimed_by_name is null`, so no caretaker can
overwrite an existing claim — between the page render and the owner's click the row can only be
released by someone else, never re-claimed by a different person. A `claimed_at is not null`
guard in the UPDATE is therefore sufficient: a double release answers NULL ("already free")
rather than clobbering a newer claim, and no version token needs to travel to the client.

> **Correction, Phase 2 impl-review F2 (2026-09-09).** The paragraph above is wrong from
> "never re-claimed by a different person" onward, and the migration's first comment repeated
> it before being corrected. A released row IS `claimed_by_name is null`, which is exactly the
> state `claim_slots` writes into, so a freed term can be re-taken between the render and the
> click: tab A renders showing Ania → tab B releases → Basia claims → tab A releases on stale
> UI and silently wipes Basia's newer claim. `claimed_at is not null` does not stop it. The
> conclusion — no version token travels to the client — **stands as an accepted risk**, not as
> a proved impossibility: the window needs two concurrent owner surfaces and the slot ends free
> either way. Recorded as `prd.md` §Open Questions item 3. Phase 3 must not re-derive
> "impossible" from this paragraph.

**Return a scalar, not a composite.** Same reason `regenerate_period_token` documents at
`20260906003122…:123-126`: a plpgsql function returning a composite answers a miss with a row of
NULLs rather than NULL, so "nothing was released" would arrive at the route as an object and the
404 branch would never fire.

---

## Phase 1: Names on the page

### Overview

The owner sees who holds each claimed term. Self-contained, ships FR-006, touches no schema.

### Changes Required

#### 1. The display helper

**File**: `src/lib/caretaker-name.ts` (new)

**Intent**: One pure module owning everything about turning a stored, anonymously-written name
into something safe to render, plus the per-period grouping that produces collision ordinals and
the distinct-caretaker count. Pure and dependency-free so it unit-tests without a database, in
the same spirit as `period-format.ts`.

**Contract**: Two exports.

`normalizeCaretakerName(raw: string | null): string | null` — strips zero-width characters
(U+200B–U+200D, U+FEFF), bidirectional controls (U+202A–U+202E, U+2066–U+2069) and C0/C1
controls; collapses runs of Unicode whitespace to a single space; trims; returns `null` when
nothing survives. `null` is the signal for "taken, name unusable", which the page renders as a
neutral fallback rather than an empty cell.

`groupCaretakers(slots: { id: string; claimed_by_name: string | null; claim_digest: string | null }[])`
→ `{ bySlotId: Map<string, { label: string; ordinal: number | null }>, caretakerCount: number }`.
Ordinals are assigned only when two or more **distinct digests** share a normalized label within
the period, numbered by first `claimed_at`/id order so a reload is stable. **The return type
carries no digest** — that is the boundary that keeps it off the page, and it is deliberate
rather than incidental.

#### 2. The page read and render

**File**: `src/pages/periods/[id].astro`

**Intent**: Widen the select, group the claimed slots, and render a claimed-terms list beneath
each day's grid carrying name, ordinal and (from Phase 3) the release control. The grid itself
stays exactly as it is — the at-a-glance free/taken map — so the name never sits adjacent to the
literal `"wolne"` / `"zajęte"` labels it could impersonate.

**Contract**: `care_slots(id, slot_date, time_of_day, claimed_at)` gains `claimed_by_name` and
`claim_digest`; the local `SlotRow` interface gains both; the `:31-34` comment is rewritten to
record that S-04 took the identity boundary down deliberately and what replaced it. The header
line at `:151` gains a distinct-caretaker count, phrased `Opiekunowie: {n}` to sidestep Polish
plural agreement. Name rendering uses `min-w-0` + `truncate` + `title=`, following
`InviteLinkPanel.tsx:48`; it must **not** use `whitespace-pre-line`, which is correct for the
owner's own note at `:165` and would turn an 80-character name into 40 rendered rows. Days with
no claimed terms render the grid alone.

#### 3. The misfiled reference line

**File**: `docs/reference/data-access.md`

**Intent**: Correct the sentence at `:177-178` that files this owner-side, `authenticated`
feature under the anon token model's rules. Research established S-04 needs no door at all; the
rule it sits under governs caretaker capabilities, and the slice it should name is S-05.

**Contract**: The sentence is replaced, not deleted — the paragraph still needs to say what
binds future slices. Add a line recording that the owner's occupancy read is the ordinary F-01
owner path, so the next reader does not go looking for a door to extend.

### Success Criteria

#### Automated Verification

- Unit tests for `normalizeCaretakerName` pass, covering: a plain name unchanged; leading and
  trailing Unicode whitespace; interior whitespace runs collapsed; a tab-only, NBSP-only and
  ZWSP-only name each returning `null`; bidi overrides stripped; an 80-character name preserved
- Unit tests for `groupCaretakers` pass, covering: no collision leaves every ordinal `null`; two
  distinct digests with the same label get 1 and 2 in stable order; one digest across several
  slots counts once; two digests with names that differ only by invisible characters collide
  after normalization; the returned objects carry no digest key
- Full suite passes: `npx vitest run`
- Type checking and linting pass: `npm run build` (dev server stopped) and `npm run lint`

#### Manual Verification

- A period with two caretakers shows both names under the right days, at phone width, in light,
  dark and the high-contrast theme
- Two caretakers who both typed the same name render as `Ania (1)` and `Ania (2)`
- The header reports the distinct caretaker count, and it matches the names visible below
- View source on the rendered page contains no 64-character hexadecimal string
- A day with no claimed terms renders its grid and no empty list

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 2: The release function

### Overview

The guarded database surface. Ships nothing user-visible.

### Changes Required

#### 1. The migration

**File**: `supabase/migrations/<timestamp>_release_slot.sql` (new)

**Intent**: A named, guarded surface for freeing one claimed term, so the three-column write
stays atomic behind one predicate and `contract-surfaces.md` gains a row that a later slice
cannot widen without noticing.

**Contract**: `public.release_slot(p_period_id uuid, p_slot_id uuid) returns uuid`, `plpgsql`,
**`security invoker`** (RLS is the authorization boundary — `care_slots_update_own` already
scopes it to the owner's own periods), `set search_path = ''`, every object fully qualified. One
`update … set claimed_by_name = null, claimed_at = null, claim_digest = null where id =
p_slot_id and period_id = p_period_id and claimed_at is not null returning id`, returning the
scalar so a miss is honestly NULL. Grants mirror `regenerate_period_token` exactly:
`revoke execute … from public, anon, service_role;` then `grant execute … to authenticated;` —
naming the roles, because `ALTER DEFAULT PRIVILEGES` means revoking from `public` alone does
nothing. A `comment on function` states what NULL means.

The `period_id` predicate is redundant with RLS and kept deliberately: it makes the route's URL
and the guard agree, so a slot uuid from another of the owner's own periods cannot be released
through the wrong period's endpoint.

#### 2. Regenerated types

**File**: `src/db/database.types.ts`

**Intent**: Pick up the new function so the route's `.rpc("release_slot", …)` is typed.

**Contract**: Generated by `npm run db:gen-types`, never hand-edited. Note that Phase 1 needed no
regeneration — `claimed_by_name` was already typed — and this phase does, because the schema
gains a function.

#### 3. The RLS suite

**File**: `tests/rls/release-slot.test.ts` (new)

**Intent**: Pin the grant posture from both directions and the guard's behaviour, per the
convention every door in this schema already follows.

**Contract**: Asserts an owner releases their own claimed slot and the three columns come back
null together; a second release of the same slot returns NULL rather than erroring; releasing a
slot in another owner's period returns NULL and leaves that slot claimed; `anon` executing the
function is refused with SQLSTATE 42501 — an assertion that **fails if the grant is widened**,
not merely one that passes on an empty result; and a released slot can immediately be claimed
again through `claim_slots`.

#### 4. The contract registry

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Register the new surface alongside the existing application rows.

**Contract**: One row for `release_slot(p_period_id, p_slot_id)` recording that it is SECURITY
INVOKER (so RLS, not the body, is the boundary), that NULL means "not yours, not there, or
already free", and that it is the **only intended** owner-side writer of the claim columns —
noting, as the `care_slots` row already does, that a direct owner UPDATE remains possible.

### Success Criteria

#### Automated Verification

- Migration applies cleanly on a reset database: `npm run db:reset`
- Types regenerate and include `release_slot`: `npm run db:gen-types`
- New `release-slot` suite passes: `npx vitest run tests/rls/release-slot.test.ts`
- Full suite passes with the existing claim suites untouched: `npx vitest run`
- Type checking and linting pass: `npm run build` (dev server stopped) and `npm run lint`
- Security advisors report nothing new: `npx supabase db advisors --type security`

#### Manual Verification

- `has_function_privilege` read from the catalog confirms `authenticated` may execute and `anon`
  may not
- `provolatile` for `release_slot` is `v`
- Releasing an already-free slot in psql returns NULL and changes no row

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 3: The release control

### Overview

Wire the function to the page: a route, an island, and the two-tap confirm.

### Changes Required

#### 1. The route

**File**: `src/pages/api/periods/[id]/slots/[slotId]/release.ts` (new)

**Intent**: The owner-side POST endpoint, mirroring `api/periods/[id]/token.ts` step for step so
a reader of one recognises the other.

**Contract**: `POST`. Checks `context.locals.user` itself and answers 401 — `/api/periods` does
**not** start with any `PROTECTED_ROUTES` prefix, so the middleware does not gate it. Validates
both path params with `periodIdSchema` (a uuid schema, reused for the slot id) and answers 400
on a malformed one. Calls `release_slot`; NULL → 404 with a Polish sentence, indistinguishable
between "not yours", "does not exist" and "already free". On error, logs `error.code` and
`error.message` only — **never the whole error**, because PostgREST echoes offending values into
`details`, which is how a digest would reach the logs. Returns `{ slotId }` on success.

#### 2. The island

**File**: `src/components/periods/ReleaseSlotButton.tsx` (new)

**Intent**: The per-term release control with its inline confirmation, modelled on
`RegenerateLinkButton` — own `pending` flag, `ServerError`, full reload on success because the
page is server-rendered.

**Contract**: Props are `periodId`, `slotId` and the already-normalized display label — **no
digest, no raw name**. Two-tap: idle renders a quiet "Zwolnij"; armed renders "Na pewno?" beside
an explicit "Nie" that disarms, so the confirm is never a single accidental double-tap. Disabled
while pending. On success `window.location.reload()`, the same choice `ClaimSlots` makes and for
the same reason — the page's state is server-rendered. Failure renders `ServerError` and leaves
the control armed so the owner can retry.

#### 3. Wiring

**File**: `src/pages/periods/[id].astro`

**Intent**: Place the island in the claimed-terms list Phase 1 built.

**Contract**: One `<ReleaseSlotButton … client:load />` per claimed term. The label passed is the
grouped, normalized one — the page must not hand the island the raw column.

#### 4. The route suite

**File**: `tests/api/release-slot.test.ts` (new)

**Intent**: Cover the handler's own branches, which the RLS suite cannot reach.

**Contract**: 401 without a session; 400 on a malformed period or slot id; 404 for another
owner's slot, for an unknown slot, and for an already-free slot — the three indistinguishable on
purpose; 200 with the slot freed, verified by re-reading the row as the owner. Uses
`createAuthenticatedOwnerWithPet()` from `tests/helpers/session.ts`, the existing primitive for a
route test that needs a real session and a period the owner really owns.

### Success Criteria

#### Automated Verification

- New route suite passes: `npx vitest run tests/api/release-slot.test.ts`
- Full suite passes: `npx vitest run`
- Type checking and linting pass: `npm run build` (dev server stopped) and `npm run lint`

#### Manual Verification

- End-to-end on a phone-sized viewport: a claimed term releases after the two-tap confirm and the
  page comes back with it free
- "Nie" disarms the confirm and changes nothing
- The freed term is immediately claimable again through the invite link
- A caretaker who held two terms and lost one still sees the sensitive tier; one who lost their
  last term in the period falls back to the pre-claim view
- The release control never appears on a free term
- The header's caretaker count drops when the last term of one caretaker is released

**Implementation Note**: Final phase. After manual confirmation, close the plan.

---

## Testing Strategy

### Unit Tests

- `normalizeCaretakerName` across the hostile-input classes research identified: Unicode
  whitespace that `btrim` does not strip, zero-width characters, bidi overrides, and the
  80-character boundary
- `groupCaretakers` collision and ordinal-stability cases, plus the structural assertion that its
  output carries no digest

### Integration Tests

- `tests/rls/release-slot.test.ts` — grant posture in both directions, the guard, cross-owner
  isolation, and release-then-reclaim
- `tests/api/release-slot.test.ts` — the handler's status branches

### Manual Testing Steps

1. Open a trip with two caretakers, one of whom holds terms on two days; confirm names appear
   under the right days and the header count reads 2
2. Claim two terms from two separate browsers using the same name; confirm `(1)` / `(2)`
3. View source; search for a 64-character hex string; expect none
4. Release one term with the two-tap confirm; confirm the page returns with it free and the grid
   dot changes
5. Re-claim the freed term through the invite link
6. Release the last term of one caretaker; confirm the header count drops to 1

## Performance Considerations

None material. The grouping is over at most 93 slots (`MAX_SPAN_DAYS × 3`) and runs once per
server render; the release is a single-row update by primary key.

## Migration Notes

One migration, additive — a new function and its grants. No table or column changes, so no data
migration and nothing to backfill. Rolling back means dropping the function; nothing else in the
schema references it. Rows already carrying hostile names are handled at display time by Phase 1,
which is the only option available for them.

## References

- Research: `context/changes/owner-occupancy-view/research.md`
- Route precedent: `src/pages/api/periods/[id]/token.ts`
- RPC precedent: `supabase/migrations/20260906003122_care_periods_and_invite_link.sql:127-169`
- Island precedent: `src/components/periods/RegenerateLinkButton.tsx`
- Truncation precedent: `src/components/periods/InviteLinkPanel.tsx:48`
- The boundary this slice is authorised to remove: `src/pages/periods/[id].astro:31-34`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Names on the page

#### Automated

- [x] 1.1 Unit tests for `normalizeCaretakerName` pass across the hostile-input classes — 106ea26
- [x] 1.2 Unit tests for `groupCaretakers` pass, including that its output carries no digest — 106ea26
- [x] 1.3 Full suite passes — 106ea26
- [x] 1.4 Type checking and linting pass — 106ea26

#### Manual

- [x] 1.5 Two caretakers' names render under the right days at phone width in all three themes — 106ea26
- [x] 1.6 Two caretakers with the same name render as `Ania (1)` and `Ania (2)` — 106ea26
- [x] 1.7 The header caretaker count matches the names visible below — 106ea26
- [x] 1.8 View source contains no 64-character hexadecimal string — 106ea26
- [x] 1.9 A day with no claimed terms renders its grid and no empty list — 106ea26

### Phase 2: The release function

#### Automated

- [x] 2.1 Migration applies cleanly on a reset database — b2e0677
- [x] 2.2 Types regenerate and include `release_slot` — b2e0677
- [x] 2.3 New `release-slot` RLS suite passes — b2e0677
- [x] 2.4 Full suite passes with the existing claim suites untouched — b2e0677
- [x] 2.5 Type checking and linting pass — b2e0677
- [x] 2.6 Security advisors report nothing new — b2e0677

#### Manual

- [x] 2.7 `has_function_privilege` confirms `authenticated` may execute and `anon` may not — b2e0677
- [x] 2.8 `provolatile` for `release_slot` is `v` — b2e0677
- [x] 2.9 Releasing an already-free slot returns NULL and changes no row — b2e0677

### Phase 3: The release control

#### Automated

- [ ] 3.1 New route suite passes
- [ ] 3.2 Full suite passes
- [ ] 3.3 Type checking and linting pass

#### Manual

- [ ] 3.4 End-to-end release on a phone-sized viewport frees the term
- [ ] 3.5 "Nie" disarms the confirm and changes nothing
- [ ] 3.6 The freed term is immediately claimable again through the invite link
- [ ] 3.7 A caretaker who lost one of two terms keeps the reveal; one who lost their last falls back
- [ ] 3.8 The release control never appears on a free term
- [ ] 3.9 The header caretaker count drops when a caretaker's last term is released
