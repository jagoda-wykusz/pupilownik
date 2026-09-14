---
date: 2026-09-13T22:50:00+02:00
researcher: jagoda.wykusz
git_commit: 05ea896e95282dc5ccd72c3e0fcc0696673256d0
branch: master
repository: pupilownik
topic: "Pet edit + delete (slice S-09): what exists, what the cascade really does, and what the block must be made of"
tags: [research, codebase, pets, care-instructions, care-period-pets, rls, cascade, owner-actions]
status: complete
last_updated: 2026-09-13
last_updated_by: jagoda.wykusz
---

# Research: Pet edit + delete (slice S-09)

**Date**: 2026-09-13T22:50:00+02:00
**Researcher**: jagoda.wykusz
**Git Commit**: 05ea896 (`master`, 1 commit ahead of `origin/master` — unpushed, so no GitHub permalinks)
**Repository**: pupilownik

## Research Question

What exists today around editing and deleting a pet, so that a plan for S-09 is grounded
rather than assumed? Scope agreed with the user before this pass: one slice, two phases
(edit, then delete), delete **blocked** while a live trip covers the pet, full 10x workflow.

Two claims were carried into this research from `change.md` as _unverified premises_, and
`context/foundation/lessons.md` ("Zdanie o tym, co się stanie po usunięciu bramki, jest
prognozą — zmierz je, zanim je zapiszesz") required measuring them rather than repeating
them. Both were measured. One held and sharpened; one turned out to understate the problem.

## Summary

**The database is already able to do everything this slice needs, and that is the finding
that shapes the plan.** Measured from the catalog, not read from a migration comment: role
`authenticated` holds `UPDATE` and `DELETE` on `pets`, `care_instructions` and
`care_period_pets`, and all four per-operation policies exist on each table. An owner can
already edit and delete their own pet today with a plain PostgREST call. So S-09 **adds a
guard, not a capability** — the same situation `revoke_period` was in, and the plan should
say so in those words.

The consequence is sharp and is the single most important input to phase 2: **a block that
lives only in the route handler is decoration.** The owner's browser holds the anon key and
a session; it can call PostgREST directly and bypass any check written in TypeScript. The
block has to live in SQL.

**The cascade premise held, and it is worse than `change.md` recorded.** Measured end to end
(transaction rolled back, nothing persisted): an owner deleted a pet that was attached to an
active, unrevoked trip on which a caretaker had already claimed a term. The delete
succeeded. The caretaker's view through the still-live invite link went from two pets to
one. The pet's two instruction rows (one of them `is_sensitive`) were cascade-deleted.
**The caretaker's claim survived — "Ania" is still booked on that term, the trip is still
active, and the link still works.** So the failure mode is not "the pet disappears"; it is
that a volunteer stays committed to a shift for an animal that no longer exists in the
trip, with the feeding instructions gone, and no signal of any kind.

**Phase 1 (edit) is a PRD guardrail, not a CRUD nicety.** `prd.md:48` and US-02's acceptance
criterion (`prd.md:74`) both require the caretaker to see the current instructions. Both
caretaker doors read the tables live at call time, so the read half already satisfies that
guardrail; with no write path it is unsatisfiable in practice.

**The history was silent in one place that matters, and the user closed it during this
pass.** Nothing in `context/` had ever decided whether instruction text or `is_sensitive` may
change _after_ a caretaker has claimed and read it. Decided 2026-09-13: **text stays editable
always** (that is the guardrail), **`is_sensitive` on an existing row freezes once any slot on
a live trip covering that pet is claimed**. See Open Questions #1 and `change.md` for the
derived defaults and the one caveat — the freeze is soft, because delete + re-add reproduces
the reveal in two deliberate steps.

## Detailed Findings

### 1. System posture, read from the catalog (measured 2026-09-13)

`lessons.md` forbids taking a posture claim from a migration comment. Read from
`information_schema.role_table_grants` and `pg_policies` on the local stack:

| table               | `anon`       | `authenticated`                                               | policies present                |
| ------------------- | ------------ | ------------------------------------------------------------- | ------------------------------- |
| `pets`              | _(no grant)_ | SELECT, INSERT, UPDATE, DELETE (+REFERENCES/TRIGGER/TRUNCATE) | select/insert/update/delete_own |
| `care_instructions` | _(no grant)_ | same                                                          | select/insert/update/delete_own |
| `care_period_pets`  | _(no grant)_ | same                                                          | select/insert/update/delete_own |

`anon` appears in **no** row of that grant query — the revoke in `20260906094254` is real,
not just described. Both UPDATE policies carry `using` **and** `with check`
(`ma_with_check = t` for `pets_update_own` and `care_instructions_update_own`).

Three writes measured under `set local role authenticated` with the owner's JWT claims:

1. `update public.pets set name=…, breed=… where id=<own>` → **`UPDATE 1`**. The positive
   path works and, per §4, **no test covers it**.
2. `update public.care_instructions set pet_id=<another owner's pet> where id=<own>` →
   **`ERROR: new row violates row-level security policy`**. The with-check defends against
   re-pointing an instruction into someone else's pet. This matters because a natural edit
   payload carries instruction ids; the defence exists, and §4 shows nothing pins it.
3. Cross-tenant update of another owner's pet — not reached in that transaction (the abort
   from (2) swallowed it); it is already covered by `tests/rls/pets.isolation.test.ts:50`.

**Planning consequence.** A route-level "you may not delete a pet that is on a live trip"
check is bypassable by the same browser that renders the page. The block must be a SQL
predicate — inside a named RPC whose `delete` is the only intended path, and/or a trigger —
and the plan must state which, because an RPC alone repeats the `release_slot` caveat
recorded at `contract-surfaces.md:36`: "the owner's UPDATE grant plus `care_slots_update_own`
still permit a direct write, so this is a convention the schema does not enforce."

### 2. The cascade, measured end to end (2026-09-13)

Setup inside one transaction, rolled back: owner with two pets (`Burek` with a public and a
sensitive instruction, `Mruczek` with a public one), an active trip over 2026-10-01..02 with
6 slots, both pets linked, and one slot claimed by "Ania" through `claim_slots`.

| probe                                                   | before             | after `delete from pets where id = Burek` |
| ------------------------------------------------------- | ------------------ | ----------------------------------------- |
| pets visible to the caretaker via `get_period_by_token` | `Burek`, `Mruczek` | **`Mruczek` only**                        |
| pets in the post-claim reveal (`get_claimed_details`)   | 2                  | —                                         |
| `care_period_pets` rows for the trip                    | 2                  | **1**                                     |
| `care_instructions` for Burek                           | 2                  | **0**                                     |
| `care_slots` for the trip                               | 6                  | 6                                         |
| claimed_by_name                                         | `Ania`             | **`Ania`**                                |
| trip active (`revoked_at is null`)                      | yes                | **yes**                                   |

The delete itself answered `DELETE 1` under the owner's own RLS context — nothing refused it.

**What this corrects in `change.md`.** The note said the cascade "po cichu wyjmuje zwierzę z
trwającego wyjazdu". True, but incomplete: the claim, the slot and the trip all survive. The
caretaker keeps an obligation and loses the instructions for it. The sensitive row going
with it is the one benign part — the house code does not outlive the pet.

**What it does NOT show.** Nothing was measured about notification, because there is no
notification layer to measure (`prd.md` §Non-goals: no push/email in v1). "No signal" here
means "no mechanism exists", not "a mechanism stayed silent".

### 3. The house pattern a new route must copy

Every owner-side mutating route repeats the same sequence literally — there is no middleware
and no handler factory, and `revoke.ts:8-10` names the repetition as the pattern. In order:
auth check (`context.locals.user` → 401); _sometimes_ an explicit `Origin` check; the
request-scoped client; zod on the path param; the `SECURITY INVOKER` RPC; an error log of
**code and message only**; `NULL → 404` with misses deliberately indistinguishable; a local
`jsonResponse` helper duplicated per file.

Two things bind this slice hard:

- **`/api/pets/[id]` is ungated by middleware.** `PROTECTED_ROUTES` (`src/middleware.ts:8`)
  is `["/dashboard", "/pets", "/periods"]` matched with `startsWith`, and `/api/pets` does
  not start with `/pets`. The middleware is a _session loader_ everywhere and a _gate_ only
  on those three page prefixes. The handler's own 401 is the only gate.
- **The PATCH route MUST carry the explicit Origin check.** Astro's `security.checkOrigin`
  defaults to true but only inspects a non-safe request that carries **no** `Content-Type`;
  a JSON body lands in the no-check branch (`claim.ts:13-15`). Today `pets.ts` has no Origin
  check at all and sends `Content-Type: application/json` from `AddPetForm.tsx:87` — so the
  existing create route is already in that hole. Do not copy the omission forward; the three
  lines are at `claim.ts:54-58` / `revoke.ts:62-65`.

For the delete island, `RevokePeriodButton.tsx` is the template, including the property that
**the escape button is rendered first** (`:127-138`) so a fast double-tap on a phone cannot
arm-then-confirm, and the `mounted`-ref focus effect (`:36-49`) that both moves focus and
_announces_ the state change. One thing is genuinely new: every existing island either
reloads or swaps local state, because none destroys its own page. A pet delete does — so it
needs `window.location.href = "/pets"`, and that is the one line with no precedent to copy.

### 4. Test coverage: the negative half exists, the positive half does not

Exhaustive grep of `tests/` for `pets`, `care_instructions`, `create_pet_with_instructions`,
`pet_species`, `is_sensitive`, `SPECIES`, and for `export const (PATCH|PUT|DELETE)` across
`src/` and `tests/` (zero hits — no non-POST/GET verb exists anywhere in the app today).

Covered: cross-tenant UPDATE is a 0-row no-op (`tests/rls/pets.isolation.test.ts:50`),
cross-tenant DELETE removes nothing (`:70`), self-UPDATE cannot reassign `owner_id` (`:79`),
and the pets→`care_period_pets` cascade leaves a petless-but-standing period
(`tests/rls/care-period-pets.isolation.test.ts:157-169`).

**Not covered, and each gap is load-bearing for this slice:**

- An owner successfully updating their **own** pet. Both existing UPDATE tests stay green if
  `pets_update_own` were dropped entirely — they assert refusals, not permissions.
- An owner deleting their own pet, other than incidentally inside the cascade test.
- An owner updating or deleting their own `care_instructions` row (negative only today).
- Re-pointing `care_instructions.pet_id` to another owner's pet on UPDATE — the with-check
  that §1 measured as working is pinned by nothing.
- The pets→`care_instructions` cascade: no test deletes a pet and asserts its instructions
  are gone.
- `pet_species` (Postgres enum) vs `z.enum(["dog","cat","other"])` (`schemas/pet.ts:46`):
  zero hits for `pet_species` in `tests/`, so a drift between the two would go unnoticed.

Also: `tests/render/island-props.test.ts:80` records `/src/pages/pets/index.astro` as having
**0 islands**. A delete button on the list page raises that floor and fails that test until
updated — a deliberate migration, not a surprise.

### 5. Shared consumers that must migrate deliberately

Per `lessons.md` ("Wylicz konsumentów, zanim zmienisz coś współdzielonego"):

- `createPetSchema` — exactly one consumer (`src/pages/api/pets.ts:3,27`). `CreatePetInput`
  and `CreateInstructionInput` are exported and have **zero** consumers.
- `SPECIES_OPTIONS` — exactly one (`AddPetForm.tsx:132`); an edit form is its second.
- `AddPetForm` — exactly one (`pets/new.astro:21`), takes **no props at all**, and hard-wires
  method, URL, success redirect and copy. Its instruction rows are keyed by **array index**
  (`:188`) and carry no `id` — the load-bearing weakness for an edit form that must round-trip
  server-side instruction ids.
- **Four sites assert today that no pet delete affordance exists** and would be falsified by
  phase 2: `tests/e2e/auth.setup.ts:22-23`, `tests/e2e/fixtures/owner.ts:24`,
  `tests/e2e/seed.spec.ts:35`, and the codified rule at `docs/reference/e2e-rules.md:66`.
  Each must either migrate or be named in §What We're NOT Doing.
- `AddPetForm` deliberately does **not** use the design-system `Input`/`Textarea`; it sits on
  the navy ground, and `context/archive/2026-09-05-ui-design-system/plan.md:499-506` records
  that migrating it would leave it light-on-light. Any edit form reusing its markup inherits
  that conflict.

### 6. Why edit/delete was left out, and what that argument rested on

S-01 excluded it as **scope and speed**, never for a safety reason —
`context/archive/2026-07-12-pet-and-instructions/plan.md:31`: "No edit / delete of pets or
instructions — S-01 is add + list own. Edit/delete is later scope."

The absence was then used as an argument elsewhere: the atomic create RPC exists _because_
there is no edit path ("a pet saved without its instructions is unrecoverable",
`plan.md:43`). Shipping phase 1 removes that premise — worth stating, since two later slices
reused it verbatim.

**S-08 considered the cascade and decided the opposite way, on a premise this slice
changes.** `context/archive/2026-09-06-period-pets-relation/plan-brief.md:36`: "| Pet
deletion | Cascade the join row | Matches every other FK in the schema; the alternative
deadlocks the owner, **since no slice owns period editing** |". That premise is now false in
the relevant direction: S-06 shipped `revoke_period`, so an owner blocked from deleting a pet
has a way out — revoke the trip, then delete. The plan must re-state this rather than
silently inherit S-08's rejection of `on delete restrict`.

What S-08 did **not** consider, explicitly (searched, no statement found): what a pet
deletion means for a caretaker who has already claimed a slot and read that pet's
instructions. Its whole discussion is framed as "does the owner's screen crash / is the row
corrupt". The caretaker-facing consequence is first articulated in this change.

### 7. RPC vs plain PostgREST — there is no rule, only a pattern to argue

`data-access.md:60-69` states the default in the opposite direction: "Prefer `SECURITY
INVOKER` (the default) everywhere else. Never add `SECURITY DEFINER` just to silence a
permission error." And `data-access.md:268-281` adds the corollary that an owner-facing slice
"does not land under these rules at all".

The operative convention is behavioural, drawn from `release_slot` and `revoke_period`: a
**named INVOKER RPC when the write carries an invariant RLS cannot express** — multi-row
atomicity, a guard predicate, or columns that must move together. Both halves of S-09 fall on
that side (a pet edit must sync `pets` + N instruction rows in one transaction; a delete must
be refused while a live trip covers it). But it is a pattern to _argue_ in the plan, not a
rule to cite: **no statement found** requiring it.

Registry duty: `contract-surfaces.md:3-5` — "add a row when a new shared entry point ships."
Each new RPC owes one.

## Code References

- `src/middleware.ts:8` — `PROTECTED_ROUTES`; `/api/*` is not gated by it
- `src/pages/api/pets.ts:20-30,45-48,67-77` — JSON parse, `safeParse`, the **superseded**
  logging rationale, the 22003 / 22P05 / 22021 mappings
- `src/pages/api/periods/[id]/revoke.ts:38-40,62-65,72-75,91,95-97` — the full owner-mutation
  checklist and the only explicit Origin check on an owner route
- `src/pages/invite/claim.ts:13-15,54-58` — why a JSON route gets no framework CSRF help
- `src/components/periods/RevokePeriodButton.tsx:36-49,127-138,162-172` — focus effect,
  escape-first ordering, the WCAG 2.5.3 decision rule
- `src/lib/schemas/pet.ts:16-22,30,44-53` — `textField` (NUL rejection), instruction schema
  with **no `id`**, `z.enum` duplicating the DB enum
- `src/components/pets/AddPetForm.tsx:33,38-48,87-95,188` — instruction state, index keys,
  hard-wired POST/redirect
- `supabase/migrations/20260712204748_pets_and_instructions.sql:12,28,46-47,63-72` — schema,
  `on delete cascade` to instructions, grants, the four pet policies
- `supabase/migrations/20260906165005_period_pets_relation.sql:19-20` — the join table's two
  `on delete cascade` FKs
- `supabase/migrations/20260910120000_revoke_period.sql` — the guard-predicate shape a delete
  block should copy (`revoked_at is null` making a second call a no-op)
- `tests/rls/care-period-pets.isolation.test.ts:157-169` — the only existing cascade assertion
- `tests/render/island-props.test.ts:80` — the island floor a delete button will raise

## Architecture Insights

- **Guards, not capabilities.** Both phases add named surfaces over permissions the owner
  already holds. The schema will still permit a direct write, exactly as
  `contract-surfaces.md:36` admits for `release_slot` — unless this slice also revokes the
  table-level DELETE grant, which is a decision the plan must make explicitly rather than
  inherit.
- **The reveal is a row filter, not a field mask** (`data-access.md:283-295`): the two
  caretaker doors partition instructions on `is_sensitive`. An edit that flips that flag
  moves a row between two audiences with no intermediate state.
- **Live reads by construction.** Both doors query at call time, which is what makes phase 1
  satisfy the PRD guardrail with no cache or invalidation work — and equally what makes a
  mid-trip edit visible to a caretaker immediately.
- **Misses collapse to 404 on purpose, but the block must not.** `revoke.ts:29-31` collapses
  misses because the owner "has no use for the difference" and a distinct answer would be an
  existence oracle. Neither reason holds for the live-trip block: the owner _does_ need to
  know to cancel the trip first, and it is their own pet, so there is no oracle. It needs its
  own status and its own actionable sentence.

## Historical Context (from prior changes)

- `context/archive/2026-07-12-pet-and-instructions/plan.md:31,43` — edit/delete excluded as
  scope; the no-edit-path premise behind the atomic create RPC
- `context/archive/2026-09-06-period-pets-relation/plan-brief.md:36`, `plan.md:115-124` — the
  cascade decision, the "petless period is representable" ruling, and the rejection of
  `on delete restrict`
- `context/archive/2026-09-09-close-care-period/` + `docs/reference/data-access.md:215-221` —
  the precedent for withdrawing sensitive content from a caretaker mid-trip, "with no push
  notification and no grace period", recorded as an accepted cost rather than a defect
- `context/foundation/prd.md:48,74` — the "Instrukcje zawsze aktualne" guardrail that phase 1
  finally makes satisfiable
- `context/foundation/prd.md` §Open Questions #5 — the precedent that the product does not
  silently destroy what a caretaker sees

## Related Research

- `context/archive/2026-09-06-caretaker-claims-slot/research.md` — the tier split and the
  reveal doors
- `context/archive/2026-09-09-close-care-period/research.md` — what revocation costs a
  caretaker; the closest analogue to "the owner takes something away mid-trip"

## Open Questions

1. ~~**May instruction text or `is_sensitive` change after a caretaker has claimed and read
   it?**~~ **RESOLVED 2026-09-13 by the user** — text stays editable always (it is the PRD
   guardrail); `is_sensitive` on an **existing** row is frozen once any slot on a live trip
   covering that pet is claimed. Full wording, the three defaults I derived from it, and the
   soft-block caveat (delete + re-add reproduces the reveal in two steps) are in `change.md`.
   Note for the plan: this freeze predicate is **not** the delete-block predicate — the freeze
   additionally requires a claimed slot, the delete block does not.

2. **Does the block look at `revoked_at is null` only, or also at dates?** PRD Open Question
   #4 records that "the trip has ended" is deliberately **not** a concept in this product —
   no anon door has a date predicate. A date-aware block would be the first derived-from-date
   state in the codebase. Recommended default: `revoked_at is null` alone.
3. **Does this slice revoke the table-level `DELETE`/`UPDATE` grant on `pets`?** Without it
   the SQL block is the only real fence but the _convention_ (RPC as the single writer) stays
   unenforced, exactly as `release_slot`'s registry entry admits. With it, every existing
   direct-delete caller breaks — including `tests/e2e/fixtures/invite.ts:99-123` and
   `tests/helpers/auth.ts`, which tear down through the owner's own client.
4. **How does the edit RPC sync child rows?** Carried from `change.md` and still open.
   Constraint discovered here: the instruction schema has no `id` field and `AddPetForm`
   keys rows by array index, so round-tripping ids is new work in both the schema and the
   form, not just the RPC.
5. **Does the roadmap get an S-09 row before or during the plan?** `roadmap.md` has no S-09
   and its last update is 2026-09-11. The S-08 precedent (next free number, placed by
   dependency, never renumbered) is behavioural, not written down.
