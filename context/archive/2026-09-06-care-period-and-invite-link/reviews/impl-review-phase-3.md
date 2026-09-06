<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Care Period & Invite Link (S-02)

- **Plan**: `context/changes/care-period-and-invite-link/plan.md`
- **Scope**: Phase 3 of 4 (Owner API & UI), commit `7f5aa31`
- **Date**: 2026-09-06
- **Verdict**: NEEDS ATTENTION → all findings triaged; 8 fixed, 1 reverted as unnecessary, 1 deferred to Phase 4
- **Findings**: 1 critical, 4 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING (F4, F5) |
| Scope Discipline | PASS |
| Safety & Quality | FAIL (F1 critical; F2, F3; F6–F10) |
| Architecture | PASS |
| Pattern Consistency | WARNING (F1 root cause) |
| Success Criteria | WARNING (F9) |

Automated criteria all passed at review time and again after triage: `npx astro check` 0 errors,
`npm run lint` 0 errors, `npm run build` complete, `npm test` 74/74 (73 before F9's added case).

Guardrails held: no claiming UI, no instructions rendered, **no caretaker identity reaches the
HTML**, no revoke UI, no period edit/delete, no notification, `/pets` untouched, no concurrency
test. The raw token is never logged and never appears in a URL the browser visits.

## Findings

### F1 — No double-submit guard; the pending state is dead

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: `src/components/periods/NewPeriodForm.tsx:161`
- **Detail**: `SubmitButton` derives `pending` from `useFormStatus()`, which only reports for a
  React form action or a native submit. This form calls `e.preventDefault()` and fetches
  manually, so `pending` was permanently `false`: no spinner, and the button was never disabled.
  Two clicks on a slow network minted two periods and two tokens, and the panel showed only the
  second — leaving the first period with a **live link its owner never saw and cannot revoke**
  (no period delete, no revoke UI; both out of scope). That defeats the slice's own premise.
  `AddPetForm.tsx:43,251` — the file the plan said to mirror — carries its own `submitting`
  state for exactly this reason, as does `RegenerateLinkButton.tsx:22,53`.
- **Fix**: Own `submitting` state; render `<Button type="submit" disabled={submitting}>`
  directly with the spinner affordance. `SubmitButton` stays for natively submitted forms.
- **Decision**: FIXED

### F2 — /periods/[id] answered differently for a bad UUID than for a foreign period

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/periods/[id].astro:19,43`
- **Detail**: `Astro.params.id ?? ""` went straight into `.eq("id", periodId)` with no
  validation, unlike the API route's `periodIdSchema`. A non-uuid raised Postgres `22P02` →
  `loadError` → **HTTP 200** with "Nie udało się wczytać wyjazdu", while a foreign or missing id
  → **404**. The file's own comment claimed the two were indistinguishable. A probe learned
  whether its input was even well-formed, and a plain typo surfaced as a failure message.
- **Fix**: `periodIdSchema.safeParse(Astro.params.id)` first; a malformed id joins the
  `notFound` / 404 branch.
- **Decision**: FIXED

### F3 — Regenerating a revoked period minted a dead link

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: `supabase/migrations/20260906003122_invite_token_access.sql:120,140`,
  `src/pages/periods/[id].astro:109`
- **Detail**: `regenerate_period_token` deliberately leaves `revoked_at` alone, but
  `get_period_by_token` filters `revoked_at is null`. So a period revoked by S-06 regenerated
  with a 200 and the panel announced "Nowy link gotowy do wysłania" — a link that resolves to
  NULL for every caretaker, permanently. The page rendered "· link został unieważniony" directly
  above the button that produced it. Harmless today (nothing sets `revoked_at` — that is S-06),
  but the trap was being set in concrete now, and the plan states regeneration is the *only*
  way to invalidate a link in this slice.
- **Fix A ⭐ Recommended**: Refuse the action in the UI when `period.revoked_at !== null`
  - Strength: the page already has the flag; no migration, no encroaching on S-06's decisions.
  - Tradeoff: an owner of a revoked period has no repair path in this slice — but only S-06 can
    produce that state.
  - Confidence: HIGH — one component, flag already in hand.
  - Blind spot: unknown what UX S-06 will want for "restore link".
- **Fix B**: Clear `revoked_at` in the regenerate UPDATE
  - Strength: the button always does what it promises.
  - Tradeoff: decides a product question that belongs to S-06 and needs another migration.
  - Confidence: MEDIUM — trivial technically, not mine semantically.
  - Blind spot: FR-012 may require revocation to be permanent.
- **Decision**: FIXED via Fix A. **Note**: the refusal is UI-only —
  `POST /api/periods/[id]/token` still regenerates a revoked period. S-06 owns the server-side
  semantics.

### F4 — ScreenHeading unused; heading markup duplicated 3×

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/pages/periods/index.astro:51`, `new.astro:20`, `[id].astro:105`
- **Detail**: the plan's contract says "Built on `src/components/ui/` — Input, Button,
  ScreenHeading". Input and Button are used; ScreenHeading was not — all three pages repeated
  its exact class string from `ScreenHeading.astro:18`. That is the mirror image of the
  `lessons.md` rule about shared components: a change to ScreenHeading would not reach these
  screens.
- **Fix**: use ScreenHeading where it fits; record the reason where it does not.
- **Decision**: FIXED PARTIALLY — `new.astro` now uses `ScreenHeading` (title + subtitle).
  `index.astro` and `[id].astro` keep composed headings for concrete reasons:
  - `index.astro` puts the h1 in a flex row beside `ThemeToggle`; ScreenHeading is a block.
  - `[id].astro` needs the date range in the accent colour (`text-primary`, matching the design's
    pink trip date). ScreenHeading renders its subtitle as `text-muted-foreground` inside an
    `mb-7` block, so using it would either drop the accent or open a 28px gap between the title
    and the date.

### F5 — Client validation did not mirror the 120-character title bound

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/components/periods/NewPeriodForm.tsx:37-54`
- **Detail**: the plan says "client-side validation mirroring the zod schema for UX only".
  `validate()` covered required title, required dates, reversed dates and the 31-day span, but
  omitted `max(120)`, and `Input` exposes no `maxLength`. A 121-character title reached the
  server and came back as a generic "Dane są niepoprawne" instead of a field error.
- **Fix**: added the length rule to `validate()`, with the bound extracted as
  `MAX_TITLE_LENGTH` in `period-format.ts` and consumed by both the schema and the island — the
  same sharing `MAX_SPAN_DAYS` already uses, so the two cannot drift.
- **Decision**: FIXED

### F6 — No Referrer-Policy / Cache-Control for the /invite path

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/middleware.ts` (the `/invite` route does not exist yet — Phase 4)
- **Detail**: the token sits in a path segment and nothing in the app sets `Referrer-Policy`.
  Once Phase 4 ships `/invite/<token>`, the landing page's first outbound link, third-party
  font, or a messenger's link-preview crawler carries the full path — token included — in the
  `Referer` header. The token also lands in Cloudflare access logs and browser history, which
  the code comments claim to avoid.
- **Fix**: deferred to Phase 4 as an explicit requirement — middleware sends
  `Referrer-Policy: no-referrer` and `Cache-Control: no-store` for `/invite/*`, and the
  path-segment-vs-fragment choice is recorded in `docs/reference/data-access.md`. Phase 4
  touches middleware anyway.
- **Decision**: DEFERRED TO PHASE 4 (recorded in the plan's Implementation Addenda)

### F7 — periods.ts did not guard `data.id` against NULL

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: `src/pages/api/periods.ts:58`
- **Detail**: `token.ts:40` guards `if (!data)`; `periods.ts` did not.
- **Fix**: attempted, then reverted — `@typescript-eslint/no-unnecessary-condition` rejected the
  guard as statically dead, correctly. In the no-error branch supabase-js's discriminated
  response types `data` as non-null, and `create_period_with_slots` returns
  `public.care_periods` (never a set), so a row is guaranteed. `token.ts` guards because *its*
  function returns `uuid` and answers NULL for a miss — a real runtime case, not a defensive
  one. The asymmetry the finding flagged is correct behaviour, not an oversight; a comment now
  records why.
- **Decision**: DISMISSED — finding was based on a runtime case the types exclude. Comment added.

### F8 — Period list unbounded, fetching every slot row for two integers

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance)
- **Location**: `src/pages/periods/index.astro:31-34`
- **Detail**: `care_slots(claimed_by_name)` pulled every slot row of every period solely to
  compute two integers. At the 93-slot cap, 30 periods is ~2,800 rows per page render — not
  N+1 (one embedded query), but unbounded in the number of periods. It also fetched
  `claimed_by_name`, which this slice has no right to display, so a future template edit would
  have leaked it silently.
- **Fix**: aggregate in the database —
  `total:care_slots(count), taken:care_slots(count)` with `.not("taken.claimed_by_name", "is", null)`
  filtering the aliased embed only, plus `.limit(PERIODS_PAGE_SIZE)`. Verified empirically
  against the local stack (a period with 2 of 9 slots claimed returns `total=9, taken=2`, and a
  period with nothing claimed still comes back with `taken=0`). `claimed_by_name` no longer
  reaches this page at all.
- **Decision**: FIXED

### F9 — No test that exactly 31 days is accepted

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `tests/api/periods.post.test.ts:121-129`
- **Detail**: the suite proved 32 days is rejected but never that 31 passes. The bound now lives
  in four places (the CHECK, the zod refine, the island's `validate`, and `MAX_SPAN_DAYS`), so a
  one-day tightening in any layer would pass every test. The arithmetic itself was verified
  correct — all bounds agree exactly, and parsing is UTC-pinned throughout.
- **Fix**: added "accepts a span of exactly 31 days" asserting 201 and 93 slots.
- **Decision**: FIXED

### F10 — console.error logged the whole Supabase error object

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/periods.ts:50`, `src/pages/api/periods/[id]/token.ts:34`,
  `src/pages/api/pets.ts:47`
- **Detail**: on a `care_periods_token_digest_key` unique violation PostgREST's `details` field
  carries `Key (token_digest)=(<hex>) already exists`, so the digest reached the logs. The raw
  token never did (verified separately) and the digest is not accepted by
  `get_period_by_token`, so exploitability is nil — it only widens what a log dump exposes.
- **Fix**: log `error.code` + `error.message` only. Applied to **all three** routes including
  `pets.ts`, which carries the same S-01 pattern — fixing only the new routes would have split
  one pattern into two. `pets.ts` is outside this slice's scope; changed on the user's explicit
  instruction.
- **Decision**: FIXED (all three routes)

## Not reported as findings

Two items the audit raised and I judged not to be findings:

- **`/invite/[token]` does not exist yet**, so every link this slice mints 404s. That is phase
  ordering, not a defect — Phase 4 lands the route in the same slice.
- **`setTimeout` without cleanup** in `InviteLinkPanel`'s copy affordance — harmless in
  React 19; the timer merely outlives the component.

## Verdict note

The rubric says REJECTED on any critical FAIL. F1 is neither a security hole, data loss, major
drift, nor a failing test — it is a reliability defect with a small fix. NEEDS ATTENTION is the
honest verdict, not REJECTED.

One uncomfortable observation worth keeping: **F1 is exactly the class of defect manual check
3.5 should have caught**, and 3.5 was ticked as passing.
