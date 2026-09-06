---
change_id: care-period-and-invite-link
title: Okres opieki ze slotami + link zapraszający (S-02)
status: implemented
created: 2026-09-06
updated: 2026-09-06
archived_at: null
---

## Notes

Roadmap slice S-02 (`context/foundation/roadmap.md`). Owner creates a care period (date
range) that generates one slot per day per time-of-day, and gets an invite link scoped to
that period alone.

Settled before planning (roadmap Unknown, owner decision 2026-09-06): **time-of-day is a
fixed set of three — morning / afternoon / evening.** Not configurable in v1. The roadmap
previously assumed two (morning/evening), which would have produced the wrong slot count
per day.

Carries the slice's stated risk: this introduces the unguessable-token access model — a
caretaker reaches the period with no account. That contract is what the "only people with
the link" guardrail rests on, and S-03 claims slots on top of it, so slot generation must
be deterministic.

Patterns to copy from S-01 (`context/archive/2026-07-12-pet-and-instructions/`): migration
+ deny-by-default RLS per table, zod server-side before any DB call, atomic security-invoker
RPC, JSON API route + React island. RLS recipe for a new table:
`context/foundation/test-plan.md` §6.5. Data access contract:
`docs/reference/data-access.md`.

UI uses the S-07 component layer (`src/components/ui/`), per roadmap §Design reference
(design screen: "Nowy wyjazd + link").

Phase 3 reviewed 2026-09-06: `reviews/impl-review-phase-3.md` (10 findings, 8 fixed,
1 dismissed, 1 deferred). Status stays `implementing` — Phase 4 is not built yet. F6 is a
binding Phase 4 requirement: `Referrer-Policy: no-referrer` + `Cache-Control: no-store` for
`/invite/*`.
