# Close / cancel a care period (FR-012, S-06) — Implementation Plan

## Overview

Give the owner a named, guarded, **irreversible** way to revoke a care period's invite link, and
give a caretaker who already claimed a slot a **true answer** ("the trip was called off") instead
of the same dead-link 404 a stranger with a typo sees.

The write itself is nearly free — the owner already holds this UPDATE. What this slice actually
buys is the _semantics_: what revocation means to the person who committed their days, and the
guarantee that "irreversible" is a property of the database rather than a React prop.

## Current State Analysis

`care_periods.revoked_at` (`20260906003122_invite_token_access.sql:33`) is the schema's **only**
lifecycle axis — nullable `timestamptz`, no default, no constraint, no trigger, no index, and no
`status`/`state`/`reason` column exists anywhere in the six public tables.

- **The write is already permitted.** `care_periods_update_own`
  (`20260905234144_care_periods_and_slots.sql:88`) is `TO authenticated` with USING and WITH CHECK
  both `auth.uid() = owner_id`. Postgres RLS has no column granularity, the table-level UPDATE
  grant carries no column list, and `pg_attribute.attacl` is NULL for every column. Proven
  behaviourally in a rolled-back transaction: an owner can set **and clear** `revoked_at` today.
  The one-way door exists only in prose and in the UI.
- **Three functions read the column, none writes it** — `get_period_by_token`, `claim_slots`,
  `get_claimed_details`, all with the identical predicate
  `where p.token_digest = v_digest and p.revoked_at is null`. There is no `revoke_period` RPC and
  no registry row for one.
- **Revocation is total and indistinguishable.** All three anon doors answer SQL `NULL`,
  byte-identical to an unknown, tampered, malformed or empty token. `get_claimed_details` resolves
  the period _before_ reading `claim_digest` (`20260907193000:55-62`, then `:74-80`), so a revoked
  period never reaches the digest gate.
- **The caretaker-facing dead end is already shipped and self-contradictory.**
  `invite/[token].astro:176` tells the caretaker _"Poproś właściciela zwierzęcia o nowy [link]"_;
  `RegenerateLinkButton.tsx:57-64` refuses to mint one for a revoked period and tells the owner
  _"Zaplanuj nowy wyjazd"_. A revoke button makes this reachable **by design** rather than by
  accident.
- **Both owner-side revoked indicators already ship, worded differently** —
  `periods/index.astro:149` (`· link nieaktywny`) vs `periods/[id].astro:201`
  (`· link został unieważniony`) — and `revoked` is already passed into an island
  (`periods/[id].astro:318`).

### Key Discoveries

- **The template is exact.** `20260909090000_release_slot.sql` is the owner-side guarded-write
  shape this slice copies line for line: `SECURITY INVOKER` (RLS _is_ the authorization boundary),
  `set search_path = ''`, every object fully qualified, **a scalar return not a composite** — a
  plpgsql function returning a composite answers a miss with a row of NULLs rather than NULL, so
  the route's 404 branch would never fire (`20260906003122:123-126`) — one guarded UPDATE, a state
  predicate that makes a double call honest rather than destructive, and the three-line grant
  recipe. `data-access.md:181-193` states this shape as a **rule**, using S-04 as its worked
  example.
- **The claim-holder widening is three layers, not one.** `get_claimed_details` returns `jsonb`,
  so moving the revoked check past the digest gate is a `create or replace` with an unchanged
  signature (grants survive, per `20260907193000:20-22`). **But the app never calls it on a
  revoked period**: the reveal is gated on `payload &&` (`invite/[token].astro:103`), and `payload`
  is null exactly when the period is revoked. So the widening also needs the call ungated and a new
  branch in `resolveInviteView`.
- **The widening is leak-free by construction, and weaker than the one already accepted.** A
  matching `claim_digest` is unforgeable and provable only by having claimed while the link was
  live (`claim.ts:96-105`, `20260907171514`). A non-holder's answer stays byte-identical NULL, so
  the one bit disclosed goes only to someone who already had it. S-03's accepted widening
  (`data-access.md:147-158`) disclosed strictly more.
- **`prd.md:146`'s non-goal does not bite.** _"w v1 nie ma automatycznych przypomnień ani maili"_
  governs messages the system pushes **outward**; it says nothing about the content of a page the
  caretaker opens themselves.
- **The irreversibility gap is server-side.** `POST /api/periods/[id]/token` never checks
  `revoked_at`, and `regenerate_period_token` deliberately leaves the column alone
  (`20260906003122:120-121`). Today nobody reaches that path because there is no revoke button;
  after this slice, the UI prop is the _only_ barrier against minting a permanently dead link.
- **CSRF depends on the request shape, not on a header.** Astro's origin middleware refuses a
  non-safe method carrying **no** Content-Type unless the origin matches; sending
  `application/json` lands in the _no-check_ branch (which is why `invite/claim.ts` has its own
  explicit Origin check). `fetch(url, { method: "POST" })` with no header and no body is the
  protection. **Adding a Content-Type or a body to the revoke island silently removes it.**
- **`/api/**`is not middleware-gated.**`PROTECTED_ROUTES` (`middleware.ts:8`) matches on
`startsWith`and lists`/periods`, not `/api/periods`. Route-level auth is each handler's job.
- **A grant test must fail when the grant is removed.** S-04's phase-2 review found the obvious
  assertion passed with the grant fully widened, because the same SQLSTATE arrives from the table
  layer. The fix: assert the error **message** names the function.

## Desired End State

An owner on `/periods/[id]` sees an "Odwołaj wyjazd" control that takes two taps and, once
confirmed, permanently kills the invite link — enforced in SQL, not in the browser. A caretaker who
had claimed slots and reopens their link is told the trip was called off, in Polish, on a page that
no longer sends them to ask for a replacement link nobody can issue. A stranger with a typo sees
exactly what they see today, byte for byte.

**Verification**: `npm run test` green (including a test that fails in **both** directions on the
widening — a non-holder must NOT learn the period exists, and a holder MUST get the distinct
answer); `npm run lint`; `npx astro check`; the manual walkthrough in Phase 3's criteria.

## What We're NOT Doing

- **No un-revoke.** Owner decision: revocation is one-way. The database gains no clearing function,
  and `regenerate_period_token` continues to leave `revoked_at` alone — Fix B from
  `2026-09-06-care-period-and-invite-link/reviews/impl-review-phase-3.md:63-89` stays rejected. An
  owner who revokes by mistake plans a new trip.
- **No second lifecycle state.** FR-012's "zamknąć" does not become a distinct action. One action,
  "odwołaj", on the one column that exists. No `status` / `reason` column — this slice does not
  introduce the codebase's first one.
- **No "the trip is over" concept.** A finished trip's link still resolves forever. That is a live
  consequence of S-02's deliberate no-expiry decision (_"a caretaker still needs the instructions
  on the last evening; auto-expiry fails exactly then"_), it predates this slice, and it stays out.
  Recorded as an open question, not silently absorbed.
- **No bulk release of claimed slots.** Owner decision. Decisive reason it is separable: the 404
  comes from `revoked_at` killing token resolution _before_ `claim_digest` is read, so
  bulk-releasing changes **nothing** the caretaker sees. `release_slot` is not reusable as written
  (scalar arity; a scalar return cannot express "released 7 of 12"; this repo's rule makes a
  signature change a drop+create with fresh grants).
- **No notification to the caretaker.** Settled precedent for the structurally identical case:
  `release_slot.sql:20-25` — _"a scope decision, not an oversight"_. The product has zero contact
  columns across all 16 migrations and no stable caretaker identity (`caretaker-name.ts:151`).
- **No cookie invalidation.** The claim cookie stays live to `end_date + 7 days`
  (`claim-cookie.ts:35,71-96`). Revocation is a filter on the period, not a logout.
- **No confirmation added to link regeneration.** Out of scope; noted as a pre-existing asymmetry.

## Implementation Approach

Four phases, and **the order is the point**. The frame's reframed problem statement is that the
slice must settle what cancellation _means to the caretaker_ **before** shipping the write, not
after. So:

1. The SQL write lands first but **has no caller** — unreachable from any UI, exactly as S-04
   staged its release function before its control (`87347d4`, "the release control (p3)").
2. The caretaker-facing answer lands second, so the coherent page exists before the button that
   makes it reachable.
3. The owner's control lands third, when everything it triggers is already true.
4. A close-out sweep re-reads this slice's own doc edits, because
   `owner-occupancy-view/reviews/impl-review.md:197-203` records exactly this failure: a doc
   sentence written in phase N, in a slice whose later phases change that world, goes stale
   silently.

## Critical Implementation Details

**Ordering inside `get_claimed_details` is load-bearing.** It must resolve the period _without_ the
revoked filter, then hash and match `claim_digest`, and only then branch on `revoked_at`. Any other
order either re-hides the answer from the holder or discloses the period's existence to a
non-holder. The `not found` gate after the digest lookup (`20260907193000:82-90`, impl-review F6)
must keep answering plain NULL — the revoked branch sits **after** it.

**No Content-Type, no body, on the revoke island.** This is a security property, not a style
choice: it is what puts the request in Astro's origin-checked branch. See Key Discoveries.

---

## Phase 1: The write, and irreversibility in SQL

### Overview

Ship `revoke_period` as a named guard over an UPDATE the owner already holds, and make
"irreversible" a database property by refusing to regenerate a revoked period's token. No caller
yet; nothing in the UI changes.

### Changes Required:

#### 1. The revoke function

**File**: `supabase/migrations/<timestamp>_revoke_period.sql` (new)

**Intent**: Add the owner-side guarded write for `revoked_at`. A named surface earns its own
registry row, grant and test, so a later slice cannot widen the owner-side write path without
noticing (`owner-occupancy-view/plan.md:92-94`).

**Contract**: `public.revoke_period(p_period_id uuid) returns uuid` — `language plpgsql`,
`security invoker`, `set search_path = ''`. One
`update public.care_periods set revoked_at = now() where id = p_period_id and revoked_at is null returning id into v_period_id`,
then `return v_period_id`. `revoked_at is null` is what makes a **double revoke honest rather than
destructive**: the second call matches nothing and answers NULL, exactly as `release_slot`'s
`claimed_at is not null` does — and it also means the original revocation timestamp is never
overwritten. Not yours / does not exist / already revoked collapse to one NULL, because the owner
has no legitimate use for the difference and a distinct "exists but not yours" would confirm the
period exists.

`comment on function` states what NULL means. Grants use the three-line recipe verbatim:
`revoke execute ... from public, anon, service_role;` then `grant execute ... to authenticated;` —
naming the roles, because Supabase's `ALTER DEFAULT PRIVILEGES` grants EXECUTE to anon,
authenticated and service_role separately from the PUBLIC pseudo-role.

The header comment must carry the two facts a reader needs and cannot see: that this adds **no
capability** (only a name over `care_periods_update_own`), and **what revocation costs every
caretaker at once** — the trip, their own record of which days they took, `caretaker_note` and
every `is_sensitive` row, with no notification and no grace period, including mid-trip. S-04's F3
recorded the single-caretaker version of that sentence; this is the all-at-once version, and
`data-access.md` gets it too in Phase 2.

#### 2. Server-side refusal of regeneration on a revoked period

**File**: same migration

**Intent**: The owner's decision that revocation is one-way must hold against a direct API call,
not only against a React prop. Today `POST /api/periods/[id]/token` returns 200 and a link that
resolves to nothing.

**Contract**: `create or replace function public.regenerate_period_token(p_period_id uuid, p_token_digest text)`
with **the signature unchanged** so the grants from `20260906003122` survive, adding
`and revoked_at is null` to the UPDATE's `where`. The existing NULL contract absorbs the new miss
with no route change: `token.ts` already answers 404 on NULL. Update the function's
`comment on function` to name the third reason for NULL, and keep the existing
`-- revoked_at is deliberately left alone` note — it is still true and now more important, since
un-revoking is answered "no" rather than "later".

#### 3. The stale column comment

**File**: same migration

**Intent**: `care_periods.revoked_at`'s comment is **live in the catalog** and already
misdescribes reality — _"Written by S-06"_ when there was no S-06 writer and the actual writer was
any authenticated owner through the generic all-columns policy, the same door used to rename a trip.

**Contract**: `comment on column public.care_periods.revoked_at is ...` naming `revoke_period` as
the intended writer, stating that a direct owner UPDATE can still write it (the policy has no
column granularity), and that it is **write-once by product decision, enforced by
`revoke_period`'s `revoked_at is null` predicate rather than by a constraint**.

#### 4. Generated types

**File**: `src/db/database.types.ts`

**Intent**: The generated types carry RPC signatures; without regeneration
`supabase.rpc("revoke_period", …)` will not typecheck in Phase 3.

**Contract**: `npm run db:gen-types` output, committed. No hand edits.

#### 5. Registry rows

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Two rows the registry is owed — one new surface, one column that has been live and
unregistered since S-02.

**Contract**: In `## Application`: a `revoke_period` row in the shape of the `release_slot` row
(`:36`) — owner's **revoke** door, security-invoker, the NULL contract, write-once, the caretaker
cost; and a `care_periods.revoked_at` row naming the three functions that read it with the
identical `revoked_at is null` predicate, its write-once posture, and the fact that
`regenerate_period_token` now refuses on it — the gap `research.md` flags at
`contract-surfaces.md:33`.

#### 6. Tests

**File**: `tests/rls/revoke-period.test.ts` (new), modelled on `tests/rls/release-slot.test.ts`

**Intent**: Pin the grant posture, the RLS boundary and the write-once predicate.

**Contract**: anon and service_role each get `42501` **and the error message must name the
function** — asserting the SQLSTATE alone passes with the grant fully widened, because the same
code arrives from the table layer (S-04 phase-2 review; `lessons.md`). Owner revoking own period →
the id back, and `revoked_at` non-null on re-read. Owner B revoking owner A's period → NULL, and
A's `revoked_at` still NULL. Second revoke of the same period → NULL, **and the original timestamp
unchanged**. Non-existent uuid → NULL.

**File**: `tests/rls/invite-token.test.ts` (amend)

**Contract**: Add a case beside the existing `regenerate_period_token` block (`:226-260`): a
revoked period's regeneration returns NULL, and its `token_digest` is unchanged afterwards.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:reset`
- Types regenerate with no diff beyond the new RPC: `npm run db:gen-types`
- New RLS tests pass: `npm run test -- tests/rls/revoke-period.test.ts`
- Amended token tests pass: `npm run test -- tests/rls/invite-token.test.ts`
- Full suite green: `npm run test`
- Lint passes: `npm run lint`

#### Manual Verification:

- Grant test genuinely fails when the grant is widened: temporarily `grant execute ... to anon`,
  confirm the test **fails**, revert.
- Nothing in the UI changed — `/periods` and `/periods/[id]` render exactly as before.
- `RegenerateLinkButton`'s UI refusal is now backed by the API: with a manually revoked period,
  `POST /api/periods/[id]/token` answers 404 instead of 200.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: The caretaker's answer

### Overview

A caretaker holding a valid capability for a revoked period stops seeing a stranger's 404 and is
told the trip was called off. The generic dead-link card stops promising a replacement link that
can no longer exist. This is the rule-4 widening, and it gets the same treatment S-03 gave its own:
a doc entry in the same change, and a test that fails in **both** directions.

### Changes Required:

#### 1. The reveal door

**File**: `supabase/migrations/<timestamp>_claimed_details_revoked_answer.sql` (new)

**Intent**: Let the door tell a proven capability-holder that the period was revoked, while a
non-holder's answer stays byte-identical NULL.

**Contract**: `create or replace function public.get_claimed_details(p_token text, p_claim_secret text) returns jsonb`
— **signature unchanged**, so the grants from `20260907180022` survive (the same move
`20260907193000` made). Three ordered changes inside the body:

1. Drop `and p.revoked_at is null` from the period lookup, keeping the
   `if not found then return null` immediately after — an unknown or tampered token still answers
   NULL from the same line.
2. Leave the digest lookup and its `if not found then return null` (impl-review F6's row gate)
   **exactly as they are**. This is the gate that keeps a non-holder at NULL.
3. **After** that gate, if `v_period.revoked_at is not null`, return a minimal object marking the
   period revoked and nothing else — no title, no dates, no pets, no `caretaker_note`, no slots.
   Revocation is still total; the widening is one bit ("the trip you claimed is off"), not a
   restoration of access.

The header comment must state why this is safe in the terms `data-access.md` uses: a matching
`claim_digest` is unforgeable and provable only by having claimed while the link was live, so the
bit is disclosed only to someone who already had it — a strictly weaker widening than S-03's
accepted one. And it must state the ordering constraint, because the correctness is entirely in the
order.

Because the payload gains a key, the flag's name is a contract shared with the app: name it once
here and use exactly that name in change 2 below.

#### 2. The reveal call, ungated

**File**: `src/pages/invite/[token].astro`

**Intent**: The reveal is currently attempted only when the token door resolved — which is never,
for a revoked period. Without this, the SQL change is unreachable.

**Contract**: The reveal call's condition (`:103`) drops its `payload` term and keeps the
claim-cookie term: attempt the reveal whenever a claim cookie is present. The `ClaimedDetails`
interface (`:70-77`) gains the revoked flag from change 1. Update the comment above the call, which
currently states the opposite rule (_"Only attempted when the token itself resolved — there is
nothing to reveal on a dead link"_) and would become a false explanation of live code. State the new
rule and its one cost: a dead link opened with any claim cookie now runs one extra bounded RPC,
whose miss is the same NULL.

#### 3. The view decision

**File**: `src/lib/invite-view.ts`

**Intent**: `resolveInviteView` is where uniform failure is enforced _by a test rather than by an
`if` nobody checks_ — so the new branch belongs here and nowhere else.

**Contract**: A new `InviteView` kind for the revoked-and-claimed case, with **status 404 and
`INACTIVE_TITLE` as the title** — the status and the tab text must not differ from the inactive
page: the title lands in browser history and on a shared phone, and a differing status is
observable without rendering the body. Only the **body** differs. The input gains one flag for
"this visitor's capability resolved, and the period is revoked"; the branch sits **after** `failed`
and **inside** the `periodTitle === null` case, ahead of the general inactive return, so an
ordinary dead link is unaffected. The comment block at `:36-42` explains why `periodTitle === null`
is tested before `hasClaims`; it must be rewritten to describe the new, narrower rule rather than
left contradicting the code.

#### 4. Copy

**File**: `src/pages/invite/[token].astro`

**Intent**: Two bodies. The new one tells a claim-holder the trip was called off. The existing one
stops sending everyone else after a link the owner is now blocked from minting.

**Contract**: The revoked-holder card says the trip was called off and that they no longer need to
come; it must not imply the owner will send anything (there is no notification channel), and it
must not restate the dates or the trip title — the payload does not carry them by design.

The generic inactive card (`:172-178`) drops _"Poproś właściciela zwierzęcia o nowy — poprzedni mógł
zostać zastąpiony"_ in favour of copy that is true in every case that reaches it: the link no longer
works, and the owner would have to share a new one if the trip is still on. No test asserts this
string today; this phase's unit test will.

#### 5. The widening, in the docs

**File**: `docs/reference/data-access.md`

**Intent**: S-03 wrote its widening into this file **in the same change** that shipped it. This one
does the same, or rule 4 becomes a rule the code no longer follows.

**Contract**: Extend rule 4 (`:147-158`) with the second widening: uniform failure still holds for
every _unproven_ caller, and the one exception is a caller who presents a `claim_digest` matching a
row in the period. State the ordering that makes it safe and the bound on what is disclosed (one
bit, no payload). Also record the all-at-once caretaker cost of revocation, the sentence S-04's F3
wrote for the single-slot case.

#### 6. Tests

**File**: `tests/rls/reveal-instructions.test.ts` (amend, incl. `:390-404`)

**Contract**: `:390-404` is today the only test covering the transition — a live capability going
dark on revocation — and its expectation now changes for the holder. It must be amended, not
deleted, and it is the natural home for the **both-directions** pair: a matching capability on a
revoked period gets the revoked marker and **no** trip content; a **non-matching** secret on the
same revoked period gets plain NULL, indistinguishable from an unknown token. Add: an unknown token
on a revoked period → NULL; a capability earned on **another** trip presented against a revoked one
→ NULL.

**File**: `tests/unit/invite-view.test.ts` (amend)

**Contract**: The new kind is returned only for the flag combination that earns it; status and title
stay identical to `inactive`; every existing uniform-failure assertion still holds. The comment at
`:10` describing the branch order needs the same rewrite as the source.

**File**: `tests/api/invite-claim.test.ts` (check, amend only if needed)

**Contract**: `:318-348` pins route-level revoked-vs-unknown indistinguishability for the **claim
write**, which this phase does not touch. Confirm it still passes unchanged; if it does not, the
widening has leaked into the write path and that is a defect, not a test to update.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly: `npm run db:reset`
- Reveal tests pass, including both directions: `npm run test -- tests/rls/reveal-instructions.test.ts`
- View unit tests pass: `npm run test -- tests/unit/invite-view.test.ts`
- Claim route tests pass **unchanged**: `npm run test -- tests/api/invite-claim.test.ts`
- Full suite green: `npm run test`
- Types check: `npx astro check`
- Lint passes: `npm run lint`

#### Manual Verification:

- Widening fails closed: temporarily move the revoked branch **before** the digest gate, confirm the
  non-holder test **fails**, revert.
- With a manually revoked period and a real claim cookie in the browser: the page shows the
  called-off card, and the response carries no trip content.
- In a fresh private window (no cookie), the same URL is byte-identical to a random 43-char token:
  same status, same title, same body.
- The generic dead-link card no longer mentions asking for a new link.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: The owner's control

### Overview

Wire the write to a route and an island. Everything this button triggers is already true and
already tested, so this is the smallest of the three build phases.

### Changes Required:

#### 1. The route

**File**: `src/pages/api/periods/[id]/revoke.ts` (new)

**Intent**: Expose `revoke_period` to the owner's session, mirroring
`api/periods/[id]/slots/[slotId]/release.ts` step for step so a reader of one recognises the other.

**Contract**: `POST /api/periods/[id]/revoke`. Own `context.locals.user` check → 401 (**not
redundant**: `/api/**` is not middleware-gated). `createClient(context.request.headers, context.cookies)`;
missing config → 500. `periodIdSchema.safeParse(context.params.id)` → one combined 400.
`supabase.rpc("revoke_period", { p_period_id })`. On error,
`console.error("revoke_period failed:", error.code, error.message)` — **code and message only**,
never the whole error, because PostgREST echoes offending values into `details`. NULL → 404 with a
Polish sentence that does not re-separate the misses. 200 with a minimal `{ periodId }` echo. Its
own private `jsonResponse` helper; there is no shared one.

The header comment must name the CSRF dependency: protection here comes from the island sending no
Content-Type and no body, and **adding either would forfeit it** unless `invite/claim.ts`'s explicit
Origin check is copied in.

#### 2. The island

**File**: `src/components/periods/RevokePeriodButton.tsx` (new)

**Intent**: A page-level destructive action with no undo, following the repo's one confirm pattern.

**Contract**: Props: `periodId`, and `revoked` so the control renders its own terminal state rather
than the caller branching. Local `useState` only: `armed`, `pending`, `error`.
`fetch("/api/periods/<id>/revoke", { method: "POST" })` — **no headers, no body** (see above).
Response ladder: 401 → `window.location.href = "/auth/signin"`; `res.ok` →
`window.location.reload()`, because the page's counts and collision ordinals are computed in Astro
frontmatter and patching one region would leave the rest lying; 404 → its own sentence (the trip is
already revoked, refresh) rather than "spróbuj ponownie", which would send the owner into a loop
against a request that can never now succeed; else a generic failure. Identical connection-error
catch string as the other two islands. Errors through `<ServerError>`.

Two taps: "Odwołaj wyjazd" → a `destructive` confirm whose visible text differs and sits elsewhere,
plus an explicit "Nie" escape (there is no backdrop and no hover on touch). Focus must move on every
state swap or React drops it to `<body>` — it is also the only announcement, since there is no live
region. `aria-label` must **start with the visible text** (WCAG 2.5.3) and track `pending`.
Deliberately do **not** disarm in `finally`: on failure the confirm stays armed so a retry is one
tap, and on success the reload replaces the page first.

When `revoked` is true, render the terminal state instead of the button, with copy that agrees with
`RegenerateLinkButton`'s refusal — one voice, not two.

#### 3. Wiring, and the two divergent indicators

**File**: `src/pages/periods/[id].astro`

**Intent**: Mount the island beside the link section it governs, and stop the app from having two
different names for one state.

**Contract**: Render `RevokePeriodButton` with `client:load`, `periodId={period.id}` and
`revoked={period.revoked_at !== null}`, in the "Link dla opiekuna" section (`:314-320`) next to
`RegenerateLinkButton` — the two are one story: replace the link, or end it.

Reconcile `periods/index.astro:149` (`· link nieaktywny`) with `periods/[id].astro:201`
(`· link został unieważniony`) onto one phrase. Prefer the detail page's wording: "nieaktywny" now
reads as the caretaker's page title (`INACTIVE_TITLE`), which is a different fact about a different
reader.

#### 4. Tests

**File**: `tests/api/revoke-period.test.ts` (new), modelled on `tests/api/release-slot.test.ts`

**Contract**: No session → 401 and the RPC is never called. Malformed id → 400. Another owner's
period → 404. Own live period → 200 with the id echo. Second call → 404. Assert the request carries
**no Content-Type and no body**, so the CSRF posture is pinned by a test rather than by a comment —
the shape is the protection, and a later refactor adding a header would otherwise pass silently.

---

### Addendum (2026-09-10): three items pulled in from earlier reviews

Added after Phase 2 with the owner's approval. All three are reachable **because** this phase ships
the revoke control, which is why they belong here rather than as standing debt.

#### 5. The regenerate island's 404 tells the owner to retry something that can never succeed

**File**: `src/components/periods/RegenerateLinkButton.tsx`

**Intent**: Phase 1's impl-review F1 carried this forward. `POST /api/periods/[id]/token` now
answers 404 for a revoked period (Phase 1 put the refusal in SQL), and this island maps every
non-401 failure to _"Nie udało się wygenerować nowego linku. Spróbuj ponownie."_ — a retry prompt
for a request that is permanently refused. Today the `revoked` prop hides the path; once this phase
ships the revoke control, a stale-prop page (revoke in one tab, regenerate in another) reaches it
by an ordinary sequence of clicks.

**Contract**: Give the 404 branch its own terminal sentence — the trip's link was revoked, so no new
one can be issued, refresh to see the current state — mirroring the reasoning
`ReleaseSlotButton.tsx:73-77` gives for treating its own 404 as actionable rather than retryable.
Keep every other status on the existing generic message.

#### 6. Validate the claim cookie's shape before the reveal RPC

**File**: `src/pages/invite/[token].astro`

**Intent**: Phase 2's impl-review F9. Ungating the reveal means any request to `/invite/<anything>`
carrying a claim cookie now issues a second RPC. The page reads that cookie with **no shape check**,
unlike `src/pages/invite/claim.ts`, which gates on `CAPABILITY_SHAPE` (moved to `src/lib/claim-cookie.ts` when this item shipped). `HttpOnly` binds browsers,
not `curl`, so a garbage cookie currently buys a parse-then-reject round trip, and there is no rate
limiting anywhere in this repo.

**Contract**: Apply the same shape gate the claim route uses before calling `get_claimed_details`, so
the page and the route agree on what a well-formed capability looks like. This is a defence-in-depth
and cost change only — the function's own 43-char bounds already make a malformed secret a
guaranteed miss, so no observable behaviour changes for any well-formed caller. Do **not** let it
alter the uniform-failure answer: a rejected cookie must degrade exactly as a NULL reveal does.

#### 7. The last surviving "ask the owner for a new link"

**File**: `src/components/invite/ClaimSlots.tsx`

**Intent**: Phase 2's impl-review F10. `:152` still says _"Ten link przestał działać. Poproś
właściciela o nowy."_ — the promise Phase 2 removed from the inactive card, on the claim-POST 404
path, which is reachable on a revoked trip. `research.md:136` flagged it alongside the card copy;
Phase 2's contract scoped the fix to `[token].astro`, so it survived.

**Contract**: Bring it in line with the card Phase 2 rewrote: the link stopped working, and a new one
would have to come from the owner if the trip is still on. One voice across the two surfaces a
caretaker can hit.

### Success Criteria:

#### Automated Verification:

- Route tests pass: `npm run test -- tests/api/revoke-period.test.ts`
- Reveal tests still pass with the cookie shape gate in place: `npm run test -- tests/rls/reveal-instructions.test.ts`
- Full suite green: `npm run test`
- Types check: `npx astro check`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Two taps to revoke; a double-tap on the first button cannot revoke by itself.
- "Nie" returns to the idle state and clears any error.
- After confirming: the page reloads, the detail line shows the revoked marker, the regenerate panel
  shows its refusal, and the revoke control shows its terminal state.
- The list page (`/periods`) shows the same phrase as the detail page.
- Keyboard only: focus lands on the confirm when arming and on the idle button when cancelling.
- Screen reader announces the confirm's full accessible name, starting with the visible text.
- At 320px width the control and any error message stay inside the card.
- The caretaker link now behaves as Phase 2 specified — holder sees the called-off card, stranger
  sees the generic one.
- Regenerating a revoked trip's link from a stale tab shows the terminal sentence, not "Spróbuj
  ponownie" (addendum item 5).
- A malformed claim cookie on a dead link still renders exactly the generic inactive card —
  byte-identical to no cookie at all (addendum item 6).
- The claim island's 404 no longer sends the caretaker after a link nobody can mint (addendum
  item 7).

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding to Phase 4.

---

## Phase 4: Close-out — the documents this slice made stale

### Overview

This is the fourth recurrence of a class `lessons.md` already records, and
`owner-occupancy-view/reviews/impl-review.md:197-203` aims its closing note at exactly this slice: a
doc sentence written in phase N, in a slice whose later phases change that world, goes stale
silently. So the sweep is a phase, not a footnote.

### Changes Required:

#### 1. The roadmap's false certainty

**File**: `context/foundation/roadmap.md`

**Intent**: `:206` records `Unknowns: —` for S-06, which was wrong on the codebase's own evidence —
two migration comments hand decisions to S-06 **by name**. Correcting it is owed whichever way the
decisions landed.

**Contract**: Replace `Unknowns: —` with the four decisions and how they landed: one action not two;
irreversible; claim-holder gets a distinct answer via the `claim_digest` widening; bulk release of
claimed slots explicitly out. Keep the entry's shape (the `- **Key:** value` list) and set
`Status:` to reflect completion.

#### 2. FR-012's surviving "zamknąć"

**File**: `context/foundation/prd.md`

**Intent**: FR-012 says _"zamknąć / odwołać"_; one action shipped. Without a recorded rationale the
wording will re-raise the question at the next reading — and the PRD's own Socratic round already
accepted _"okres mija sam, ręczne zamykanie zbędne"_ without deleting the word.

**Contract**: Note under FR-012 (`:100-101`) that it shipped as a single irreversible "odwołaj",
with the one-line reason (`:140` already treats close and revoke as one identical effect; the schema
has one lifecycle axis). Add to `## Open Questions` the two things this slice deliberately left:
whether "the trip is over" ever becomes a product concept (today a finished trip's link resolves
forever — a live consequence of S-02's no-expiry decision), and whether a cancelled trip should
release claimed slots.

#### 3. The debt S-04 half-paid

**File**: `docs/reference/data-access.md`

**Intent**: `:160-172` still says a later slice **owes** the owner a "release this slot" action. S-04
shipped it; the full-plan review narrowed the adjacent paragraph but not this one. The same
paragraph's claim that revocation _"invalidates future access without releasing slots already
taken"_ is still true and must survive the edit as a **standing** limitation, not a to-do.

**Contract**: Retire the "owes" framing, point at `release_slot`, and restate the
slots-stay-claimed asymmetry as a recorded product decision from this slice with its reason (bulk
release changes nothing the caretaker sees).

#### 4. Re-read this slice's own edits

**File**: all of the above, plus Phase 1's and Phase 2's doc and comment edits

**Intent**: Phase 1 wrote a column comment and two registry rows in a world where the widening did
not exist and there was no route; Phase 2 wrote a rule-4 entry in a world with no owner control.
Both are now stale in the specific way the lesson names.

**Contract**: Re-read, in order: the new `revoked_at` column comment, the `revoke_period` and
`care_periods.revoked_at` registry rows, `regenerate_period_token`'s function comment and its
registry row (`contract-surfaces.md:33`), rule 4 in `data-access.md`, and the header comment on
`invite/[token].astro`'s reveal call. Each must describe the world **after** Phase 3, and each
registry row must name the route that now reaches it.

### Success Criteria:

#### Automated Verification:

- Full suite green: `npm run test`
- Lint and formatting pass: `npm run lint`
- Build succeeds: `npm run build`
- No stale forward references remain:
  `grep -rn "S-06" supabase/migrations/ docs/ context/foundation/` returns only entries that
  describe shipped behaviour

#### Manual Verification:

- Read `contract-surfaces.md`'s two new rows and `regenerate_period_token`'s row as a stranger: they
  describe live behaviour, name their route, and contain no future tense.
- Rule 4 in `data-access.md` reads as one coherent rule with two bounded widenings, not as two
  patches.
- The `revoked_at` column comment in the **live catalog** (not just the migration file) matches.

---

## Testing Strategy

### Unit Tests:

- `resolveInviteView`: the new kind for the exact flag combination that earns it; identical status
  and title to `inactive`; every pre-existing uniform-failure case unchanged.

### Integration Tests:

- `revoke_period`: grant refusal for anon and service_role with the **message naming the function**;
  own period succeeds; another owner's answers NULL and leaves the row untouched; double revoke
  answers NULL and preserves the original timestamp.
- `regenerate_period_token`: refuses a revoked period and leaves `token_digest` unchanged.
- `get_claimed_details`, both directions in one place: matching capability on a revoked period → the
  marker and no content; non-matching secret, unknown token, and another trip's capability on the
  same revoked period → plain NULL.
- `POST /api/periods/[id]/revoke`: 401 / 400 / 404 / 200 / second-call-404, plus the assertion that
  the request carries no Content-Type and no body.
- `tests/api/invite-claim.test.ts:318-348` must pass **unchanged** — the write path keeps uniform
  failure.

### Manual Testing Steps:

1. Create a trip with slots, copy the invite link, claim a slot in a private window (keeping that
   window's cookie).
2. As the owner, revoke the trip: two taps, then confirm the reload, the marker, the regenerate
   refusal and the control's terminal state.
3. Reload the caretaker's private window: the called-off card, with no trip content in the response.
4. Open the same URL in a **second**, cookie-less private window: byte-identical to a random
   43-char token — same status, same title, same body.
5. `POST /api/periods/[id]/token` against the revoked trip: 404.
6. Revoke a second time: 404 and the "already revoked, refresh" sentence.
7. Repeat steps 2–3 at 320px width, keyboard-only, with a screen reader.

## Performance Considerations

One extra bounded RPC per dead-link view that carries a claim cookie. `get_claimed_details` bounds
both arguments to 43 chars before hashing anything (`20260907193000:44-52`), and the digest lookup
is served by `care_slots_period_claim_digest_idx`. `revoke_period` writes one column on one row by
primary key. `revoked_at` participates in no index and needs none — every reader already filters by
`token_digest`, which is unique.

## Migration Notes

Two migrations, both forward-only and both safe on live data: one adds a function and replaces two
comments; the other is a `create or replace` with an unchanged signature (grants survive). No column
is added, altered or dropped. Existing revoked periods — if any — immediately gain the new
caretaker-facing answer for capability-holders, which is the intended behaviour and needs no
backfill.

Rollback is `drop function public.revoke_period(uuid)` plus re-applying the two prior function
bodies. Nothing depends on `revoke_period` outside this slice's own route.

## References

- Frame brief: `context/changes/close-care-period/frame.md`
- Related research: `context/changes/close-care-period/research.md`
- Guarded-write template: `supabase/migrations/20260909090000_release_slot.sql`
- Route template: `src/pages/api/periods/[id]/slots/[slotId]/release.ts`
- Island template: `src/components/periods/ReleaseSlotButton.tsx:88-159`
- The rule this slice follows: `docs/reference/data-access.md:181-193`
- The widening it extends: `docs/reference/data-access.md:147-158`
- Signature-preserving replace, precedent:
  `supabase/migrations/20260907193000_claimed_details_row_gate.sql:20-22`
- Rejected Fix B (clear `revoked_at` on regenerate):
  `context/archive/2026-09-06-care-period-and-invite-link/reviews/impl-review-phase-3.md:63-89`
- The doc-staleness lesson:
  `context/archive/2026-09-08-owner-occupancy-view/reviews/impl-review.md:197-203`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The write, and irreversibility in SQL

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run db:reset` — a3454a6
- [x] 1.2 Types regenerate with no diff beyond the new RPC: `npm run db:gen-types` — a3454a6
- [x] 1.3 New RLS tests pass: `npm run test -- tests/rls/revoke-period.test.ts` — a3454a6
- [x] 1.4 Amended token tests pass: `npm run test -- tests/rls/invite-token.test.ts` — a3454a6
- [x] 1.5 Full suite green: `npm run test` — a3454a6
- [x] 1.6 Lint passes: `npm run lint` — a3454a6

#### Manual

- [x] 1.7 Grant test genuinely fails when the grant is widened — a3454a6
- [x] 1.8 Nothing in the UI changed — a3454a6
- [x] 1.9 Regeneration of a revoked period answers 404 at the API — a3454a6

### Phase 2: The caretaker's answer

#### Automated

- [x] 2.1 Migrations apply cleanly: `npm run db:reset` — 8e32a65
- [x] 2.2 Reveal tests pass, including both directions: `npm run test -- tests/rls/reveal-instructions.test.ts` — 8e32a65
- [x] 2.3 View unit tests pass: `npm run test -- tests/unit/invite-view.test.ts` — 8e32a65
- [x] 2.4 Claim route tests pass unchanged: `npm run test -- tests/api/invite-claim.test.ts` — 8e32a65
- [x] 2.5 Full suite green: `npm run test` — 8e32a65
- [x] 2.6 Types check: `npx astro check` — 8e32a65
- [x] 2.7 Lint passes: `npm run lint` — 8e32a65

#### Manual

- [x] 2.8 Widening fails closed when the revoked branch is moved before the digest gate — 8e32a65
- [x] 2.9 Holder sees the called-off card with no trip content in the response — 8e32a65
- [x] 2.10 Cookie-less window is byte-identical to a random token — 8e32a65
- [x] 2.11 The generic dead-link card no longer mentions asking for a new link — 8e32a65

### Phase 3: The owner's control

#### Automated

- [x] 3.1 Route tests pass: `npm run test -- tests/api/revoke-period.test.ts` — f3ea47b
- [x] 3.2 Reveal tests still pass with the cookie shape gate in place: `npm run test -- tests/rls/reveal-instructions.test.ts` — f3ea47b
- [x] 3.3 Full suite green: `npm run test` — f3ea47b
- [x] 3.4 Types check: `npx astro check` — f3ea47b
- [x] 3.5 Lint passes: `npm run lint` — f3ea47b
- [x] 3.6 Build succeeds: `npm run build` — f3ea47b

#### Manual

- [x] 3.7 Two taps to revoke; a double-tap cannot revoke by itself — f3ea47b
- [x] 3.8 "Nie" returns to idle and clears the error — f3ea47b
- [x] 3.9 After confirming: reload, marker, regenerate refusal, terminal state — f3ea47b
- [x] 3.10 List and detail pages show the same phrase — f3ea47b
- [x] 3.11 Keyboard-only focus moves correctly on every state swap — f3ea47b
- [x] 3.12 Screen reader announces the confirm's full name, starting with the visible text — f3ea47b
- [x] 3.13 Control and errors stay inside the card at 320px — f3ea47b
- [x] 3.14 Caretaker link behaves as Phase 2 specified — f3ea47b
- [x] 3.15 Regenerating a revoked trip from a stale tab shows the terminal sentence, not "Spróbuj ponownie" — f3ea47b
- [x] 3.16 A malformed claim cookie on a dead link renders exactly the generic inactive card — f3ea47b
- [x] 3.17 The claim island's 404 no longer sends the caretaker after a link nobody can mint — f3ea47b

### Phase 4: Close-out — the documents this slice made stale

#### Automated

- [x] 4.1 Full suite green: `npm run test`
- [x] 4.2 Lint and formatting pass: `npm run lint`
- [x] 4.3 Build succeeds: `npm run build`
- [x] 4.4 No stale forward references: `grep -rn "S-06" supabase/migrations/ docs/ context/foundation/`

#### Manual

- [x] 4.5 The two new registry rows and `regenerate_period_token`'s row describe live behaviour
- [x] 4.6 Rule 4 reads as one rule with two bounded widenings
- [x] 4.7 The live catalog's `revoked_at` column comment matches the migration
