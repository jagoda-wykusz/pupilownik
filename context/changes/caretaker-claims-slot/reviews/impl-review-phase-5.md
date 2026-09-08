<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Caretaker claims slot — Design layer

- **Plan**: `context/changes/caretaker-claims-slot/plan.md`
- **Scope**: Phase 5 of 5
- **Date**: 2026-09-08
- **Commit under review**: `016f9b5` (+ epilogue `f240c39`)
- **Verdict**: NEEDS ATTENTION → all 10 findings triaged, 10 fixed (2026-09-08)
- **Findings**: 0 critical, 5 warnings, 5 observations

## What passed cleanly

- **No security regression.** `[token].astro:368` hands the island exactly `byDay` (the public
  `get_period_by_token` shape), `token`, and the `hasCapability` boolean. `claimed.name`,
  `caretaker_note` and the sensitive instruction rows stay in server-rendered markup. The only
  other island, `ThemeToggle`, takes only `theme`. No `set:html` / `dangerouslySetInnerHTML`
  anywhere in `src/pages/invite` or `src/components/invite`.
- **The UTC date arithmetic is correct.** Checked 28/29/30/31-day months, a December→January
  boundary, DST, and the `setUTCMonth(+1)` + `setUTCDate(0)` last-day idiom. The overflow trap
  in that idiom is unreachable because `first` is always constructed at day 1.
- **Tokens are genuinely additive.** `--success` / `--notice` are new names defined in all four
  palette blocks and mapped in `@theme inline`; their only consumers are in
  `src/pages/invite/[token].astro`. `--destructive` lost exactly one call site — the invite
  page's sensitive callout, which Phase 3 shipped as an explicit placeholder. Every other
  pre-existing consumer still reads it. No out-of-scope screen changed appearance.
- **No hardcoded colours.** Zero hex literals or `rgb()` in the changed component files;
  everything routes through tokens. `ClaimSlots` also moved from a hand-rolled `[...].join(" ")`
  to `cn()`, matching `Chip.tsx` and `Input.tsx`.
- **Success criteria, re-verified at HEAD without a pipe**: `npm run lint` exit 0 (4 pre-existing
  `no-console` warnings), `npx vitest run` 200/200, `npm run build` exit 0.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Cross-day selection is invisible and unreviewable

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/components/invite/ClaimSlots.tsx:56, 156-166`
- **Detail**: A regression this phase introduced. Before the commit every day and every slot was
  on screen, so `selected` was always fully visible. Now only the selected day's cards render,
  but `selected` is a flat `Set<string>` that persists across day changes. Pick morning on 12
  July, navigate to 14 July, pick evening: the submit reads "Zapisuję się (2)" with one
  selection off-screen and no way to see or drop it. Worse on the 409 path — `claim_slots` is
  all-or-nothing, so the server's refusal names a term the caretaker cannot see. The calendar
  dots encode only `is_claimed`, never "selected but unsubmitted", so a day carrying a pending
  pick looks identical to one that does not.
- **Fix A ⭐ Recommended**: Clear `selected` inside `onSelect`, making a claim always single-day.
  - Strength: Matches the artboard's one-tap model, kills the invisible-state class entirely,
    and makes the 409 sentence always name a term on screen. Three lines.
  - Tradeoff: A caretaker taking slots on three days makes three requests instead of one; each
    is independently all-or-nothing, which is arguably better.
  - Confidence: HIGH — the multi-day path is new in this commit and A36 already records that the
    design never had it.
  - Blind spot: Have not checked whether anything downstream assumes a claim can span days.
- **Fix B**: Keep multi-day; render a selection summary above the submit (`formatDay` +
  `TIME_OF_DAY_LABEL` chips with a remove affordance) and add a "selected" ring state to the
  calendar cell.
  - Strength: Preserves one-request-for-the-whole-trip, which is what the all-or-nothing
    guarantee was built for.
  - Tradeoff: Two new UI states the design does not draw, on top of the two already invented in
    A36.
  - Confidence: MEDIUM — more surface, more to get wrong.
  - Blind spot: Phone-width room for a chip row under the cards.
- **Decision**: FIXED via Fix A — `selectDay` clears the selection on a day change (`ClaimSlots.tsx`).

### F2 — `--success` heading misses 4.5:1 on the ground it actually renders on

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/styles/global.css:56-58`, `src/pages/invite/[token].astro:222`
- **Detail**: The comment in `global.css` justifies `#2f7d52` as "~4.9:1", measured against
  `--background`. The heading renders on `bg-success/10`, not on `--background`. Recomputed:
  composite ground ≈ `#E6EAE3`, ratio **4.13:1**. At `text-[18px] font-bold` that is 13.5pt bold,
  under WCAG's 14pt-bold large-text threshold, so 4.5:1 applies and it fails. Dark (8.29:1) and
  contrast modes pass. This is `lessons.md` §"Weryfikuj posturę… (Rule dokumenty)": a
  present-tense contrast claim written without checking the ground the text lands on.
- **Fix**: Set the heading in `--foreground` and keep `--success` for the tick disc and border
  only — which is what the same comment says the token is for ("body text left on
  `--foreground`"). Correct the comment to name the ground it measured.
- **Decision**: FIXED — heading moved to `--foreground`; the `global.css` comment now names the ground it measured.

### F3 — The amber callout's separation signal is weak, and opts out of `.contrast`'s hard-edge rule

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/invite/[token].astro:300, 350`; `src/styles/global.css:66`
- **Detail**: The callout is the only marker separating the sensitive tier from the public list
  (Progress row 5.6). Measured in light mode: `bg-notice/10` ground 1.07:1, `border-notice/50`
  edge 1.45:1 (independently recomputed: 1.452), lock icon 2.03:1 against 3:1 for graphical
  objects. Two honest qualifiers: the heading text sits on `--foreground`, so the block is
  readable — what is weak is the "this is different" signal; and the alpha-border pattern is
  inherited prior art (`--destructive/40` ≈ 2.07:1), so this is consistent with the repo rather
  than novel. The sharper point is `.contrast`: that mode sets `--border: #000000` for every
  other border precisely to keep edges hard, and these two alpha borders opt out (2.34:1 and
  2.01:1).
- **Fix A ⭐ Recommended**: Drop the alpha in `.contrast` (full-strength `border-notice` /
  `border-success`), and raise the light-mode border to full `border-notice`.
  - Strength: Fixes the mode with an explicit, documented design intent, and leaves the shipped
    `--destructive` prior art alone.
  - Tradeoff: The light-mode edge is still only ~2.0:1 — `#caa53a` at full strength does not
    reach 3:1 against `--background`.
  - Confidence: HIGH for `.contrast`; MEDIUM that light mode is then enough.
  - Blind spot: Manual check 5.6 was approved visually — the measurements may be pessimistic
    about how it actually reads.
- **Fix B**: Also darken `--notice` the way `--muted-foreground` and `--success` were already
  darkened in this file.
  - Strength: Gets light mode to a real 3:1 and follows an established precedent in this exact
    file.
  - Tradeoff: Moves further from the design's `rgb(202,165,58)`, and the token is one commit
    old — churn.
  - Confidence: MEDIUM — no candidate value measured yet.
  - Blind spot: Whether a darker amber still reads as amber and not brown.
- **Decision**: FIXED via Fix A — `border-notice/50` → `border-notice`, `border-success/40` → `border-success`, so no alpha border opts out of `.contrast`.

### F4 — `Input.tsx` enumerates four call sites; grep says three files, eight uses, and "add pet" is not a consumer

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/components/ui/Input.tsx:20-22`
- **Detail**: The new comment reads "the four call sites that predate it (sign-in, sign-up, add
  pet, new period)". Verified: `SignInForm` (2 uses), `SignUpForm` (3), `NewPeriodForm` (3) —
  three files, eight call sites. `AddPetForm.tsx` uses raw `<input>` at :190 and :225 and never
  imports `Input`. Behaviour is correct (`disabled = false` at :37; none of those files are in
  `016f9b5`), but the enumeration was copied from the plan's prose instead of re-derived from the
  code — exactly what `lessons.md` §"Wylicz konsumentów" requires and §"Weryfikuj posturę…
  (Rule dokumenty)" forbids. The same wrong count is now frozen into Progress row 5.5.
- **Fix**: Correct the comment to "three files, eight call sites (sign-in, sign-up, new period)"
  and amend Progress row 5.5 to match.
- **Decision**: FIXED — comment re-derived by grep (eight call sites, three files); Progress row 5.5 amended.

### F5 — "at most two months" is false; three is reachable, and the error is in the code, the addendum AND the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/components/invite/PeriodCalendar.tsx:87`; `plan.md` A35 and Phase 5
  §Changes Required
- **Detail**: Verified — a 31-day period starting 2027-01-30 ends 2027-03-01 and spans January,
  February and March. The code is fine (`months` is an arbitrary-length array, the arrows are
  index-based), but the comment is load-bearing reasoning a future reader could act on, e.g. by
  hardcoding a two-element assumption. Not only an implementation error: the plan's own Phase 5
  §Changes Required says "MAX_SPAN_DAYS = 31 means at most two", and that was propagated into the
  comment and into addendum A35.
- **Fix**: Correct all three to "at most three months", or drop the count and keep only "the
  control is often inert".
- **Decision**: FIXED — corrected in `PeriodCalendar.tsx:87`, addendum A35, and Phase 5 §Changes Required.

### F6 — Month arrows ignore the `disabled` prop

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/invite/PeriodCalendar.tsx:113-134`
- **Detail**: `disabled` locks the day cells (:171) but not the two arrows, so during an in-flight
  claim the caretaker can page the calendar while nothing is selectable.
- **Fix**: Pass `disabled` to both arrow buttons.
- **Decision**: FIXED — both arrows now take `disabled`.

### F7 — Day-cell aria-labels carry no date context

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/invite/PeriodCalendar.tsx:173`
- **Detail**: Yields "12: są wolne terminy". The weekday header is `aria-hidden` and the grid has
  no accessible name, so on a two- or three-month period two cells both announce as "1: …".
- **Fix**: Build the label from `formatWeekday` + `formatDay` (both already exported from
  `period-format` and already imported by `ClaimSlots`), and give the grid an `aria-label` naming
  the displayed month.
- **Decision**: FIXED — labels built from `formatWeekday` + `formatDay`; the grid carries an `aria-label` naming the month.

### F8 — Taken slot cards drop out of the tab order

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/components/invite/ClaimSlots.tsx:176`
- **Detail**: A36 states the taken-card state exists so a caretaker "can tell the rest exist";
  `disabled` removes it from the tab order, so a keyboard-only user never reaches it. Screen
  readers in browse mode still read it, so this is partial.
- **Fix**: `aria-disabled` for the claimed case with a no-op `onClick` guard; keep `disabled` for
  `pending`.
- **Decision**: FIXED — `aria-disabled` for the taken case with an `onClick` guard; `disabled` kept for `pending`.

### F9 — Four small restyles are outside §3 and outside the addenda

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `[token].astro:238-242, 343-353`; `ClaimSlots.tsx:242`; `PeriodCalendar.tsx:37`
- **Detail**: Pet-name typography (15px → 18px `font-heading`), the NOTATKA moved onto
  `--notice`, `autoComplete="given-name"`, and `PeriodCalendar`'s own `disabled` prop. All benign
  and all inside this slice's own screen, but §3 lists only banner / cards / instruction list /
  sensitive callout, and A32–A37 do not cover them.
- **Fix**: One addendum sentence covering all four.
- **Decision**: FIXED — recorded as addendum A38.

### F10 — `PeriodCalendar` default-exports though it is a shared child

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/invite/PeriodCalendar.tsx:82`
- **Detail**: The repo's split is default export for island entrypoints (`NewPeriodForm`,
  `AddPetForm`, `ClaimSlots`) and named export for shared children (`Chip`, `Input`,
  `ServerError`, `Button`). `PeriodCalendar` carries no `client:` directive and is only rendered
  by `ClaimSlots`. Related: `maxLength` was moved from the native attribute to a slice
  (`ClaimSlots.tsx:238`) only because `Input` lacks the prop — and this same commit added a
  `disabled` passthrough for the same call site.
- **Fix**: Switch to a named export; optionally add `maxLength?: number` to `Input` alongside
  `disabled`.
- **Decision**: FIXED — named export; `ClaimSlots` import updated. The `maxLength`-on-`Input` half was not taken.
