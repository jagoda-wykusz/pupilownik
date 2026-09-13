# First E2E test — the caretaker reveal chain

## Overview

Introduce Playwright to this project and spend it on ONE thing: the chain that runs from a
caretaker clicking "Zapisuję się" to the sensitive tier appearing on their screen. That chain
crosses the React island, `/invite/claim`, a `Set-Cookie` with four load-bearing attributes, the
browser's own cookie jar, a full page reload, the middleware, two `SECURITY DEFINER` RPCs and
server-side rendering. **No existing test crosses it**, and its documented failure modes are
silent — the claim succeeds and the reload renders the pre-claim page.

Secondarily, and only reachable once a real claim exists, close the Risk #6 edge on this page:
post-claim the page HOLDS sensitive rows and renders a `client:load` island, and nothing has ever
looked at that combination.

## Current State Analysis

**Risk #4** (`context/foundation/test-plan.md` §2) — sensitive instructions shown before a slot is
claimed, or to someone outside the invite link. **Risk #6** — sensitive text escaping into the
client bundle, logs, or error bodies.

What already covers them, and what each one cannot see:

| Layer            | File                                    | Blind to                                                                                                                                                                                                                |
| ---------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The two doors    | `tests/rls/reveal-instructions.test.ts` | Everything above SQL. Calls the RPCs directly.                                                                                                                                                                          |
| Page composition | `tests/unit/invite-composition.test.ts` | Anything that is not `composeCaretakerView`'s return value.                                                                                                                                                             |
| View resolution  | `tests/unit/invite-view.test.ts`        | The template.                                                                                                                                                                                                           |
| Claim route      | `tests/api/invite-claim.test.ts`        | Uses a FAKE cookie jar (`createFakeCookies`). It records the attributes; no browser ever enforces them.                                                                                                                 |
| Rendered pages   | `tests/render/island-props.test.ts`     | Renders `invite/[token].astro` with NO middleware and NO session, so it takes the degraded branch — it has never seen a page that holds sensitive rows. Scans for KEY SHAPES (`sb_secret_`, JWT), not instruction text. |
| Built bundle     | `npm run check:secrets`                 | Under `output: "server"` `dist/client` holds no HTML at all.                                                                                                                                                            |

The gap is the seam between them: attributes recorded by a fake jar, and a render that never has
data. Only a real browser holds both ends at once.

**This was left on the table deliberately, not overlooked.**
`context/archive/2026-09-11-testing-domain-guardrails/plan.md:35` — _"No e2e runner, no Astro
Container API, no rendered-HTML assertions. §7 excludes the caretaker page's HTML deliberately and
§4 defers Playwright to post-Phase-4."_ This change is that post-Phase-4.

### Key Discoveries

- **The pre-claim absence assertion is NAIVE and must not be the load-bearing one.**
  `test-plan.md` §7 records it as measured: _"the caretaker page was never the secrecy boundary.
  `get_period_by_token` returns PUBLIC instruction rows only, so before a claim the page is never
  handed a sensitive row or the trip note — there is nothing there to withhold."_ Breaking the
  template leaves that assertion green, because the data never arrives. It is kept as a cheap
  co-assertion and labelled as one in the spec header.
- **The cookie's attributes have silent failure modes, documented in
  `src/lib/claim-cookie.ts`.** `secure: true` over a LAN IP → the browser drops the cookie and
  "the claim succeeds, the reload renders the pre-claim page, and it reads as _it didn't work_".
  A drifting `path: "/invite"` → same symptom. `MIN_AGE_SECONDS` exists because a non-positive
  `maxAge` → same symptom again. Three distinct bugs, one indistinguishable surface, invisible
  below the browser.
- **`playwright@1.63.0` declares NO `scripts` field.** Measured 2026-09-13 by unpacking the
  published tarball, not inferred. So the `supabase` install-hook class (`lessons.md` §"Bramka nie
  jest najbardziej zewnętrzną rzeczą, która może paść") does NOT apply: `npm ci` runs no hook and
  cannot fail on a browser download. Browsers arrive only via an explicit
  `npx playwright install chromium`. Cost that IS incurred on every Cloudflare build: ~18.5 MB
  unpacked (`playwright-core` 13.4 MB + `playwright` 5.1 MB).
- **`tsconfig.json` includes everything and excludes only `dist`**, so anything under `tests/e2e/` is
  typechecked by `astro check` — which runs in pre-commit AND in `ci:gate`. The specs must
  typecheck in the publish gate even though they never RUN there. That is the reason
  `@playwright/test` must be an ordinary `devDependency` and not optional: npm drops an optional
  package on failure, and a dropped package breaks `astro check`, which breaks the deploy.
- **`eslint.config.js` applies to every `js/jsx/ts/tsx` file** with `projectService: true`, and
  `npm run lint` runs with `--max-warnings 0` inside `ci:gate`. New files get no free pass.
- **The seeding primitives already exist**: `tests/helpers/auth.ts` (`createOwnerWithPet`,
  anon-keyed — never service-role), `tests/helpers/reveal.ts` (`SECRET_TITLE`, `SECRET_BODY`,
  `PUBLIC_TITLE`, `NOTE`), `src/lib/invite-token.ts` (`generateInviteToken`, `digestInviteToken`),
  and the `create_period_with_slots` RPC. `tests/env.ts` refuses any non-localhost `SUPABASE_URL`.
- **DOM anchors on `/invite/[token]`**: sensitive block heading `Tylko dla opiekuna`; success banner
  `Zapisano, <imię>!`; pre-claim hint `Część wskazówek — na przykład dostęp do mieszkania…`; name
  field label `TWOJE IMIĘ`; submit `Zapisuję się (<n>)`; slot cards are `button`s whose accessible
  name carries the time-of-day label and `WOLNE` / `ZAJĘTE`.
- **The island receives `hasCapability` (a boolean) and `token`.** The page's own comment states the
  token is knowingly serialized into island props and the sensitive rows knowingly are not. Nothing
  enforces the second half.

## Desired End State

`npm run test:e2e` runs Playwright against the local stack and the dev server, and:

1. A caretaker who claims a slot in a real Chromium sees `Tylko dla opiekuna` and the sensitive
   body after the reload — and that assertion goes RED when any of the cookie's four attributes is
   broken.
2. The same sensitive body appears in the server-rendered body and is ABSENT from every
   `<astro-island props>` on the page — and that assertion goes RED when `details` is handed to
   the island.
3. A second browser context with no capability cookie, on the same link, sees neither.
4. The suite passes twice in a row with no manual cleanup.
5. `test-plan.md` §4, §5 and §7 describe what is now true, including what this test still cannot
   fail on.

## What We're NOT Doing

- **No test for Risk #3 (concurrent claim).** Browser-level concurrency is the slowest, flakiest
  way to prove atomicity; `tests/rls/claim-slots.test.ts` and `tests/api/invite-claim.test.ts`
  already hold it at the layer where it is provable.
- **No visual/screenshot regression, no `toMatchSnapshot`, no vision mode.** `test-plan.md` §7
  already excludes Tailwind class output as brittle and low-signal.
- **No wiring into `ci:gate`.** The Cloudflare build container has no Docker, so `supabase start`
  cannot run there — the same forced split §5 already applies to the integration suite. Touching
  `ci:gate` would also require updating `tests/unit/ci-gate-source.test.ts`.
- **No change to any production file.** No migration, no route change, no template change. The
  deliberate breakages in VERIFY are reverted and never committed.
- **No Playwright MCP, no planner/generator/healer agents.** The path is mapped; CLI exploration
  would spend tokens re-deriving what this plan already contains.
- **No E2E for the owner-side flows (Risks #1, #2) beyond the seed test.** `seed.spec.ts` exists to
  demonstrate conventions, not to cover a risk.
- **No fork of `tests/helpers/`.** The e2e fixture imports them; it does not copy them.

## Implementation Approach

Three phases. Phase 1 buys the runner and pays the "seed test + rules" tax on the cheap owner path,
where a failure cannot be confused with a Risk #4 failure. Phase 2 is the change's reason to exist.
Phase 3 reconciles the documents this repo treats as load-bearing.

Seeding goes through the existing anon-keyed harness rather than through the UI: a long clicking
prologue is the shared-state and missing-cleanup anti-pattern pair, and a setup failure would read
as a Risk #4 failure. The one place the UI IS the subject is the claim itself, because the browser
is the thing under test.

## Which skill drives which phase

`/10x-e2e` landed on 2026-09-13 (`npx @przeprogramowani/10x-cli get m3l4`) and its `SKILL.md` draws
the boundary for us — it states plainly that it "does **not** install Playwright, scaffold configs,
or wire up CI", and that it STOPS if there is no `playwright.config.*` and no `*.spec.ts`. So:

| Phase | Driven by                            | Why                                                                                                                                     |
| ----- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `/10x-implement`                     | `/10x-e2e` refuses to run without a config and would stop on its own gate. Phase 1 IS that prerequisite.                                |
| 2     | `/10x-e2e e2e-invite-reveal phase 2` | Exactly its inner loop: PLAN → GENERATE → REVIEW (five anti-patterns) → VERIFY (deliberate break). It shares this plan's `## Progress`. |
| 3     | `/10x-implement`                     | CI wiring and document edits; explicitly outside the skill's remit.                                                                     |

Two conventions taken from the skill, and two deliberate departures — recorded here so a later
reader does not read them as drift:

- **Taken — `tests/e2e/`.** The skill's default is a project-level e2e dir, `tests/e2e/<feature>.spec.ts`.
  No convention existed, so Phase 1 establishes that one. Verified safe: all three vitest projects
  include `*.test.ts` / `*.test.tsx` only, so Playwright's `*.spec.ts` cannot be swept into `npm test`.
- **Taken — the five anti-patterns and the re-prompt discipline** from
  `.claude/skills/10x-e2e/references/e2e-anti-patterns.md`. The skill names anti-pattern #1
  "Hallucinated assertion"; this plan's §"Key Discoveries" entry about pre-claim absence IS that
  anti-pattern, caught before a line was written.
- **Departure — one spec file, three tests.** The skill's default is one test per file. This repo's
  existing convention is the opposite (`tests/rls/*`, `tests/api/*` each hold many related tests),
  and the skill says to follow the convention discovered in Setup. Three tests share one seeded trip;
  splitting them would re-seed three times to buy nothing.
- **Departure — the project's E2E rules live in `AGENTS.md` + `docs/reference/e2e-rules.md`, never in
  `CLAUDE.md`.** The skill lists `CLAUDE.md` as a candidate home. In THIS repo `CLAUDE.md` is entirely
  a CLI-managed fence (`<!-- BEGIN @przeprogramowani/10x-cli -->`) and the `get m3l4` run replaced its
  whole contents — anything written inside it is lost on the next `get`. `AGENTS.md` carries no fence
  and is the project's own rules file. The generic hard rules (locators, no `waitForTimeout`,
  independence + cleanup) now sit in `CLAUDE.md` courtesy of the CLI and need no copy.

## Critical Implementation Details

**Kill the dev server before `npm run build`, `npx astro check`, or any `git commit`.**
`lessons.md` §"Ubij serwer dev…" — `astro dev` and `astro build` share `node_modules/.vite`, the
pre-commit hook runs `astro check`, and a running dev server is left holding URLs that no longer
exist. The symptoms (`Invalid hook call`, `more than one copy of React`, empty SSR) read as code
bugs. Playwright's `webServer` with `reuseExistingServer: true` attaches to a server the developer
already has running, which makes this MORE likely to bite here, not less.

**Never read an exit code through a pipe.** `lessons.md` §"Nie czytaj kodu wyjścia z potoku" —
`npx playwright test > out.txt 2>&1; echo $?`, then read the file. `cmd | tail` reports `tail`'s
status, which is always 0. This closed a phase on a false reading once already.

**A mutation that returns green may not have applied.** `lessons.md` §"Zdanie o tym, co się stanie
po usunięciu bramki…" — for every deliberate breakage, confirm the edit is live (prettier
reformatting and unreachable conditions have both produced silent no-ops here), and confirm the
test fails for the predicted reason, not an adjacent one.

**Assert against shape, not substring.** `lessons.md` §"Asercja podciągiem trafia we własne
uzasadnienie" — the island-props assertion must read the `props` attribute's own value, not run a
page-wide `toContain` that a comment or a visible paragraph could satisfy.

---

## Phase 1: Runner, config, storageState, seed test

### Overview

Playwright installed, configured against the local dev server, with an owner session captured once
via `storageState` and a single seed test that shows the agent — and the next human — what a
correct test in this project looks like.

### Changes Required:

#### 1. Dependency and scripts

**File**: `package.json`

**Intent**: Add `@playwright/test` as an ordinary `devDependency` and a `test:e2e` script. Ordinary,
not optional, because `astro check` typechecks `tests/e2e/` inside `ci:gate` and npm drops an optional
package entirely when its install fails.

**Contract**: `devDependencies["@playwright/test"]`, `scripts["test:e2e"] = "playwright test"`. Do
NOT touch `ci:gate` — `tests/unit/ci-gate-source.test.ts` pins its contents.

#### 2. Playwright configuration

**File**: `playwright.config.ts`

**Intent**: Two projects — `setup` (produces the owner `storageState`) and `chromium` (depends on
it). Chromium only. `webServer` points at `npm run dev` on 4321 with `reuseExistingServer` outside
CI, so a developer's running server is attached to rather than duplicated.

**Contract**: `baseURL` is `http://127.0.0.1:4321` — **`127.0.0.1`, not a LAN IP**, because the claim
cookie is `Secure` and only `localhost` / `127.0.0.1` count as secure contexts. Getting this wrong
produces the silent drop `claim-cookie.ts` documents, and the test would fail for a reason that has
nothing to do with the risk.

#### 3. Owner session capture

**File**: `tests/e2e/auth.setup.ts`

**Intent**: Create a fresh owner through the same anon-keyed primitive the vitest suite uses, then
sign in through the REAL form so the session cookies are the ones the app issues, and save the
state. Signing in through the UI rather than injecting cookies is what makes the state honest.

**Contract**: Writes `playwright/.auth/owner.json`. The form is labelled `E-MAIL` and `HASŁO`
(`src/components/auth/SignInForm.tsx`), posts to `/api/auth/signin`, and redirects to `/` on
success — so the wait is on the redirect, not on a timeout.

#### 4. Seed test

**File**: `tests/e2e/seed.spec.ts`

**Intent**: One owner-side test that demonstrates every convention the rules file states:
`getByRole` selectors, waiting on state rather than time, a unique identifier in the test data, a
cleanup, and a name that ties the test to a risk. Playwright's docs say the generator copies this
file as its example, so it is written to be copied.

**Contract**: Uses `storageState` from the `setup` project. Test name in the shape
`test('<behaviour> persists after page reload')`. Unique pet name via `Date.now()`.

#### 5. E2E rules

**File**: `docs/reference/e2e-rules.md`, plus a pointer in `AGENTS.md`

**Intent**: Carry ONLY what is specific to this project — the generic block (role-based locators,
no `waitForTimeout`, independence + cleanup, `storageState`) already arrived in `CLAUDE.md` via the
CLI and must not be duplicated. What is local and nowhere else: `127.0.0.1` as a hard requirement
because the capability cookie is `Secure`; "never make pre-claim absence a load-bearing assertion",
with §7's measurement as the reason; and the seeding rule that fixtures go through the anon-keyed
client, never service-role.

**Contract**: A short pointer in `AGENTS.md` — **not** in `CLAUDE.md`, which is a CLI-managed fence
that `get m3l4` already overwrote once and will overwrite again. Linked from `test-plan.md` §6 in
Phase 3. `npm run check:links` verifies every path a document cites, so every reference must resolve.

#### 6. Ignore the artifacts

**File**: `.gitignore`

**Intent**: Keep session state and run output out of git. `playwright/.auth/owner.json` holds a live
session.

**Contract**: `playwright/.auth/`, `test-results/`, `playwright-report/`.

### Success Criteria:

#### Automated Verification:

- `npx playwright install chromium` completes
- `npm run test:e2e` passes, and passes again immediately afterwards with no manual cleanup
- `npm run check` passes (`tests/e2e/` is inside the tsconfig include)
- `npm run lint` passes with `--max-warnings 0`
- `npm run check:links` passes
- `git status` shows no `playwright/.auth/` and no `test-results/`

#### Manual Verification:

- `playwright/.auth/owner.json` exists on disk and is NOT staged
- The seed test reads as an example worth copying — role-based selectors, no `waitForTimeout`, a
  visible cleanup

**Implementation Note**: Kill the dev server before running `npm run check` / `npm run lint`. Pause
for confirmation before Phase 2.

---

## Phase 2: The Risk #4 ∩ #6 test

### Overview

The change's reason to exist: a real browser walks the claim chain, the reveal is asserted, the
island-props edge is closed, and both assertions are proven by deliberate breakage.

### Changes Required:

#### 1. Seeding fixture

**File**: `tests/e2e/fixtures/invite.ts`

**Intent**: A fixture that builds one trip per run — an owner with a pet, one PUBLIC and one
SENSITIVE instruction, a period with slots, and a fresh invite token — then tears the trip down.
Built on `tests/helpers/auth.ts` and `tests/helpers/reveal.ts` so there is ONE definition of what a
leak looks like, which is exactly why `tests/helpers/reveal.ts` exists.

**Contract**: Hands the test `{ token, secretTitle, secretBody, publicTitle, note, petName }`.
Inserts through the owner's own anon-keyed client — **never service-role**, which would bypass RLS
and make the seeding a different operation from the one the app performs. Unique per run
(UUID / `Date.now()` suffix on the trip title and pet name) so parallel and repeat runs cannot
collide. Teardown deletes the period and the pet; the auth user is left, matching what the vitest
suite already does.

#### 2. The spec

**File**: `tests/e2e/invite-reveal.spec.ts`

**Intent**: One file, three tests against one seeded trip.

- **The load-bearing one** — a caretaker opens the link, picks a free slot, gives a name, submits,
  and after the reload the page shows `Zapisano, <imię>!`, `Tylko dla opiekuna`, the sensitive title
  and the sensitive body. This is the assertion whose breakage must turn it red.
- **The Risk #6 half** — on that same post-claim page, the sensitive body is present in the
  rendered body and ABSENT from every `<astro-island props>` attribute value.
- **The outsider** — a second, cookie-less browser context opens the same link and sees the public
  instruction but neither `Tylko dla opiekuna` nor the sensitive body.

The file header must state plainly that the pre-claim absence check is a co-assertion, not a guard,
and why (`test-plan.md` §7) — otherwise the next reader inherits the belief that correction exists
to kill.

**Contract**: No `waitForTimeout` anywhere. Waiting is `expect(locator).toBeVisible()` and
`page.waitForURL` / `waitForResponse`. Selectors are `getByRole` / `getByLabel`; the sensitive body
is matched by `getByText` against the fixture's own constant. The island-props assertion reads the
`props` attribute values off `astro-island` elements and asserts the fixture's `SECRET_BODY` is in
none of them — anchored to the attribute, not to a page-wide substring.

#### 3. VERIFY by deliberate breakage — TWO independent mutations

**File**: (production files, reverted immediately — nothing committed)

**Intent**: Prove each assertion bites, separately. A single mutation that reddens both proves
neither is independent.

**Contract**:

- **Mutation A (the reveal chain)** — change `path` in `claimCookieOptions`
  (`src/lib/claim-cookie.ts`) from `/invite` to `/periods`. Predicted: the claim still returns 200,
  the reload sends no cookie, the page renders pre-claim, the load-bearing test goes red and the
  outsider test stays green. This is the exact silent failure that file's own comment describes.
- **Mutation B (the island edge)** — pass `details`, or its sensitive rows, into `<ClaimSlots />` in
  `src/pages/invite/[token].astro`. Predicted: the Risk #6 test goes red and the load-bearing test
  stays GREEN, because the visible reveal is unaffected.

For each: confirm the edit is live before reading the result, and read WHY it failed, not merely
that it did. If a mutation comes back green, first check that it applied at all.

### Success Criteria:

#### Automated Verification:

- `npm run test:e2e` passes
- Run twice back-to-back — all tests pass both times (no unique-constraint or stale-state failure)
- Mutation A: the reveal test FAILS, the outsider test still passes; reverted afterwards
- Mutation B: the island-props test FAILS, the reveal test still passes; reverted afterwards
- `git status` clean of both mutations before commit
- `npm run check`, `npm run lint` pass
- `npx vitest run` — the existing suite is unaffected by the new fixture importing `tests/helpers/`

#### Manual Verification:

- Each mutation's failure message names the thing it should — a missing sensitive block, not a
  timeout on an unrelated selector
- The spec header's claim about what the pre-claim check does and does not guard is accurate

**Implementation Note**: Both mutations are reverted before any commit. Red from deliberate breakage
is a checkpoint, never a record. Pause for confirmation before Phase 3.

---

## Phase 3: CI wiring and document reconciliation

### Overview

Give the test somewhere to run other than one laptop, and make the documents describe what is now
true — including its limits.

### Changes Required:

#### 1. Actions job

**File**: `.github/workflows/ci.yml`

**Intent**: Run the E2E suite in the one environment that can host it, alongside the integration
suite that is there for the same reason. The stack, the keys and `.env.test` are already set up by
the existing steps.

**Contract**: `npx playwright install --with-deps chromium`, then `npm run test:e2e`, placed after
the build. `reuseExistingServer` must be false in CI so Playwright starts its own server. The job
still cannot block a merge — private repo, GitHub Free — and the file's own header says so; do not
write the step as if it can.

#### 2. Test plan §4 — the stack table

**File**: `context/foundation/test-plan.md`

**Intent**: The row `e2e | Playwright | TBD | none yet — optional, deferred until a domain flow
exists (post-Phase 4)` is now false. Replace it with what exists.

**Contract**: Version, config path, what it covers, and the fact that it runs in Actions and on a
developer machine but never in the publish gate, with the Docker reason.

#### 3. Test plan §5 — the gate table

**File**: `context/foundation/test-plan.md`

**Intent**: The row `e2e on critical flows | — | not present` becomes accurate. §5's own correction
note warns that "with the suite" misled about what blocks; this row must be unambiguous that it does
NOT block publication.

**Contract**: Where it runs, "cannot block a merge", and what it catches, in the table's existing
voice.

#### 4. Test plan §7 — what is NOT covered, and what this test cannot fail on

**File**: `context/foundation/test-plan.md`

**Intent**: Two edits. The entry "The caretaker page's rendered HTML (S-02)" says the page is
verified by hand because this project has no e2e runner "by choice" — now partly false, and it must
say what became covered and what did not. And the §7 Risk #4 correction gains the honest note that
the new E2E test's pre-claim check does not fail on a template mutation, so a later reader does not
credit it with more than it does.

**Contract**: Present tense only for what was just read against the code (`lessons.md` §"Weryfikuj
posturę systemu z katalogu, nie z komentarza"). The island-props entry in §7 also gains its
now-closed post-claim edge.

#### 5. Test plan §6 — cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Point at `docs/reference/e2e-rules.md` so the rules are reachable from the plan every
future test starts in.

**Contract**: One entry; `npm run check:links` must pass.

#### 6. change.md

**File**: `context/changes/e2e-invite-reveal/change.md`

**Intent**: Status and date.

**Contract**: `status: complete`, `updated: <today>`.

### Success Criteria:

#### Automated Verification:

- `npm run check:links` passes (every path cited in the edited documents resolves)
- `npm run ci:gate` passes end-to-end with the dev server killed first
- `npx vitest run` passes
- The workflow file is valid YAML and the new step names are unique

#### Manual Verification:

- A CI run executes the E2E job and it passes there, not only locally
- Every new sentence in `test-plan.md` was checked against the code at the moment of writing — no
  claim about coverage that was not just read
- §7 states what the E2E test cannot fail on, not only what it covers

**Implementation Note**: This is the phase `lessons.md` warns about twice — an aspirational sentence
becoming a historical record, and a correction made in one place while another table still says the
old thing. Read every edited claim against the code before writing it.

---

## Testing Strategy

### Unit Tests:

None added. Every assertion this change makes needs a browser; anything that does not belongs in the
suite that already exists.

### Integration Tests:

None added. `tests/rls/reveal-instructions.test.ts` already owns the SQL boundary and must not be
duplicated — `lessons.md` records a whole file once written as a strict subset of an existing one.

### E2E Tests:

- `tests/e2e/seed.spec.ts` — the conventions example (owner path, `storageState`).
- `tests/e2e/invite-reveal.spec.ts` — the reveal chain, the island-props edge, the outsider.

### Manual Testing Steps:

1. `npm run db:start`, then `npm run dev`.
2. `npm run test:e2e` — all green.
3. Immediately again — still green (proves isolation).
4. Apply Mutation A, run, confirm the reveal test fails and the outsider test does not. Revert.
5. Apply Mutation B, run, confirm the island-props test fails and the reveal test does not. Revert.
6. `git status` clean of both mutations.

## Performance Considerations

One Chromium, three tests, one seeded trip. Expect well under a minute locally. The cost that lands
on every Cloudflare build is ~18.5 MB of additional `npm ci` payload and no install hook (measured,
see Key Discoveries) — the browser download happens only where `npx playwright install` is called.

## Migration Notes

None. No schema change, no production code change, no data migration.

## References

- Risk map and the §7 corrections: `context/foundation/test-plan.md`
- The deferral this change picks up: `context/archive/2026-09-11-testing-domain-guardrails/plan.md`
- Cookie attribute contract and its silent failure modes: `src/lib/claim-cookie.ts`
- The page under test: `src/pages/invite/[token].astro`
- Seeding primitives: `tests/helpers/auth.ts`, `tests/helpers/reveal.ts`
- Recurring rules that bind this plan: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Runner, config, storageState, seed test

#### Automated

- [x] 1.1 `npx playwright install chromium` completes — 7525ec3
- [x] 1.2 `npm run test:e2e` passes, and passes again immediately with no manual cleanup — 7525ec3
- [x] 1.3 `npm run check` passes — 7525ec3
- [x] 1.4 `npm run lint` passes with `--max-warnings 0` — 7525ec3
- [x] 1.5 `npm run check:links` passes — 7525ec3
- [x] 1.6 `git status` shows no `playwright/.auth/` and no `test-results/` — 7525ec3

#### Manual

- [x] 1.7 `playwright/.auth/owner.json` exists on disk and is NOT staged — 7525ec3
- [x] 1.8 The seed test reads as an example worth copying — 7525ec3

### Phase 2: The Risk #4 ∩ #6 test

#### Automated

- [x] 2.1 `npm run test:e2e` passes — 2bfa98c
- [x] 2.2 Run twice back-to-back — all tests pass both times — 2bfa98c
- [x] 2.3 Mutation A: reveal test FAILS, outsider test still passes; reverted — 2bfa98c
- [x] 2.4 Mutation B: island-props test FAILS, reveal test still passes; reverted — 2bfa98c
- [x] 2.5 `git status` clean of both mutations before commit — 2bfa98c
- [x] 2.6 `npm run check`, `npm run lint` pass — 2bfa98c
- [x] 2.7 `npx vitest run` — existing suite unaffected — 2bfa98c

#### Manual

- [x] 2.8 Each mutation's failure message names the thing it should — 2bfa98c
- [x] 2.9 The spec header's claim about the pre-claim check is accurate — 2bfa98c

### Phase 3: CI wiring and document reconciliation

#### Automated

- [x] 3.1 `npm run check:links` passes
- [x] 3.2 `npm run ci:gate` passes with the dev server killed first
- [x] 3.3 `npx vitest run` passes
- [x] 3.4 The workflow file is valid YAML and new step names are unique

#### Manual

- [x] 3.5 A CI run executes the E2E job and it passes there
- [x] 3.6 Every new sentence in `test-plan.md` was checked against the code when written
- [x] 3.7 §7 states what the E2E test cannot fail on
