# UI Design System (S-07) — Plan Brief

> Full plan: `context/changes/ui-design-system/plan.md`

## What & Why

Pupilownik currently looks like the starter it was scaffolded from: a navy glassmorphism login
screen in English, sitting on shadcn's default neutral palette. A hi-fi design exists
(`context/design/Pupilownik Hi-fi.html`) and every remaining slice is supposed to be built in its
vocabulary. This slice establishes that vocabulary — tokens, fonts, themes, base components — and
proves it by reskinning the screens that already exist.

## Starting Point

shadcn/ui is configured but nearly unused (only `button.tsx` exists). The class-based dark variant is
already declared in `global.css`, but nothing toggles it. Critically, the auth components hardcode
their colours (`FormField.tsx:5`, `Topbar.astro:7`), so replacing tokens alone would change nothing
on screen — they have to be rewritten, not restyled. No fonts are loaded at all, and auth copy is
English while S-01 and the design are Polish.

## Desired End State

`/auth/signin` renders the design: warm off-white ground, plum accent, Quicksand over Nunito, 16px
radii, Polish copy. A control in the chrome cycles light → dark → high-contrast; the choice survives
a reload, and because the server reads it from a cookie and stamps the class during SSR, there is no
flash of the wrong theme. A user who has chosen nothing gets their OS preference.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Reskin scope | Auth screens + shared chrome | Chrome reaches every page anyway; without it `/pets` stays on the navy starter | Plan |
| Component layer | shadcn tokens, hand-rolled components | Design is specific enough (16px radii, two families, 54px controls) that shadcn variants would be fought, not used; `cn`/`cva`/`shadcn add` stay available | Plan |
| Third mode | All three shipped at once | Design provides a complete high-contrast palette; real accessibility value, and retro-fitting it later means re-verifying every component anyway | Plan |
| Theme persistence | Cookie, read during SSR | The only option with no flash — the server renders the right theme in the first byte | Plan |
| Default with no cookie | OS preference | Expected behaviour; handled purely in CSS since the server cannot see `prefers-color-scheme` | Plan |
| Fonts | Astro Fonts, self-hosted from Google | No third-party request per render, no user IPs sent to Google, `latin-ext` subset for Polish diacritics. Stable (not experimental) in Astro 6 | Plan |
| UI language | All Polish | Design supplies the copy; S-01 is already Polish | Plan |
| Verification | Unit test on theme logic; look verified by eye | Test-plan §7 excludes Tailwind class assertions as brittle; theme resolution is the only real branching logic | Plan |

## Scope

**In scope:** three-theme token layer; self-hosted Quicksand + Nunito; server-side theme resolution
and the toggle; base components auth consumes (button variants, input with reveal, card, section
heading, divider, error banner, theme toggle); reskin of `signin`/`signup`/`confirm-email`,
`Layout`, `Topbar`, `Banner`; Polish copy including validation messages; a Vitest `unit` project.

**Out of scope:** domain screens (`/pets`, `/pets/new`, dashboard) and domain components (pet card,
instruction row, sensitive callout, chip) — they belong to S-01…S-04; Google sign-in and password
reset, both drawn in the design but unbacked by any auth flow; visual regression tests; pulling
shadcn components.

## Architecture / Approach

Bottom-up. The token layer keeps shadcn's variable names and swaps in the design's values, so
`button.tsx` and any future `shadcn add` keep working. `src/lib/theme.ts` owns one pure function
mapping a cookie value to an `<html>` class; `Layout.astro` calls it during SSR, and a small client
island writes the cookie and swaps the class on click. Light lives on bare `:root` (not a `.light`
class) precisely so the no-cookie case can fall through to a `prefers-color-scheme` block.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Tokens, fonts & theme resolution | Three palettes, self-hosted fonts, no-flash SSR theme, `unit` test project | The three theme sources (cookie, OS, default) overriding each other in the wrong order |
| 2. Base component layer | The components auth actually needs, on tokens | Building beyond what auth uses — the over-investment the roadmap warns about |
| 3. Auth reskin & shared chrome | Design-accurate auth screens, Polish copy, chrome for every page | Rewriting the form components without breaking sign-in or the auth-gating suite |

**Prerequisites:** none — no data layer, no other slice. Local Supabase must be up for the full test
suite (note: `npm run db:start` currently fails on unhealthy analytics/storage containers; a reduced
service set works).
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- The design is a static export with inline styles; palettes were extracted by frequency analysis, so
  a rarely-used accent could have been missed. Phase 2's manual check against the design is what
  catches this.
- Astro's font pipeline is exercised here for the first time on Cloudflare Workers; if the adapter
  and the font emitter disagree, Phase 1's build check is where it surfaces.
- High-contrast mode is being shipped without an accessibility audit — it follows the design's
  palette, which is assumed to meet contrast requirements rather than verified to.
- `/pets` and `/pets/new` will look half-finished after this slice: new chrome, old content. That is
  intended, and S-01's screens get their treatment when their design is applied.

## Success Criteria (Summary)

- A user can pick light, dark or high-contrast, reload, and stay in the theme they picked — with no
  flash of another one.
- The auth screens are recognisably the design, in Polish, at both mobile and desktop widths.
- Sign-in still works, and the existing test suite stays green.
