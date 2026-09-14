# Pet edit + delete (S-09) — Plan Brief

> Full plan: `context/changes/pet-edit-and-delete/plan.md`
> Research: `context/changes/pet-edit-and-delete/research.md`
> Decisions & rejected variants: `context/changes/pet-edit-and-delete/change.md`

## What & Why

The owner can finally change a pet after creating it, and remove one no live trip covers.
Editing is the point: `prd.md:48` promises the caretaker always sees the current feeding
instructions, and with no write path that promise cannot be kept — a wrong portion size is
permanent today. Deleting is the smaller half, and it exists mainly to be _refused_ safely.

## Starting Point

Measured, not assumed: the database can already do all of this. `authenticated` holds
`UPDATE`/`DELETE` on `pets` and friends, all four policies exist, and an owner's plain
`update pets … where id = <own>` answered `UPDATE 1`. **So this slice adds a guard, not a
capability** — and a guard written in the handler would be bypassable by the same browser
that renders the page.

The cascade's real failure mode was measured too, and it is worse than "the pet disappears":
delete a pet mid-trip and the caretaker's claim, her slot, the trip and the invite link all
survive — she keeps a shift for an animal no longer on the trip, with the instructions gone,
and no mechanism exists by which she could find out.

No `PUT` or `DELETE` exists anywhere in `src/pages/api/` today. This slice ships the first of
each.

## Desired End State

An owner taps a pet card on `/pets` and lands on `/pets/<id>`: a pre-filled form with the
pet's instruction rows, and a delete zone below it. Saving rewrites pet and instructions
atomically, and a caretaker on the live link sees the new text on their next load. Flipping
`is_sensitive` is refused while a claim exists on a covering live trip. Deleting is refused
while any live trip covers the pet, with a sentence naming the remedy: revoke the trip first.

## Key Decisions Made

| Decision                     | Choice                                                              | Why (1 sentence)                                                                                                         | Source   |
| ---------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| Delete semantics             | Block while a live trip covers the pet                              | The cascade silently strands a caretaker; the product already refuses to destroy what a caretaker sees (PRD Open Q #5).  | Change   |
| Where the block lives        | SQL predicate inside a named RPC                                    | Measured: the owner's browser can call PostgREST directly, so a handler check is decoration.                             | Research |
| Instruction text after claim | Always editable                                                     | That is the PRD guardrail; both caretaker doors read live, so the read half already works.                               | User     |
| `is_sensitive` after claim   | Frozen on existing rows                                             | `true→false` publishes the house code to everyone holding the link, with no intermediate state.                          | User     |
| Freeze hardness              | Soft — delete + re-add still reveals, accepted                      | Defends against an accidental click, not against the owner's intent; they authored the data.                             | User     |
| Child-row sync               | Match by `id` (update / insert / delete)                            | The only shape in which a per-row freeze is expressible at all — delete-all destroys row identity.                       | Plan     |
| Delete predicate             | `revoked_at is null` only, no dates                                 | "The trip has ended" is deliberately not a concept here; a date rule would be the first derived-from-date state.         | Plan     |
| Table grants                 | Left in place; RPC is the intended, not enforced, writer            | Same posture `contract-surfaces.md:36` records for `release_slot`; revoking would break every test teardown.             | Plan     |
| Form & ground                | New `EditPetForm` on the design system, new page on `bg-background` | Ground and primitives are one choice: a token form on themeless navy is broken in 2 of 3 themes, incl. the default.      | Plan     |
| Screen shape                 | `/pets/<id>` is the edit screen; delete zone below                  | One new page; keeps `/pets` at zero islands, which the render sweep pins.                                                | Plan     |
| Verb                         | `PUT` (body is the complete desired state)                          | Rows absent from the payload are deletions — that is a replacement, not a patch.                                         | Plan     |
| Test scope                   | Close the positive-path RLS gaps this slice leans on                | Today's suite stays green if `pets_update_own`/`pets_delete_own` are dropped — it describes the layer, doesn't guard it. | Plan     |
| E2E                          | Fix four stale prose claims, no new spec                            | E2E is deliberately outside `ci:gate`, so a spec here would gate nothing.                                                | Plan     |

## Scope

**In scope:** `update_pet_with_instructions` and `delete_pet` RPCs with their guards; `PUT`
and `DELETE` on `/api/pets/[id]`; `petIdSchema`, `updatePetSchema`, `PET_MESSAGES`; the
`/pets/<id>` page; `EditPetForm` and `DeletePetButton`; making the pet card a link; the
positive-path and guard tests; registry rows; the S-09 roadmap row.

**Out of scope:** migrating `/pets` and `/pets/new` off `bg-cosmic`; touching `AddPetForm`,
`FormField` or `PasswordToggle`; revoking table grants; hardening the freeze; any date
predicate; a new E2E spec; bulk revoke, un-revoke or period editing; the cascade and
enum-drift tests that this slice does not touch.

## Architecture / Approach

Two named `security invoker` RPCs carry the invariants RLS cannot express; RLS stays the
authorization boundary. Each returns a **scalar** so a miss is honestly NULL (a composite
would answer a row of NULLs and the route's 404 would never fire), and each signals a
business refusal with `errcode = 'PT409'`, which PostgREST maps straight onto an HTTP 409 —
that is what keeps the refusal from collapsing into the 404 path. Routes validate with zod
before any DB call, carry an explicit `Origin` check, and log code and message only. The UI
is one new token-ground page with two islands.

Two predicates do similar-sounding work and are deliberately **not** the same:
_freeze_ = live trip **and** a claimed slot; _delete-block_ = live trip, no claim condition.

## Phases at a Glance

| Phase                        | What it delivers                                                               | Key risk                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Editing, end to end       | Update RPC + freeze, `PUT`, `/pets/<id>`, `EditPetForm`, card link, tests      | The child-row sync is the slice's one real unknown; a freeze checked against the payload instead of storage is a no-op that looks like a guard. |
| 2. Deleting, and refusing to | `delete_pet` + block, `DELETE`, `DeletePetButton`, tests, four doc corrections | First action in the repo that destroys its own page — the success path navigates rather than reloading, with no precedent to copy.              |

**Prerequisites:** local Supabase stack running (`npm run db:start`); no `npm run dev` server
alive during verification, since `astro check` and `git commit` rebuild `node_modules/.vite`
and will wreck it (`lessons.md`).
**Estimated effort:** ~2–3 sessions; Phase 1 is roughly twice Phase 2.

## Open Risks & Assumptions

- **The freeze is soft by decision.** Delete + re-add reproduces the reveal in two steps.
  Recorded as a property, not a defect, with both closure variants considered and rejected.
- **The RPC is a convention, not a fence.** Table grants stay, so a determined owner can
  still write directly — the same admitted gap as `release_slot`.
- **A pet on an old, unrevoked trip is unremovable** until the owner revokes that trip. A
  consequence of having no date concept; the 409 message must make the remedy obvious.
- **`/pets` will look inconsistent** — two navy screens without a theme toggle, one token
  screen with one — until S-01's reskin.
- Instruction ids are owner-supplied input; the with-check that refuses adopting a stranger's
  row is measured but was untested before this slice.

## Success Criteria (Summary)

- An owner can fix a feeding instruction mid-trip and the caretaker sees it on next load —
  the PRD guardrail is satisfiable for the first time.
- An owner cannot strand a caretaker: deleting a pet on a live trip is refused with an
  actionable sentence, and refused in the database, not just in the UI.
- The suite would go red if either guard were removed — verified by mutation, per predicate.
