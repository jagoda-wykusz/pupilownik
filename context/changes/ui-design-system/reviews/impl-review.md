<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: UI Design System (S-07)

- **Plan**: context/changes/ui-design-system/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-09-06
- **Verdict**: NEEDS ATTENTION at review time; all six findings triaged, five fixed
- **Findings**: 0 critical, 2 warnings, 4 observations

Success criteria were re-run rather than read off the checkboxes: `npx astro check`
0 errors / 0 warnings, `npm run lint` 0 errors (one pre-existing `no-console` warning in
`src/pages/api/pets.ts:47`, outside this change), `npx vitest run --project unit` 11/11
with the Supabase stack down, `npm test` 36/36, `npm run build` passes. Re-verified after
the triage fixes landed.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING (four documented adaptations, all agreed with the user) |
| Scope Discipline | WARNING (F1) |
| Safety & Quality | WARNING (F2, F3, F5) |
| Architecture | PASS |
| Pattern Consistency | WARNING (F4) |
| Success Criteria | PASS |

## Findings

### F1 — The "no domain screens" guarantee was not kept

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: src/styles/global.css, src/components/ui/button.tsx,
  src/components/auth/ServerError.tsx → consumed at src/components/pets/AddPetForm.tsx:5,247,249
- **Detail**: The plan promised that domain screens would change only through the chrome they
  inherit from `Layout.astro`. Three changes crossed that line by being *consumed* rather than
  edited:
  1. `--radius` 0.625rem → 1rem restyles every `rounded-lg`/`rounded-md` in the app — 12
     occurrences across four out-of-scope files.
  2. `Button`'s default size went h-9 → h-[54px] and the base class gained `font-heading`.
     `AddPetForm.tsx:249` overrides only colours and padding, so its submit button silently grew
     ~50% taller and switched typeface.
  3. `ServerError` moved onto tokens in Phase 2, but `AddPetForm` renders it too — on the navy
     ground where, by the slice's own bg-cosmic reasoning, token colours do not belong. Red on
     navy measures 3.8:1, under the 4.5:1 threshold.

  Same root cause as the four adaptations already in the addenda: during planning, what the auth
  screens use was checked; what *else* uses the same thing was not. This one did not break the
  build, so it went unnoticed until review.
- **Fix A ⭐ Recommended**: Accept as a deliberate consequence and correct the plan's claim.
  - Strength: These screens are reskinned by S-01/S-04 regardless; forcing the old look on them
    is work built to be discarded. `/pets` and `/pets/new` were confirmed legible.
  - Tradeoff: The plan's "What We're NOT Doing" section was untrue as written.
  - Confidence: HIGH — occurrences counted, screens inspected.
  - Blind spot: `ServerError` on navy is the one spot where "cosmetic" becomes "less legible",
    and it was not seen directly — it needs a failed pet save to surface.
- **Fix B**: Pin AddPetForm's button height and ServerError's old ground at the call site.
  - Strength: Restores the letter of the guarantee.
  - Tradeoff: Adds code that exists only to be removed; grows the number of places remembering
    this debt from three to five.
  - Confidence: MED — easy for the button, uglier for ServerError.
  - Blind spot: Unknown whether S-01 starts soon; if it does, the work is wasted.
- **Decision**: FIXED via Fix A — `## What We're NOT Doing` corrected and the consequence
  recorded in `## Implementation Addenda`.

### F2 — Hero subtitle breaks contrast in the high-contrast theme

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/ui/AuthScreen.astro:43
- **Detail**: `opacity-80` on the hero subtitle. Effective contrast: 2.87:1 in light (4.5:1
  required) and 4.79:1 in contrast mode, down from 7.65:1. Dimming text in the mode whose only
  purpose is maximum contrast works directly against it. The design does not ask for this — it
  was added during implementation.
- **Fix**: Remove `opacity-80`; `text-secondary-foreground` already carries the colour.
- **Decision**: FIXED

### F3 — The design's palette fails AA for secondary text

- **Severity**: OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/styles/global.css (`--muted-foreground`)
- **Detail**: `#8A8089` measures 3.53:1 on the page ground and 3.8:1 as a placeholder on white,
  against a 4.5:1 threshold. That colour carries field labels, subtitles and placeholders across
  every auth screen. Dark mode was fine (6.32:1); the problem was light only. The value came from
  the design, but shipping it makes it ours.
- **Fix**: Darken light-mode `--muted-foreground` to `#6F6570` — the tone the design already uses
  for field labels, so the change stays inside its palette. Now 5.18:1 on the ground and 5.57:1 as
  a placeholder.
- **Decision**: FIXED

### F4 — Two of three Banner variants stopped reading as status

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/Banner.astro
- **Detail**: `warning` was painted in `--primary` (the brand accent) and `info` in `--secondary`,
  which equals `--accent` and most surfaces — so a warning looked like ordinary brand chrome. The
  cause: the design supplies no status palette, and the variants were mapped onto whatever tokens
  existed instead of that gap being recorded.
- **Fix**: Keep `error` on `--destructive`; give `warning` and `info` their own amber and blue,
  tuned per theme. Kept local to Banner rather than promoted into the token layer, since it is the
  only status surface in the app. Every pair clears 7:1.
- **Decision**: FIXED

### F5 — Integration project's `exclude` replaced Vitest's defaults

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: vitest.config.ts
- **Detail**: `exclude: ["tests/unit/**"]` replaces Vitest's own default list, which includes
  `**/node_modules/**` and `dist`. Harmless while `include` stays narrow; a latent footgun the day
  someone widens it.
- **Fix**: Spread `configDefaults.exclude` alongside the project-specific entry.
- **Decision**: FIXED

### F6 — Theme-toggle icon flips after hydration

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/components/ThemeToggle.tsx
- **Detail**: With no cookie on a dark-mode OS, the server renders the moon icon ("switch to
  dark") and the client corrects to the contrast icon after hydration. The behaviour is correct —
  an unavoidable consequence of the server not seeing `prefers-color-scheme` — but the flip is
  visible.
- **Fix**: None. Recorded so it is not later reported as a bug.
- **Decision**: ACCEPTED — no change

## Standing debt this slice leaves behind

Three deliberate keeps, each annotated in code with the condition for its removal. Nothing
enforces them beyond those comments; if S-01/S-04 forget, they become permanent.

- `@utility bg-cosmic` in `global.css` — still grounds dashboard, pets/*, Welcome.
- `src/components/Topbar.astro` — untouched; only Welcome imports it.
- `src/components/auth/FormField.tsx` and `PasswordToggle.tsx` — still used by `AddPetForm`.
