# The caretaker page's two silent RPC failures

## Overview

`src/pages/invite/[token].astro` calls two RPCs and swallows the error from both. Neither writes
anything to the log sink. The second one is the more serious: when `get_claimed_details` fails, a
caretaker who HAS claimed a slot is served the pre-claim page with status 200 — their instructions
simply vanish — and nobody, on either side of the screen, learns that anything went wrong.

This change makes both failures visible **in the logs** without changing a single byte of what a
visitor sees. The user-facing behaviour and the page's uniform-failure property are deliberately
untouched.

## Current State Analysis

A full sweep for the M3L5 pattern (a `catch` or an `if (error)` that logs or swallows and still
returns success) was run before this change opened. It is recorded in `change.md`; the summary:

| Layer                                                                          | Result                                                                                       |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 6 API routes (`periods`, `pets`, `revoke`, `release`, `token`, `invite/claim`) | clean — `console.error("… failed:", error.code, error.message)` then `500` or a mapped `4xx` |
| `src/lib/`, middleware                                                         | clean                                                                                        |
| client islands                                                                 | clean — every `catch` sets a user-visible message                                            |
| `InviteLinkPanel.tsx:33`                                                       | benign and documented — the clipboard may refuse; the link is on screen anyway               |
| `res.json().catch(() => null)` ×2                                              | benign — parsing a body that may not be JSON; the status is handled separately               |
| **`src/pages/invite/[token].astro` ×2**                                        | **the finding**                                                                              |

> **Corrected during Phase 2.** This table's first row reads as a claim about the whole API layer,
> but the sweep behind it opened the six routes it names plus `signin`/`signup` and never opened
> `auth/signout.ts` — which does not inspect `signOut()`'s result at all. The table is left as
> written because it is the record of what was believed at planning time; the correction, and why
> the fix is deliberately out of this change's scope, is in `change.md`.

The two branches:

- **`:87-93`** — `get_period_by_token` fails → `loadError = true`. The visitor gets an error card,
  which is correct; but the server records nothing, so a persistent RPC failure is invisible.
- **`:137-144`** — `get_claimed_details` fails → `claimed = error ? null : …`. Nothing at all
  happens: no log, and the visitor is silently downgraded to the pre-claim view.

The measurement this change rests on: **`grep -rn "console\." src/pages/**/\*.astro` returns 0.\*\*

### Key Discoveries

- **Lint currently forbids the obvious fix.** `eslint.config.js:105-118` relaxes `no-console` to
  `["error", { allow: ["error", "warn"] }]` for `files: ["src/pages/**/*.ts"]` only. The `.astro`
  block (`eslint.config.js:120+`) does not touch `no-console`, so the base `"warn"` applies — and
  `npm run lint` runs with `--max-warnings 0` inside `npm run ci:gate`. A `console.error` added to
  this page today **fails the publish gate**.
- **No test asserts the contents of `eslint.config.js`.** Both files that mention it
  (`tests/unit/ci-gate-source.test.ts`, `tests/render/island-props.test.ts`) do so in comments
  only — verified by reading the assertions, not the greps. So extending the allowlist breaks
  nothing. But `ci-gate-source.test.ts:138` states "`no-console` is `error` only for
  `src/pages/**/*.ts`", and that sentence becomes false with this change.
- **The page already has a source-level test file, with exactly the right machinery.**
  `tests/unit/invite-source.test.ts` pins six frontmatter properties of this page and carries
  `stripFrontmatterComments()` (`:51-55`), which removes comments before asserting — built to stop
  a guard passing on its own rationale. That is the `lessons.md` §"Asercja podciągiem trafia we
  własne uzasadnienie" defence, already written. New assertions reuse it.
- **Uniform failure is a pinned security property.** `tests/unit/invite-view.test.ts` pins that
  unknown, tampered, malformed and revoked tokens produce identical status, title and body. Nothing
  in this change may alter a rendered byte, which is why "log only" was chosen over a visible
  notice.
- **The log sink exists and is enabled.** `wrangler.jsonc:42` turns on Workers observability, and
  `test-plan.md` records that `console.error` IS this project's log sink — there is no logging
  library by decision. So `console.error` is not a placeholder here; it is the mechanism.
- **`roadmap.md:68` already names the wider gap** — "brak warstwy aplikacyjnej (logger, error
  tracking, metryki)". This change does not close that and should not claim to.

## Desired End State

Both RPC failures on the caretaker page reach the Workers log stream with the function name, the
PostgREST error code and its message — the same shape the six API routes already use. Rendered
output is byte-identical to today for every visitor in every branch. `tests/unit/invite-source.test.ts`
fails if either log call is removed, and it fails on the code rather than on a comment.

## What We're NOT Doing

- **No change to what any visitor sees.** Not for the error card, not for the pre-claim downgrade,
  not for the revoked or inactive cards. Uniform failure stays exactly as pinned.
- **No 500 / error page for a failed reveal.** The page's own comment argues the public half has
  already loaded and an error page would hide a trip the visitor may legitimately see; that
  reasoning still holds.
- **No Sentry, no logger library, no application-level error tracking.** That is the gap
  `roadmap.md:68` names, and it is its own change (M3L5's optional task 2).
- **No sweep of other `.astro` pages.** The audit already established none of them carry this
  pattern; re-walking them would find nothing.
- **No new automated guard against the class recurring.** Decided in planning: a `lessons.md` entry
  instead. A regex sweep over `.astro` files is exactly the brittle-source-assertion shape this
  repo has already been bitten by.
- **No change to `src/lib/**` lint scoping.\*\* The config's existing comment says that exclusion is
  deliberate because client islands import from there.
- **No test for `:92`'s user-visible error card.** That branch already renders something; only its
  silence is in scope.

## Implementation Approach

Phase 1 is a single red→green loop driven by `/10x-tdd`: write the assertions that fail on today's
code, then make them pass. The red and the fix live in one phase because `/10x-implement`'s ritual
commits only on green — a phase boundary between them would require committing a failing test.

The fix has two parts that must land together: the lint allowlist must be extended before the
`console.error` calls can survive `npm run lint`, which the phase runs as a success criterion.

Phase 2 reconciles the two documents whose claims this change falsifies, and records the recurring
rule.

## Critical Implementation Details

**What may and may not be logged here is the one genuinely load-bearing constraint.** Two rules,
both already enforced by discipline at the existing call sites and documented in
`eslint.config.js:96-104`:

1. **Never log the raw token or the raw capability secret.** Both are in scope in this frontmatter
   (`token` at `:44`, `claimSecret` at `:135`). `src/lib/invite-token.ts` states the invite token
   "is never written to the database and must never be logged". A log line that interpolates either
   turns a bearer credential into a log entry.
2. **Log `error.code` and `error.message`, never the whole error object.** `eslint.config.js:96-104`
   records why, measured: a SECURITY DEFINER function owned by `postgres` receives the failing row
   in `details`, and both RPCs here are such functions. Nothing mechanical enforces this — it is a
   call-site discipline, and this change adds two more call sites to it.

## Phase 1: Red test, then make both failures visible

### Overview

Assertions that fail on today's code, then the logging and the lint change that turn them green.

### Changes Required:

#### 1. The failing assertions

**File**: `tests/unit/invite-source.test.ts`

**Intent**: Pin that each of the page's two RPC error branches writes to the log sink. Written
first, confirmed red against unmodified source, and only then made to pass.

**Contract**: New `it(...)` cases inside the existing `describe`, reusing the file's
`frontmatter` binding — the comment-stripped source produced by `stripFrontmatterComments()`.
Anchoring must be to a SHAPE the prose cannot satisfy (a `console.error(` call adjacent to each
branch), not a substring like `"update_failed"` that a future explanatory comment could contain.
The file's own header explains why the strip exists; the new cases inherit that protection only if
they assert against `frontmatter`, not against `source`.

#### 2. The lint allowlist

**File**: `eslint.config.js`

**Intent**: Extend the `no-console` relaxation from `src/pages/**/*.ts` to server-rendered `.astro`
frontmatter, on the same argument the existing block already makes — a page's output is its HTTP
response, not its log, so `console.log` must still fail while `error` and `warn` are the sink.

**Contract**: `serverRouteConfig`'s `files` glob gains `src/pages/**/*.astro`, or an equivalent
block is added. `allow` stays `["error", "warn"]` — do NOT widen it. `src/lib/**` stays excluded;
the existing comment says why.

#### 3. The two log calls

**File**: `src/pages/invite/[token].astro`

**Intent**: Make both swallowed failures observable. Behaviour is unchanged — `loadError = true`
and `claimed = null` still happen exactly as now; a log line is added beside each.

**Contract**: Two `console.error` calls following the shape the six API routes use —
`console.error("<rpc_name> failed:", error.code, error.message)`. See Critical Implementation
Details for what must not appear in them. The `:144` branch currently uses a ternary that has no
statement position; it needs an `if`/`else` or equivalent so a call can sit in the failure path —
and `claimed` must still end up `null` on error, unchanged.

#### 4. A comment that stops being true

**File**: `tests/unit/ci-gate-source.test.ts`

**Intent**: Line 138 states `no-console` is `error` only for `src/pages/**/*.ts`. After change #2
that is false. Correct it in the same commit that falsifies it.

**Contract**: Comment text only — no assertion in that file reads the eslint config, so nothing
else moves.

### Success Criteria:

#### Automated Verification:

- The new assertions FAIL against unmodified `[token].astro` — confirmed before the fix, and the
  failure names the missing log call rather than a parse error
- `npx vitest run --project unit` passes after the fix
- `npm run lint` passes with `--max-warnings 0`
- `npm run check` passes
- `npx vitest run` — the full suite, including `invite-view.test.ts` and `invite-source.test.ts`'s
  six existing cases, is unaffected
- Deliberate break: remove either `console.error` and confirm exactly the matching assertion goes
  red — reverted afterwards
- `git diff` on `src/pages/invite/[token].astro` shows no change below the frontmatter fence

#### Manual Verification:

- Neither log line can interpolate `token` or `claimSecret` — read both, do not infer
- The rendered page is unchanged for a visitor with no claim, one with a claim, and one on a dead
  link

**Implementation Note**: Kill the dev server before `npm run check` / `git commit` —
`context/foundation/lessons.md` records this biting three times. Pause for manual confirmation
before Phase 2.

---

## Phase 2: Reconcile the documents and record the rule

### Overview

Two written claims become false with Phase 1; one recurring rule is worth keeping.

### Changes Required:

#### 1. Test plan §7

**File**: `context/foundation/test-plan.md`

**Intent**: §7 records that all twelve `no-console` warnings were `console.error` "in Astro
endpoints under `src/pages/**/*.ts` — deliberate observability", and that endpoints got the
narrower treatment. The scope statement is now wider.

**Contract**: Present tense only for what was read against the config at the time of writing
(`lessons.md` §"Weryfikuj posturę systemu z katalogu, nie z komentarza"). Say what the allowlist
covers now and why `.astro` frontmatter qualifies on the same argument.

#### 2. The lesson

**File**: `context/foundation/lessons.md`

**Intent**: Record the recurring rule this change exists because of — an RPC error in `.astro`
frontmatter degrades silently and, until now, had no sink at all. The register is read at the start
of `/10x-plan`, `/10x-implement` and `/10x-impl-review`, which is where this class is introduced.

**Contract**: A new `## ` section in the file's existing shape — Context / Problem / Rule /
Applies to. The Problem cites the measurement (`0` `console.*` calls across all `.astro` files) and
names the user-visible consequence. Nine sections exist after this one lands.

#### 3. change.md

**File**: `context/changes/invite-page-silent-failures/change.md`

**Intent**: Status and date.

**Contract**: `status: implemented`, `updated: <today>`. Note the allowed set is `new`, `preparing`,
`planned`, `plan_reviewed`, `implementing`, `implemented`, `impl_reviewed`, `archived`, `blocked` —
`complete` is not a value.

### Success Criteria:

#### Automated Verification:

- `npm run check:links` passes — every path cited in the edited documents resolves
- `npm run ci:gate` passes with the dev server killed first
- `npx vitest run` passes, including `tests/unit/test-plan-shape.test.ts` if it constrains §7's shape

#### Manual Verification:

- Every new sentence in `test-plan.md` was read against `eslint.config.js` at the moment of writing
- The `lessons.md` entry states what was measured, not what is feared

**Implementation Note**: This is the phase `lessons.md` warns about twice — an aspirational sentence
becoming a historical record, and a correction applied in one place while another still says the old
thing.

---

## Testing Strategy

### Unit Tests:

- Two new cases in `tests/unit/invite-source.test.ts`, asserting against the comment-stripped
  frontmatter, one per error branch.

### Integration Tests:

None. Forcing a genuine `get_claimed_details` failure needs grant manipulation or a transport
fault — a new pattern in this repo, for a branch whose defect is an observability gap rather than a
wrong output. Decided in planning; revisit if the branch ever grows behaviour of its own.

### E2E Tests:

None. The rendered output does not change, so there is nothing for a browser to see.

### Manual Testing Steps:

1. `npm run db:start`, `npm run dev`.
2. Open a valid invite link — page renders as before.
3. Claim a slot — the sensitive tier appears as before.
4. Confirm no log line contains the token or the capability secret.

## Performance Considerations

None. Two `console.error` calls on failure paths that today do nothing.

## Migration Notes

None. No schema change, no data migration, no change to any response.

## References

- The audit this change rests on: `context/changes/invite-page-silent-failures/change.md`
- The page: `src/pages/invite/[token].astro`
- The lint scoping and its rationale: `eslint.config.js`
- The source-test machinery being reused: `tests/unit/invite-source.test.ts`
- The pinned security property: `tests/unit/invite-view.test.ts`
- Recurring rules that bind this plan: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Red test, then make both failures visible

#### Automated

- [x] 1.1 The new assertions FAIL against unmodified `[token].astro`, naming the missing log call — 2c406f0
- [x] 1.2 `npx vitest run --project unit` passes after the fix — 2c406f0
- [x] 1.3 `npm run lint` passes with `--max-warnings 0` — 2c406f0
- [x] 1.4 `npm run check` passes — 2c406f0
- [x] 1.5 `npx vitest run` — full suite unaffected — 2c406f0
- [x] 1.6 Deliberate break: removing either `console.error` reddens exactly its own assertion; reverted — 2c406f0
- [x] 1.7 `git diff` shows no change below the frontmatter fence — 2c406f0

#### Manual

- [x] 1.8 Neither log line can interpolate `token` or `claimSecret` — 2c406f0
- [x] 1.9 The rendered page is unchanged in all three visitor states — 2c406f0

### Phase 2: Reconcile the documents and record the rule

#### Automated

- [x] 2.1 `npm run check:links` passes
- [x] 2.2 `npm run ci:gate` passes with the dev server killed first
- [x] 2.3 `npx vitest run` passes

#### Manual

- [x] 2.4 Every new sentence in `test-plan.md` was read against `eslint.config.js` when written
- [x] 2.5 The `lessons.md` entry states what was measured
