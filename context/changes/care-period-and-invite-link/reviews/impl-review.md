<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Care Period & Invite Link (S-02) — full plan

- **Plan**: `context/changes/care-period-and-invite-link/plan.md`
- **Scope**: full plan, Phases 1–4 (commits `246863d`, `26cc515`, `7f5aa31`, `5283214`, `d8d2654`, `94d2e9c`)
- **Date**: 2026-09-06
- **Verdict**: NEEDS ATTENTION → all 10 findings triaged and **all 10 fixed**
- **Findings**: 0 critical, 6 warnings, 4 observations

Phase 3 was reviewed separately first (`impl-review-phase-3.md`, 10 findings, 8 fixed); this
review focused on Phases 1, 2 and 4 plus cross-phase interactions, and did not re-report
those.

## Verdicts (at review time)

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (F1, F2, F5, F8, F10) |
| Architecture | PASS |
| Pattern Consistency | WARNING (F5, F10) |
| Success Criteria | WARNING (F3, F4, F6, F7) |

Every automated criterion passed at review time and again after triage, run from scratch:
`db:reset` (7 migrations), security advisors clean, `db:gen-types` with **no drift**,
`astro check` 0 errors, `npm run lint` 0 errors, `npm run build` complete, **89/89** tests
(77 before triage), working tree clean.

Plan adherence was strong: every Phase 1/2/4 contract item verified MATCH, every guardrail
held (no claiming UI, no instructions, no caretaker identity in any HTML, no revoke UI, no
period edit/delete, no notification, `/pets` untouched beyond one log line), and the raw
token is never logged nor persisted. All deviations were already documented in the plan's
Implementation Addenda.

## Findings

### F1 — A period crossing New Year rendered the wrong date

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality (Reliability)
- **Location**: `src/lib/period-format.ts:96-99`
- **Detail**: `formatRange` took the year from `end_date` only, so the start day inherited the
  wrong year. Reproduced: `formatRange("2026-12-27", "2027-01-03")` →
  `"27 grudnia – 3 stycznia 2027"`. 27 December belongs to 2026. Reachable with an 8-day
  trip, so the 31-day cap does not prevent it, and this string is the authoritative date
  range on both the owner's detail screen and the caretaker's page — a caretaker saw the
  wrong year for the dates they were being asked to cover.
- **Fix**: print the year at both ends when they differ, once at the end when they match.
  Added `tests/unit/period-format.test.ts` (5 cases: UTC day formatting, same-year range,
  cross-year range, inclusive day counts at both bounds, and a DST-transition range).
  Verified live over HTTP: the caretaker page renders
  `27 grudnia 2026 – 3 stycznia 2027`.
- **Decision**: FIXED

### F2 — `claimed_by_name` and `claimed_at` were not tied together

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality (Data integrity)
- **Location**: `supabase/migrations/20260905234144_care_periods_and_slots.sql:50-51`
- **Detail**: Both audits raised this independently. The columns were separately nullable
  with nothing pairing them, so `(claimed_at set, claimed_by_name null)` was representable.
  Nothing disagreed today — all three readers key on `claimed_by_name`, and `claimed_at` was
  written and read by nobody. The exposure was forward: S-03 writes both and S-04 renders
  occupancy, so the first consumer keying on `claimed_at` would silently disagree with all
  three existing readers — and worse, the atomic claim this schema was designed for
  (`update … where claimed_by_name is null`) would let a **second** caretaker overwrite a row
  already carrying a claim time. The unique constraint cannot catch that: same row.
- **Fix A ⭐ (chosen)**: `check ((claimed_by_name is null) = (claimed_at is null))` now, while
  the table holds no claims — no data migration, and S-03's claim becomes provably
  all-or-nothing at the storage layer. Added as `20260906094254_claim_columns_paired.sql`,
  plus 4 assertions in `care-slots.isolation.test.ts` (each half alone refused, both together
  allowed, release clears both).
- **Fix B (not chosen)**: defer to S-03's first migration. Rejected because a requirement in
  a document is weaker than a constraint in the database — a lesson this slice already
  learned once, when a migration comment described an execute-grant posture the database did
  not have.
- **Decision**: FIXED via Fix A

### F3 — Two token-model tests passed for the wrong reason

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Location**: `tests/rls/invite-token.test.ts:116-133`
- **Detail**: (a) "is the only door — anon cannot select either table directly" asserted
  `expect(periods.data ?? []).toEqual([])`. Verified what anon actually receives:
  `error.code=42501, data=null`, so `data ?? []` is `[]` and the assertion passes. But with
  the `revoke all on table … from anon` removed, RLS would filter to zero rows and `data`
  would be `[]` — **the test still passes**. It therefore guarded nothing about the grant
  layer this slice deliberately added, only re-proving deny-by-default RLS, which the
  migration header explicitly said it did not want to rely on alone.
  (b) "carries no instruction rows" pinned the top-level and `period` keys but never the
  **slot** keys, so adding `claimed_by_name` to the function's slot object — the likeliest
  leak in the payload, deferred to S-04 — passed untouched.
- **Fix**: assert `error.code === "42501"` and `data === null` for both tables, and pin the
  exact slot key set. Both assertions now fail if the property disappears.
- **Decision**: FIXED

### F4 — Nothing asserted that anon cannot execute the owner-only RPCs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Location**: `tests/rls/invite-token.test.ts`
- **Detail**: The grants were correct — verified from the catalog:
  `create_period_with_slots` anon=false, `regenerate_period_token` anon=false,
  `get_period_by_token` anon=true. But nothing pinned it, and this is exactly the posture
  the project got wrong twice before (S-01's F3 was closed as fixed while describing a
  posture the database did not have).
- **Fix**: added "anon cannot execute the owner-only RPCs" asserting 42501 on both.
- **Decision**: FIXED

### F5 — anon still held default table grants on three older tables

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Pattern Consistency
- **Location**: `supabase/migrations/20260906003122_invite_token_access.sql:23-24`
- **Detail**: This slice discovered the `ALTER DEFAULT PRIVILEGES` gap and closed it — for its
  own two tables only. Verified from the catalog: `profiles`, `pets` and `care_instructions`
  still carried anon's `SELECT/INSERT/UPDATE/DELETE`. The same migration's header calls this
  "the third time the same gap would have bitten", and the table half was left half-done, so
  the repo held two postures for one rule. Not exploitable (no table has a policy naming
  anon), but the next anon-facing feature adding a permissive policy to `pets` would inherit
  a live grant.
- **Fix B (chosen)**: revoke on all three in the same migration — one rule, one posture.
  Verified safe: nothing anon-facing reads these tables, and after the revoke the suite is
  green with `auth.users` and `public.profiles` both at 20 rows, proving the signup trigger
  still fires with no grants at all (it runs as the table owner). Public schema now has
  **zero** anon table grants.
- **Fix A (not chosen)**: separate follow-up change. Rejected because this gap had already
  been discovered once and closed halfway.
- **Decision**: FIXED via Fix B

### F6 — No test for the caretaker page's uniform failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Success Criteria
- **Location**: `src/pages/invite/[token].astro`
- **Detail**: Uniform failure was asserted only on the SQL return value. The HTTP-level
  property — same 404, same `<title>`, same body for unknown / tampered / malformed /
  revoked — was enforced entirely by branch logic in the `.astro` frontmatter and was
  completely uncovered. `Astro.response.status = 404` inside an `if` and a `<title>` on a
  ternary are precisely what a later edit ("let's tell them the link was revoked") breaks
  with no test failing. Same shape as phase 3's F2, which had to be found by reading.
- **Fix A ⭐ (chosen)**: extracted the decision into `src/lib/invite-view.ts`
  (`resolveInviteView`), a pure function taking "did the call fail" and "did it resolve" and
  returning kind/status/title. Pinned by `tests/unit/invite-view.test.ts` (5 cases, including
  that the inactive title never names the period, and that branch order keeps a backend
  failure from rendering as a dead link). The page was rewired to use it, so the test guards
  the code actually in use rather than a copy. Confirmed over HTTP that tampered/unknown/
  malformed still return byte-identical 404s.
- **Fix B (not chosen)**: record as deliberately-not-tested only.
- **Decision**: FIXED via Fix A. The template itself remains unasserted, now recorded in
  `test-plan.md` §7.

### F7 — The database CHECK boundary was not pinned

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Location**: `tests/rls/care-periods.isolation.test.ts:118-129`
- **Detail**: The test used a 36-day span, so the CHECK's boundary was untested at the
  database level — loosening `<= 30` to `<= 34` passed every test in the repo. Phase 3's F9
  added the "accepts exactly 31" case at the API layer, where zod rejects before Postgres is
  reached.
- **Fix**: changed the span to 32 days (`2026-07-01 → 2026-08-01`), which reaches the CHECK.
- **Decision**: FIXED

### F8 — `p_token` had no length bound

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality (Security)
- **Location**: `supabase/migrations/20260906003122_invite_token_access.sql:62-69`
- **Detail**: `get_period_by_token` is SECURITY DEFINER, granted to anon, and unauthenticated.
  A caller could post a multi-megabyte `p_token` and make the database `convert_to` + `sha256`
  all of it before the guaranteed index miss. A valid token is exactly 43 characters.
- **Fix**: `20260906105815_bound_token_length.sql` adds
  `if p_token is null or length(p_token) <> 43 then return null; end if;`. Stays inside the
  uniform-failure contract (the answer is still NULL) and flattens input-size-dependent
  timing. Verified: a 5,000-character token and a short one both return NULL, and
  `CREATE OR REPLACE` preserved the grants (anon=true, authenticated=true, public=false,
  service_role=false).
- **Decision**: FIXED

### F9 — `contract-surfaces.md` did not register the anti-drift constants

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: `docs/reference/contract-surfaces.md`
- **Detail**: Missing rows for `MAX_SPAN_DAYS` / `MAX_TITLE_LENGTH` / `countDays` — which
  exist *precisely* so the island and the zod schema cannot diverge, with three consumers
  each — plus `createPeriodSchema` / `periodIdSchema` (shared by an API route and a page) and
  the `TIMES_OF_DAY` / `TIME_OF_DAY_LABEL` ordering contract two pages rely on. The file's own
  preamble asks for exactly this.
- **Fix**: five rows added, including `resolveInviteView` from F6.
- **Decision**: FIXED

### F10 — Three hygiene items

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: `src/middleware.ts`, `src/pages/periods/[id].astro:50`,
  `src/lib/schemas/period.ts:34`, plan addenda
- **Detail & fix**:
  - `/invite` was matched with a bare `startsWith`, so a hypothetical `/invitations` would
    inherit `no-store`. Now segment-aware (`isInviteRoute`).
  - `/periods/[id]` still selected `claimed_by_name` while `index.astro` had been changed not
    to (phase 3's F8), leaving two owner pages applying different standards to the same
    column. Fixed using F2's new constraint: since `claimed_at is null` ⟺
    `claimed_by_name is null`, the page now reads `claimed_at` — the same signal with no
    identity attached, so the page cannot render a caretaker's name even by accident.
  - `CreatePeriodInput` was a dead export (zero importers) — removed. The Phase 4 addendum
    claimed the "deliberately not tested" note lived in `test-plan.md` §7 when it was in §6.6
    prose; the note is now genuinely in §7, which is what §8's freshness trigger watches.
- **Decision**: FIXED (all three)

## Not reported as findings

Raised by the audits and judged not to be findings:

- **A digest-existence oracle in `regenerate_period_token`** (a unique violation surfaces as
  500 while success is 200). Exploiting it requires already knowing the raw token, so
  practical value is nil.
- **Unqualified `generate_series` / `unnest` / `enum_range`** in the Phase 1 migration.
  `pg_catalog` is searched implicitly even with `search_path = ''`, so these cannot be
  shadowed — the comment overstates what the code does, but the code is safe.
- **`setTimeout` without cleanup** in `InviteLinkPanel` — harmless in React 19.
- **Two test-naming nits** (`"never returns another owner's period"` is weaker than its name).
  Renaming without changing coverage is churn.

## Post-triage state

15 test files, **89 tests**, all green. 7 migrations apply clean from scratch. Zero anon
table grants in `public`. `astro check` and `lint` clean, build complete, no type drift.
