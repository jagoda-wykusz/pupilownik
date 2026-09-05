<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Auth Gating & Session Handling (Risk 2)

- **Plan**: context/changes/testing-auth-gating/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-09-05
- **Verdict**: APPROVED (with one warning, since fixed)
- **Findings**: 0 critical, 1 warning, 2 observations

Success criteria were verified by running them, not by reading the checkboxes:
`npm test` 25/25 green (7 files), `npm run lint` 0 errors, `npm run build` passes.
All 12 Progress rows carry a SHA. The plan's "no production-code changes to
`src/**`" claim holds for the original diff (`73f4da8^..41c31c7`); the single
`src/` edit in this review is the F2 fix.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING (F1, F3) |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (F1) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — The "invalid cookie" case could pass for the wrong reason

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence + Safety & Quality
- **Location**: tests/helpers/session.ts:13-16, 90-103 (pre-fix)
- **Detail**: The plan (Phase 1, item 4) specified `corruptCookieHeader(header)` —
  tamper a *captured* header. The implementation instead built a synthetic cookie
  from scratch and reconstructed the name by hand
  (`sb-${host.split(".")[0]}-auth-token`). If @supabase/ssr ever changes its
  storage-key scheme, the forged name stops matching the one the middleware reads:
  the request then carries a cookie nobody parses → no session → redirect → the
  test stays green while silently proving nothing about rejecting a
  present-but-invalid token. That is precisely the case the plan called
  load-bearing ("a token ≠ authorization").
- **Fix A ⭐ Recommended**: Derive the invalid header from a real one — replace
  `createInvalidCookieHeader()` with `corruptCookieHeader(header)` that takes the
  header from `createAuthenticatedCookieHeader()` and swaps in an untrusted
  session, keeping the captured cookie name.
  - Strength: The name can never drift, because it comes from the same source as
    the positive case; matches the contract the plan wrote down.
  - Tradeoff: The negative case now needs a signUp + signIn, so it is slower.
  - Confidence: HIGH — `createAuthenticatedCookieHeader()` already returns exactly
    that header; this repoints a source rather than adding logic.
  - Blind spot: Whether corrupting a payload inside a chunked session could throw
    in `combineChunks` instead of yielding a clean "no user" — sidestepped by
    collapsing to the base cookie name and carrying one intact-but-untrusted value.
- **Fix B**: Keep the forge, add an anchoring assertion that the forged name occurs
  in a captured header.
  - Strength: Cheap; the negative case stays fast, and a name drift breaks loudly.
  - Tradeoff: The anchor lives in the test, not the helper — easy to lose when the
    pattern is copied to the next route.
  - Confidence: MED — guards the name, not the value encoding.
  - Blind spot: Does not verify the fabricated value still reaches the parser as
    the test assumes.
- **Decision**: FIXED via Fix A

### F2 — The gating test did not keep up with the protected-route list

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/middleware.ts:4 vs tests/middleware/auth-gating.test.ts:12
- **Detail**: `PROTECTED_ROUTES` was `["/dashboard"]` when the plan was written.
  S-01 added `/pets`, but the test still exercised only `/dashboard`; `/pets` had
  manual coverage alone (pet-and-instructions step 3.7).
- **Fix**: Export `PROTECTED_ROUTES` and drive the no-cookie case over it with
  `it.each`, so a newly gated prefix gets regression coverage without editing the
  test.
- **Decision**: FIXED (suite went 24 → 25 tests; the new one is `/pets`)

### F3 — The contract-surfaces registry never existed

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: docs/reference/contract-surfaces.md, context/foundation/lessons.md
- **Detail**: Phase 2 item 3 planned to register `runMiddleware()` and
  `createAuthenticatedCookieHeader()`. Neither file existed. Note the mechanism:
  `/10x-init`'s SKILL.md states both files are deliberately NOT scaffolded there —
  they self-bootstrap on first use by `/10x-lesson`, `/10x-contract`, and
  `/10x-impl-review` triage. The root CLAUDE.md claims `/10x-init` scaffolds them,
  which is out of date.
- **Fix**: Bootstrap both with their canonical headers and register the harness
  entry points.
- **Decision**: FIXED

## Out of scope, noted in passing

`npm run lint` warns `no-console` at `src/pages/api/pets.ts:47` — belongs to the
archived S-01 change, not this one.
