<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: A failed sign-out leaves the session alive and redirects as if it succeeded

- **Plan**: context/changes/signout-swallows-failure/plan.md
- **Scope**: full plan (2 phases)
- **Date**: 2026-09-13
- **Verdict**: REJECTED on first pass → all 10 findings triaged and resolved the same day
- **Findings**: 1 critical, 5 warnings, 4 observations

## Verdicts

| Dimension           | Verdict                     |
| ------------------- | --------------------------- |
| Plan Adherence      | PASS                        |
| Scope Discipline    | PASS                        |
| Safety & Quality    | FAIL → resolved (F1, F6)    |
| Architecture        | PASS                        |
| Pattern Consistency | WARNING → resolved (F9)     |
| Success Criteria    | WARNING → resolved (F2, F3) |

## Findings

### F1 — `cookies.delete` turns a hostile cookie name into a 500

- **Severity**: CRITICAL
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/signout.ts:34
- **Detail**: `parseCookieHeader` accepts names that `cookie.serialize` — which `delete` calls —
  rejects with a `TypeError`. Measured: `["sb-a b", "sb-ą", "sb-ok"]` → the first two throw. The
  route's own header promises "One exit, whatever happened"; this change introduced a path that
  breaks that promise with a 500, and the real session cookie later in the header never gets
  cleared. Reachability was narrowed during the fix: a header value is a ByteString, so
  `new Request` rejects `sb-ą` before the route sees it. A SPACE in the name passes that gate.
- **Fix**: wrap the loop body in try/catch; skipping is correct rather than a swallow, because a
  name we cannot serialize cannot be a name `@supabase/ssr` wrote.
- **Decision**: FIXED. Pinned by "still redirects when a cookie name cannot be serialized";
  mutation-tested — removing the try/catch turns that case red.

### F2 — the cookie fake could not tell the fix from a no-op

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: tests/api/signout-failure.test.ts:46
- **Detail**: the fake's `delete(name)` took no options, so nothing asserted `{ path: "/" }`.
  Regressing the route to `delete(name)` — which a browser ignores, clearing nothing — left all
  four cases green.
- **Fix**: record the options in the fake (`removals`) and assert them.
- **Decision**: FIXED. Mutation-tested — dropping the path option turns the error-path case red.

### F3 — §7 claimed both paths log `code` and `message`

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md (§7, signout entry)
- **Detail**: the null-client path logs a static string; there is no error object on that branch.
  The 2.5 verification printed the disproving output and the claim went in anyway.
- **Fix**: state the difference and why it exists, so a reader grepping for a `code` that is not
  there reads it as the branch, not as a lost log.
- **Decision**: FIXED.

### F4 — the probe reads as contradicting `signout.test.ts:99`

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md (§7, "What the fix does NOT do")
- **Detail**: "a probe confirmed the captured token still authenticates" sits beside a test named
  "leaves the caller's cookie unable to authenticate". Two different objects on two different
  paths, but nothing said so.
- **Fix**: spell out the distinction — success path + cookie vs. failure path + captured token.
- **Decision**: FIXED.

### F5 — `{ path: "/" }` is an assumption, not a measurement

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/signout.ts (clear loop) / src/lib/supabase.ts
- **Detail**: correct only while `createServerClient` gets no `cookieOptions`. Measured:
  `cookieOptions` appears nowhere under `src/` or `tests/`. Adding one would silently stop every
  delete from matching, with the whole suite still green.
- **Fix**: record it in §7 as the fix's one standing assumption, naming the failure mode.
- **Decision**: FIXED (recorded, not guarded — a guard here would pin library defaults).

### F6 — a mid-request refresh stages a session the loop never sees

- **Severity**: WARNING
- **Impact**: HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/signout.ts (clear loop)
- **Detail**: measured in `GoTrueClient.js` v2.105.3 — `_signOut()` runs inside `_useSession()`,
  whose `__loadSession()` calls `_callRefreshToken()` when the session is within
  `EXPIRY_MARGIN_MS`, persisting through the adapter's `setAll`. The sign-out attempt can therefore
  stage a FRESH session under re-chunked names the request header never carried, and then fail.
  Clearing only the request's names would emit a working session in the response that says
  "signed out".
- **Fix**: union the request's names with Astro's outgoing jar (`cookies.headers()`), snapshotted
  before iterating. `delete` replaces an outgoing entry by name, so a staged set becomes a removal.
- **Decision**: FIXED. Pinned by "clears a session the request never carried, staged by a
  mid-request refresh"; mutation-tested — restricting the loop to request names turns it red.

### F7 — the §7 restatement mangled the original and dropped a measurement

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md (§7, "What this said until now")
- **Detail**: the em-dash clauses scrambled "a claim about reachability, not about a gate", and the
  restatement dropped the concrete fact that `npm run check:secrets` does exit 2 without the env
  vars — leaving only the rebuttal, which reads as if the original had been simply wrong.
- **Fix**: rewrite the sentence; restore the measurement alongside its rebuttal.
- **Decision**: FIXED.

### F8 — risk #8's `High` Impact reads as measured

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md (§2 preamble)
- **Detail**: the preamble explains why likelihood is `unmeasured` and says nothing about Impact,
  so `High` next to an empty likelihood looks like the measured half of the pair.
- **Fix**: name it as reasoned from consequence, the same as every other Impact in the table.
- **Decision**: FIXED.

### F9 — dead defensiveness in the new test file

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/api/signout-failure.test.ts:91
- **Detail**: `anonKey ? "http://127.0.0.1:1" : ""` pretends to handle a missing key that
  `getTestEnv()` never produces, and `createFakeCookies(seed)` took a parameter no caller passed.
- **Fix**: drop both.
- **Decision**: FIXED.

### F10 — `tests/rls/release-reveal.test.ts` flakes and nothing said so

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/rls/release-reveal.test.ts
- **Detail**: one failure in three full-suite runs during this change, then green. Measured again
  in isolation: five consecutive runs, 4/4 each time. So it is a suite-level interaction, not a
  defect in that file, and it predates this change.
- **Fix**: record it in §7 — seen, NOT diagnosed, and "it passed on retry" is not the end of it.
- **Decision**: FIXED (recorded; diagnosis is its own change).

## Verification after triage

- `npm run ci:gate` — green (229 unit+component, 32 render, bundle scan clean)
- `npx vitest run --project=integration` — 24 files, 209 tests, green
- Mutation-tested: the F1, F2 and F6 assertions each go red when their fix is reverted
