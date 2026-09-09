<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Owner Occupancy View (full plan)

- **Plan**: `context/changes/owner-occupancy-view/plan.md`
- **Scope**: Phases 1–3 of 3, commits `106ea26 → a7898e7`
- **Date**: 2026-09-09
- **Verdict**: NEEDS ATTENTION at review time; all five warnings fixed during triage
- **Findings**: 0 critical, 5 warnings, 5 observations

Phases 1 and 2 were each reviewed in isolation (`impl-review-phase-1.md`, `impl-review-phase-2.md`)
and their findings fixed. This review covers what a single-phase pass cannot see.

## Verdicts

| Dimension           | Verdict (at review time) |
| ------------------- | ------------------------ |
| Plan Adherence      | PASS                     |
| Scope Discipline    | PASS                     |
| Safety & Quality    | WARNING                  |
| Architecture        | PASS                     |
| Pattern Consistency | WARNING                  |
| Success Criteria    | WARNING                  |

**The slice's central invariant HOLDS.** `claim_digest` reaches no island prop, no `data-`
attribute and no rendered text — traced end to end. The type-level guard (`CaretakerLabel` has no
digest field) enforced it unassisted when Phase 3 added an island into exactly the list Phase 1
built from digest-grouped data. No security defect anywhere in the slice. The three layers agree
on one contract: `release_slot`'s four-way NULL → the route's single 404 → the island's one
message; no layer re-separates what the one below collapsed.

## Findings

### F1 — The error state overflows the card on a phone

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/periods/ReleaseSlotButton.tsx:89`, `src/pages/periods/[id].astro:258`
- **Detail**: A Phase 3 comment claimed the row's `flex-wrap` meant the island "can drop to its
  own line when it has an error to show, rather than squeezing the name". The wrap happens; the
  rest does not follow, and it was asserted rather than verified. The armed wrapper was
  `shrink-0`, so once wrapped onto its own flex line it sizes at max-content — and `ServerError`
  has no width cap, so the 76-character 404 sentence lays out on one line (~500px plus padding
  and icon) inside a card leaving ~248px on a 320px viewport. Roughly 300px of horizontal
  overflow, on the exact viewport the plan mandates a manual pass at. It survived manual testing
  because Progress 3.4–3.9 exercise the success path and "Nie", never a failure.
- **Fix**: `min-w-0` instead of `shrink-0` on the armed wrapper; the inner button row carries its
  own `shrink-0` so the buttons stay whole while the error text wraps.
- **Decision**: FIXED. Both the Phase 3 and Phase 1 layout comments corrected to describe what the
  code does.

### F2 — `contract-surfaces.md` still said the function has no caller

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `docs/reference/contract-surfaces.md:36`
- **Detail**: The `release_slot` row ended "No caller yet: the owner-side route and island are
  S-04 Phase 3." Both callers shipped in `87347d4`, which touched no doc file. The sentence was
  written during Phase 2 triage and never revisited — the exact failure `lessons.md` §"Weryfikuj
  posturę systemu z katalogu" §Rule (dokumenty) records: a present-tense claim left standing after
  the code moved under it. Notable that Phase 2's own F3 was an edit to this same row.
- **Fix**: Name the caller and its NULL → 404 mapping; retitle the row now the surface spans phases.
- **Decision**: FIXED.

### F3 — `data-access.md` said S-04 added no function, grant or policy

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `docs/reference/data-access.md:188`
- **Detail**: True when Phase 1 wrote it; falsified by Phase 2, which added `public.release_slot`
  and `grant execute … to authenticated`. The paragraph's real lesson — an owner-reader slice
  needs no anon door — survives, and the false clause is load-bearing for it, which makes it more
  likely to be believed than a stray sentence.
- **Fix**: Narrow the claim to the READ; note the release action did add a function, as a guarded
  SECURITY INVOKER surface over an UPDATE the owner already held, not a new door.
- **Decision**: FIXED.

### F4 — Focus was dropped on every state swap

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency (accessibility)
- **Location**: `src/components/periods/ReleaseSlotButton.tsx:68-83`, `:108-121`
- **Detail**: Arming unmounts "Zwolnij" and mounts two different buttons; "Nie" swaps them back.
  React drops focus to `<body>` both times, stranding a keyboard or screen-reader user who then
  re-traverses a list of up to 93 rows to find the confirmation they just opened. No live region
  either, so the armed state was never announced.
- **Fix**: `useRef` + `useEffect` keyed on `armed`, skipping the initial mount so hydrating islands
  do not fight over focus.
- **Decision**: FIXED. Mutation-verified: removing the focus call turns two component assertions red.

### F5 — WCAG 2.5.3 "Label in Name" failure on the confirm

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency (accessibility)
- **Location**: `src/components/periods/ReleaseSlotButton.tsx:101`
- **Detail**: `aria-label` was "Potwierdź zwolnienie terminu: …" over visible text "Na pewno?".
  The visible string is not in the accessible name, so a voice-control user saying "Na pewno"
  could not activate the button. ("Zwolnij" and "Nie" were already fine — each is a prefix of its
  own label.) Separately, while pending the text became "Zwalnianie..." but the static
  `aria-label` still said "Potwierdź", and `aria-label` wins.
- **Fix**: Start the confirm's name with its visible text; swap the name while pending; add
  `aria-busy={pending}`.
- **Decision**: FIXED.

### F6 — CSRF holds, but by an accident of the fetch shape

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/periods/ReleaseSlotButton.tsx:60`, `release.ts` header
- **Detail**: The island sends `{ method: "POST" }` with NO Content-Type. Astro's origin
  middleware refuses a non-safe method carrying no content-type unless the origin matches, so a
  cross-site POST is 403'd before the handler. That is why this route can omit the explicit Origin
  check `invite/claim.ts:52-55` needs — claim.ts sends `application/json`, which lands in the
  middleware's no-check branch. `token.ts` is in the same position and likewise relies on it, so
  the repo is consistent. But the protection is invisible: adding a header or a body later would
  silently remove it.
- **Fix**: Record the dependency in the route's header comment, and pin it from the client side.
- **Decision**: FIXED. Documented in the route, and `tests/component/release-slot-button.test.tsx`
  now asserts the request carries neither headers nor a body.

### F7 — Four route tests re-run RLS tests against the same database

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `tests/api/release-slot.test.ts`
- **Detail**: "another owner's slot", "another period of the same owner", "double release" and
  "re-claimable through the invite link" duplicate the RLS suite rather than covering handler
  branches. Cost is wall-clock, not correctness.
- **Decision**: SKIPPED — the redundancy through the real handler is worth the seconds (user's call).

### F8 — The island had no test at any level

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `src/components/periods/ReleaseSlotButton.tsx`
- **Detail**: Not the arm/disarm cycle, not the 401 redirect, not `pending` disabling both buttons,
  not that failure leaves the control armed. The repo had no component tests at all, so this was
  convention-consistent — but it is the slice's only irreversible action, and F4 and F5 are both
  defects such a test would have caught.
- **Decision**: FIXED. Added the repo's first component test: `happy-dom`,
  `@testing-library/react` and `@testing-library/user-event` as dev dependencies (none introduce
  new advisories — all 28 in `npm audit` are pre-existing), plus a third vitest project
  `component` that needs no Supabase stack. 13 tests covering the two-tap cycle, focus, the
  accessible name, the request shape, all four response branches, a network throw and double
  submit. Known limit, recorded in the file: happy-dom computes no layout, so F1's overflow class
  of bug stays invisible there and appearance remains a manual check.

### F9 — The digest invariant was pinned by a type and a manual step only

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `src/pages/periods/[id].astro`
- **Detail**: The slice's central rule had no runtime guard beyond manual Progress step 1.8
  (view-source for a 64-hex string). No test renders the page.
- **Decision**: FIXED, with a stated limit. A rendered-HTML assertion was attempted first and is
  **not currently possible**: vitest's SSR environment sets `resolve.external`, which
  `@cloudflare/vite-plugin` rejects outright, so a `.astro` file cannot be imported into this
  suite even in an isolated project (spike run and rolled back). Instead
  `tests/unit/period-detail-source.test.ts` asserts over the page SOURCE — `claim_digest` and
  `claimed_by_name` appear nowhere below the frontmatter fence, the island's props carry no
  digest, and (guarding the guard) the frontmatter does still read the column. It cannot catch a
  leak routed through an indirection; it does catch the way the leak would realistically be
  written. Mutation-verified: adding a digest-bearing prop to the island turns it red.

### F10 — Up to 93 `client:load` islands on a month-long period

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `src/pages/periods/[id].astro:295`
- **Detail**: One hydrated React island per claimed term. The plan specified `client:load`, so this
  is compliance rather than drift; `client:visible` is a drop-in if it ever shows in profiling.
- **Decision**: Recorded, no action.

## Success criteria

Re-verified on the final tree, after all triage fixes:

| Check                  | Result                                           |
| ---------------------- | ------------------------------------------------ |
| `npx vitest run`       | 26 files, 260 tests passed (was 24 / 243)        |
| `npm run build`        | exit 0, dev server not running                   |
| `npm run lint`         | exit 0 — 5 warnings, all pre-existing no-console |
| `supabase db advisors` | "No issues found"                                |

All 21 Progress rows are `[x]` and carry a commit SHA.

## Note for the next slice

Two of this review's five warnings (F2, F3) were false present-tense sentences in `docs/reference/`,
both written earlier in this same slice, and both are the failure mode `lessons.md` already
records. The pattern that produced them is specific: a doc sentence written in phase N that
describes phase N's world, in a slice whose later phases change that world. `lessons.md` covers
the rule; what it does not yet say is that a multi-phase slice should re-read its own doc edits at
the close, not only when writing them.
