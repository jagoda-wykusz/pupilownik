---
change_id: owner-occupancy-view
title: Owner occupancy view
status: impl_reviewed
created: 2026-09-08
updated: 2026-09-09
archived_at: null
---

## Notes

Roadmap slice S-04 (`context/foundation/roadmap.md`). FR-006, US-01 (domknięcie). Last
must-have before MVP.

**Scope decision, 2026-09-08 (user): the owner's "release this slot" action ships WITH the
occupancy view, not as a later slice.** It was the inherited follow-up from S-03
(`context/archive/2026-09-06-caretaker-claims-slot/plan.md:1147-1154`, "load-bearing rather
than nice-to-have"). Reason it belongs here: `/periods/[id]` is the screen on which an owner
discovers a forwarded link took every slot, and without the action FR-006 delivers _widzi_
and leaves _reagować_ with nothing behind it. Research confirmed the cost — a route and a
button over permissions that already exist, no schema change, because the owner's grant plus
`care_slots_update_own` already permit nulling the three claim columns and all-null passes
`care_slots_claim_complete`.

Research also settled the slice's other surprise: **there is no database work for the
occupancy view itself.** The owner can already read `claimed_by_name` (verified by an
impersonated select against the catalog, not from a comment); the column is withheld only by
the `.select()` string at `src/pages/periods/[id].astro:69`.

Scoped to the owner's detail screen. The `/periods` list aggregate and the caretaker-facing
side (S-05 / FR-011) are out.
