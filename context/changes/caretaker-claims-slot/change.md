---
change_id: caretaker-claims-slot
title: Caretaker claims slot
status: impl_reviewed
created: 2026-09-06
updated: 2026-09-08
archived_at: null
---

## Notes

Roadmap slice S-03 (`context/foundation/roadmap.md`). FR-007, FR-008, FR-009, US-02 + the
atomicity NFR.

Two owner decisions, settled 2026-09-06 before planning (full reasoning in `research.md`
§Decisions):

1. **Sensitive instructions are revealed per CLAIMER, not per claim event.** Accepts the
   lightweight caretaker identity `prd.md:116` deferred to v2, as a per-claim capability
   secret — no login, no profile, no history. Needs a claim secret (digest-only), a third
   function surface for the sensitive read, and the repo's first server-set HttpOnly cookie.
2. **The period ↔ pet relation is a separate change.** Consequence: S-03 as scoped cannot
   deliver FR-008 in either half, because nothing links a period to `care_instructions`.
   **Sequenced as a hard prerequisite: the relation change ships FIRST.** S-03 therefore
   keeps its roadmap outcome whole. **This change is blocked until that one lands.**

What the shipped S-02 schema already gives this slice: `care_slots_claim_complete` makes the
claim provably all-or-nothing, `unique (period_id, slot_date, time_of_day)` gives a slot one
identity, and `data-access.md` §token model states the rule that a caretaker capability
extends the function set rather than adding an anon policy.

Hard constraint found in research: `get_period_by_token` is `STABLE`, so it cannot be
extended to write. The claim must be a new `VOLATILE` function.

## Inherited from `period-pets-relation` (planned 2026-09-06)

Two things this slice owns, decided while planning the relation change. Both are recorded here
so S-03 does not rediscover them:

1. **The design's period-level `NOTATKA` field is S-03's.** It is caretaker-facing free text
   whose content overlaps `is_sensitive` (the design fills it with "Klucze u sąsiadki,
   mieszkanie 4…"), so it needs the same reveal rule S-03 is writing. S-02 dropped it silently
   along with the pet selector; the relation change parks it here rather than repeating that
   silence.
2. **The relation now exists — `public.care_period_pets`, shipped by `period-pets-relation`.**
   A period reaches its pets, and through them `care_instructions`, so FR-008 is implementable.
   The path is `care_periods → care_period_pets → pets → care_instructions`, and PostgREST
   resolves the many-to-many automatically, so a `pets(...)` embed needs no mention of the join
   table. Sensitivity is a per-ROW flag (`is_sensitive`), so the reveal is a row filter, not a
   field mask.
3. **A period with ZERO pets is representable, by decision.** The relation change enforces
   "at least one pet" only inside `create_period_with_slots`, so a raw insert, a pre-relation
   row, or deleting the last linked pet all produce one. Nothing is corrupt — the period is
   merely useless. **S-03's caretaker page must tolerate it** rather than assume at least one
   pet exists, or FR-008's instruction block will crash on a state the database permits.
