# Owner Occupancy View — Plan Brief

> Full plan: `context/changes/owner-occupancy-view/plan.md`
> Research: `context/changes/owner-occupancy-view/research.md`

## What & Why

The owner can see that a term is taken but not by whom, and if a forwarded invite link is used
to take every term of a trip there is no way to undo it. This slice adds both — names on the
period detail screen (FR-006, the last must-have) and a per-term release action, which was S-03's
inherited follow-up and ships here by decision rather than being deferred a third time.

## Starting Point

`/periods/[id]` already renders a free/taken grid per day; it reads `claimed_at` rather than
`claimed_by_name` because of a boundary drawn in S-02 and restated in every slice since. Research
verified against the live catalog that both halves of this slice need **no schema capability
added**: the owner can already read the name column, and can already null the three claim
columns, because `care_slots_update_own` predicates on ownership of the parent period and says
nothing about columns. The name is written by an unauthenticated caretaker through a function
whose only name validation is trim, reject-empty, reject-over-80.

## Desired End State

Under each day's grid, the owner sees a list of that day's claimed terms with the caretaker's
name beside each, disambiguated by an ordinal when two different caretakers typed the same name.
The header reports how many distinct caretakers hold the trip. Each claimed term carries a
release control that asks once, then frees the term — after which it is immediately claimable
again through the invite link.

## Key Decisions Made

| Decision              | Choice                                         | Why (1 sentence)                                                                                                             | Source   |
| --------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------- |
| Release in scope?     | Yes, ships with the view                       | `/periods/[id]` is where an owner discovers a griefed trip; without it FR-006 delivers _widzi_ and leaves _reagować_ empty.  | User     |
| Release granularity   | One term at a time                             | Smallest blast radius, and the guarded single-statement UPDATE stays trivially correct.                                      | Plan     |
| Release mechanism     | SECURITY INVOKER RPC + POST route              | Mirrors `regenerate_period_token`; RLS stays the boundary and the guard earns a contract-surfaces row.                       | Plan     |
| Confirmation          | Two-tap inline confirm with an explicit "Nie"  | Stops a misclick without a modal — the repo has no dialog component to reuse.                                                | Plan     |
| Aggregate             | Existing count plus a distinct-caretaker count | One honest new number from the grouping the ordinals already need.                                                           | Plan     |
| Name placement        | Claimed-terms list beneath each day's grid     | Room for a long name and a confirm, and it removes the adjacency where a name could impersonate the `wolne`/`zajęte` labels. | Plan     |
| Same-name caretakers  | Ordinal only when names actually collide       | The badge appears only where the page would otherwise lie; the digest never leaves the server.                               | Plan     |
| Hostile text          | Normalise at display time only                 | The only option that fixes rows already stored, and it leaves the anon write door untouched.                                 | Plan     |
| Owner reads names via | Plain PostgREST + RLS, no new door             | Verified from the catalog — the owner path has been complete since S-02.                                                     | Research |

## Scope

**In scope:** caretaker names on `/periods/[id]`; collision ordinals; distinct-caretaker count;
display-time normalisation of hostile text; a `release_slot` RPC, route and island; the
correction to `data-access.md:177-178`, which misfiles this slice under the anon token model.

**Out of scope:** caretaker-facing name visibility (S-05 / FR-011, whose privacy question is
unresolved and the user's to answer); names on the `/periods` list; any change to `claim_slots`;
bulk release, undo, or notifying the caretaker; realtime; PRD edits.

## Architecture / Approach

Nothing new architecturally — both halves sit in the ordinary F-01 owner path, not the caretaker
token model. A pure `caretaker-name.ts` module owns normalisation and grouping (it takes
`claim_digest` as input and its return type deliberately does not carry it, which is what keeps
the digest off the page). The page widens one `.select()` and renders a list. The release is a
guarded single-statement UPDATE inside a SECURITY INVOKER function, reached through a POST route
that mirrors the existing token route step for step.

## Phases at a Glance

| Phase                   | What it delivers                                                      | Key risk                                                                         |
| ----------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1. Names on the page    | FR-006 closed — names, ordinals, count. Independently shippable.      | The digest leaking into island props or the DOM; layout breaking on a long name. |
| 2. The release function | `release_slot` RPC, grants, RLS suite, contract row. Nothing visible. | Getting the grant posture wrong — `revoke from public` alone does nothing here.  |
| 3. The release control  | Route, island, two-tap confirm, wired in.                             | A destructive action one tap away; 404 must not distinguish its three causes.    |

**Prerequisites:** none — S-03 is archived and both permissions this slice needs already exist.
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- **Ordinals imply an identity the schema does not hold.** `Ania (1)` / `Ania (2)` are per-render
  and mean nothing outside the page; an owner may read them as stable. Accepted — the alternative
  is showing two people as one.
- **Display-time normalisation is an obligation every future reader inherits.** The hostile string
  stays in the database; tightening `claim_slots` was considered and deferred as another slice's
  function.
- **Release is silent for the caretaker.** They discover it by revisiting the link. Accepted for
  v1; a notification has no channel to travel on.
- **Two PRD defects routed, not fixed**: `prd.md:122` promises a release confirmation nothing
  delivered until now, and FR-010's cut text assumes a manual owner remedy that never existed.
  Both belong with the already-queued PRD v2 clarification.

## Success Criteria (Summary)

- An owner opening a trip can tell who holds each term, and cannot be misled into reading two
  caretakers as one.
- An owner can free a wrongly-taken term in two taps, and it is immediately claimable again.
- Nothing a caretaker types can break the page's layout, impersonate its labels, or render as an
  invisible name that still reads as claimed.
