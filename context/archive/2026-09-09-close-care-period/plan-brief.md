# Close / cancel a care period (FR-012, S-06) — Plan Brief

> Full plan: `context/changes/close-care-period/plan.md`
> Frame brief: `context/changes/close-care-period/frame.md`
> Research: `context/changes/close-care-period/research.md`

## What & Why

The owner cannot revoke a care period at all, and the answer the product gives a caretaker when
one _is_ revoked is advice the owner cannot satisfy — so the slice must settle what cancellation
_means to the caretaker_ before shipping the write, not after.

The write is nearly free; the semantics are the work. This slice ships one irreversible "odwołaj",
enforced in SQL, plus the first honest answer for a caretaker who committed their days.

## Starting Point

`care_periods.revoked_at` exists and is honoured by all three anon doors, but **no function writes
it** — the owner can already set _and clear_ it with a plain `.update()` through their own session
(proven behaviourally under RLS, not inferred). Both owner-side "revoked" indicators already ship,
worded differently. And the caretaker-facing dead end is already live and self-contradictory: the
invite page says _"poproś właściciela o nowy link"_ while `RegenerateLinkButton` refuses to mint
one.

## Desired End State

An owner on `/periods/[id]` has an "Odwołaj wyjazd" control that takes two taps and permanently
kills the invite link — irreversibly, enforced by the database rather than by a React prop. A
caretaker who had claimed slots and reopens their link is told the trip was called off. A stranger
with a typo sees exactly what they see today, byte for byte.

## Key Decisions Made

| Decision                       | Choice                                         | Why (1 sentence)                                                                                                         | Source   |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| One action or two              | One: "odwołaj"                                 | `prd.md:140` already treats close and revoke as one identical effect, and the schema has exactly one lifecycle axis.     | Plan     |
| Reversibility                  | Irreversible, no un-revoke                     | Nice-to-have priority argues against a second function, and an un-revoked leaked link is the risk revocation exists for. | Plan     |
| Caretaker's answer             | Claim-holders get a distinct "trip called off" | A matching `claim_digest` is unforgeable, so the one bit goes only to someone who already had it.                        | Plan     |
| Claimed slots                  | Not released in this slice                     | The 404 comes from `revoked_at` before `claim_digest` is read, so bulk release changes nothing the caretaker sees.       | Plan     |
| Regeneration of a revoked link | Refused in SQL, not only in the UI             | After a revoke button ships, the React prop becomes the only barrier against minting a permanently dead link.            | Plan     |
| Confirmation UX                | Two-tap arm/confirm                            | The repo's only confirm pattern; no new component, and the action has no undo.                                           | Plan     |
| Generic dead-link copy         | Fixed too                                      | Frame's cheapest real win — no SQL, no security property, no test asserts the string.                                    | Frame    |
| Schema change                  | None                                           | `claim_digest` is an existing second axis, so no `status`/`reason` column is needed.                                     | Frame    |
| Notification to caretaker      | None                                           | Settled precedent in `release_slot.sql:20-25`; the product has zero contact columns.                                     | Research |

## Scope

**In scope:**

- `revoke_period(uuid) returns uuid` — security-invoker guarded write, write-once predicate
- `regenerate_period_token` refuses a revoked period (signature-preserving replace)
- `get_claimed_details` gains a revoked answer **behind** the digest gate
- The reveal call ungated on the invite page; a new `resolveInviteView` kind; two copy fixes
- `POST /api/periods/[id]/revoke` + `RevokePeriodButton` (two-tap) + wiring
- Rule-4 widening entry, two registry rows, and the doc/roadmap/PRD corrections this slice owes

**Out of scope:**

- Un-revoke; a second lifecycle state; a "trip is over" concept
- Bulk release of claimed slots; caretaker notification; cookie invalidation
- Adding confirmation to link regeneration

## Architecture / Approach

Two migrations, one route, one island, one pure function. `revoke_period` is a **named guard over a
permission the owner already holds** — `SECURITY INVOKER`, so `care_periods_update_own` stays the
authorization boundary; scalar return, so a miss arrives as NULL and the route's 404 fires. The
caretaker side is one ordered change inside `get_claimed_details`: resolve the period without the
revoked filter → match `claim_digest` → _then_ branch on `revoked_at`. That order is the entire
correctness argument, and both the digest gate and its plain-NULL miss stay untouched.

## Phases at a Glance

| Phase                     | What it delivers                                                                                    | Key risk                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1. The write              | `revoke_period` + SQL refusal of regeneration, with no caller yet                                   | A grant test that passes with the grant widened — assert the message names the function           |
| 2. The caretaker's answer | The rule-4 widening, ungated reveal, new view kind, both copy fixes                                 | Wrong ordering inside the function discloses the period's existence to a non-holder               |
| 3. The owner's control    | Route + two-tap island + wiring, indicators reconciled, plus three carry-ins from the p1/p2 reviews | Adding a Content-Type or body to the fetch silently forfeits CSRF protection                      |
| 4. Close-out              | Roadmap `Unknowns`, PRD rationale, `data-access.md`, own doc re-read                                | The fourth recurrence of a known staleness class — the sweep is why it is a phase, not a footnote |

**Prerequisites:** S-02 (done since 2026-09-06) and S-04's `release_slot` as the template. Local
Supabase running for `npm run db:reset` and the RLS suite.
**Estimated effort:** ~2–3 sessions across 4 phases; phases 1 and 3 are small, phase 2 carries the
security reasoning.

## Open Risks & Assumptions

- **The widening's safety rests on the branch order**, not on a constraint. A future edit that
  moves the `revoked_at` check ahead of the digest gate turns it into a disclosure — mitigated by a
  test that must fail in both directions, and a manual step that verifies it actually does.
- **Frame confidence was MEDIUM–HIGH**, held below HIGH because an unprimed hostile cross-check was
  still running when it was written. The conclusion it had not yet survived — "the copy fix is the
  cheapest real win" — is cheap enough that being wrong about its ranking costs nothing.
- **Ungating the reveal call adds one bounded RPC** to every dead-link view that carries a claim
  cookie. Bounded at 43 chars before any hashing, so the cost is a primary-key-shaped miss.
- **A page-level two-tap confirm is untested at this scale** — the pattern exists because a dozen
  near-identical row controls sit in a list. Accepted: the action is rarer and heavier than the one
  it borrows from.
- **`revoked_at` stays writable directly** by any authenticated owner; write-once is a product
  decision enforced by `revoke_period`'s predicate, not by the schema. Recorded in the registry.

## Success Criteria (Summary)

- An owner can end a trip's link in two taps, and cannot undo it or mint a replacement — including
  by calling the API directly.
- A caretaker who claimed a slot learns the trip was called off; a stranger's experience is
  unchanged, byte for byte.
- Every document that named S-06 in the future tense now describes shipped behaviour, and the
  roadmap no longer claims this slice had no unknowns.
