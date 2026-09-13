<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: First E2E test — the caretaker reveal chain

- **Plan**: `context/changes/e2e-invite-reveal/plan.md`
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-09-13
- **Verdict**: NEEDS ATTENTION → all 10 findings triaged and fixed in-session
- **Findings**: 1 critical, 6 warnings, 3 observations

## Verdicts

| Dimension           | Verdict (at review) | After triage                       |
| ------------------- | ------------------- | ---------------------------------- |
| Plan Adherence      | WARNING             | PASS                               |
| Scope Discipline    | PASS                | PASS                               |
| Safety & Quality    | WARNING             | PASS                               |
| Architecture        | PASS                | PASS                               |
| Pattern Consistency | WARNING             | PASS                               |
| Success Criteria    | FAIL                | PENDING — 3.5 awaits a real CI run |

Scope Discipline was clean on every count and is worth recording: `ci:gate` untouched, zero changes
under `src/` or `supabase/`, no visual/snapshot assertion, no Risk #3 test, `tests/helpers/` imported
rather than forked.

## Findings

### F1 — Criterion 3.5 was checked against a CI run that never executed the E2E job

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/e2e-invite-reveal/plan.md` row 3.5; branch `ci/e2e-verify`
- **Detail**: `git ls-remote origin ci/e2e-verify` resolved to `2bfa98c` (phase 2). The workflow's
  E2E steps landed in `7023efb` (phase 3), which was not on that branch — the branch was pushed
  before phase 3 was committed. The green run executed the OLD workflow. Consequently
  `--with-deps` on a bare ubuntu runner, step ordering, and whether the CI dev server receives
  Supabase configuration at all remained unverified. That last one is a live risk: the workflow
  writes `.env.test` (read by node-side clients) but not `.dev.vars`, and both env vars are
  `optional: true`, so a misconfigured server degrades silently and every test fails on a missing
  element — indistinguishable from a product bug.
- **Fix**: force-push current HEAD to `ci/e2e-verify`; revert 3.5 to `- [ ]` until a run actually
  executes the E2E step.
- **Decision**: FIXED — branch now at `36131b2` (contains `7023efb`); row 3.5 reverted to pending.

### F2 — The CI artifact upload step is a no-op

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml:181-187`
- **Detail**: `reporter` is `[["github"], ["list"]]` — no `html` reporter, so `playwright-report/`
  is never written (confirmed: the directory does not exist after five runs). Traces and
  screenshots land in `test-results/`, which was not uploaded. `if-no-files-found` defaults to
  `warn`, so the step went green and empty — the "green without evidence" mode the config's own
  comment argues against.
- **Fix**: point at `test-results/`, add `if-no-files-found: error`, drop retention to 3 days, and
  document that a trace embeds the sign-in POST body.
- **Decision**: FIXED

### F3 — Fixture teardown swallowed errors and orphaned rows on early failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality
- **Location**: `tests/e2e/fixtures/invite.ts:88-96`
- **Detail**: Neither `.delete()` checked `error`, unlike `tests/rls/*` and `seed.spec.ts`. Worse,
  Playwright runs the second half of a fixture only if `provide` was reached — so a throw from the
  instruction insert or the RPC skipped teardown entirely and orphaned the owner and pet.
- **Fix**: wrap everything after `createOwnerWithPet` in `try/finally`; record delete errors and
  re-throw after the block.
- **Decision**: FIXED. **Note the correction inside the fix**: the first attempt threw from inside
  `finally`, which `no-unsafe-finally` rejected — correctly, because a throw there REPLACES an
  exception already in flight and would have masked the seeding failure it was meant to preserve.
  The comment had claimed the opposite ("a seeding error in flight takes precedence"). Errors are
  now recorded and thrown after the block, which gives the stated semantics.

### F4 — The delete-ordering comment was factually wrong

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: `tests/e2e/fixtures/invite.ts:88-90`
- **Detail**: The comment claimed "deleting the pet while a period still points at it is the one
  ordering that can fail". Both `care_period_pets` foreign keys are `on delete cascade`
  (`supabase/migrations/20260906165005_period_pets_relation.sql:19-20`), so pet-first SUCCEEDS —
  it cascades the junction row away and leaves a childless period. The chosen ordering is right;
  its stated justification was invented. In a repo whose house style is "measured, not assumed", a
  confidently wrong claim is worse than no comment.
- **Fix**: rewrite with the real reason.
- **Decision**: FIXED

### F5 — §4's preamble contradicted the row updated in the same edit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Plan Adherence
- **Location**: `context/foundation/test-plan.md:162-163` and the build-artifact row
- **Detail**: "The classic test base for this project: **none yet** (no runner configured, 0 test
  files)" stood three lines above the row recording a working Playwright ^1.63. The
  "build-artifact checks … none yet" row was equally false — `npm run check:secrets` ships and
  blocks publication. This is exactly the `lessons.md` rule about correcting a document in one
  place and believing it corrected.
- **Fix**: put the preamble in the past tense with a measured current-state paragraph (46 vitest
  files / 428 tests, 4 Playwright tests in 2 spec files); point the build-artifact row at the real
  script.
- **Decision**: FIXED

### F6 — seed.spec.ts cleanup was skippable and its success unverifiable

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality
- **Location**: `tests/e2e/seed.spec.ts:63-67`
- **Detail**: Cleanup sat in the test body, so any earlier failure leaked a `pets` row — the very
  anti-pattern (#5) the file's header claims to demonstrate, in the file a generator copies.
  Separately, `expect(error).toBeNull()` passes for a delete matching ZERO rows: PostgREST reports
  no error for an empty delete.
- **Fix**: move to `test.afterEach`; assert `.select("id")` returns exactly one row.
- **Decision**: FIXED

### F7 — The plan still specified a `status` value outside the allowed set

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Plan Adherence
- **Location**: `context/changes/e2e-invite-reveal/plan.md`, Phase 3 item 6
- **Detail**: Contract said `status: complete`, which is not in `change-md.md`'s allowed set.
  `implemented` was used at execution time, but the correction lived only in the epilogue commit
  message — the weakest paper trail of the six recorded drifts.
- **Fix**: correct the plan with a short note naming the allowed set.
- **Decision**: FIXED

### F8 — A fixture imported a type from a setup file

- **Severity**: 💡 OBSERVATION
- **Dimension**: Pattern Consistency
- **Location**: `tests/e2e/fixtures/owner.ts:6`
- **Detail**: `OwnerCredentials` was imported from `auth.setup.ts`. It worked only because
  `import type` is erased before Playwright loads the module; dropping the word `type` would pull
  `setup(...)` into the graph and Playwright would refuse with "test() can only be called in a test
  file".
- **Fix**: move the interface into `fixtures/owner.ts` and have `auth.setup.ts` import it from
  there, so no test file is ever in anyone's module graph.
- **Decision**: FIXED

### F9 — The slot locator depended on the island's default day selection

- **Severity**: 💡 OBSERVATION
- **Dimension**: Safety & Quality
- **Location**: `tests/e2e/invite-reveal.spec.ts` (three claim blocks)
- **Detail**: The seeded trip spans two days, so `create_period_with_slots` generates two "Rano"
  slots. `getByRole("button", { name: /^Rano/ })` resolved to one only because `ClaimSlots` renders
  a single selected day. If that default moves, the locator matches two elements and fails with a
  strict-mode violation that reads like a product bug.
- **Fix**: extract a `claimMorningSlot` helper that selects the day explicitly first.
- **Decision**: FIXED — and re-verified by re-running Mutation B after the refactor: only the
  island-props test goes red, the other two stay green, so the guard survived the extraction.

### F10 — Two silent failure modes: hydration blindness and a stale credentials file

- **Severity**: 💡 OBSERVATION
- **Dimension**: Safety & Quality
- **Location**: `tests/e2e/fixtures/hydration.ts`, `tests/e2e/fixtures/owner.ts`
- **Detail**: `waitForHydration` keys off the `ssr` attribute, which a `client:only` island never
  carries — it would report ready while the component loads. (Verified safe today: every island in
  `src/` is `client:load`.) Separately, `owner-credentials.json` survives a `supabase db reset`, so
  it can name a user that no longer exists — or one that exists but is a different owner, in which
  case sign-in succeeds, RLS scopes the cleanup delete to nobody, and the test goes green having
  cleaned up nothing.
- **Fix**: document the `client:load` precondition in the helper and in `e2e-rules.md` §7, add a
  `> 0` island control, and make `ownerClient()` assert the signed-in user id matches the file.
- **Decision**: FIXED

## Verification after triage

| Check                                   | Result                                        |
| --------------------------------------- | --------------------------------------------- |
| `npm run test:e2e` ×2                   | 5 passed / 5 passed                           |
| Mutation B re-run after the F9 refactor | only the island-props test red — guard intact |
| `npm run ci:gate`                       | exit 0                                        |
| `npx vitest run`                        | 46 files / 428 tests                          |
| `npm run lint` / `npm run check`        | exit 0 / 0 errors, 0 warnings                 |
| `npm run check:links`                   | clean                                         |
| `git status src/ supabase/`             | clean — no mutation residue                   |

## Still open

- **Progress row 3.5** is deliberately `- [ ]`. It may be checked only after a CI run that actually
  executes the "E2E — the caretaker reveal chain" step on branch `ci/e2e-verify` (now at
  `36131b2`). F1's underlying risk — whether the CI dev server receives Supabase configuration —
  is resolved by that run, not by this review.
