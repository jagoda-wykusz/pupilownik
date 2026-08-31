---
change_id: pet-and-instructions
title: Właściciel definiuje zwierzę z instrukcjami (S-01)
status: implemented
created: 2026-07-12
updated: 2026-08-31
---

## Notes

Roadmap slice S-01 (`context/foundation/roadmap.md`). First domain slice: owner
adds a pet with structured care instructions (public + sensitive), owner-isolation
RLS. Establishes the patterns (zod server-side, React-island + JSON API route,
atomic security-invoker RPC, transitive child-table RLS) that later slices copy.
Visual reskin to the hi-fi design is deferred to S-07 (`ui-design-system`).
