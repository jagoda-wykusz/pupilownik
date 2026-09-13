# A failed sign-out leaves the session alive — Plan Brief

> Full plan: `context/changes/signout-swallows-failure/plan.md`

## What & Why

`src/pages/api/auth/signout.ts` discards the result of `supabase.auth.signOut()` and redirects to `/`
regardless. Measured in the installed library rather than assumed: when that call errors outside
404/401/403, supabase-js returns **before** `_removeSession()`, which is the only path by which the
`@supabase/ssr` adapter clears the session cookies. So a failed sign-out leaves the browser holding a
working session while telling the user they signed out.

## Starting Point

The repo already named this exact failure — `tests/api/signout.test.ts` opens with _"A sign-out that
redirects while leaving the session usable is the failure that matters, and it is invisible from the
status code"_ — and then tested only the success path, because reaching the failure path needs a
mock and that file exists to talk to the real client. The finding surfaced during the
`invite-page-silent-failures` audit and was deferred there with its severity explicitly marked
unmeasured; measuring it is what opened this change.

## Desired End State

A sign-out leaves no usable `sb-*` cookie in the browser whether or not GoTrue answered, and whether
or not a Supabase client could be built. Failures reach the log with their code and message. The
redirect, and the three existing green cases, are unchanged.

## Key Decisions Made

| Decision                     | Choice                                           | Why (1 sentence)                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Behaviour on failure         | Clear the cookies anyway, log, keep the redirect | The shared-machine case is what actually hurts, and the browser's cookie is the half we control; a 500 that leaves the session alive is honest and practically worse. |
| Where the failure test lives | A new file that mocks `@/lib/supabase`           | `signout.test.ts` names the no-mock rule as its reason for existing and for not covering this path; two files, two roles.                                             |
| Pin the library premise      | Yes, its own case                                | The fix's manual clearing is only necessary while supabase-js skips its own cleanup on error; if that changes, nobody would find out without this.                    |
| Scope                        | Both silent paths in the file                    | It is nine lines with two of them, and §7's reason for leaving the second ("needs a mock") expires with this change.                                                  |
| Risk map                     | Add an eighth row, likelihood **unmeasured**     | Chosen over widening risk #2; the honest cost is that without monitoring nobody knows the frequency, so the row says so instead of inventing a weight.                |

## Scope

**In scope:** `signout.ts`'s two silent paths; a new failure-path test file; the library-premise
case; `test-plan.md` §7 and an eighth §2 risk row.

**Out of scope:** any user-facing change; server-side token revocation when GoTrue is unreachable;
retries; edits to `signout.test.ts`; Sentry; `signin.ts` / `signup.ts`; any edit to the archived
change that first raised this.

## Architecture / Approach

```
POST /api/auth/signout
  ├─ createClient() === null ──────────────► clear sb-* cookies, log, redirect   (was: skip, redirect)
  └─ signOut()
       ├─ ok    ── supabase-js clears cookies ─► redirect                        (unchanged)
       └─ error ── supabase-js SKIPS clearing ─► clear sb-* ourselves, log, redirect   (was: redirect)
```

Cookie names are read from the incoming `Cookie` header — the project ref is part of the name
(`sb-127-auth-token` locally) so nothing may be hardcoded.

## Phases at a Glance

| Phase                      | What it delivers                                                             | Key risk                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Red tests → fix → green | Both silent paths clear the session and report; two new cases, one per claim | Breaking the removal _shape_ three existing green cases assert: names `sb-`-prefixed, values empty, and nothing written when the caller sent no session |
| 2. §7 + the eighth risk    | Documents say what is true; the risk class is on the map                     | Recording an invented likelihood in a table whose value is that its weights are measured                                                                |

**Prerequisites:** local Supabase for the existing suite; dev server killed before `check` / `commit`.
**Estimated effort:** ~1 session, 2 phases.

## Open Risks & Assumptions

- **The fix clears what we control, not what we do not.** The access token stays cryptographically
  valid until it expires; anyone who captured it earlier still holds a usable credential. This is the
  accepted limit, to be stated in the code rather than implied away.
- **Frequency is unknown and stays unknown.** There is no application monitoring, so this change
  cannot say whether the failure ever happens in production — only that when it does, it is silent
  today and will not be after.
- **The library premise is a third-party behaviour.** Pinning it means a dependency upgrade can turn
  that case red without anything of ours being wrong — which is the point, but it should not read as
  a regression when it happens.

## Success Criteria (Summary)

- A sign-out whose `signOut()` errors still leaves the caller's `sb-*` cookies cleared, and says so
  in the log.
- Removing the error-path clearing reddens the route case and leaves the library case green.
- The three existing cases in `tests/api/signout.test.ts` pass unmodified.
