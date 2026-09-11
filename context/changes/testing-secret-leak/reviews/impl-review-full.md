<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Secret-Leak Assertions (Risk #6) — full plan

- **Plan**: `context/changes/testing-secret-leak/plan.md`
- **Scope**: all three phases
- **Date**: 2026-09-11
- **Reviewed commits**: 98e06f7 (p1), fd39569 (p2), 2136253 (p3), e0e918b (epilogue)
- **Verdict**: NEEDS ATTENTION (all accepted findings fixed)
- **Findings**: 4 critical, 11 warnings, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | FAIL    |

No "What We're NOT Doing" boundary was crossed. The auth fix is sound. The scan script had three
inputs that made it exit 0 on a real leak, and **the honesty pass introduced a new instance of
the defect it existed to fix**.

## F16 — The honesty pass left two false rows in the table it rewrote

- **Severity**: ❌ CRITICAL · **Impact**: 🏃 LOW · **Dimension**: Success Criteria
- **Location**: `context/foundation/test-plan.md` §5 cost table
- **Detail**: §5 was rewritten to state that no CI exists and that `astro check` replaced
  `tsc --noEmit`. Eleven lines below, the cost table still read `| eslint . | ~110s | CI |` and
  `| tsc --noEmit | ~26s | pre-commit |`. One row of that table was updated; the two it
  contradicts were not. Commit `2136253`'s own message claims this contradiction was the bug
  being fixed.
- **Fix**: Both rows corrected. The section now records **why it took two passes** — correcting a
  document in one place and believing it corrected is the same failure as writing it wrong; the
  unit of verification is the claim, not the section.
- **Decision**: FIXED

## F18 — Three corrected comments assert an exception that cannot apply at their call site

- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Safety & Quality
- **Location**: `src/pages/api/periods.ts`, `.../[id]/token.ts`, `.../[slotId]/release.ts`
- **Detail**: Each justified "log code and message" with "a SECURITY DEFINER function owned by
  `postgres` DOES receive the full row in DETAIL". Verified: `create_period_with_slots`,
  `regenerate_period_token` and `release_slot` are all **SECURITY INVOKER**, so the exception
  cannot apply on those paths. `release.ts` went furthest, naming `claim_digest` as "the column
  at risk" for an invoker-scoped call. `claim.ts` was the honest one — `claim_slots` really is
  definer-owned.
- **Fix**: All three now say the exception does **not** apply at that call site, and that the
  discipline is uniform because `claim_slots` in `claim.ts` is definer-owned.
- **Decision**: FIXED

## F3 — The project-specific patterns guard the local throwaway stack

- **Severity**: ❌ CRITICAL · **Impact**: 🔎 MEDIUM · **Dimension**: Safety & Quality
- **Detail**: The literal and host patterns are derived from `.env`, which in every checkout
  points at `127.0.0.1:54321` (`.env.example` says so). The key is new-style, not a JWT. So a
  pasted **production** URL, host or `sb_publishable_` key was caught by nothing, while the
  script header and §5 both claimed the scan catches "a secret literal pasted into a client
  island".
- **Fix**: Added an `sb_publishable_` pattern and a `SECRET_SCAN_HOSTS` input for hosts no `.env`
  points at (a project ref is not a secret). The summary line now **names the host it guarded**,
  so a run against localhost cannot read like one guarding production. The header says which
  patterns are project-independent and which are not.
- **Decision**: FIXED

## F1 + F2 — Two ways to exit 0 on a real leak

- **Severity**: ❌ CRITICAL · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality
- **Detail**: (F1) The `.env` parser's greedy `(.*)` swallowed an inline `# comment` into the
  value, so `includes(value)` could never match and `new URL()` threw into an empty catch —
  dropping both patterns while the run printed "clean". An `export ` prefix skipped the variable
  entirely. (F2) A missing, empty or under-8-character value silently degraded the scan to two
  generic patterns; the only signal was a stdout suffix nothing asserted.
- **Fix**: Parser accepts `export `, strips an unquoted trailing comment, handles quoting. A
  degraded run now **exits non-zero** unless `SECRET_SCAN_ALLOW_MISSING_ENV=1` is set, and the
  success line carries a `WEAKENED` marker the test asserts against.
- **Decision**: FIXED

## F8 — Excluding all JavaScript from the scan kept the suite green

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Success Criteria
- **Detail**: Adding `.js` to the script's binary-skip list leaves `npm test` passing: the lone
  `.css` file contains the word `function`, so the positive control still matched. The sharpest
  mutation in the review, and the test survived it.
- **Fix**: The test now asserts floors on scanned file count and pattern count, and that the run
  is not marked `WEAKENED`.
- **Decision**: FIXED

## F12 — The auth test compared one string

- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Success Criteria
- **Detail**: `call()` returned `{status, location}`, and the shim built a fresh `Response`, so
  any cookie the Supabase client wrote was discarded and never inspected. A regression that
  differentiated causes by cookie, header or body was invisible to every assertion.
- **Fix**: `call()` now returns sorted header names, sorted cookie names and the body; the
  sameness assertions compare whole objects and pin an empty body.
- **Decision**: FIXED

## F17 — Five routes, not four

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW
- **Detail**: §7 and the plan's "What We're NOT Doing" both said four routes answer
  `"Supabase is not configured"`. There are five — `release.ts` was omitted, and it is one of the
  files this change edited.
- **Fix**: §7 corrected, and the miscount is named in it.
- **Decision**: FIXED

## F19 — An unmeasured claim about `Referer`

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW
- **Detail**: `auth-messages.ts` claimed the query string "travels in `Referer`" because
  `no-referrer` is scoped to `/invite`. The browser default is `strict-origin-when-cross-origin`
  — cross-origin requests send origin only — and `/auth` makes no third-party requests at all,
  since `astro.config.mjs` self-hosts the fonts precisely so none are made. Browser history is
  the whole of the exposure and is sufficient on its own.
- **Fix**: The claim is withdrawn in place, with the reason, rather than deleted. The
  `"Email not confirmed"` mention is also now hedged to match §7.
- **Decision**: FIXED

## F22 — `npm test` now requires a build

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW
- **Detail**: The bundle test fails rather than skips without `dist/client` — deliberate — but
  neither §5 nor the "wiring is one line" claim mentioned that on a fresh clone `npm test` fails
  until `npm run build` has run, and that CI must order build before test.
- **Fix**: Recorded in §7 and in the README's rewritten CI section.
- **Decision**: FIXED

## Found while fixing, beyond the review

**`README.md` carried the same false CI claim, more visibly.** Its `## CI` section stated that
"build and deploy run via Cloudflare Workers Builds connected to the GitHub repo", that "merges
to the production branch auto-deploy" and that "pull requests get preview URLs". None of that is
true. Rewritten to say there is no CI, what was deleted and when, and which commands a developer
must run themselves. This is the fourth artifact in this repo found describing that intended
setup as if it existed.

## Accepted, not fixed

- **F4** — `.map` is in the binary-skip list though source maps are text and can embed
  `sourcesContent`. No maps are emitted today (sourcemaps off), so it is latent. Not selected.
- **F6** — the positive control keys on the word `function`; a build emitting only arrow
  functions, or only CSS, would fail with a misleading message. Not selected. The new floor
  assertions reduce the blast radius.
- **F13** — timing. A wrong password for an existing account does more upstream work than an
  unknown address, and the missing-config branch makes no network call at all. Unmeasured,
  unmitigated, and the prose does not qualify the channel.
- **F14** — the source check pins one English phrase in one syntactic shape; hoisting the message
  into a constant evades it. Not selected.
- **F9/F10** — the schema regex truncates on a nested object and misses a declaration hoisted
  above the `env:` key. Not selected.

## Verification after fixes

| Check                   | Result                                                                |
| ----------------------- | --------------------------------------------------------------------- |
| `npm run build`         | Complete, EXIT=0                                                      |
| `npm run check:secrets` | clean, 6 patterns, EXIT=0                                             |
| `npm test`              | 39 files / 369 tests, EXIT=0                                          |
| `npx astro check`       | 0 errors, EXIT=0                                                      |
| degraded-run guard      | exits 2 without env; opt-out restores exit 0 with a `WEAKENED` marker |

## The finding worth carrying

This change's whole purpose was correcting prose that stated an unmeasured posture — and its own
correction pass produced a fresh instance, in the same section, eleven lines from the sentence
that contradicted it. The rule `lessons.md` already carries covers writing such a claim. What
this adds is the other half: **when you correct a document, the unit of verification is the
CLAIM, not the section.** Fixing one row and believing the table fixed is the same error wearing
a different hat, and only a second reader caught it.
