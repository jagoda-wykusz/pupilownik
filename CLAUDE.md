# Pupilownik

Astro 6 SSR (React 19 islands, Tailwind 4, shadcn/ui) on Supabase, deployed to Cloudflare
Workers. TypeScript strict, `@/*` → `./src/*`.

**Read `@AGENTS.md` before changing code.** It is the operational contract — hard rules,
commands, conventions, and the two CI gates. This file only orients you.

## What the product is

An owner leaving for a trip needs several trusted people to cover feeding — today that is
organised serially over a messenger, one slow reply blocking the next question. Pupilownik
turns it into **parallel self-service sign-up inside a closed circle invited by one link**.
The owner defines pets with care instructions, creates a care period (date range → morning /
evening slots) and sends a single link; caretakers claim free slots themselves, without an
account.

Two product rules hold the whole thing together, and every change is judged against them:

1. **No slot is ever filled twice.** `claim_slots` (`supabase/migrations/20260907154125_claim_slots.sql`)
   allocates with one guarded `UPDATE` — all-or-nothing. A read-then-write check is not a
   substitute and will be rejected in review.
2. **Nothing leaks outside the link's circle.** The raw invite token never reaches the
   database (only its SHA-256; see `src/lib/invite-token.ts`), and sensitive instructions
   (address, access codes) reveal only _after_ a slot is claimed.

Ownership is enforced by **RLS in the database, not by handler code**. A route that checks
`owner_id` in TypeScript is doing the wrong thing in the wrong layer.

## Two paths through the app

|              | Owner                                                                 | Caretaker                                                     |
| ------------ | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| Access       | account (email + password), Supabase Auth                             | **no account** — the invite link only                         |
| Entry points | `src/pages/{dashboard,pets,periods}/*` (gated in `src/middleware.ts`) | `src/pages/invite/[token].astro`, `src/pages/invite/claim.ts` |
| Data scope   | own rows only, via RLS                                                | one period; the sensitive tier only after claiming            |

## Where to look before asking

| Need                                                  | Read                              |
| ----------------------------------------------------- | --------------------------------- |
| Rules, commands, conventions, CI                      | `@AGENTS.md`                      |
| Setup, scripts, Supabase config                       | `@README.md`                      |
| Why the product exists, FR/NFR, open questions        | `context/foundation/prd.md`       |
| What ships next, slice status                         | `context/foundation/roadmap.md`   |
| Risk map, what is tested and what is deliberately not | `context/foundation/test-plan.md` |
| Recurring pitfalls already paid for                   | `context/foundation/lessons.md`   |
| Data-access and contract rules, E2E rules             | `docs/reference/`                 |
| What was decided on past changes (**never edit**)     | `context/archive/`                |

## About the fence below

Everything between the `@przeprogramowani/10x-cli` markers is **CLI-managed course
material** — `10x-cli get` rewrites that region wholesale, so never put project rules
inside it. This preamble lives above the fence and survives; `tests/unit/claude-md-overview.test.ts`
fails the gate if it stops doing so.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
