<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Domain Guardrails — Phase 3

- **Plan**: `context/changes/testing-domain-guardrails/plan.md`
- **Scope**: Phase 3 of 5 — A valid token opens nothing on the owner side (Risk #5)
- **Date**: 2026-09-11
- **Reviewed commit**: 91d5f78
- **Verdict**: NEEDS ATTENTION (all findings triaged and fixed)
- **Findings**: 0 critical, 5 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

Coverage of owner-only entry points is complete: nine endpoints exist, three are auth (pre-session
by design), one is the deliberately anonymous `invite/claim`, and all five owner-only handlers are
in the table.

## The correction that matters, and it corrects a correction

Phase 3's gate report said the plan's premise was wrong and recorded a replacement: "the owner
routes are double-fenced, the grant layer is the stronger fence". **That replacement was itself too
broad, and the review caught it.** The measured answer has two sides:

- **No session cookie at all** (this file's shape, and the link-only caller Risk #5 is about):
  deleting the route guard does not produce a row — the anon-keyed client is refused by the grant
  layer with SQLSTATE 42501. The route check is defence in depth, and what the table pins is the
  ANSWER: a clean 401 rather than a 500 carrying a database error.
- **Session cookie present, `locals.user` absent** (the shape a middleware mistake produces): the
  client is `authenticated`, the grant layer lets it straight through, and the route guard is the
  ONLY fence. **Measured by mutation: deleting the guard from `pets.ts` yields 201 and a real row.**

Either half alone misleads. Both are now recorded in the plan's §7 commitments for Phase 5.

## Findings

### F1 — The added `pets.post.test.ts` comment stated the opposite of what the test does

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `tests/api/pets.post.test.ts:73-76` (as committed)
- **Detail**: The case passes a genuine `cookieHeader` with `locals.user = null`, so the client is
  authenticated and `create_pet_with_instructions` is granted `to authenticated`. The comment
  claimed the write would still fail because the caller is anon-keyed. Mutation-measured: **201**,
  not 500. The comment understated the repo's strongest owner-guard probe on this route and could
  have led a future reader to delete it as redundant.
- **Fix**: Split into two named cases — no cookie at all (grant layer catches; the 401 is what is
  pinned) and cookie present without `locals.user` (route guard is the only fence), each with a
  comment that matches what it does. Mirrors `tests/api/revoke-period.test.ts:130`.
- **Decision**: FIXED

### F2 — The §7 commitment recorded at the phase gate was too broad

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Plan Adherence
- **Location**: `plan.md` — Phase 5, change #4, commitment 2
- **Detail**: Same root cause as F1. As written it would have told §7 that the grant layer always
  backstops the route check, which is false for the middleware-mistake shape.
- **Fix**: Rewritten as two cases with the measurement behind each.
- **Decision**: FIXED

### F3 — Five of fifteen cases were decoration

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Success Criteria
- **Location**: `tests/api/token-scope.test.ts` — the `PLACEMENTS` product
- **Detail**: `revoke`, `release` and `token` take no request body, so the `body` placement planted
  the token nowhere. `POST /api/periods` and `POST /api/pets` have no `id` param, and no route in
  the API surface reads query params, so the `url` placement planted it nowhere either. Those five
  requests were indistinguishable from an ordinary sessionless call already tested elsewhere.
- **Fix**: Placements are declared per entry — `cookie` on all five (the Cookie header is genuinely
  parsed by `@supabase/ssr`), `body` on the two routes that read one, `url` on the three with an id
  param. Ten cases, each planting the token somewhere the handler can observe.
- **Decision**: FIXED

### F4 — The header promised a 400 could not masquerade as protection

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Detail**: False for the `url` placement, which deliberately substitutes a 43-char token for a
  uuid in `params.id`. Nothing but statement order keeps that from answering 400 — every one of
  these routes happens to check auth before validating the id.
- **Fix**: The header states the substitution is deliberate and names the ordering it depends on,
  as a property worth keeping true rather than an accident.
- **Decision**: FIXED

### F5 — Hardcoded row counts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Detail**: `expect(await countOf("care_periods")).toBe(1)` encoded the exact seed, so any future
  case seeding another row would turn the file red for a reason unrelated to authorization.
- **Fix**: Each entry exposes a `state()` string captured before the call and compared after —
  seed-independent, and uniform across the five routes.
- **Decision**: FIXED

### F6 — The live-token guard covered only the first case

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Detail**: Verified once in `beforeAll`. `revoke` and the token mint would each invalidate the
  token if they ever succeeded, and later cases would then assert 401 against a dead link — the
  precise thing the header said would make them meaningless.
- **Fix**: Moved to `beforeEach`.
- **Decision**: FIXED

### F7 — Handler cast instead of context cast

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Detail**: Casting the handler to `(c: unknown) => Promise<Response>` means any one-argument
  function satisfies the slot, so a changed route signature would not fail compilation. The three
  established files cast the context and keep the handler typed.
- **Fix**: `handler: APIRoute`; the context is what gets cast.
- **Decision**: FIXED

### F8 — The `it.each` claim was circular

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Detail**: "A new owner route falls under the same guard the day it joins the table" — it falls
  under the guard the day someone remembers to add it. `tests/middleware/auth-gating.test.ts:17`
  does this properly by iterating the exported `PROTECTED_ROUTES`; there is no equivalent registry
  for owner-only API routes.
- **Fix**: The comment now says what is actually free (the placements) and names the manual step.
- **Decision**: FIXED

### F9 — Fourth copy of the context shim

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Detail**: `createFakeCookies` now exists in four test files and there are three incompatible
  `call` signatures.
- **Decision**: NOT FIXED — noted for a future consolidation. Hoisting one shim into
  `tests/helpers/` touches four files and is not this phase's scope.

## Verification after fixes

| Check                 | Result                       |
| --------------------- | ---------------------------- |
| `token-scope.test.ts` | 10 tests, EXIT=0             |
| `pets.post.test.ts`   | 7 tests, EXIT=0              |
| `npm test`            | 34 files / 343 tests, EXIT=0 |
| `npx astro check`     | 0 errors, EXIT=0             |
| `npm run lint`        | 0 errors, EXIT=0             |

## Process note

Three phases, three times the plan's stated premise was wrong and the mutation run — not the
planning — is what revealed it. Worth naming: the plan was written from research, and research
reads code rather than behaviour. A premise about what happens when a guard is removed is a
prediction, and predictions belong in a mutation run before they belong in prose.
