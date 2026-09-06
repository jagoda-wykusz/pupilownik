# Period ↔ Pets Relation — Plan Brief

> Full plan: `context/changes/period-pets-relation/plan.md`
> Research: `context/changes/caretaker-claims-slot/research.md` (§1 and §6 cover this scope)

## What & Why

A care period must cover the owner's chosen pet(s). Nothing links the two today, so the
caretaker's invite link cannot reach `care_instructions` and **FR-008 is unimplementable** —
not merely unimplemented. This change adds the relation, which unblocks S-03 and closes scope
that S-02 shipped without recording.

## Starting Point

`care_periods` has no pet reference of any kind. `care_instructions` hangs off `pets` with a
per-row `is_sensitive` flag, so the eventual reveal is a row filter. `create_period_with_slots`
takes four arguments and generates one slot per day per time-of-day for the *period*, with no
notion of pets. S-02's plan claims the design's "Nowy wyjazd" screen as delivered — twice — but
shipped it without the `KTÓRE ZWIERZĘTA` selector and without listing the omission in its
§What We're NOT Doing. This change is that unfinished scope, not new functionality.

## Desired End State

An owner creating a trip picks which pets it covers from a chip multi-select matching the
design, and cannot create one without at least one pet. Both `/periods` and `/periods/[id]` name
the trip's pets. The database refuses to link a period to a pet the caller does not own, in
either direction. The caretaker's page is deliberately untouched — S-03 owns all of FR-008.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Cardinality | Many pets per period, join table | `prd.md:88` records it as a decision and four design screens agree; the design shows a *subset* being picked, which a `pet_id` column cannot express | Research |
| Reveal scope | Relation only; `/invite` untouched | S-03 owns FR-008 as one coherent reveal, and the only anon door gets touched once instead of twice | Plan |
| "≥1 pet" invariant | Enforced in the RPC only | The RPC is the app's only insert path; the alternatives (deferred trigger, `on delete restrict`) cost more than a useless-but-uncorrupt period does | Plan |
| Pet deletion | Cascade the join row | Matches every other FK in the schema; the alternative deadlocks the owner, since no slice owns period editing | Plan |
| Existing petless periods | Leave them | Zero destructive risk, and `seed.sql` seeds no periods so `db:reset` is clean anyway | Plan |
| `NOTATKA` field | Assigned to S-03 | It is caretaker-facing content that needs a reveal rule, and S-03 owns that rule | Plan |
| Owner screens | Both list and detail show pets | The owner must see what they picked; pets-per-period is small, so this is not a repeat of impl-review F8 | Plan |
| Selector shape | Chip multi-select, all pets | Matches the design 1:1; search and scrolling solve a problem this product does not have yet | Plan |
| Slot granularity | Unchanged — slot belongs to the period | Matches the shipped unique constraint and the design's single slot card with one merged instruction list | Plan |
| RPC signature change | Drop-and-recreate | An added parameter creates an overload that inherits Supabase's default anon grants and leaves the old signature reachable | Research |

## Scope

**In scope:** `care_period_pets` join table with both-parents RLS, an index, the anon revoke; a
drop-and-recreate of `create_period_with_slots` taking `p_pet_ids uuid[]` with its grant posture
re-established; regenerated types; a new isolation suite; repair of the three test files the
signature change reaches; `pet_ids` through the zod schema and the create route; a chip
multi-select in the create form; pets on both owner screens; a seeded period; registry and
test-plan updates; the S-03 hand-off note.

**Out of scope:** instructions anywhere (all of FR-008 is S-03's); the `NOTATKA` field
(assigned to S-03); a database constraint for "≥1 pet"; backfill of existing petless periods;
per-pet slots; period editing; pet search in the selector; any reskin of `/pets`.

## Architecture / Approach

A join table, not a column — the design has the owner picking a subset, and `care_periods`
already has live rows plus a `db:push` step in the documented workflow. Ownership is enforced by
RLS on that table under `security invoker`, with a predicate that is a **conjunction over both
parents**: the caller must own the period *and* the pet. A single-parent predicate would be an
IDOR — owner A could attach their own period to owner B's pet, and B's instructions would leak
through A's invite link once S-03 ships. Because enforcement is RLS under an invoker function, a
foreign pet id rolls the whole create back rather than being caught in the handler.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema, RLS & RPC signature | Join table, both-parents policies, index, anon revoke, recreated RPC, types, new isolation suite, repaired test files | The grant posture silently not surviving the drop-and-recreate — this repo has three recorded instances of a described posture the database did not have |
| 2. Owner API & pet selector | `pet_ids` through zod and the route, chip multi-select, pets SSR-supplied to the form | An owner with zero pets getting a form they cannot submit |
| 3. Read screens, contracts & hand-off | Pets on both owner screens, registry rows, §6.6 note, S-03 hand-off | The list-query embed being read as a regression of impl-review F8 |

**Prerequisites:** none. S-02 is shipped and archived; the local Supabase stack must be running
for the integration suite.
**Estimated effort:** ~2–3 sessions across 3 phases. Phase 1 is the bulk of it and cannot be
split — the join table without the RPC is unusable, and the signature change breaks two test
files the moment it lands.

## Open Risks & Assumptions

- **A petless period stays representable, deliberately.** Three paths produce one: a raw insert,
  a pre-existing row, and deleting the last linked pet. Nothing is corrupt, but S-03's caretaker
  page must tolerate it rather than assume at least one pet.
- **The both-parents RLS predicate is the security boundary of this change.** If it is written
  with one `exists` instead of two, nothing fails visibly — the leak only becomes reachable when
  S-03 ships the reveal. The isolation suite's two with-check cases exist solely to catch this.
- **The recreated RPC's grants must be verified from the catalog**, not from the migration text.
- **Assumption**: pets-per-owner stays small enough for an unfiltered chip list. The plan records
  search and scrolling as explicitly out of scope, so this is a decision to revisit, not a bug.

## Success Criteria (Summary)

- An owner picks pets when creating a trip, cannot create one without any, and sees the chosen
  pets afterwards on both the list and the detail screen.
- The database refuses a cross-owner link in either direction, proved by two with-check cases
  alongside the four standard §6.5 denial surfaces.
- S-03 is unblocked: a period now has a path to its pets' instructions, and the two things S-03
  inherits are written down rather than rediscovered.
