---
change_id: period-pets-relation
title: Period pets relation
status: planned
created: 2026-09-06
updated: 2026-09-06
archived_at: null
---

## Notes

A care period must cover the owner's chosen pet(s), so the caretaker's invite link can reach
`care_instructions`. Today nothing links the two: `public.care_periods` has no `pet_id` and no
join table, and `care_instructions` hangs off `pets`.

**Why this exists now.** It is a hard prerequisite for S-03 (`caretaker-claims-slot`), which is
blocked on it: without this relation, FR-008 (`must-have`) is unreachable in *both* halves —
public instructions on arrival and sensitive ones after the claim. Owner decision, 2026-09-06:
the relation ships as its own change, sequenced first, so S-03 keeps its roadmap outcome whole.

**This is unfinished S-02 scope, not new functionality.** S-02's plan claims the design's
"Nowy wyjazd" screen as delivered — twice — but shipped it without the `KTÓRE ZWIERZĘTA` pet
selector, and did not record the omission in its §What We're NOT Doing. That is the failure
mode `context/foundation/lessons.md` exists to prevent, and this change inherits it. Frame the
work accordingly.

**Research is already done — do not redo it.** `context/changes/caretaker-claims-slot/research.md`
§1 and §6 cover exactly this scope:

- **Cardinality settled: many pets per period.** `prd.md:88` (FR-002's recorded resolution,
  "jeden okres może obejmować kilka zwierząt o różnych instrukcjach") plus four design screens
  ("KTÓRE ZWIERZĘTA" with both chips selected; "Burek & Mru" on three others). Nothing
  contradicts it. The PRD has no §Data Model section, so that resolution is the authority.
- **A join table, not a `pet_id` column.** The design shows the owner picking a *subset* of
  their pets per trip, and `care_periods` already has live rows plus a `db:push` step in the
  documented workflow, so `pet_id not null` cannot be added directly. Note the trade-off: with
  a join table, "a period must have at least one pet" is **not** expressible as a column
  constraint — it needs a trigger or RPC-level enforcement, which sits uneasily with
  `20260906094254`'s own argument that a constraint in the database outranks a requirement in
  a document.
- **`create_period_with_slots` must be drop-and-recreate, not an added parameter.** An added
  parameter creates a second function (an overload) that inherits Supabase's default
  `anon`/`service_role` execute grants — the gap this repo has been bitten by three times —
  and leaves the old signature reachable. `create or replace` preserves grants only on an
  unchanged argument list. Re-establish the `revoke … from public, anon, service_role` /
  `grant … to authenticated` pair in the same migration and verify with
  `has_function_privilege`. Keep `security invoker`, so RLS on the join table is what rejects
  a period naming another owner's pet.
- **Blast radius is enumerated**: 9 DB objects, 11 app files, 4 test files, generated types,
  and three reference docs (`contract-surfaces.md`, `data-access.md`, `test-plan.md`). All four
  RLS test files seed periods through the RPC, and `care-periods.isolation.test.ts` uses raw
  inserts — a join table breaks none of them, a `not null` column breaks all the raw ones. A
  new join table needs its own isolation suite per `test-plan.md` §6.5 (all four denial
  surfaces).
- **Grep noise to avoid**: `dist/server/chunks/*.mjs` (build output, gitignored) and the stale
  worktree at `.claude/worktrees/distributed-snacking-dusk/`. Scope greps to
  `src tests supabase docs context/foundation`.

**Open, and not assigned to any slice.** The design's "Nowy wyjazd" screen also draws a
period-level `NOTATKA` free-text field ("Klucze u sąsiadki, mieszkanie 4…"), dropped by S-02
in the same silence as the pet selector. Its content overlaps the `is_sensitive` instruction
concept. Someone must decide whether it is a real requirement or a design artifact — this
change is the natural place to settle it, or to explicitly park it.
