# UI Design System (S-07) Implementation Plan

## Overview

Establish the visual system the whole product will be built in: three colour themes from the
hi-fi design, self-hosted Quicksand/Nunito, a server-resolved theme with no flash, a minimal
set of base components, and the existing auth screens plus shared chrome reskinned onto them —
in Polish. Domain screens stay with their own slices; this slice gives them the vocabulary.

## Current State Analysis

- `src/styles/global.css` is the **untouched shadcn default palette** — neutral oklch tokens for
  light and `.dark`, plus `@utility bg-cosmic` (a navy gradient belonging to the starter, used at
  `src/pages/auth/signin.astro:8`). Nothing in it reflects the design.
- `@custom-variant dark (&:is(.dark *))` already exists (`src/styles/global.css:4`), so the
  class-based dark strategy is wired at the CSS level — **nothing toggles it**.
- **shadcn/ui is configured but nearly unused**: `components.json` (new-york, baseColor `neutral`),
  `cn()` in `src/lib/utils.ts`, `cva` available — yet `src/components/ui/` contains only
  `button.tsx`, still on stock shadcn variants.
- **The auth components bypass the token layer entirely.** `src/components/auth/FormField.tsx:5`
  hardcodes `bg-white/10 border ... text-white placeholder-white/40`; `src/components/Topbar.astro`
  hardcodes `text-blue-100/70` and `text-purple-300`. Swapping tokens alone changes nothing on
  these screens — they must be rewritten against tokens.
- `src/layouts/Layout.astro` loads no fonts, declares `lang="en"`, and defaults the title to
  "10x Astro Starter".
- Auth copy is English ("Sign in", "Email is required" — `src/components/auth/SignInForm.tsx:23-30`)
  while S-01 and the design are Polish.
- `src/pages/pets/index.astro` and `pets/new.astro` exist from S-01 and consume `Layout.astro`, so
  they inherit whatever the shared chrome does.

## Desired End State

Opening `/auth/signin` shows the design's login screen: warm off-white ground, plum accent,
Quicksand headings over Nunito body, 16px radii, Polish copy. A control in the chrome cycles
light → dark → high-contrast; the choice survives a reload and the server renders the chosen
theme directly, so there is no flash of the wrong one. With no choice yet made, the OS preference
decides. `npm test` covers the theme-resolution logic; the look is confirmed by eye against
`context/design/Pupilownik Hi-fi.html`.

### Key Discoveries:

- **Astro Fonts is stable in Astro 6, not experimental.** `fonts` is a top-level config key
  (`node_modules/astro/dist/core/config/schemas/base.js:311`); `fontProviders.google()` downloads
  and self-hosts, `<Font>` from `astro:components` emits the `@font-face` + preload, and the
  `subsets` field takes `latin-ext` — required for Polish diacritics.
- **`tests/setup.ts` is a global setupFile whose `beforeAll` demands a live local Supabase**
  (`tests/setup.ts:42-84`). A pure-logic unit test would therefore need Docker. Vitest 4 supports
  `test.projects`, which separates a no-setup `unit` project from the existing integration suite —
  and fills test-plan §6.1, still marked "TBD".
- The design ships **three** modes ("Tryb jasny", "Tryb ciemny", "Tryb wysokiego kontrastu"), each
  a complete palette. Extracted anchors, in order background / surface / text / muted / accent /
  accent-surface / border:
  - light `#FAF6F3 #FFFFFF #2C2530 #8A8089 #9C5470 #F6EAEF #ECDFE5`
  - dark `#211D24 #2C2832 #F2ECF0 #A79DA4 #E59AB6 #3A2A33 #443E49`
  - contrast `#FFFFFF #FFFFFF #000000 #2C2530 #8A0F49 #EFE6EA #000000`
- Design geometry: 16px radius on inputs/buttons, 15px on the square instruction badge, 20px on
  chips; the primary button carries `drop-shadow(rgba(156,84,112,0.32) 0 12px 24px)` rather than a
  box-shadow; inputs are 52px tall with a 1.5px border, buttons 54px.

## What We're NOT Doing

- **No domain screens.** `/pets`, `/pets/new`, dashboard, caretaker calendar and owner panel keep
  their current markup; S-01…S-04 own them (roadmap §Design reference). Only the chrome they
  inherit through `Layout.astro` changes.
- **No domain components.** Pet card, instruction row with time badge, sensitive-data callout and
  chip are in the design but land with the slices that use them — building them now is the
  over-investment the roadmap's risk note warns about.
- **No Google sign-in.** The design shows a "Kontynuuj z Google" button; this slice styles no such
  control, because the auth backend has no Google provider. Out of scope entirely.
- **No password reset.** The design shows "Nie pamiętasz hasła?"; there is no reset flow behind it.
- **No visual regression tests.** Test-plan §7 excludes Tailwind class assertions; Playwright is
  deferred past Phase 4.
- **No shadcn component pull.** We keep the shadcn token contract and `cn`/`cva`, but do not run
  `npx shadcn add`.

## Implementation Approach

Bottom-up in three phases, each independently verifiable. Phase 1 lays the token, font and theme
machinery with nothing consuming it yet — proven by flipping the class by hand and by a unit test
on the resolution logic. Phase 2 builds only the components the auth screens actually need, so the
system is exercised by real usage rather than designed in the abstract. Phase 3 rewrites the auth
pages and shared chrome onto those components and moves the copy to Polish.

The token layer keeps shadcn's variable names (`--background`, `--primary`, `--border`, …) rather
than inventing a parallel vocabulary: `button.tsx` and any future `shadcn add` keep working, and
the design's palette simply becomes the values behind the familiar names.

## Critical Implementation Details

**Theme resolution must not fight itself.** Three sources can specify a theme — an explicit cookie,
the OS preference, and the light default. The rule is: an explicit class on `<html>` always wins;
`prefers-color-scheme` applies only when no class is present. Write the media-query block so it
cannot override an explicit choice (scope it to the no-class case), or a user who picks light on a
dark-mode OS gets a dark app.

**The server never learns `prefers-color-scheme`.** With no cookie, the SSR output carries no theme
class and the OS preference is honoured purely in CSS. This is the one case the class mechanism
cannot cover, and it is why the light palette must live on bare `:root` rather than inside a
`.light` class.

**The contrast variant must be declared.** `@custom-variant dark` exists; the contrast mode needs its
own custom variant declared the same way, or `contrast:` utilities silently do nothing.

## Phase 1: Tokens, fonts & theme resolution

### Overview

Replace the starter palette with the design's three themes, self-host the two font families, resolve
the theme on the server from a cookie, and give the project a home for pure unit tests.

### Changes Required:

#### 1. Token layer

**File**: `src/styles/global.css`

**Intent**: Carry the design's three palettes in shadcn's variable contract so every component —
existing and future — inherits the design by using the names it already uses. Remove the starter's
navy `bg-cosmic` utility, which no longer has a consumer after Phase 3.

**Contract**: Light palette on bare `:root`; `.dark` and `.contrast` blocks redefine only what
changes. Add `@custom-variant contrast (&:is(.contrast *))` beside the existing dark variant. Map
the design anchors onto `--background`, `--card`, `--foreground`, `--muted-foreground`, `--primary`,
`--accent`, `--border`/`--input`, `--ring`, keeping `--primary-foreground` white in light/contrast
and dark-plum on the pink dark accent. Set `--radius` to the design's 16px. Add a
`@media (prefers-color-scheme: dark)` block scoped so it applies only when no explicit theme class
is present. Extend `@theme inline` with the two font-family variables Astro generates.

#### 2. Font pipeline

**File**: `astro.config.mjs`

**Intent**: Self-host Quicksand and Nunito so no request reaches Google at render time and Polish
diacritics render.

**Contract**: Add a top-level `fonts: [...]` array with two entries using `fontProviders.google()` —
Quicksand (`--font-heading`, the 700/800 weights the design uses) and Nunito (`--font-body`,
400/600/700/800). Both set `subsets: ["latin", "latin-ext"]`, `display: "swap"`, and system-stack
`fallbacks`. Import `fontProviders` from `astro/config`.

#### 3. Theme resolution

**File**: `src/lib/theme.ts` (new)

**Intent**: One pure function owning the cookie-to-class decision, so the rule is testable without a
browser, a server, or Docker.

**Contract**: Export the theme union (`light | dark | contrast`), the cookie name constant, and
`resolveTheme(cookieValue: string | undefined)` returning the class to place on `<html>` — the empty
string when the value is absent or unrecognised, so CSS falls through to the OS preference. Export
the cookie name so the client toggle and the layout cannot drift apart.

#### 4. Server-side theme application

**File**: `src/layouts/Layout.astro`

**Intent**: Put the resolved theme class on `<html>` during SSR so the first painted frame is already
correct, and emit the font faces.

**Contract**: Read the cookie via `Astro.cookies.get(...)`, pass through `resolveTheme`, and apply
the result as the `class` on `<html>`. Render `<Font cssVariable="--font-heading" preload />` and the
body equivalent inside `<head>`. Set `lang="pl"` and change the default title off the starter string.
Leave the existing `Banner`/`missingConfigs` block and `<slot />` intact.

#### 5. Test project separation

**File**: `vitest.config.ts`, `tests/unit/theme.test.ts` (new)

**Intent**: Give pure-logic tests a place to run without the Supabase stack, and cover the resolution
rule.

**Contract**: Convert the config to `test.projects` with two entries — `integration` (the current
`setupFiles`, `testTimeout`, and the existing `tests/{rls,api,middleware}` plus `harness.smoke`) and
`unit` (no setup file, `tests/unit/**`). `resolve.alias` stays shared. The new test asserts each
recognised cookie value maps to its class, and that absent/garbage values yield the empty string
(the OS-preference fallthrough).

### Success Criteria:

#### Automated Verification:

- Unit project runs with the Supabase stack **down**: `npx vitest run --project unit`
- Full suite still passes with the stack up: `npm test`
- Linting passes: `npm run lint`
- Build passes and fonts are emitted: `npm run build`

#### Manual Verification:

- Setting the theme cookie by hand to each of the three values renders that palette on first paint,
  with no flash of another theme (check with network throttling).
- With the cookie cleared, toggling the OS dark-mode setting switches the app.
- Polish diacritics (ą ę ł ń ó ś ź ż) render in both families, not in a fallback face.

**Implementation Note**: After automated verification passes, pause here for manual confirmation
before Phase 2.

---

## Phase 2: Base component layer

### Overview

Build only the components the auth screens consume, written against the Phase-1 tokens.

### Changes Required:

#### 1. Button variants

**File**: `src/components/ui/button.tsx`

**Intent**: Reshape the stock shadcn variants into the design's button styles without changing the
component's API, so existing call sites keep working.

**Contract**: Keep `cva` and the exported `buttonVariants`. Redefine `default` as the design's
primary (plum fill, white label, Quicksand 700, the plum drop-shadow) and `outline` as the bordered
white button. Sizes gain the design's 54px control height. Radius comes from `--radius`, not a
hardcoded `rounded-md`.

#### 2. Text input with reveal

**File**: `src/components/ui/Input.tsx` (new)

**Intent**: The design's field — uppercase Nunito 700 label above a 52px rounded input, with an
inline plum "Pokaż"/"Ukryj" affordance on password fields and an error state.

**Contract**: Props for `id`, `label`, `type`, `value`, `onChange`, `error`, and an optional
`revealable` flag that renders the toggle and swaps `type` between `password` and `text`. The label
must be a real `<label htmlFor>`; the reveal control a `<button type="button">` with an accessible
name that reflects state, so it neither submits the form nor goes unannounced.

#### 3. Surface & layout primitives

**File**: `src/components/ui/Card.tsx`, `src/components/ui/SectionHeading.tsx`, `src/components/ui/Divider.tsx` (new)

**Intent**: The rounded white panel the auth form sits on, the Quicksand section title, and the
design's "LUB" rule between stacked actions.

**Contract**: All three are presentational and token-only — no colour literals. `Divider` takes an
optional centred label. `Card` accepts `className` for per-screen width so pages compose rather than
fork it.

#### 4. Error banner

**File**: `src/components/auth/ServerError.tsx`

**Intent**: Move the existing server-error display onto tokens and Polish copy.

**Contract**: Same props; restyle to the design's callout treatment using `--destructive`. Keep it
`role="alert"` so the message is announced.

#### 5. Theme toggle

**File**: `src/components/ThemeToggle.tsx` (new)

**Intent**: The control that cycles the three themes and persists the choice.

**Contract**: A client island. Reads the current theme from the `<html>` class on mount (the server
already decided it), cycles light → dark → contrast on activation, writes the cookie via
`document.cookie` using the name exported from `src/lib/theme.ts` (path `/`, a long `Max-Age`,
`SameSite=Lax`), and swaps the class on `documentElement` so the change is immediate without a
reload. It must be a `<button>` with an accessible name naming the theme it switches **to**, and it
must render a sensible label before hydration.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Full suite still green: `npm test`

#### Manual Verification:

- Each component matches the design at mobile width in all three themes.
- The reveal toggle shows and hides the password and does not submit the form.
- Keyboard-only: every control is reachable, the focus ring is visible on all three grounds.

**Implementation Note**: After automated verification passes, pause here for manual confirmation
before Phase 3.

---

## Phase 3: Auth reskin & shared chrome

### Overview

Rewrite the auth screens and the chrome every page inherits onto the Phase-2 components, in Polish.

### Changes Required:

#### 1. Shared chrome

**File**: `src/components/Topbar.astro`, `src/components/Banner.astro`

**Intent**: Remove the hardcoded starter palette so every page — including S-01's, which inherit this
chrome — sits on the design. Give the theme toggle a home.

**Contract**: Replace every literal colour class with token classes. Mount `ThemeToggle` in the
`Topbar`. Polish labels ("Wyloguj się", "Zaloguj się", "Załóż konto"). `Banner` keeps its `variant`
API and moves to `--destructive`.

#### 2. Auth pages

**File**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`

**Intent**: Replace the glassmorphism shell with the design's screen — greeting heading, subtitle,
card, and the desktop hero panel the design shows at wide widths.

**Contract**: Drop `bg-cosmic` and the `bg-white/10 backdrop-blur` wrapper in favour of `Card` on the
token background. Polish headings and the cross-links between sign-in and sign-up. At `lg` and above,
lay out the design's two-column hero; below it, the single mobile column. Page `title` props in Polish.

#### 3. Auth form components

**File**: `src/components/auth/FormField.tsx`, `PasswordToggle.tsx`, `SubmitButton.tsx`, `SignInForm.tsx`, `SignUpForm.tsx`

**Intent**: Retire the hardcoded field components in favour of the Phase-2 `Input`, and move all
user-facing strings — including client-side validation messages — to Polish.

**Contract**: `FormField` and `PasswordToggle` are superseded by `Input` and should be deleted rather
than restyled, with their call sites updated. `SubmitButton` delegates to the `Button` primary
variant. `SignInForm`/`SignUpForm` keep their existing validation logic, submit behaviour and
`serverError` prop; only markup and message strings change. Do not touch the POST targets or the
`client:load` directives.

#### 4. Cookbook note

**File**: `context/foundation/test-plan.md`

**Intent**: §6.1 "Adding a unit test" has read "TBD — see §3 Phase 1" since the plan was written; the
unit project created in Phase 1 is the answer.

**Contract**: Replace the §6.1 placeholder with the recipe: pure-logic tests live in `tests/unit/`,
run without the Supabase stack under the `unit` project, and must not import app modules that reach
for the network. Add a §6.6 bullet for this slice.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Full suite green, including the auth-gating tests that drive these routes: `npm test`
- No orphaned references to the deleted components: `grep -rn "FormField\|PasswordToggle" src/` returns nothing

#### Manual Verification:

- Sign-in, sign-up and confirm-email match the design at mobile and desktop width in all three themes.
- A real sign-in still works end to end, and a wrong password still surfaces the server error.
- Client-side validation messages appear in Polish.
- `/pets` and `/pets/new` (untouched by this slice) still render and are legible under the new chrome
  and all three themes — they will look unfinished, but must not be broken.
- No flash of the wrong theme on a hard reload of any auth page.

**Implementation Note**: After automated verification passes, pause for manual confirmation. Then the
slice is ready for `/10x-impl-review`.

---

## Testing Strategy

### Unit Tests:

- `resolveTheme` — each valid cookie value maps to its class; absent, empty and unrecognised values
  return the empty string so CSS falls through to `prefers-color-scheme`. This is the only piece of
  this slice with branching logic, and the only place a silent regression could hide.

### Integration Tests:

- None new. The existing auth-gating suite already drives `/dashboard` and `/pets` through the real
  middleware; it must stay green as the pages change, which is the regression signal that matters.

### Manual Testing Steps:

1. `npm run db:start` (or the reduced service set if the analytics/storage containers fail), then
   `npm test`.
2. Visit `/auth/signin` with no theme cookie and the OS in dark mode — the app should be dark.
3. Cycle the toggle through all three themes; hard-reload after each and confirm the theme survives
   with no flash.
4. Sign in for real; confirm the redirect works and `/pets` renders under the new chrome.
5. Submit the sign-in form empty and confirm the Polish validation messages.

## Performance Considerations

Self-hosted fonts remove a third-party connection from the critical path but add preloaded `.woff2`
files; keeping `subsets` to `latin` + `latin-ext` holds them small. The theme class is resolved
during SSR, so no client work happens before first paint — the toggle is the only new hydrated
island on the auth pages, and it is a single button.

## Migration Notes

No data or schema change. `bg-cosmic` and the `FormField`/`PasswordToggle` components are deleted;
grep for consumers before removing them. Users with no theme cookie are unaffected — they simply get
the OS preference.

## References

- Design source: `context/design/Pupilownik Hi-fi.html` (sections "Tryb jasny", "Tryb ciemny",
  "Tryb wysokiego kontrastu")
- Roadmap slice: `context/foundation/roadmap.md` §S-07
- Token contract to preserve: `src/styles/global.css` `@theme inline` block
- Components that must be rewritten, not restyled: `src/components/auth/FormField.tsx:5`,
  `src/components/Topbar.astro:7`
- Astro fonts API: `node_modules/astro/dist/assets/fonts/providers/index.d.ts`
- Existing suite that must stay green: `tests/middleware/auth-gating.test.ts`
- Harness entry points: `docs/reference/contract-surfaces.md`

## Implementation Addenda

Adaptations made during implementation, recorded so a later review can tell drift
from decision.

### Phase 1 — `bg-cosmic` kept, not removed

The phase contract said to delete `@utility bg-cosmic` because it "no longer has a
consumer after Phase 3". That was wrong: it has **seven** consumers, and only three
are Phase 3's auth screens. The other four — `src/pages/dashboard.astro`,
`src/pages/pets/index.astro`, `src/pages/pets/new.astro`, `src/components/Welcome.astro`
(plus `src/components/pets/AddPetForm.tsx`) — are domain screens this slice does not
touch, and they hardcode light-on-dark text (35 occurrences). Removing the navy ground
would drop them onto the new off-white background as white-on-off-white, i.e. unreadable,
and would make the plan's own check 3.9 unsatisfiable.

Decided with the user: keep the utility, with a comment naming when it retires (when
S-01/S-04 reskin those screens). Cost: the app is two-styled between this slice and
those — auth on the design, domain screens still navy.

### Phase 1 — check 1.7 confirmed for Nunito only

Nothing uses `font-heading` yet — Quicksand is first consumed by the Phase 2
components — so only the Nunito half of "both families" was observable. The
Quicksand face is downloaded and preloaded (verified in `dist/`), but its
diacritics get their visual confirmation in Phase 2.

### Phase 1 — manual checks needed a DevTools workaround

Because `bg-cosmic` was kept (above), every route paints over the themed `body`,
so 1.5/1.6 are not visible by simply loading a page. They were verified by removing
the `bg-cosmic` class in DevTools and reading `getComputedStyle(document.body)`.
From Phase 3 the auth screens no longer need this workaround.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Tokens, fonts & theme resolution

#### Automated

- [x] 1.1 Unit project runs with the Supabase stack down: `npx vitest run --project unit`
- [x] 1.2 Full suite still passes with the stack up: `npm test`
- [x] 1.3 Linting passes: `npm run lint`
- [x] 1.4 Build passes and fonts are emitted: `npm run build`

#### Manual

- [x] 1.5 Each cookie value renders its palette on first paint, no flash
- [x] 1.6 With no cookie, the OS dark-mode setting switches the app
- [x] 1.7 Polish diacritics render in both families, not a fallback face

### Phase 2: Base component layer

#### Automated

- [ ] 2.1 Type checking passes: `npx astro check`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Build passes: `npm run build`
- [ ] 2.4 Full suite still green: `npm test`

#### Manual

- [ ] 2.5 Each component matches the design at mobile width in all three themes
- [ ] 2.6 Reveal toggle shows/hides the password and does not submit the form
- [ ] 2.7 Keyboard-only reachable; focus ring visible on all three grounds

### Phase 3: Auth reskin & shared chrome

#### Automated

- [ ] 3.1 Type checking passes: `npx astro check`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Build passes: `npm run build`
- [ ] 3.4 Full suite green including auth-gating: `npm test`
- [ ] 3.5 No orphaned references to the deleted components

#### Manual

- [ ] 3.6 Auth screens match the design at mobile and desktop in all three themes
- [ ] 3.7 Real sign-in works end to end; wrong password still surfaces the server error
- [ ] 3.8 Client-side validation messages appear in Polish
- [ ] 3.9 `/pets` and `/pets/new` still render legibly under the new chrome in all three themes
- [ ] 3.10 No flash of the wrong theme on a hard reload of any auth page
