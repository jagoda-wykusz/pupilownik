# A failed sign-out leaves the session alive

## Overview

`src/pages/api/auth/signout.ts` is nine lines and has two silent paths. The one that matters:
`await supabase.auth.signOut()` is called without inspecting `{ error }`, and the route redirects to
`/` regardless. Measured in the installed library, that is not merely an unlogged failure — on a
failed sign-out the session cookies are **never cleared**, so the user is told they signed out and
remains signed in.

This change makes the route clear the cookies itself whichever way `signOut()` goes, log the
failure, and keep the redirect. It also covers the file's second silent path, where `createClient`
returns null and the sign-out is skipped entirely.

## Current State Analysis

```ts
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) {
    await supabase.auth.signOut(); // ← result discarded
  }
  return context.redirect("/"); // ← unconditional
};
```

**The measurement this change rests on**, read from
`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js` (v2.105.3), not from documentation:

```js
if (accessToken) {
  const { error } = await this.admin.signOut(accessToken, scope);
  if (error) {
    if (
      !(
        (isAuthApiError(error) && (error.status === 404 || error.status === 401 || error.status === 403)) ||
        isAuthSessionMissingError(error)
      )
    ) {
      return this._returnResult({ error }); // early return
    }
  }
}
if (scope !== "others") {
  await this._removeSession(); // never reached
}
```

`_removeSession()` is the only path by which the `@supabase/ssr` adapter in `src/lib/supabase.ts`
clears the session cookies. So for any error outside 404/401/403 — a 500 from GoTrue, a timeout, a
network failure — the cookies survive and the route still answers `302 → /`.

### Key Discoveries

- **The repo already named this failure mode and then tested only its absence.**
  `tests/api/signout.test.ts` opens with: _"A sign-out that redirects while leaving the session
  usable is the failure that matters, and it is invisible from the status code."_ All three of its
  cases exercise the success path against the real local stack.
- **That file deliberately does not mock `@/lib/supabase`** — its header says it "exists precisely
  to talk to the real one", which is why the failure path was never reachable from it. The fix's
  test therefore goes in a new file; the existing one stays untouched.
- **The null-client branch is already recorded as knowingly-left.** `test-plan.md:686-697` documents
  it, and gives the reason: _"reaching that branch needs a null-returning mock, and that file exists
  to talk to the real client."_ That reason expires with this change, because the mock arrives.
- **Cookie removal has an observable shape that three green tests depend on.**
  `@supabase/ssr` removes a cookie by writing it through the adapter with an **empty value**
  (`src/lib/supabase.ts` `setAll`), and `signout.test.ts` asserts exactly that: every written name
  matches `/^sb-/` and every value is `""`. A third case asserts that a caller with **no** session
  has nothing written at all. Whatever the fix does on the error path must not break either.
- **The cookie name is derived, not fixed.** Measured in that file's own comment:
  `sb-127-auth-token` against the local stack, i.e. `sb-<project-ref>-auth-token`. The route cannot
  hardcode it; it must read the names off the incoming `Cookie` header. `src/lib/supabase.ts`
  already imports `parseCookieHeader` from `@supabase/ssr` for exactly that.
- **No existing risk covers this.** The seven risks in `test-plan.md` §2 include #2 — _"A protected
  route stops being gated, or signup/signin/session handling lets an **unauthenticated** user reach
  owner data"_. This is the mirror image: an **authenticated** user who believes they are not.

## Desired End State

A sign-out request leaves the browser holding no usable `sb-*` cookie, whether or not GoTrue
answered, and whether or not a Supabase client could be constructed. A failure is recorded in the
log sink with its code and message. The redirect is unchanged, and the three existing cases stay
green.

## What We're NOT Doing

- **No user-facing change.** No new UI state, no error page, no message on the destination. The
  redirect to `/` is unchanged in status and target.
- **No attempt to revoke the token server-side when GoTrue is unreachable.** We clear what we
  control — the browser's cookies. The access token stays cryptographically valid until it expires;
  anyone who captured it earlier still holds a usable credential. That is the accepted limit of this
  fix and must be stated in the code, not implied.
- **No retry loop.** A failed sign-out is not retried; it is recorded and the local session is
  cleared regardless.
- **No change to `tests/api/signout.test.ts`.** Its three cases and its no-mock rule stand.
- **No Sentry / monitoring layer.** `roadmap.md` names that gap; it stays open, which is why this
  change cannot say how often the failure occurs.
- **No change to `signin.ts` / `signup.ts`.** Both already inspect and propagate.
- **No rewrite of the `## Progress` or content of any archived change.** The stale
  _"Waga: NIEZMIERZONA"_ note in `context/archive/2026-09-13-invite-page-silent-failures/change.md`
  stays as written; archived records are immutable (`AGENTS.md` Hard Rules). This change's own
  `change.md` carries the correction.

## Implementation Approach

Phase 1 is one red→green loop driven by `/10x-tdd`. Two red tests come first, and they assert
different things on purpose: one pins the **library premise** the fix depends on, the other pins the
**route's behaviour**. Then the fix, then green. Red and fix share a phase because the ritual commits
only on green.

Phase 2 reconciles the two documents whose claims this change falsifies or leaves incomplete.

## Critical Implementation Details

**Clearing must not break the removal shape three green tests already assert.** `@supabase/ssr`
removes a cookie by writing an empty value through the adapter; `signout.test.ts` asserts every
written name is `sb-`-prefixed and every value is `""`, and separately that a caller with no session
has nothing written. The error-path clearing has to produce something those assertions still accept
— and it must write nothing when the request carried no `sb-` cookie, or the third case breaks.

**The cookie names come from the request, never from a constant.** The project ref is part of the
name (`sb-127-auth-token` locally, a different ref in production). Read them from the incoming
`Cookie` header — `parseCookieHeader` from `@supabase/ssr` is already a dependency and already used
in `src/lib/supabase.ts`.

**Log discipline, as at every other call site.** `error.code` and `error.message` only — never the
whole error object, and nothing session-derived. `eslint.config.js` permits `console.error` in
`src/pages/**/*.ts`, so no config change is needed here.

## Phase 1: Red tests, then make the failure safe

### Overview

Two failing assertions — one on the library, one on the route — then the fix that turns both green
without moving the three existing cases.

### Changes Required:

#### 1. The library premise

**File**: `tests/api/signout-failure.test.ts` (new)

**Intent**: Pin the behaviour the whole fix rests on: when `signOut()` returns an error outside
404/401/403, supabase-js skips its own session removal. If a future version starts clearing
regardless, the fix's manual clearing becomes redundant — and without this case nobody would learn
that; they would inherit dead code under a confident comment.

**Contract**: Build a `createServerClient` with a session in place and a **URL pointing at a closed
port**, so `admin.signOut()` fails with a retryable fetch error rather than an API error. Assert two
things together: the call returned an error, AND the session is still present afterwards. The second
assertion without the first would pass for the wrong reason.

#### 2. The route's failure path

**File**: `tests/api/signout-failure.test.ts`

**Intent**: Drive the real route handler with a mocked `@/lib/supabase` whose client returns
`{ error }` from `signOut()`, and assert the route clears the caller's `sb-` cookies anyway and still
redirects. A second case covers `createClient` returning `null`.

**Contract**: `vi.mock("@/lib/supabase")`. This is the file where mocking is allowed, and the header
must say why it exists separately from `tests/api/signout.test.ts` — that file talks to the real
client by design, and its own header names the mock as the reason the failure path went untested.
Reuse the fake-cookies shape from that file rather than inventing a second one, extended so a
removal is observable.

#### 3. The route

**File**: `src/pages/api/auth/signout.ts`

**Intent**: Inspect the result, clear the caller's session cookies on every path, log a failure, keep
the redirect.

**Contract**: On an error from `signOut()` — and in the `createClient === null` branch — remove every
incoming `sb-`-prefixed cookie, then `console.error("signout failed:", error.code, error.message)`
following the shape the six other routes use. The success path is unchanged: supabase-js clears the
cookies itself and the route must not clear them twice. See Critical Implementation Details for the
removal shape and the name derivation. State in a comment what this does NOT do — the token stays
valid server-side.

### Success Criteria:

#### Automated Verification:

- Both new assertions FAIL against the unmodified route, each for its own stated reason
- `npx vitest run tests/api/signout-failure.test.ts` passes after the fix
- `npx vitest run tests/api/signout.test.ts` — all three existing cases still pass, unmodified
- `npm run lint` passes with `--max-warnings 0`
- `npm run check` passes
- `npx vitest run` — full suite green
- Deliberate break: remove the cookie-clearing from the error path and confirm the route case goes
  red while the library case stays green; reverted

#### Manual Verification:

- The log line carries only `code` and `message` — read it, do not infer
- The comment states the accepted limit (the token remains valid server-side) rather than implying
  the session was revoked

**Implementation Note**: kill the dev server before `npm run check` / `git commit`. Pause for
confirmation before Phase 2.

---

## Phase 2: Reconcile the risk map and §7

### Overview

One recorded decision expires; one risk class is missing from the map.

### Changes Required:

#### 1. The §7 entry that this change falsifies

**File**: `context/foundation/test-plan.md`

**Intent**: The entry at §7 records the null-client no-op as left-unfixed, and gives as its reason
that reaching the branch "needs a null-returning mock, and that file exists to talk to the real
client". Both halves change: the branch is now fixed, and the mock exists in a new file.

**Contract**: Rewrite the entry to say what became covered and how, keeping the original reasoning
visible as the record of why it stood until now. Add what the change measured about `signOut()`'s
error path, since §7 is where this project records measurements that correct earlier beliefs.

#### 2. The eighth risk

**File**: `context/foundation/test-plan.md`

**Intent**: §2's seven risks do not contain this class — an authenticated user who believes they
signed out and did not. Risk #2 is its mirror and does not cover it.

**Contract**: One new row. **Likelihood must be recorded as unmeasured**, not guessed: this project
has no application monitoring (`roadmap.md`), so nobody knows how often GoTrue answers with an error
outside 404/401/403. The table's value comes from its weights being measured; an invented one would
cost more than the row adds. Add the matching Risk Response Guidance row, including the anti-pattern
this change already hit — asserting the redirect instead of the cookie's fate.

#### 3. change.md

**File**: `context/changes/signout-swallows-failure/change.md`

**Intent**: Status and date.

**Contract**: `status: implemented`, `updated: <today>`.

### Success Criteria:

#### Automated Verification:

- `npm run check:links` passes
- `npx vitest run` passes, including `tests/unit/test-plan-shape.test.ts` (it constrains §8's shape;
  confirm the §2 and §7 edits leave it alone)
- `npm run ci:gate` passes with the dev server killed first

#### Manual Verification:

- The new risk row's likelihood says unmeasured and says why, rather than carrying a number
- Every new sentence in §7 was read against the code at the moment of writing

**Implementation Note**: this is the phase `lessons.md` warns about twice — an aspirational sentence
becoming a record, and a correction applied in one place while another still says the old thing.

---

## Testing Strategy

### Unit Tests:

None. Nothing here is a pure function.

### Integration Tests:

`tests/api/signout-failure.test.ts` — the library premise against a closed port, and the route's two
failure paths against a mocked client. The existing `tests/api/signout.test.ts` keeps the success
path against the real stack; the split is deliberate and documented in both headers.

### E2E Tests:

None. Nothing rendered changes.

### Manual Testing Steps:

1. `npm run db:start`, `npm run dev`.
2. Sign in, sign out, confirm the session ends as before — the success path must be untouched.
3. Read the new log line and confirm it carries no session-derived value.

## Performance Considerations

None. One cookie-header parse on a path that already redirects.

## Migration Notes

None. No schema change, no data migration, no change to any response status or target.

## References

- The measurement: `context/changes/signout-swallows-failure/change.md`
- The route: `src/pages/api/auth/signout.ts`
- The success-path suite and its no-mock rule: `tests/api/signout.test.ts`
- The recorded decision this change retires: `context/foundation/test-plan.md` §7
- Where the finding was first raised and deferred: `context/archive/2026-09-13-invite-page-silent-failures/`
- Recurring rules that bind this plan: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Red tests, then make the failure safe

#### Automated

- [x] 1.1 Both new assertions FAIL against the unmodified route, each for its own reason — 383ce1a
- [x] 1.2 `npx vitest run tests/api/signout-failure.test.ts` passes after the fix — 383ce1a
- [x] 1.3 The three existing cases in `tests/api/signout.test.ts` still pass, unmodified — 383ce1a
- [x] 1.4 `npm run lint` passes with `--max-warnings 0` — 383ce1a
- [x] 1.5 `npm run check` passes — 383ce1a
- [x] 1.6 `npx vitest run` — full suite green — 383ce1a
- [x] 1.7 Deliberate break: removing the error-path clearing reddens the route case, not the library case; reverted — 383ce1a

#### Manual

- [x] 1.8 The log line carries only `code` and `message` — 383ce1a
- [x] 1.9 The comment states the accepted limit rather than implying revocation — 383ce1a

### Phase 2: Reconcile the risk map and §7

#### Automated

- [x] 2.1 `npm run check:links` passes — 603143a
- [x] 2.2 `npx vitest run` passes, `test-plan-shape` included — 603143a
- [x] 2.3 `npm run ci:gate` passes with the dev server killed first — 603143a

#### Manual

- [x] 2.4 The new risk row records likelihood as unmeasured, and why — 603143a
- [x] 2.5 Every new sentence in §7 was read against the code when written — 603143a
