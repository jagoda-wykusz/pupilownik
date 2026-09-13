<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: The caretaker page's two silent RPC failures

- **Plan**: `context/changes/invite-page-silent-failures/plan.md`
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-09-13
- **Verdict**: NEEDS ATTENTION → all 7 findings triaged; 6 fixed, 1 accepted as a recorded trade-off
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension           | Verdict (at review) | After triage |
| ------------------- | ------------------- | ------------ |
| Plan Adherence      | PASS                | PASS         |
| Scope Discipline    | PASS                | PASS         |
| Safety & Quality    | WARNING             | PASS         |
| Architecture        | PASS                | PASS         |
| Pattern Consistency | WARNING             | PASS         |
| Success Criteria    | PASS                | PASS         |

Verified independently before triage: **no behavioural drift**. The `:144` ternary → `if`/`else` is
identical in predicate and in both assignments. All seven "What We're NOT Doing" boundaries held —
no rendered change, no 500 for a failed reveal, no logger library, no other `.astro` touched, no new
automated recurrence guard beyond the lesson, `src/lib/**` lint scoping untouched, no test for
`:92`'s error card.

## Findings

### F1 — Widening the lint allowlist invalidated another file's guard premise

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `eslint.config.js:119` + `src/pages/periods/[id].astro:52,85,122`
- **Detail**: The allowlist now covers ten `.astro` files. `periods/[id].astro` reads `claim_digest`
  (the SHA-256 of a bearer secret) and `caretaker_note` in frontmatter, and
  `tests/unit/period-detail-source.test.ts:7` EXPLICITLY permits that — "because that runs on the
  server" — while guarding only the template. That permission rested on an unstated premise:
  frontmatter had no way to emit anything, because `no-console` was scoped to `*.ts` and
  `--max-warnings 0` blocked a page-level `console.error`. This change created the emit path, so the
  premise expired in a commit that never touched that file. `console.error(slot.claim_digest)` would
  have linted clean and passed the whole suite.
- **Fix**: add a frontmatter case to `period-detail-source.test.ts` forbidding `digest` /
  `caretaker_note` inside any `console.error` / `console.warn` call.
- **Decision**: FIXED. Proven by mutation: injecting
  `console.error("debug slot:", period?.care_slots?.[0]?.claim_digest)` into that page's frontmatter
  turns the new case red with "a log line carries the claim digest"; reverted.

### F2 — The credential guard failed open in three shapes

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `tests/unit/invite-source.test.ts`, `logCalls()`
- **Detail**: Measured, with one correction to the sub-agent that raised it. Real holes:
  `/\bclaimSecret\b/` does **not** match `rawClaimSecret` (verified: `false`) — and that is the raw,
  ungated cookie value in scope two lines away; the regex scanned only `console.error` while the
  allowlist also permits `warn`; and a `);` inside a string literal truncates the argument list.
  **Not** a hole, contrary to the report received: nested parens such as `String(error.code)` do not
  truncate, because that text contains no `);` — verified by running the regex. Every genuine failure
  mode pointed the same way: a **false pass**.
- **Fix**: parenthesis-balanced argument extraction; cover `console.(error|warn)`; exact-count
  control instead of `>= 2`; substring `/token/i` and `/secret/i` instead of word boundaries, applied
  after stripping the leading message literal.
- **Decision**: FIXED. Proven by mutation: adding `rawClaimSecret` to the reveal log call turns the
  case red — the shape the old assertion passed; reverted.

### F3 — The test header's stated justification was false

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: `tests/unit/invite-source.test.ts` (second `describe` header)
- **Detail**: It claimed forcing an RPC failure "needs grant manipulation or a transport fault — a
  new pattern in this repo". Verified false: `tests/rls/reveal-instructions.test.ts:491` already
  forces a deterministic `42501` out of **this same function** with a `service_role` client, and two
  further files do the same for theirs. The chosen level (source) is defensible; its written reason
  was not — and this repo treats an overclaiming justification as a defect in itself.
- **Fix**: rewrite the paragraph around the real barrier — producing the error is cheap, _observing
  the log line_ is what has no harness (workerd stdout capture) — citing `reveal-instructions.test.ts:491`.
- **Decision**: FIXED.

### F4 — The token already reaches the log sink by a path this change does not control

- **Severity**: 💡 OBSERVATION
- **Dimension**: Safety & Quality
- **Location**: `wrangler.jsonc:42`
- **Detail**: Observability is enabled with no `logs.invocation_logs: false` and no sampling, so
  every request URL is recorded — and for the caretaker page the URL _is_ the credential,
  `/invite/<token>`. The never-log-the-token discipline at the call sites is correct but narrower
  than the surrounding prose implies.
- **Fix**: record it at `wrangler.jsonc`; do not disable invocation logs, which would cost the
  request-level signal that makes an outage diagnosable.
- **Decision**: FIXED (recorded as a knowingly-taken trade-off, not changed).

### F5 — `error.message` is unbounded

- **Severity**: 💡 OBSERVATION
- **Dimension**: Safety & Quality
- **Location**: `src/pages/invite/[token].astro` (both log calls)
- **Detail**: `postgrest-js` falls back to `{ message: await res.text() }` for a non-JSON error
  response, so an upstream gateway's HTML body can land verbatim in the log. Log bloat / newline
  injection, not disclosure.
- **Fix**: `String(error.message).slice(0, 500)` if it ever matters.
- **Decision**: SKIPPED — truncating an error message cuts the diagnostic exactly when it is needed,
  and the failure mode is noise rather than leakage.

### F6 — A third branch on the same page was still silent

- **Severity**: 💡 OBSERVATION
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/invite/[token].astro:106-108`
- **Detail**: The `else { loadError = true }` reached when `createClient` returns null degraded to
  the same error card and recorded nothing — literally the defect this change's own new lesson
  describes, one `else` away from the branch it was written for. `src/pages/api/auth/signin.ts:43`
  logs the identical state.
- **Fix**: log it with signin.ts's wording.
- **Decision**: FIXED.

### F7 — The client-`<script>` exclusion was real but undocumented

- **Severity**: 💡 OBSERVATION
- **Dimension**: Architecture
- **Location**: `eslint.config.js`
- **Detail**: `eslint-plugin-astro`'s `astro/client-side-ts` processor extracts `<script>` bodies into
  virtual files named `**/*.astro/*.js`, whose basename no longer matches the `**/*.astro` glob — so a
  `console.*` in a page's client script still falls under the base `warn` and still fails
  `--max-warnings 0`. Structurally safe, not accidentally safe, and the block documents its two other
  standing assumptions in exactly this style.
- **Fix**: one sentence recording the processor's virtual-file naming.
- **Decision**: FIXED.

## Verification after triage

| Check                                                        | Result                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `npx vitest run`                                             | 46 files / **432** tests (was 431 — the new `period-detail-source` case) |
| `npm run ci:gate`                                            | exit 0, port 4321 verified free first                                    |
| `npm run lint` / `npm run check`                             | exit 0 / 0 errors, 0 warnings                                            |
| `npm run check:links`                                        | clean, 544 references                                                    |
| Mutation: `rawClaimSecret` in a log call                     | F2's hardened guard goes red                                             |
| Mutation: `claim_digest` in `periods/[id].astro` frontmatter | F1's new guard goes red                                                  |
| `git status src/`                                            | clean of both mutations                                                  |

## Not fixed, deliberately

- **F5** — see above.
- **`src/pages/api/auth/signout.ts`** — the swallowed error found mid-implementation and recorded in
  `change.md`. Still unfixed and its consequence still unmeasured; it needs its own change, starting
  with a measurement of whether a failed `signOut()` leaves a live session.
