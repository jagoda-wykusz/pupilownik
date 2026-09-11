<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Close / cancel a care period (FR-012, S-06)

- **Plan**: `context/changes/close-care-period/plan.md`
- **Scope**: Phase 3 of 4 — "The owner's control" (including the 2026-09-10 addendum)
- **Commit reviewed**: `f3ea47b`
- **Date**: 2026-09-10
- **Verdict**: REJECTED as committed → all findings fixed in-session
- **Findings**: 1 critical, 6 warnings, 5 observations

## Verdicts

| Dimension           | Verdict (at review) |
| ------------------- | ------------------- |
| Plan Adherence      | WARNING             |
| Scope Discipline    | PASS                |
| Safety & Quality    | FAIL (1 critical)   |
| Architecture        | PASS                |
| Pattern Consistency | PASS                |
| Success Criteria    | PASS                |

## What was verified clean

- **The CSRF mechanism is real, and was checked against the installed framework rather than
  against the comment describing it.** Astro 6.3.1's own middleware: `SAFE_METHODS` excludes
  POST; `checkOrigin: true` is the schema default and `astro.config.mjs` does not override
  `security`; the no-Content-Type branch refuses a request whose `Origin` does not equal the
  URL's origin — and an **absent** Origin fails that equality too, so the framework is stricter
  than the route's comment claimed. The island really sends `{ method: "POST" }` and nothing
  else, and nothing in the repo can add a header: no `globalThis.fetch`/`window.fetch`
  assignment, no service worker, no interceptor; all five other `fetch(` sites build their init
  inline.
- **Uniform failure holds at the route.** One 404 branch; the three misses collapse in SQL and
  the route does not re-separate them. The 200 echoes only the id the caller supplied.
- **The cookie shape gate is behaviour-neutral, traced path by path.** (a) no cookie, (b)
  malformed cookie, (c) well-formed cookie matching nothing all converge on `claimed = null` →
  `splitRevealAnswer(null)` → same status, same `<title>`, same body, same headers. **(b) is
  byte-identical to (a) and (c).** The regex is a strict superset check over the DB's
  length-only bound, and the values it newly rejects are unreachable for any browser-originated
  caller, because minting passes through the same regex.
- **The shared-constant move is clean.** Character-identical pattern; exactly two consumers, both
  enumerated in the registry; `claim.ts`'s behaviour unchanged (only the import line moved);
  `claim-cookie.ts` has **zero imports**, so nothing new enters the page's server bundle.
- **Three of the island's four load-bearing decisions were honoured as committed**: focus moves
  on every state swap (two refs + mount guard), success reloads rather than patches, `finally`
  does not disarm.
- **Scope discipline**: zero creep across 13 files. Notably **no confirmation was added to link
  regeneration** — `RegenerateLinkButton` still has three state hooks, no `armed`, no refs, no
  `useEffect`, and one button that fires on the first click. Only its 404 copy changed.
- **Pattern compliance**: the route is a line-for-line mirror of `release.ts`; the island matches
  `ReleaseSlotButton`'s prop shape, state trio and response ladder. Nothing substantive.

## Findings

### F1 — The confirm's accessible name violated WCAG 2.5.3

- **Severity**: ❌ CRITICAL · **Impact**: 🔎 MEDIUM · **Dimension**: Safety & Quality
- **Location**: `src/components/periods/RevokePeriodButton.tsx` (as committed, `:137` / `:140`)
- **Detail**: Visible text `"Na pewno? Odwołaj na zawsze"`; accessible name
  `"Na pewno? Potwierdź odwołanie wyjazdu"`. WCAG 2.5.3 "label in name" requires the accessible
  name to **contain** the visible label, not share a prefix. `aria-label` overrides the text node
  entirely, so a voice-control user saying the words on screen could not activate **the
  product's only irreversible action**. `ReleaseSlotButton` is compliant only because its visible
  text is exactly `"Na pewno?"`, which its label does contain; this island lengthened the visible
  text and kept the pattern's shape without re-checking the property.
- **Fix (applied)**: drop `aria-label` from the confirm entirely. This control is alone on its
  page — unlike the template, which needs a label to disambiguate a dozen identical confirms — so
  the visible text is the best accessible name: it satisfies 2.5.3 by construction and tracks
  `pending` with no second string to drift.
- **Decision**: FIXED

### F2 — The confirm occupied the same rectangle as the idle button

- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Safety & Quality
- **Detail**: Both buttons are `w-full` as the first child of the same wrapper, so the
  destructive confirm appeared exactly where the idle button had been. A fast double-tap at one
  point armed **and then confirmed** — on a phone, on the one action with no undo. The plan said
  the confirm must sit "elsewhere"; the component's own comment claimed it did.
- **Fix (applied)**: render the escape FIRST, so "Nie odwołuj" occupies the vacated rectangle and
  a stray second tap lands on the way out.
- **Decision**: FIXED

### F3 — Both assertions that should have caught F1 and F2 did not bite

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality (test quality)
- **Detail**: The name test asserted `name.startsWith("Na pewno?")` — a hard-coded prefix that
  both the label and the visible text happen to share, so it stayed green while the posture it
  names was violated. Nothing at all covered the geometry. Verbatim the recorded lesson: an
  assertion that passes with the layer gone is a description, not a test.
- **Fix (applied)**: read the visible text out of the DOM and assert the accessible name contains
  it; add a document-order assertion for the escape (the two are stacked in a flex column, so DOM
  order is visual order).
- **Measured**, each regression failing exactly its own assertion:
  - re-added non-containing `aria-label` → `× accessible name that CONTAINS its whole visible text`
  - confirm back in the first slot → `× puts the escape where the idle button was` /
    `AssertionError: expected 1 to be less than 0`
- **Decision**: FIXED

### F4 — "answers 401 … and never reaches the RPC" did not pin the ordering

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality (test quality)
- **Detail**: Found by measurement, not by reading: moving the auth check **after** the RPC left
  the test green. With no cookie the client runs as `anon`, which holds no EXECUTE on
  `revoke_period`, so the grant layer refuses the write regardless of the handler. The comment
  claimed the row assertion proved the ordering; it inherited its force from the grants.
- **Fix (applied)**: a separate case with a session **present** and `locals.user` absent — the one
  shape this harness can use, since the client is then authenticated and only the handler's
  ordering stops the write. **Measured**: with auth moved after the RPC it fails with
  `expected '2026-09-10T21:38:07…' to be null`.
- **Decision**: FIXED

### F5 — Four false statements in prose, plus two stale line references

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence
- **Detail**:
  1. `revoke.ts` justified its log discipline by "`details` … could be a token_digest" — this
     function writes **only** `revoked_at`, so the unique-violation-on-`token_digest` path cannot
     arise. The rationale was copied along with the practice from `token.ts`.
  2. `claim-cookie.ts` called the regex "identical to the 43-char bound both database functions
     apply" — it is strictly **narrower** (they check length only).
  3. The same file credited Phase 2 with the second reader; Phase 3 added it (Phase 2 ungated the
     reveal, which is the _reason_ for it).
  4. `RegenerateLinkButton`'s header said "Revoking without replacing **is S-06**", as future
     work, while the revoke control now sits directly below it.
  5. `caretaker-name.ts` pointed at `claim-cookie.ts:23` for the `set:html` dependency; the
     13-line insertion moved that sentence to `:36`, and `:23` now holds an unrelated sentence
     about RPCs. Two further pointers (`plan.md`, the Phase 2 report) still named
     `claim.ts:96` as `CAPABILITY_SHAPE`'s home.
     The registry's `RevokePeriodButton` row also restated F1's WCAG claim as though it held.
- **Fix (applied)**: all corrected; line-number cross-references replaced with references by
  name, which is what made them rot in the first place.
- **Decision**: FIXED

### F6 — The endpoint's CSRF control was a framework default with no test

- **Severity**: ⚠️ WARNING · **Impact**: 🔬 HIGH · **Dimension**: Safety & Quality
- **Detail**: The protection works, but it is a default this route does not own and no test
  exercises. Three edits remove it without touching the file: `security: { checkOrigin: false }`
  in `astro.config.mjs`, a deployment path skipping Astro's internal middlewares, or an island
  refactor that starts sending `Content-Type` — the last being the same edit the island's comment
  warns about, and it would land here as a 200 rather than a 403. A comment is not a control.
- **Fix (applied, owner's decision)**: copy `claim.ts`'s explicit three-line `Origin` check into
  the route, with a 403 test **and** a same-origin positive control so the 403 cannot pass for
  the wrong reason. Absent `Origin` is still allowed, matching `claim.ts`'s reasoning; the
  framework's own branch is stricter there, so this narrows nothing that reaches it.
- **Follow-up, deliberately out of scope**: `token.ts` and `release.ts` still rely on the default
  alone. Recorded in the route's comment.
- **Decision**: FIXED via the explicit check

### F7 — A revoked period stated one fact three times in two vocabularies

- **Severity**: 🔵 OBSERVATION · **Impact**: 🔎 MEDIUM · **Dimension**: Pattern Consistency
- **Detail**: Under the single "Link dla opiekuna" heading: the header line's
  "· link został unieważniony", `RegenerateLinkButton`'s refusal ("został unieważniony … Zaplanuj
  nowy wyjazd"), and the new island's terminal card ("został odwołany — link nie działa i nie da
  się go przywrócić"). Two visually identical muted boxes, three statements, two verbs — and the
  commit message claimed they "read coherently".
- **Fix (applied, owner's decision)**: the island's terminal state keeps only what it alone knows
  — that it cannot be undone, and what the caretaker will see — as one line, not a card. The idle
  hint's verb aligned on "unieważniony", the wording this phase standardised the indicators onto.
- **Decision**: FIXED

## Observations left open

- **Keyboard residual.** Focus lands on the destructive confirm, so Enter key-repeat can still
  arm-then-confirm. F2's fix closes the pointer case, not this one. Moving focus to the escape
  would close it but weakens the announcement, since the focus move is the only announcement
  there is.
- **The `mounted` guard is untested** in both this island and the template: remove it and every
  test still passes, while the island would steal focus on hydration. Closing it is a two-line
  case (render, assert `document.activeElement` is `document.body`).
- **The CSRF assertion inspects `fetch`'s second argument only**, so `fetch(new Request(url, {
headers: … }))` would slip past it. Low risk, worth knowing.
- **A third inline copy of the capability regex** lives in `src/lib/schemas/claim.ts` for the
  TOKEN. Deliberately separate, now stated in the registry rather than left implicit.
- **Astro's `hasContentType` branch means `/api/periods` and `/api/pets` get no origin check at
  all** — their protection is that a cross-site POST carries no session cookie. Fine, but the repo
  now holds three CSRF postures and only two are documented.

## Verification after fixes

Clean run: full suite **305/305** across 29 files (was 300; +2 origin cases, +1 ordering case,
+1 geometry case, +1 positive control) · `astro check` 0 errors 0 warnings · `lint` exit 0,
0 errors · `build` exit 0. Exit codes read from the tool, not from a pipeline.
