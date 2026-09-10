---
date: 2026-09-09T22:30:35+02:00
researcher: jagoda.wykusz
git_commit: fa2d7f278586ae958a77750f9cb83f4147f5d646
branch: master
repository: pupilownik
topic: "Closing / cancelling a care period (FR-012, roadmap S-06)"
tags: [research, codebase, care-periods, revoked-at, invite-token, owner-actions, rls]
status: complete
last_updated: 2026-09-09
last_updated_by: jagoda.wykusz
---

# Research: Closing / cancelling a care period (FR-012, roadmap S-06)

**Date**: 2026-09-09T22:30:35+02:00
**Researcher**: jagoda.wykusz
**Git Commit**: fa2d7f2 (`master`, 77 commits ahead of `origin/master` — nothing pushed, so no GitHub permalinks)
**Repository**: pupilownik

## Research Question

What exists today around closing / revoking a care period, so that a plan for S-06
(`close-care-period`, FR-012) is grounded rather than assumed? Scope agreed with the user:
the owner-side write path **plus** what revocation does to a caretaker who already claimed.
Focus areas: current posture read from the catalog, prior decisions in the archives, whether
FR-012 is one action or two, and the design / UI precedent.

## Summary

**The mechanism is nearly free. The semantics are wide open. The roadmap has this backwards.**

`roadmap.md:206` records S-06 as `Unknowns: —` and frames it as "ścieżka unieważnienia … już
częściowo pokryta" — implying a small slice that adds a write and a button. The write really is
small. But the slice carries at least five unanswered product questions, and the roadmap says
there are none. That is the single most important correction this research makes.

Three findings drive everything else:

1. **No new capability is needed, in either direction.** An authenticated owner can already set
   `revoked_at` _and clear it back to NULL_ with a plain `.update()` through their own session
   client. Proven behaviourally under RLS in a rolled-back transaction, not inferred from
   comments. There is no function, no trigger, no CHECK, no column ACL. S-06 is a **guard over a
   permission the owner already holds** — structurally the same slice as S-04's `release_slot`
   (`data-access.md:181-194` states this shape as a rule).

2. **Revocation is total, indistinguishable and uninstrumented.** Setting one column closes all
   three anon doors at once. A caretaker who already claimed sees the identical "Link nieaktywny"
   404 card as a stranger with a typo: they lose the trip, their own record of which days they
   took, the `caretaker_note` and every sensitive instruction — **including mid-trip, standing at
   the door**. Nobody is notified. And the card's copy tells them to _"poproś właściciela o
   nowy [link]"_, which is a dead end: `RegenerateLinkButton` refuses to mint one for a revoked
   period. The owner, meanwhile, loses nothing and still sees every caretaker by name.

3. **The product has no concept of a trip being over.** Verified exhaustively: no anon door has a
   date predicate (`start_date`/`end_date` appear only as payload fields), and the only place in
   all of `src/` that reads the _current_ time is a default parameter in `claim-cookie.ts:71`.
   A trip that ended six months ago still resolves its link, still reveals house keys, and still
   accepts claims. That is a live consequence of S-02's deliberate no-expiry decision, and no
   document in the repo treats it as a defect.

**The crux, which no single source states:** FR-012 fuses three intents onto one nullable
timestamp, and the column's behaviour only suits one of them.

| Intent                | PRD's word        | What revocation actually does                                                                | Fit                                 |
| --------------------- | ----------------- | -------------------------------------------------------------------------------------------- | ----------------------------------- |
| The link leaked       | "wrażliwy link"   | Kills all access immediately, indistinguishably                                              | **Good** — that is the point        |
| The trip is cancelled | "odwołany wyjazd" | Hides the trip from caretakers instead of telling them it is off; leaves their slots claimed | **Poor** — worst of both            |
| The trip is over      | "zamknąć"         | Nothing distinguishes this from the above; used early it cuts access mid-job                 | **Absent** — no such concept exists |

The PRD's own Socratic round (`prd.md:101`) accepted the counter-argument _"okres mija sam,
ręczne zamykanie zbędne"_ and kept FR-012 **only** on the cancellation and leaked-link
justifications. The "zamknąć" sense survived in the wording with no recorded rationale behind it.

## Detailed Findings

### 1. The write: already permitted, needs a guard rather than a capability

Read from the live catalog per `lessons.md` §"Weryfikuj posturę systemu z katalogu", with the
queries run against `supabase_db_10x-astro-starter`.

- **One UPDATE policy**, `care_periods_update_own`, `TO authenticated`, USING and WITH CHECK both
  exactly `auth.uid() = owner_id` (`20260905234144_care_periods_and_slots.sql:88`). Postgres RLS
  has no column granularity, so a policy that admits the row admits every column of it. The
  policy text is the proof: it never mentions `revoked_at`, therefore it never restricts it.
- **Table-level UPDATE grant** to `authenticated`, **no column list**, and
  `pg_attribute.attacl` is NULL for every column on the table — nothing narrows the write.
- **`revoked_at` is `timestamptz`, nullable, no default.** No constraint on the table mentions it
  (the four that exist cover date ordering, max span, note length, and the owner FK). No trigger
  on the table at all. It participates in no index.
- **Behavioural proof**, in a transaction that was rolled back, using a throwaway user and period
  and `set local role authenticated`: both `set revoked_at = now()` and `set revoked_at = null`
  returned `UPDATE 1`. **Revocation is fully reversible at the database level today** — the
  one-way door exists only in prose and in the UI.
- **Three functions read the column**, all `SECURITY DEFINER`, all with the identical predicate
  `where p.token_digest = v_digest and p.revoked_at is null`: `get_period_by_token`,
  `claim_slots`, `get_claimed_details`. **No function writes it.** There is no `revoke_period` /
  `close_period` RPC and no row for one in `contract-surfaces.md`.
- **No closed-vs-cancelled distinction anywhere in the schema.** A query across all six public
  tables for any column matching `cancel|close|status|state|revok|archiv` returns exactly one
  row: `care_periods.revoked_at`. If the action needs to tell "closed" from "cancelled", that is
  a **schema change**, not a UI change.

### 2. The blast radius: what a caretaker loses

All three doors answer a revoked period with SQL `NULL`, byte-identical to their answer for an
unknown, tampered, malformed or empty token. `get_claimed_details` resolves the period _before_
checking the capability (`20260907193000_claimed_details_row_gate.sql:55-62`, then `:74-90`), so
a revoked period never reaches the digest match.

The invite page reads the token door first (`invite/[token].astro:80-93`); on revocation
`payload === null`, so the reveal call is not even attempted (`:105`). `resolveInviteView`
(`src/lib/invite-view.ts:24-49`) checks `periodTitle === null` at `:36` **before** `hasClaims` at
`:43` — deliberately, per its own comment: a capability that no longer resolves _"must degrade to
the same inactive page as any other dead link, never to a post-claim view with nothing in it."_

Ordered by how surprising each is to the owner clicking the control:

1. **Nobody is told.** No notification of any kind. The caretaker finds out only if they happen
   to reopen the link, and it looks like a broken URL.
2. **The copy points at a dead end.** _"Ten link nie działa. Poproś właściciela zwierzęcia o nowy
   — poprzedni mógł zostać zastąpiony"_ (`invite/[token].astro:172-178`) is written for the
   _regenerate_ case. It tells the caretaker to ask for a replacement the owner cannot issue,
   because `RegenerateLinkButton.tsx:57-64` refuses on a revoked period.
3. **The whole trip vanishes, not just the booking** — title, dates, pets, and the pets' _public_
   instructions. Even a caretaker who never claimed loses sight of what they were asked to do.
4. **A committed caretaker loses their own record.** No _"Zapisano, Ania! Masz 2 dni…"_; they
   cannot see which days they took.
5. **The house keys go dark.** `caretaker_note` and every `is_sensitive` row become unreachable —
   with no grace period and no "you already claimed, keep your access" branch. Note the direct
   tension with S-02's reason for having no auto-expiry: _"a caretaker still needs the
   instructions on the last evening; auto-expiry fails exactly then."_ Revocation violates that
   principle by design; that is fine when intentional, but the timing consequence is invisible in
   the UI.
6. **A mid-flight claim fails with the wrong story** — `claim.ts:131-134` → 404 → the island
   renders _"Ten link przestał działać. Poproś właściciela o nowy"_ (`ClaimSlots.tsx:151-154`).
   Nothing is written; the selection is lost.
7. **The credential stays live in the browser** for up to `end_date + 7 days`
   (`claim-cookie.ts:35,41,71-96`), doing nothing on this trip and still fully valid on any other
   trip that caretaker claimed — the cookie is scoped by path, not by period. Revocation is a
   filter on the period, not a logout. Nothing in `src/` ever deletes the cookie.
8. **The asymmetry is total.** The owner keeps every name, timestamp and digest; the detail page
   just appends `· link został unieważniony` and keeps counting caretakers.

**Nothing is destroyed.** Revocation writes one column on `care_periods` and touches no claim
data. Clearing it restores every caretaker's access exactly as it was — same claims, same
capabilities, same reveal. The one exception is a cookie whose Max-Age expired during the revoked
window; that caretaker returns as a new identity and cannot reclaim slots they already hold,
because those now read as taken.

### 3. One column, three intents — the real shape of FR-012

`prd.md:100-101`, in full:

> FR-012: Właściciel może zamknąć / odwołać okres opieki, unieważniając link zapraszający.
> Priority: nice-to-have
>
> > Socrates: Kontrargument: okres mija sam, ręczne zamykanie zbędne. Rozstrzygnięcie: przydatne
> > (odwołany wyjazd, wrażliwy link), ale nie blokuje MVP — demote do nice-to-have.

The counter-argument that was _accepted as valid_ is precisely "a period expires by itself,
manual closing is redundant". The requirement survived on two justifications, both of which are
the "odwołać" sense. The two other PRD mentions (`:76` in US-02's acceptance criteria, `:140` in
§Access Control) both describe a single identical effect — the link stops working — and never
split the pair.

**Where the PRD is silent:** no NFR, no user story, no non-goal and no Open Question touches
closing, ending or archiving a trip. The one-vs-two question **has never been asked in this
repo**.

The design is silent too. `context/design/Pupilownik Hi-fi.html` has eleven artboards and **no
owner trip-detail or trip-list screen at all**; grepping for `zamknij|zamknięt|odwoła|anuluj|
zakończ|nieaktywn|archiw|usuń|status` returns nothing. **S-06 has no design** — consistent with
S-07 having deliberately left domain components to the slices that use them.

And the code has no second state to hang "closed" on: `revoked_at` is the only lifecycle axis,
binary and nullable.

### 4. The precedents S-06 must mirror

**The RPC** (`release_slot`, `20260909090000_release_slot.sql`; `regenerate_period_token`,
`20260906003122_invite_token_access.sql:127-169`):
`SECURITY INVOKER` so RLS stays the authorization boundary, `set search_path = ''`, every object
fully qualified, **returns a scalar not a composite** (a plpgsql function returning a composite
answers a miss with a row of NULLs rather than NULL, so the route's 404 branch would never fire),
one guarded UPDATE, a redundant-but-deliberate scoping predicate so the URL and the guard agree,
grants as `revoke execute … from public, anon, service_role` then `grant execute … to
authenticated`, and a `comment on function` stating what NULL means.

**The route** (`api/periods/[id]/token.ts`, `api/periods/[id]/slots/[slotId]/release.ts`):
own `context.locals.user` check answering 401 — **`/api/**`is not middleware-gated**, because`PROTECTED_ROUTES`matches`startsWith`and lists`/periods`, not `/api/periods`
(`middleware.ts:8`). Then `periodIdSchema.safeParse`on every path param → one combined 400; the
RPC;`console.error("<rpc> failed:", error.code, error.message)`— **code and message only, never
the whole error**, because PostgREST echoes offending values into`details`; NULL → 404 with a
Polish sentence that does not re-separate the misses; 200 with a minimal id echo. Each route
carries its own private `jsonResponse` helper; there is no shared one.

**The island** (`ReleaseSlotButton.tsx`, newest; `RegenerateLinkButton.tsx`, older). Shared
skeleton: local `useState` only, `setError(null); setPending(true)` … `finally { setPending(false) }`,
`fetch(url, { method: "POST" })`, the fixed response ladder 401 → redirect, `res.ok` → success,
else `setError`, plus an identical connection-error catch string; errors through `<ServerError>`
(which carries `role="alert"`). Four decisions in the newest one are **load-bearing**, each
argued in the file:

- **`window.location.reload()` on success**, because the page's derived state (counts, collision
  ordinals) is computed in Astro frontmatter and patching one row would leave the rest lying.
- **No `Content-Type`, no body — a security property.** Astro's origin middleware refuses a
  non-safe method carrying no content-type unless the origin matches; sending
  `application/json` lands in the _no-check_ branch, which is exactly why `invite/claim.ts`
  needs its own Origin check. **A close endpoint that takes a JSON body forfeits CSRF protection
  unless it re-implements that check.** This is the single most constraining item for S-06.
- **`aria-label` must start with the visible text** (WCAG 2.5.3) and must track `pending`.
- **Focus must move on every state swap**, or React drops it to `<body>`; it is also the only
  announcement, since there is no live region.

**Confirmation:** exactly one pattern in the repo and **no shared component** — the inline
two-tap arm/confirm in `ReleaseSlotButton.tsx:88-159`, destructive variant on the second tap
only, explicit "Nie" escape. There is no dialog component anywhere. Whether a row-level pattern
scales to a **page-level** action is untested; the existing one exists because a dozen
near-identical controls sit in a list. Note also that regenerating a link — which invalidates the
previous one — currently has **no confirmation at all**.

The `destructive` button variant (`ui/button.tsx:22`) has exactly one consumer in the whole repo:
that confirm button. It came from the shadcn bootstrap, not from the design.

## Code References

- `supabase/migrations/20260906003122_invite_token_access.sql:32-36` — where `revoked_at` was
  added, with the two future-tense comments that go stale when S-06 ships
- `supabase/migrations/20260906003122_invite_token_access.sql:120-121` — un-revoking deferred to
  S-06 by name
- `supabase/migrations/20260906003122_invite_token_access.sql:46-49` — the uniform-failure rule,
  stated as a security property
- `supabase/migrations/20260907193000_claimed_details_row_gate.sql:55-62` — period resolved
  before the capability check, which is why revocation kills the reveal
- `supabase/migrations/20260909090000_release_slot.sql` — the owner-side guarded-write template
- `supabase/migrations/20260905234144_care_periods_and_slots.sql:88` — `care_periods_update_own`,
  the policy that already permits the write
- `src/lib/invite-view.ts:24-49` — the branch order that sends a revoked-period caretaker to the
  inactive page rather than an empty post-claim view
- `src/pages/invite/[token].astro:172-178` — the "ask for a new link" copy that becomes a dead end
- `src/components/periods/RegenerateLinkButton.tsx:57-64` — the refusal that makes it a dead end
- `src/pages/periods/index.astro:149` / `src/pages/periods/[id].astro:201` — the two (differently
  worded) revoked indicators that already ship
- `src/pages/periods/[id].astro:318` — `revoked` already passed into the island
- `src/lib/claim-cookie.ts:71-96` — the only current-time read in `src/`; cookie outlives the trip
- `src/middleware.ts:8` — why `/api/**` needs its own auth check
- `tests/rls/invite-token.test.ts:115-130` — revoked token deliberately in the same uniform-failure
  assertion list as unknown / tampered / malformed / empty
- `tests/rls/reveal-instructions.test.ts:390-404` — the only test covering the _transition_: a live
  capability going dark on revocation
- `tests/api/invite-claim.test.ts:318-348` — route-level revoked-vs-unknown indistinguishability

## Architecture Insights

- **"Check which role a slice serves before reaching for a `SECURITY DEFINER` door"**
  (`data-access.md:181-194`). S-06 serves the owner, who is `authenticated` and reaches
  `care_periods` through the ordinary F-01 path. It is a named guard over an existing UPDATE —
  `SECURITY INVOKER`, not a new door, and not anon-reachable.
- **Uniform failure is non-negotiable on the NULL half.** S-03 widened rule 4 for writes (a claim
  must distinguish won from refused), but only _inside_ a period the caller already proved a
  token for, and it wrote the widening into `data-access.md` in the same change. Any S-06 refusal
  must stay uniform with unknown and malformed tokens, pinned by a test that fails in both
  directions, **at both the SQL and route layers** (S-03's phase-4 review F8a caught exactly the
  gap where SQL was covered and the route's mapping was not).
- **Owner-side writes answer one NULL for every miss.** Both `release_slot` and
  `regenerate_period_token` collapse "not yours" / "does not exist" / "already in that state" to
  a single answer, and their routes do not re-separate them. An S-06 RPC that answered
  differently for "already revoked" would break a pattern both existing writes hold.
- **A test asserting a security posture must fail when the posture is removed.** S-04's phase-2
  review found the obvious grant assertion passed with the grant fully widened, because the same
  SQLSTATE arrives from the table layer; the fix was to assert the error _message_ names the
  function. Any S-06 grant test inherits this.
- **Nulling a credential-bearing column has downstream effects that must be documented.** S-04's
  F3 recorded that freeing a capability's last term revokes that caretaker's reveal
  indistinguishably. Revoking a period does the same thing to _every_ caretaker at once. S-06
  owes that sentence to the docs.

## Historical Context (from prior changes)

- `context/archive/2026-09-06-care-period-and-invite-link/research.md:252-254` — `revoked_at` was
  raised as an open question and settled as a cheap-now decision: one column now versus a
  migration plus a security-function edit later.
- `context/archive/2026-09-06-care-period-and-invite-link/plan-brief.md:39-40` — the sibling
  decision that matters most here: **no expiry**, because _"a caretaker still needs the
  instructions on the last evening; auto-expiry fails exactly then"_, which makes `revoked_at`
  _"the only brake that exists"_.
- `context/archive/2026-09-06-care-period-and-invite-link/reviews/impl-review-phase-3.md:63-89` —
  finding F3: regenerating a revoked period mints a permanently dead link. Fix A (refuse in the
  UI) was taken; **Fix B (clear `revoked_at` on regenerate) was explicitly rejected**, and
  _"S-06 owns the server-side semantics"_. The API still regenerates a revoked period today.
- `context/archive/2026-09-06-caretaker-claims-slot/plan.md:107-113` — the standing risk, widened
  after review: _"revoking the link does not release slots already taken"_, so a leaked link can
  permanently occupy a whole trip and the owner's only lever leaves the slots taken. **S-04 paid
  half this debt** by shipping `release_slot`; S-06 is the other half.
- `context/archive/2026-09-08-owner-occupancy-view/plan.md:92-94` — why a named database surface
  beats an inline `.update()`: it earns a registry row and stops a later slice widening it by
  accident.
- `context/archive/2026-09-08-owner-occupancy-view/reviews/impl-review.md:197-203` — the closing
  note aimed at the next slice: a doc sentence written in phase N, in a slice whose later phases
  change that world, goes stale silently. **A multi-phase slice must re-read its own doc edits at
  the close.**

### Documents that go stale the moment S-06 ships

This is the fourth recurrence of the class `lessons.md` records, so it is worth listing up front
rather than discovering it in review:

1. `20260906003122_invite_token_access.sql:32` — `-- Set by S-06's "revoke link" (FR-012)`.
2. `20260906003122_invite_token_access.sql:35-36` — the **column comment**, which is live in the
   catalog: _"Written by S-06"_. It already misdescribes reality: there is no S-06 writer, and the
   actual writer is any authenticated owner through the generic all-columns policy — the same door
   used to rename a trip.
3. `docs/reference/data-access.md:160-172` — still says a later slice _owes_ the owner a "release
   this slot" action. S-04 shipped it; the full-plan review narrowed the adjacent paragraph but
   not this one.
4. `docs/reference/contract-surfaces.md:33` — the `regenerate_period_token` row says nothing about
   `revoked_at` at all, despite the UI-only refusal being a live behaviour.

## Related Research

- `context/archive/2026-09-06-care-period-and-invite-link/research.md` — the token model, digest
  storage, and the origin of `revoked_at`
- `context/archive/2026-09-06-caretaker-claims-slot/research.md` — the capability model and the
  read-shaped-rules analysis that produced rule 4's widening
- `context/archive/2026-09-08-owner-occupancy-view/research.md` — the owner-already-can-write
  finding for `care_slots`, the direct structural analogue of this slice

## Open Questions

Five, all genuine product decisions the repo does not answer. **`roadmap.md:206` records
`Unknowns: —` for S-06, which is wrong and should be corrected whichever way these land.**

- **A. One action or two?** The evidence _leans_ one action: the Socratic round accepted "okres
  mija sam", the two other PRD mentions describe one identical effect, the roadmap frames a single
  "ścieżka unieważnienia", the design shows nothing, and the schema has no second state. But
  "zamknąć" was never deleted from the FR, and no sentence in the repo says close and cancel are
  the same thing. Owner: user.
- **B. Should "the trip is over" become a concept at all?** Nothing in the product distinguishes a
  past trip from a future one, and a finished trip's link stays live forever — verified, not
  assumed. If S-06 introduces a date-derived state it introduces the product's first one. Owner:
  user.
- **C. Un-revoke.** Deferred to S-06 by name. The database permits it freely today; the UI
  pre-commits to "no" via copy (_"Zaplanuj nowy wyjazd"_) that the API does not enforce. Three
  sub-decisions: does un-revoke exist; does regenerating imply un-revoking; does the API refuse
  regeneration of a revoked period, or only the island? Owner: user.
- **D. What happens to already-claimed slots?** Revocation leaves them taken. Whether a
  _cancelled_ trip should release them (the caretakers are no longer needed) while a _closed_ one
  should not is exactly the asymmetry that would justify two actions — and it is nowhere
  considered. Note S-04 now makes bulk release mechanically cheap. Owner: user.
- **E. Does the caretaker deserve a better answer than "Link nieaktywny"?** Uniform failure is a
  security property for an _unknown_ token, but a caretaker holding a valid capability for a trip
  the owner cancelled is not a prober. Telling them apart is possible — their `claim_digest`
  matches — but doing so would confirm the period exists to anyone holding a claimed capability,
  which is a deliberate widening of rule 4 and would need the same treatment S-03 gave its
  widening. Not free, not impossible, and currently not even asked. Owner: user.

**Recommended next step:** `/10x-frame close-care-period` before `/10x-plan`. The mechanism is
understood well enough to plan in an afternoon; what is not settled is _what the action means_,
and questions A, B and D change the shape of the slice rather than its details.
