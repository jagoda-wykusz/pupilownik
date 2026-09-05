---
change_id: ui-design-system
title: System wizualny wg hi-fi designu + reskin ekranów auth (S-07)
status: implementing
created: 2026-09-05
updated: 2026-09-05
archived_at: null
---

## Notes

Roadmap slice S-07 (`context/foundation/roadmap.md`). Horizontal slice: establish the
visual system (color tokens, Quicksand/Nunito, radii, shadows, light/dark) plus the base
component set, and reskin the existing `signin`/`signup` screens to it. Domain screens
(pets, care periods, caretaker calendar, owner panel) are NOT built here — S-01…S-04 own
them and consume these components (see roadmap §Design reference).

Design source: `context/design/Pupilownik Hi-fi.html` (+ `Pupilownik Hi-fi_files/`).

Two unknowns to settle during planning (from the roadmap):
- Component layer: extend the starter's shadcn/ui, or hand-rolled components on Tailwind 4
  tokens? Owner: team. Non-blocking.
- ~~Dark mode~~ — SETTLED 2026-09-05 by the user: **in v1, with a UI toggle.** Tailwind
  `dark` class strategy plus a persisted user choice, not `prefers-color-scheme` alone. The
  plan must therefore cover the toggle component, where the choice is persisted, and
  avoiding a flash of the wrong theme under SSR on Cloudflare Workers.

Kept deliberately minimal: tokens + the components auth actually uses now; the rest arrives
with the domain slices, to avoid over-investing in a component system before the screens
that would consume it exist.
