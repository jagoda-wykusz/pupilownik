<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Period ↔ Pets Relation — Phase 3

- **Plan**: `context/changes/period-pets-relation/plan.md`
- **Scope**: Phase 3 of 3, commits `cc115c8` + `6b439fb` (epilogue)
- **Date**: 2026-09-06
- **Verdict**: NEEDS ATTENTION at review time → 6 findings triaged; 5 fixed, 1 justified in place
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts (at review time)

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING (F3, F5) |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (F1, F4) |
| Architecture | PASS |
| Pattern Consistency | WARNING (F2, F6) |
| Success Criteria | PASS |

All four automated criteria passed at review time and again after triage: `astro check` 0
errors, `npm run lint` 0 errors, `npm run build` complete, **124/124** tests.

Scope guardrails were verified from git rather than from the plan's own claims: `/pets`,
`src/pages/invite/`, `supabase/` and `context/foundation/roadmap.md` are untouched in this
range. Both explicit "must not be undone" contracts hold — `claimed_by_name` never returns to
`/periods/[id]`, and the list keeps `.limit(PERIODS_PAGE_SIZE)` with both aggregates.

**Why Scope Discipline is PASS despite an unplanned file.** `src/components/ui/Chip.tsx` and the
`NewPeriodForm.tsx` refactor appear in the diff but not in Changes Required. They were recorded
in the plan's Implementation Addenda, with the consumer enumeration `lessons.md` rule 1 demands,
*before* the commit landed — which is precisely the remedy a scope finding would have prescribed.

**Security was clean.** The `pets(id, name)` embed cannot surface another owner's pet: the
`care_period_pets` SELECT policy requires ownership of both parents and `pets_select_own` guards
the table itself. Only `id` and `name` reach the client. The embed is also not a repeat of
phase-2 F8 — that one pulled up to ~9,300 rows per page to compute two integers; this one is
bounded by a household's pet count and every row is rendered.

## Findings

### F1 — The read-only chip barely reads as a pill on `/periods`

- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Safety & Quality
- **Location**: `src/components/ui/Chip.tsx:36`, `src/pages/periods/index.astro:114`
- **Detail**: the read-only tone was `bg-card` + `border-input`, and the list card behind it is
  `bg-card` too. Contrast computed from the tokens in `global.css`, not estimated: the pill edge
  is **1.29:1** light (`#ecdfe5` on `#ffffff`) and **1.40:1** dark (`#443e49` on `#2c2832`),
  against a 3:1 non-text threshold. Text was never the problem (5.6:1 / 5.5:1) — the pill was.
  On `/periods` the chip was effectively muted text in a near-invisible outline, which is close
  to the plain-text rendering this phase's chip work set out to replace. `/periods/[id]` fared
  better only because its chips sit on `bg-background`.
- **Fix A ⭐ (chosen)**: the read-only variant takes the accent tone unconditionally
  (`border-primary bg-secondary text-secondary-foreground`). The design draws its chips in
  exactly one state, and on a screen with nothing to choose between, "these pets are on this
  trip" *is* that state. Measured after: text 4.58:1 light / 6.18:1 dark, pill edge 5.36:1.
  One edit in `Chip.tsx` fixes both screens; the toggle's unselected tone is untouched.
- **Fix B (not chosen)**: keep the muted tone, swap `bg-card` → `bg-muted`. Rejected — the fill
  measures 1.17:1 against the card, weaker than the border it replaces.
- **Verified**: over HTTP after the fix, both owner screens render 2 chips carrying
  `border-primary` and 0 carrying `border-input`; `/periods/new` still renders 2 `border-input`
  (its unselected toggles), confirming the toggle path was not collaterally changed.
- **Decision**: FIXED via Fix A

### F2 — The new shared surface shipped a dead prop and a spread after `className`

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Pattern Consistency / Safety
- **Location**: `src/components/ui/Chip.tsx:28`, `:41-43`, `:57`
- **Detail**: three faults in one place. (1) `aria-describedby` was passed by none of the three
  call sites — dead on arrival. (2) The `<span>` branch discarded it silently: a caller could
  write it, get a clean compile, and get nothing. (3) `{...aria}` sat *after* `className`, so a
  future `<Chip {...props} />` carrying a `className` would override the entire chip geometry —
  and TypeScript's excess-property check does not apply to a JSX spread of a wider-typed value.
- **Fix**: the prop and the spread are both gone; `Chip` now takes exactly `children`,
  `selected`, `onToggle`. `aria-pressed` stays. Field-level aria belongs on the group wrapper
  that owns the error, which is where `NewPeriodForm` already keeps it. A comment records why
  there is deliberately no `className` passthrough.
- **Decision**: FIXED

### F3 — The Phase 3 contract required two facts in `test-plan.md` that were not there

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence
- **Location**: `context/foundation/test-plan.md:240-251`
- **Detail**: the plan's item 4 asked §6.6 to carry "why a single-parent one is an IDOR, and the
  fact that a petless period is representable by design". Verified by grep: "petless" appears
  nowhere in `test-plan.md`. And §6.6 justified the conjunction purely as a *test-coverage*
  argument ("a single-parent version passes every one of those four") without ever saying what
  breaks in production. Neither fact was lost to the project — both live in the S-03 change file
  and the migration comment — but S-03 reading the file the plan designated would not find them.
- **Fix**: §6.6 now states the production consequence (with only the period half, an owner can
  attach another owner's pet to their own trip, and that pet's care instructions reach the
  attacker's caretakers once S-03 ships the reveal) and the petless-period fact with its three
  producers.
- **Decision**: FIXED

### F4 — The chip rows were an unlabelled `<div>` of bare `<span>`s

- **Severity**: 💡 OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality
- **Location**: `src/pages/periods/index.astro:130`, `src/pages/periods/[id].astro:133`
- **Detail**: a screen-reader user heard the pet names as loose text between the date range and
  the slot count, with nothing saying these are the trip's pets. The create form's selector got
  `role="group"` + `aria-labelledby` for exactly this reason in phase-2 F3; the read screens got
  the styling but not the affordance. A new gap rather than a regression — nothing was there
  before this phase.
- **Fix**: `<ul aria-label="Zwierzęta w tym wyjeździe">` with each chip in an `<li>`, on both
  screens. Inside the list card's `<a>` a `<ul>` is still valid flow content.
- **Verified**: over HTTP, both screens render the labelled `<ul>` with `<li>`-wrapped chips.
- **Decision**: FIXED

### F5 — The addendum's verification record claimed more than was measured

- **Severity**: 💡 OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence
- **Location**: `context/changes/period-pets-relation/plan.md:750`
- **Detail**: it read "the two owner screens render read-only `<span>` chips and zero
  `<button>`s". Literally false for `/periods/[id]`, which mounts `RegenerateLinkButton`. What
  was actually counted was elements carrying the chip's geometry — true, and sufficient — but
  the sentence generalised the measurement. This is `lessons.md` rule 2 ("verify a system's
  posture from the catalogue, not from a comment") appearing inside a record written during this
  very phase, and the second time in this change that a written claim outran its measurement
  (the first was phase-2 F2's silently no-op mutation).
- **Fix**: the record now names what was counted (`rounded-[24px]`), gives the per-route numbers,
  and states explicitly that `RegenerateLinkButton` and `Button asChild` are out of its scope.
- **Decision**: FIXED

### F6 — `period.pets.length` read directly, one line from a defensive aggregate read

- **Severity**: 💡 OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Pattern Consistency
- **Location**: `src/pages/periods/index.astro:131`, `src/pages/periods/[id].astro:132`
- **Detail**: the adjacent aggregates use `period.taken[0]?.count ?? 0` while `pets` is read
  directly. Safe in practice — PostgREST returns `[]` and never `null` for an empty to-many
  embed, and `database.types` reflects that — but it looks like an oversight.
- **Decision**: SKIPPED, justified in place. Adding `?? []` would be defensiveness against a
  state the type forbids, and `@typescript-eslint/no-unnecessary-condition` would likely flag
  it. The two reads have genuinely different shapes: a to-many embed is always an array, whereas
  a `count` aggregate is an embed that *can* come back empty, making `[0]` undefined. A comment
  on both pages now says so, so the next reader does not read it as a missed guard.

## Post-triage state

`astro check` 0 errors, lint 0 errors, build complete, **124/124** tests. Five findings fixed,
one justified in place with the reasoning recorded where the next reader will find it. F1 and F4
were re-verified through rendered HTML rather than by compilation alone.
