# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-11

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic check that already catches the
   regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is produced
   by `/10x-research` during each rollout phase. If the plan and research
   disagree about where the failure lives, research is the ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/` (excluding
build output, docs, fixtures). History is thin (5 commits/30d), so likelihood
leans on the PRD guardrails and the Phase 2 interview more than on churn.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. **Risk #8's likelihood is recorded as `unmeasured`, not estimated.** Its
trigger is an error from the auth server, and this project has no application monitoring
(`roadmap.md`: "brak warstwy aplikacyjnej"), so nobody knows how often that happens. A number there
would be invented, and the value of these weights is that they are not. Its `High` Impact is a
different kind of claim and should not be read as measured alongside the empty likelihood: it is
reasoned from the consequence — a session left alive on a machine the user believes they signed out
of — the same way every other Impact in this table is. The Source column cites the _evidence that
surfaced
this risk_ — never a specific file as "where the failure lives" (see §1
principle #3).

Note on maturity: **auth**, the **F-01 data foundation** (profiles +
owner-isolation RLS + signup trigger), **S-01** (pets + instructions) and **S-02**
(care periods, slots, invite-link token model) are implemented today. Risk #5 is
therefore live and covered (see the row below). Risks #3 and #4 remain real PRD
guardrails living in code that does not exist yet (S-03); they activate as that
slice ships (see §3 Phase 4).

| #   | Risk (failure scenario)                                                                                                                          | Impact | Likelihood     | Source (evidence — not anchor)                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A logged-in owner reads or modifies another owner's rows (data / instructions / sign-ups) through a missing or incorrect RLS policy              | High   | High           | interview Q1; PRD §Access Control; AGENTS hard rule "RLS on every table"; hot-spot dir `supabase/migrations/` (2 commits/30d)                                                                                                                                                                                                                                                                                   |
| 2   | A protected route stops being gated, or signup/signin/session handling lets an unauthenticated user reach owner data                             | High   | Med            | interview Q1; PRD §Access Control; hot-spot dir `src/` (`middleware` + auth routes)                                                                                                                                                                                                                                                                                                                             |
| 3   | _(forward — S-03)_ Two caretakers claim the same slot; allocation is not atomic, producing a double-booking                                      | High   | Med            | PRD §NFR (atomic claim), §Business Logic; interview Q3                                                                                                                                                                                                                                                                                                                                                          |
| 4   | _(forward — S-01/S-03)_ Sensitive instructions (address, access codes) are shown before a slot is claimed, or to someone outside the invite link | High   | Med            | PRD FR-008, §NFR; interview Q1                                                                                                                                                                                                                                                                                                                                                                                  |
| 5   | The link-only (no-auth) caretaker path grants more than its scope, or a leaked/guessed token exposes a period                                    | High   | Med            | PRD FR-005/FR-007; interview Q3; abuse lens (IDOR / bearer token). **Active since S-02.** Covered by `tests/rls/invite-token.test.ts` (the SECURITY DEFINER function is the only anon door), `tests/api/periods.post.test.ts` (the minted token opens the period; no digest in the response) and `tests/middleware/auth-gating.test.ts` (`/invite` public by requirement, and its no-referrer/no-store headers) |
| 6   | A Secret/service-role key or sensitive instruction text escapes into the client bundle, logs, or error bodies                                    | High   | Low–Med        | AGENTS hard rule "server-only secrets"; abuse lens (secret/PII leakage)                                                                                                                                                                                                                                                                                                                                         |
| 7   | An API handler trusts client input (missing or weak zod), accepting malformed or forbidden data                                                  | Med    | Med            | AGENTS rule "validate input with zod"; abuse lens (untrusted input)                                                                                                                                                                                                                                                                                                                                             |
| 8   | A user who clicks "sign out" is told it worked and stays signed in — the session survives on the machine they walked away from                   | High   | **unmeasured** | Measured 2026-09-13: `auth-js` `_signOut()` returns before `_removeSession()` on any error outside 404/401/403, and the route discarded that error. Fixed by `signout-swallows-failure`; see §7.                                                                                                                                                                                                                |

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                  | Must challenge                                                                                           | Context `/10x-research` must ground                                                                                  | Likely cheapest layer                                  | Anti-pattern to avoid                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| #1   | Owner A's session cannot SELECT or UPDATE owner B's row; an anonymous request sees nothing                                                   | "RLS enabled" ≠ "policies correct"; a SELECT-only test misses UPDATE/INSERT holes                        | How a user JWT is injected into a test request; the anon/publishable-keyed client path; which tables currently exist | integration vs local Supabase, two distinct JWTs       | Asserting via the service-role/postgres client — it bypasses RLS, so the test always passes (tautology) |
| #2   | An unauthenticated request to a `PROTECTED_ROUTES` path redirects to signin and returns no owner data; auth flows succeed and fail correctly | "Happy-path login works" ≠ "the protected route is gated"; a redirect status ≠ data actually withheld    | Middleware ordering; how `context.locals.user` resolves; session-cookie shape on the workerd runtime                 | integration on routes + middleware                     | Mocking the Supabase auth client so the test asserts the mock instead of real gating                    |
| #3   | A second concurrent claim on a taken slot is rejected; exactly one caretaker wins                                                            | "Final status 200" ≠ "only one winner"; sequential tests miss the race                                   | (S-03 must exist) the claim entry point, the DB-level uniqueness/locking guarantee                                   | integration with concurrent requests                   | Testing two sequential claims and calling it concurrency                                                |
| #4   | Public instructions are visible pre-claim; sensitive fields appear only to a caretaker who has claimed, and never outside the link           | "It's a separate column" ≠ "the API never serializes it pre-claim"                                       | (S-01/S-03 must exist) where the public/sensitive split is enforced — query vs response shaping                      | integration on the caretaker read path                 | Asserting the DB column split while the API leaks the field anyway                                      |
| #5   | A valid link grants access only to its own period; an invalid/old token is rejected; the link cannot reach the owner panel                   | "Has a token" ≠ "token is scoped"; absence of login ≠ absence of authorization                           | (S-02/S-03 must exist) token generation/validation, scope enforcement, revocation                                    | integration on the link route                          | Treating an unguessable token as sufficient without a scope check (IDOR)                                |
| #6   | The built client bundle contains no Secret key; error responses carry no secret or PII                                                       | "It's a server env var" ≠ "it never reached the client"; absence in source ≠ absence in the built bundle | Build-output location; what error bodies serialize                                                                   | deterministic build-artifact grep + response assertion | Grepping source instead of the built bundle                                                             |
| #7   | Malformed, oversized, or forbidden payloads are rejected server-side with a clean error                                                      | "The client validates" ≠ "the server validates"; a 200 ≠ stored correctly                                | Each handler's zod schema and what input the route actually trusts                                                   | unit / integration on API handlers                     | Re-asserting the zod schema's own shape (implementation mirror)                                         |
| #8   | A sign-out leaves no usable `sb-` cookie in the browser whether or not the auth server answered, and a failure is recorded                   | "It redirected" ≠ "the session ended"; the status code cannot see this                                   | Which layer actually clears the cookie, and whether the client library does it on its error paths                    | integration with an injected failing client            | Asserting the 302 instead of the cookie's fate — the shape this route shipped with for months           |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                             | Goal (one line)                                                                                                     | Risks covered | Test types                                    | Status   | Change folder                                           |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------- | -------- | ------------------------------------------------------- |
| 1   | Bootstrap runner + RLS owner-isolation | Prove an owner cannot read/modify another's rows; establish the reusable RLS-test harness every future table copies | #1            | vitest setup + integration vs local Supabase  | complete | context/archive/2026-06-28-testing-rls-owner-isolation/ |
| 2a  | Auth gating                            | Protected routes gate unauthenticated access; auth/session flows behave; an invalid session cannot reach owner data | #2            | integration (routes + middleware)             | complete | context/archive/2026-07-12-testing-auth-gating/         |
| 2b  | Input validation                       | API handlers reject malformed/forbidden input server-side (zod), not just the client                                | #7            | unit / integration on API handlers            | complete | context/archive/2026-09-12-testing-input-validation/    |
| 3   | Secret-leak assertions                 | No secret reaches `dist/client`, no upstream error or config state reaches a caller                                 | #6            | build-artifact scan + unit + integration      | complete | context/archive/2026-09-11-testing-secret-leak/         |
| 4   | Domain guardrails (gated)              | Instruction visibility scoping, link-only access enforcement, atomic slot claim                                     | #3, #4, #5    | unit + integration + component, no new runner | complete | context/archive/2026-09-11-testing-domain-guardrails/   |

Phase 2 was split into **2a (auth gating, #2)** and **2b (input validation, #7)**
when the gating work shipped in `context/archive/2026-07-12-testing-auth-gating/` — Risk #2
landed there.

**Phase 2b closed 2026-09-12, and it closed NARROWER than its name, on purpose.**
The research pass refuted most of the phase's premise: seven of the nine API
routes already validated correctly, and the classic "weak zod" defect — a handler
that parses and then reads around the parsed result — existed nowhere in the
codebase, including on the one two-parameter route that invites it. So the phase
did not sweep all nine routes. It did four things instead, each answering
something measured:

1. **Fixed a live defect the research found.** `/api/auth/signin` and
   `/api/auth/signup` answered **500** to any body that was not form-encoded,
   because `await context.request.formData()` was unwrapped and `formData()`
   rejects rather than returning empty. Reachable pre-auth by anyone. Both now
   answer the same generic redirect as every other failure, and **twelve**
   assertions pin it — in the `unit` project, since the throw never reached
   Supabase. (The file holds fifteen cases; the other three pin a different
   property, the `as string` pass-through. Corrected after the full-plan review
   counted them — an inventory sentence in this document is exactly the kind
   §7 keeps catching.)
2. **Gave `/api/auth/signout` its first coverage.** It had none. What is asserted
   is not the 302 but that the caller's cookie STOPS AUTHENTICATING, measured
   first because a session cookie carries a JWT that could have stayed valid.
3. **Closed a genuine weak-zod case.** `sort_order` was bounded below and not
   above while its column is `integer`; a `1e12` value answered 500. Bounded in
   the schema at the type's ceiling and mapped in `pets.ts` — the mapping
   `periods.ts` already carried. Five bounds on `/api/pets` are now pinned by
   boundary pairs, one of which (instruction `title`) was found unpinned by a
   mutation that slipped onto the wrong anchor.
4. **Proved the `z.guid()` guards are load-bearing.** Measured by mutation:
   removing the guard from `revoke.ts` and sending `not-a-uuid` turns a clean
   `400 "Validation failed"` into `500` — PostgREST raises `22P02` and the route
   maps any database error to 500.

What it deliberately did NOT do is add tests to `periods`, `revoke`, `token`,
`release` or `invite/claim`: the coverage census in that change's `research.md`
found them already covered, and `tests/api/invite-claim.test.ts:506-531` alone
pins five bad-input shapes. See `context/archive/2026-09-12-testing-input-validation/`.

Phase 4 was blocked until slices S-01..S-03 existed — `/10x-research` cannot
ground code that has not been written. **Unblocked 2026-09-11**: S-01..S-06 have
all shipped and archived.

Phase 4 opened out of order on 2026-09-11 at the user's explicit direction —
Phases 2b and 3 were neither skipped nor completed at that point. Phase 3 has since
closed (see its row above); **2b remains `not started`.**
The split-per-slice refresh this note originally prescribed was **not** run;
instead Phase 4 opens as a single change and `/10x-research` establishes what
the shipping slices already covered. Live signal at open: 28 test files exist,
including `tests/rls/claim-slots.test.ts` and `tests/api/invite-claim.test.ts`
(Risk #3 territory), `tests/rls/reveal-instructions.test.ts` (Risk #4) and the
three files §2 already credits to Risk #5. Treat this phase's scope as
**gap-finding over existing coverage**, not greenfield. S-06 shipped period
revocation after this plan was last written, so the revocation leg of Risk #5
is the one area with no prior claim of coverage in §2.

**Phase 4 closed 2026-09-11** as gap-finding, in five phases: the caretaker page's
instruction gate (#4), release x reveal (#5), token scope on the owner routes (#5),
contention at the HTTP layer plus the claim-triple constraint (#3), and this closing
pass. Five test files added, one production move (the per-pet instruction composition
out of `[token].astro` into `src/lib/invite-view.ts`), no migration. Every phase was
mutation-tested; §7 below records what those mutations revealed about what is actually
defended, including two places where this plan's own prose was wrong.

**Phase 3 closed 2026-09-11, and the "quality-gate wiring" half was dropped rather than done.**
The gate had nowhere to live that anyone had found yet — a belief that turned out to be wrong in
both directions, see §5. What shipped is the assertion layer — `npm run check:secrets` plus three
test files — built so that wiring would be one line. **It was**: `ci-quality-gates` wired it on
2026-09-12, and the scan is now the last link of the publish gate. Measured along the way and worth carrying: the client bundle was already clean and
structurally so (Astro fails the build on a client-side `astro:env/server` import), so the
headline assertion cannot fail through the framework path; the real disclosure was an upstream
auth error in a URL, which Phase 3 fixed; and `dist/server/.dev.vars` holds the env values in
plaintext on every build, which is why the scan targets `dist/client` alone.

## 4. Stack

The classic test base for this project **when this plan was first written**: none — no runner
configured, 0 test files. Phase 1 bootstrapped it.

**As measured 2026-09-13**: 46 vitest files / 428 tests across the `unit`, `component` and
`integration` projects, plus 4 Playwright tests in 2 spec files (`tests/e2e/`) behind their own
runner. The sentence above is kept in the past tense rather than deleted because §3's phase
numbering refers back to it — but read as a description of state it is now false in both halves.

| Layer                 | Tool                                                         | Version   | Notes                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration    | Vitest                                                       | ^4.1      | wired in Phase 1 (`vitest.config.ts`, node env, `npm test`). Natural fit: the project already builds on Vite (Astro 6).                                                                                                                                                          |
| Supabase integration  | local stack (`npx supabase start`) + `@supabase/supabase-js` | installed | Run RLS tests against the local Postgres with two distinct user JWTs; never the service-role client.                                                                                                                                                                             |
| e2e                   | Playwright                                                   | ^1.63     | wired 2026-09-13 (`playwright.config.ts`, `tests/e2e/`, `npm run test:e2e`). Chromium only, `retries: 0`. Runs on a developer machine and in GitHub Actions; **never** in the publish gate — the Cloudflare build container has no Docker, so `supabase start` cannot run there. |
| build-artifact checks | `scripts/check-client-bundle.mjs` (`npm run check:secrets`)  | n/a       | shipped by §3 Phase 3 and wired into `npm run ci:gate` on 2026-09-12, so it **blocks publication**. Scans `dist/client` only — under `output: "server"` that is where the client bundle lives and SSR output never reaches it (see §7).                                          |
| (optional) AI-native  | none                                                         | n/a       | not justified under cost × signal at this maturity.                                                                                                                                                                                                                              |

**Stack grounding tools (current session):**

- Docs: Supabase skill (RLS / migration / SSR best-practices) — available, used to ground the RLS-test approach (two JWTs, no service-role client); checked: 2026-06-28. Context7 / framework-docs MCP: not available in current session.
- Search: none — no Exa.ai / web-search MCP available in current session; checked: 2026-06-28.
- Runtime/browser: Playwright MCP — not available in current session; checked: 2026-06-28.
- Provider/platform: wrangler (Cloudflare) skill — available; relevant to future CI/quality-gate wiring (Cloudflare Workers Builds, no GitHub Actions); Supabase local stack available for integration tests; checked: 2026-06-28.

## 5. Quality Gates

What actually runs, where, and what stops a bad change.

**Read the "Where" column literally, and read this paragraph before the table.**

**There is a deploy pipeline and it now contains the tests. Until 2026-09-12 it did not**, and
the paragraph below is kept in the past tense rather than deleted, because the reasoning is what
made the fix worth doing.

_Before 2026-09-12:_ Cloudflare Workers Builds was connected to this repository and a push built
and published the project. What it ran was the build command — `astro build`. That did not run
`npm run lint`, did not run `npm test`, did not run `npm run check:secrets`, and did not typecheck
`.astro` templates (which is why `astro check` was promoted to pre-commit in the first place). So
every push published, and nothing between the commit and production executed a single assertion in
this plan. That was a worse position than having no pipeline at all, because a pipeline invites the
belief that something is checking.

_Since `ci-quality-gates`:_ the build command is `npm run ci:gate` and a non-zero exit produces no
version, so a failing lint, typecheck, unit/component test or secret scan stops the deploy. The
integration half runs in GitHub Actions, which on this plan can report but cannot block. The
pre-commit hook is unchanged and still bypassable with `--no-verify`; the publish gate is not.

**Correction, recorded because the mistake is instructive.** This section said until 2026-09-11
that no CI existed at all. That was wrong. It came from reading `infrastructure.md:96` — "Wire
CI (GitHub → Workers Builds)" — as a description of state when it is a numbered SETUP STEP, and
from `b1fd059` having deleted `.github/workflows/ci.yml`. The archived
`context/archive/2026-09-11-testing-secret-leak/research.md` and its review carry the same wrong
conclusion; they are superseded by this paragraph and must not be quoted for it. The lesson is
the one this project keeps relearning from the other direction: **an instruction and an
inventory look identical in prose, and the only way to tell them apart is to observe the
system.**

| Gate                                          | Where it runs                                                             | Enforced?                                                                  | Catches                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| format (prettier, edited file)                | per-edit agent hook (`.claude/hooks/format-edited-file.mjs`)              | agent sessions only                                                        | formatting drift; a file the formatter cannot parse                                                                         |
| format (prettier, staged json/css/md)         | pre-commit, lint-staged                                                   | every commit                                                               | formatting drift in non-code files                                                                                          |
| lint (staged files)                           | pre-commit, lint-staged → `eslint --fix` on `*.{ts,tsx,astro}`            | every commit                                                               | syntactic drift                                                                                                             |
| lint (whole project)                          | **publish gate** + GitHub Actions                                         | **every deploy; blocks publication**                                       | drift in files no commit touched; any WARNING (`--max-warnings 0`)                                                          |
| typecheck                                     | pre-commit → `npm run check`; **publish gate**; Actions                   | every commit **and every deploy**                                          | type drift, including inside `.astro` templates; any WARNING (`--minimumFailingSeverity warning`)                           |
| build                                         | **publish gate** + GitHub Actions                                         | **every deploy; blocks publication**                                       | broken SSR build                                                                                                            |
| unit + component                              | **publish gate** + GitHub Actions                                         | **every deploy; blocks publication**                                       | logic regressions                                                                                                           |
| unit + integration, scoped to the edited file | per-edit agent hook (`.claude/hooks/related-tests.mjs`)                   | agent sessions only; skips when the stack is down                          | regressions on the path just edited                                                                                         |
| secret-leak scan of `dist/client`             | `npm run check:secrets`, and a test inside `npm test`                     | **every deploy; blocks publication**                                       | a secret literal pasted into a client island                                                                                |
| env schema shape                              | a test inside `npm test`                                                  | **every deploy; blocks publication**                                       | a `PUBLIC_`/client-context redeclaration that would inline a secret                                                         |
| Supabase advisors (security)                  | `npx supabase db advisors`, by hand                                       | recommended on every migration                                             | RLS / definer-function issues                                                                                               |
| integration (RLS + routes)                    | **GitHub Actions only** — the build container has no Docker               | every push and PR, but **cannot block a merge**                            | RLS + route regressions                                                                                                     |
| gate contents themselves                      | `tests/unit/ci-gate-source.test.ts`                                       | **every deploy; blocks publication**                                       | a step quietly removed from either gate                                                                                     |
| island props in rendered pages                | `tests/render/island-props.test.ts` via `npm run test:render`             | **every deploy; blocks publication**                                       | a server secret reaching the browser inside `<astro-island props>`                                                          |
| font provider source                          | `tests/unit/font-source.test.ts`                                          | **every deploy; blocks publication**                                       | a Google host re-entering the build path through a config edit                                                              |
| fonts actually emitted by the build           | `tests/unit/font-assets.test.ts`                                          | **every deploy; blocks publication**                                       | a build that exits 0 having produced no webfonts, or lost `unicode-range`                                                   |
| documentation links                           | `npm run check:links`, first in `ci:gate` + Actions                       | **every deploy; blocks publication**                                       | a document citing a path that no longer exists                                                                              |
| e2e on critical flows                         | `npm run test:e2e`; **GitHub Actions only** — needs Docker + a dev server | every push and PR, but **cannot block a merge**, and never blocks a deploy | the caretaker reveal chain end to end: claim → cookie jar → reload → SSR, and the sensitive tier reaching an island's props |

**Why so many rows now say "blocks publication", corrected 2026-09-12.** Five rows read
"with the suite", which is true but misleading in the one way this section exists to prevent:
anything in `tests/unit/`, `tests/component/` or `tests/render/` runs inside `npm run ci:gate`,
and `ci:gate` IS the Cloudflare build command — so a failure there produces no version and
nothing deploys. A reader deciding whether the font assertion can stop a bad deploy got the
wrong answer from that cell. Only the `integration` vitest PROJECT is genuinely
non-blocking, because it needs Docker and therefore runs in Actions alone. Note it is a project,
not a directory: `vitest.config.ts` gives it `include: ["tests/**/*.test.ts"]` and selects by
config, so there is no `tests/integration/` folder to point at. <!-- link-check:ignore -->

The `astro check` in pre-commit replaced `tsc --noEmit` on 2026-09-07 (S-03 phase 3 review:
`tsc` does not see type errors inside `.astro` templates). Both tables said otherwise until
2026-09-11.

**And the correction had to be made twice, which is the part worth keeping.** The first pass
rewrote the gate table above and updated one row of the cost table below — leaving that table
still assigning `eslint .` to CI and `tsc --noEmit` to pre-commit, eleven lines under a
paragraph stating that no CI exists. A review caught it. Correcting a document in one place and
believing it corrected is the same failure as writing it wrong: the unit of verification is the
CLAIM, not the section.

**Wired on 2026-09-12 (`ci-quality-gates`), and the shape it took is worth recording**, because
the paragraph that stood here predicted it almost correctly and got one thing wrong.

The build command is now `npm run ci:gate`, defined in `package.json` — not typed into the
dashboard, so its contents are in git history where review can see them. The chain is
`check:links → check → lint → build → --project unit --project component → test:render → check:secrets`, and the order is
load-bearing twice over: `astro check` regenerates `.astro/` that type-aware ESLint needs, and
the build must precede the TESTS, not merely the scan — `tests/unit/client-bundle.test.ts` fails
rather than skips without `dist/client`. That is the correction: the paragraph that stood here
tied the ordering to `check:secrets` alone.

The integration half was split off exactly as predicted, and runs in `.github/workflows/ci.yml`
against a real `supabase start`. It cannot block a merge — this repository is private on GitHub
Free, where branch protection is unavailable — so the two gates divide cleanly: Actions is the
only place the integration suite runs, and the build command is the only thing that can stop a
publication.

### Which layer each gate lives in

Gates are placed by measured cost, not by preference. Measured on this project
(Windows, 2026-09-07). Two rows were re-measured on 2026-09-11 during `ci-quality-gates`
research and came back substantially faster — a cost table is a measurement with a date on it,
not a constant, and planning a gate around a stale number is how a cheap check gets called
expensive:

| Check                         | Scope                     | Cost                                        | Layer                                                  |
| ----------------------------- | ------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| `prettier --write <file>`     | one file                  | ~0.3s                                       | per-edit agent hook                                    |
| `vitest related <file> --run` | one file's import graph   | ~2s                                         | per-edit agent hook, risk areas only                   |
| `eslint --fix <file>`         | one file                  | 12-22s (type-aware, `projectService: true`) | pre-commit (lint-staged)                               |
| `eslint .`                    | whole project             | **28s** (was ~110s on 2026-09-07)           | **publish gate** + GitHub Actions (see §5)             |
| `tsc --noEmit`                | whole project             | ~26s                                        | not wired — superseded by `astro check` on 2026-09-07  |
| `astro check`                 | whole project + templates | **18s** (was ~38s on 2026-09-07)            | **pre-commit** (as `npm run check`) **+ publish gate** |
| `npm run ci:gate`             | the whole publish chain   | **183s cold / 104s warm**                   | **Workers Builds build command** — blocks publication  |

The `ci:gate` row carries two numbers because the gap between them is the whole story: the chain
costs 183s on a cold Vite cache and 104s when it is warm, and the sum of the steps measured
individually (99s) matches the warm figure — so the five `npm run` spawns cost nothing and the
difference is entirely cache. **Cloudflare builds cold** (its build cache is opt-in and off), so
183s is the number that describes the deploy path; 104s describes a developer re-running it.

Two consequences worth knowing before changing the wiring:

- **Lint is not a per-edit hook here.** `projectService: true` makes ESLint
  build a TS program per invocation, so even single-file linting costs 12-22s.
  It stays on staged files at commit time.
- **The scoped test hook skips instead of failing when the local Supabase stack
  is down.** The suite needs it; a stack-down failure says nothing about the
  edit, and a blocking exit code there would train the agent to ignore the hook.
  Migrations are also skipped (verifying them needs `npm run db:reset`).

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section fills in once the
relevant rollout phase ships; before that it reads "TBD — see §3 Phase N."

### 6.1 Adding a unit test

Pure-logic tests live in `tests/unit/` and run under the **`unit`** Vitest project,
which has no `setupFiles` — so they run with the local Supabase stack down:

1. Put the test in `tests/unit/<subject>.test.ts`. Import the module under test via
   the `@/` alias (shared with the integration project).
2. Run just these: `npx vitest run --project unit`. `npm test` runs both projects.
3. **Do not import app modules that reach for the network.** Anything that builds a
   Supabase client, reads `.env.test`, or touches `astro:env/server` belongs in the
   integration project instead — putting it here trades a fast test for a confusing
   failure with no setup guidance.
4. Keep the split honest: if a test needs a database, it is not a unit test. The value
   of this project is that it stays runnable without Docker.

See `tests/unit/theme.test.ts` for the canonical example.

### 6.2 Adding an integration test (RLS / Supabase)

Harness shipped in Phase 1 (`testing-rls-owner-isolation`). Recipe:

1. Start the local stack (`npm run db:start`) and put the printed `SUPABASE_URL` +
   **anon** key into `.env.test` (copy `.env.test.example`). `tests/env.ts` loads it and guards
   that the host is local (both per worker, on import); `tests/global-setup.ts` waits for the
   stack once per run and fails fast with an actionable message if it never becomes ready.
   `tests/setup.ts` is now just the re-export that ties them together.
2. In your test, get an authenticated, anon-keyed client per owner from
   `createOwnerClient()` (`tests/helpers/auth.ts`). Each call signs up a fresh, distinct
   owner and returns `{ client, userId, email, password }`.
3. Assert cross-tenant denial via these clients only. See
   `tests/rls/profiles.isolation.test.ts` for the canonical example.
4. Run with `npm test`. **Never** assert through the service-role/postgres client — it
   bypasses RLS and makes the test a tautology. (The one allowed service-role use is an
   admin-only operation like deleting an `auth.users` row — confine it to its own file,
   as in `tests/rls/profiles.cascade.test.ts`, and never use it to assert RLS.)

`createOwnerClient()` signs up a fresh `auth.users` row per call and does not tear it
down, so the local DB accumulates test owners across runs. This is harmless (local only),
but run `npm run db:reset` to start from a clean, seed-only state whenever you want it
tidy.

### 6.3 Adding an e2e test

**Read `docs/reference/e2e-rules.md` first** — it carries the rules that are specific to this
repo and not derivable from general Playwright practice. Model the test on
`tests/e2e/seed.spec.ts`; that file is the exemplar a generator copies.

1. Start from a §2 risk that genuinely needs a browser — it crosses several boundaries (auth,
   routing, API, DB) or exists only in the rendered UI. If an isolated function can prove it, a
   unit or integration test is cheaper and more honest.
2. Seed through `tests/e2e/fixtures/`, per test, with an anon-keyed client — never service-role,
   which bypasses RLS and makes the surrounding assertions tautological.
3. `await waitForHydration(page)` before touching any island. Controlled inputs are reset by
   hydration and clicks on un-hydrated buttons do nothing, silently.
4. Prove the assertion bites by a deliberate break, and check WHICH assertion moved — not merely
   that something went red. Revert it; never commit it.

### 6.4 Adding a test for a new API endpoint

- TBD — see §3 Phase 2. Target pattern: exercise the handler request → response
  AND side-effects; assert zod rejection of bad input; mock only the external edge.

### 6.5 Adding RLS coverage for a NEW table

The recurring pattern every slice (S-01+) copies. After enabling RLS and writing the
owner-isolation policies (`docs/reference/data-access.md`), add a `tests/rls/<table>.isolation.test.ts`
that mirrors `tests/rls/profiles.isolation.test.ts`:

1. `createOwnerClient()` for two owners (A, B); seed each owner a row of the new table
   (via the app's insert path or a helper) so there is cross-tenant data to probe.
2. Assert all four denial surfaces, not just SELECT:
   - **SELECT** — A sees only A's rows, never B's.
   - **UPDATE** — A updating B's row affects 0 rows and does not mutate it.
   - **INSERT** — writing a row owned by someone else is rejected (error).
   - **DELETE** — A cannot delete B's row (0 rows; row survives).
   - plus the **with-check** case if the table lets a user reassign the owner FK.
3. A SELECT-only test is not enough — the deny-by-default gate lives on INSERT/DELETE
   (grants may already permit them). This is the lesson from the F-01 impl-review (F3).

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note here
capturing anything surprising the phase taught.)

- **Phase 1 (RLS owner-isolation, `testing-rls-owner-isolation`)**: DELETE/UPDATE denial
  under RLS is silent — no error, just 0 rows affected — so those cases assert the row
  _survives/is unchanged_, not that an error is thrown. Only INSERT (and the with-check
  reassignment) raise a hard RLS error. `.env.test` carries a service-role key solely for
  the cascade test's `auth.admin.deleteUser`; it is fenced to that one file.
- **S-07 (`ui-design-system`)**: splitting `vitest.config.ts` into `unit` + `integration`
  projects was the only way to test pure logic without Docker — `tests/setup.ts` was then a
  setup file whose `beforeAll` demanded a live stack, so before the split every test file paid
  that cost. (It paid it per FILE, which `ci-quality-gates` measured in 2026-09 and fixed by
  moving the readiness probes into a real `globalSetup`.) Note what is deliberately NOT tested here: no assertions on Tailwind classes or
  rendered colour (§7), only `resolveTheme`'s cookie → class rule, which is the slice's sole
  piece of branching logic. The visual work was verified by eye against the design.
- **Phase 2 (auth gating, `testing-auth-gating`)**: the Phase-1 harness yields an in-memory
  session, not cookies — driving the middleware needs the real `sb-<host>-auth-token` captured
  from an `@supabase/ssr` sign-in (`createAuthenticatedCookieHeader`), never a hand-forged JWT
  (real sessions are base64url and chunk past ~3180 chars). The genuine `onRequest` runs in
  pure-Node Vitest via honest shims for `astro:env/server` / `astro:middleware` — no Container
  API (it won't auto-load our middleware) and no running server needed. `getUser()` is the
  correct call and is never mocked.

- **S-02 (`care-period-and-invite-link`)**: this slice added a second access model, and
  the §6.5 recipe does not reach it. `get_period_by_token` is `SECURITY DEFINER` and
  bypasses RLS by design, so there is no policy behind it to catch a mistake in its body —
  `tests/rls/invite-token.test.ts` is its only automated guard, and it needs a primitive the
  harness did not have: `createAnonClient()` (`tests/helpers/auth.ts`), a client with **no
  session**, so it genuinely carries the `anon` role. Three things that recipe taught:
  (1) asserting "anon sees nothing" is not enough — assert the failures are _indistinguishable_
  from each other, because a distinct answer for a revoked token confirms the period exists;
  (2) `revoke ... from public` does not revoke from `anon`/`authenticated`/`service_role` on
  Supabase (ALTER DEFAULT PRIVILEGES grants those separately), and the same gap exists at
  table level, so assert privileges from the catalog rather than trusting the migration's
  intent; (3) a plpgsql function returning a composite answers `return null` with a row of
  NULLs, not NULL, so an RLS miss reads as a hit at the client — return a scalar when the
  caller needs to tell "nothing happened" apart from "here it is". Also note what is
  deliberately NOT tested at the time: the caretaker page was verified through HTTP by hand,
  because an automated version would depend on a running dev server. **Superseded in part on
  2026-09-13** — the post-claim reveal flow is now driven by Playwright
  (`tests/e2e/invite-reveal.spec.ts`), outside `npm test`; the page's other branches are still
  unasserted. See §7.

- **S-08 (`period-pets-relation`)**: the first table in this schema whose ownership is
  transitive through TWO parents, and the recipe changes because of it. §6.5's four denial
  surfaces are necessary but not sufficient: the predicate is a conjunction (`caller owns the
period AND the pet`), and a single-parent version passes every one of those four. What
  catches it is a pair of with-check cases in opposite directions — A's period + B's pet, and
  B's period + A's pet. Say what the missing half actually costs, not just that a test would
  miss it: with only the period half, an owner can attach **another owner's pet** to their own
  trip — a classic IDOR, and one that stays invisible until S-03 ships the instruction reveal,
  at which point that pet's care instructions are handed to the attacker's caretakers.
  Two further lessons: (1) **mutation-test a conjunction, do not assume it** — breaking each half in turn showed exactly which cases guard which, and confirmed both
  are load-bearing; (2) **verify the mutation actually applied** — one run was a silent no-op
  because prettier had reformatted the call being patched, and the test "passed", which would
  have read as "the test does not guard this". Also note the enforcement asymmetry recorded in
  §7: SELECT and DELETE are deliberately unpinned because the application cannot produce the
  row they would need. One more fact S-03 must not rediscover: **a period with zero pets is
  representable by design.** "At least one pet" is enforced only inside
  `create_period_with_slots`, so a pre-relation row, a raw insert, or deleting the last linked
  pet all leave a petless period standing. Every screen that reads a period's pets has to
  render that state rather than assume a non-empty list.

- **Phase 4 (domain guardrails, `testing-domain-guardrails`)**: the phase taught one thing
  repeatedly and it is worth more than the tests. **A prediction about what happens when a
  guard is removed belongs in a mutation run before it belongs in prose.** Three times the
  plan's stated premise turned out to be false, and every time the mutation — not the
  planning, not the review of the plan — is what revealed it (see §7). Mutation testing has
  its own ceiling too: it only refutes hypotheses you already hold, which is how a
  release that over-reached ACROSS periods passed four tests written for the two
  hypotheses their author had. Mechanics worth copying: mutate through a scratch migration
  plus `npm run db:reset` rather than patching in place (prettier silently reformatted an
  in-place mutation once, producing a no-op that read as "the test does not guard this");
  and verify the mutation actually applied before believing the result.

- **Phase 3 (secret-leak assertions, `testing-secret-leak`)**: the phase's own headline could not
  fail, and finding that out early is what made it useful. Astro guards the client bundle by
  FAILING THE BUILD on a client-side `astro:env/server` import, and env is a runtime binding with
  no build-time substitution, so a bundle scan can only catch a literal a person pasted into an
  island. Three mechanics worth copying. (1) **Scope the scan to what ships**: `dist/server/.dev.vars`
  holds the env values in plaintext on every build, so a `grep dist/` fails on a CORRECT build and
  the reflex fix is to weaken the check. (2) **Choose tokens that stay true**: `service_role` reads
  like the obvious pattern and is JSDoc prose inside bundled supabase-js — it is absent today only
  because supabase-js is not client-bundled. (3) **A scan needs a positive control and must fail,
  not skip, on an empty input** — a green run against no artifact is the same defect as an
  assertion that passes when the layer it guards is gone. Also a mutation lesson with a new shape:
  the first planted literal was a dead `const`, the bundler tree-shook it, and the artifact came
  back BYTE-IDENTICAL — which reads as "the check does not bite" unless you compare sizes. Plant
  live code.

### 6.7 Adding a protected-route (middleware gating) test

The recipe for proving a route is gated (Risk #2). Shipped in Phase 2
(`testing-auth-gating`). Mirrors `tests/middleware/auth-gating.test.ts`:

1. Drive the real middleware with `runMiddleware({ pathname, cookieHeader })`
   (`tests/helpers/middleware.ts`) — it imports the genuine `onRequest` and returns
   `{ response, nextCalled, locals }`. The `astro:env/server` / `astro:middleware` virtual
   modules resolve via shims wired in `vitest.config.ts` (honest stand-ins, not auth mocks).
2. For the authenticated case, get a real session cookie from `createAuthenticatedCookieHeader()`
   (`tests/helpers/session.ts`) — it mints a fresh owner and captures the genuine (base64url,
   possibly chunked) `sb-<host>-auth-token`. For the negative case, `corruptCookieHeader(cookieHeader)`
   turns that captured header into a present-but-invalid session, keeping the captured
   cookie name — never reconstruct the name, or the case can pass for the wrong reason.
3. Assert three surfaces, not just the redirect status. Drive the no-cookie case with
   `it.each(PROTECTED_ROUTES)` (exported from `src/middleware.ts`) so a newly gated prefix
   is covered the moment it is added, instead of relying on a manual check:
   - **no cookie** — `response.status === 302`, `Location === "/auth/signin"`, and
     `nextCalled === false` (the route handler never ran → no owner data served).
   - **valid cookie** — `nextCalled === true` and `locals.user.id` is the signed-in user.
   - **invalid/expired cookie** — redirect again. `getUser()` validates the token server-side;
     a present token is not authorization.
4. **Never** mock the Supabase auth client — that asserts the mock, not the gate (§2 Risk #2
   anti-pattern). `getUser()` runs for real against the local stack.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Generated Supabase types** (`src/db/database.types.ts`) — the generator is the
  test; asserting on them is tautological. Re-evaluate only if we hand-edit generated
  output (we don't). (Source: Phase 2 interview Q5.)
- **Tailwind styling / exact class output** — brittle and low-signal. Re-evaluate if a
  visual regression ever causes a real incident. (Source: Phase 2 interview Q5.)

- **The caretaker page's rendered HTML (S-02) — PARTLY COVERED since 2026-09-13, and the
  boundary is worth stating precisely.** This entry used to read "this project has no e2e runner
  by choice"; that is no longer true. `tests/e2e/invite-reveal.spec.ts` now drives the page in a
  real Chromium and asserts the POST-CLAIM state: the sensitive tier on screen, and that same
  text absent from every `<astro-island props>`. It lives outside `npm test` (its own runner and
  script), so the original objection — a suite that fails whenever the dev server is down — does
  not apply to it.
  What is STILL not asserted: every other branch of the template. The inactive card, the revoked
  card, the error card and the uniform-failure rule remain pinned only by `resolveInviteView`
  (`tests/unit/invite-view.test.ts`) and `tests/rls/invite-token.test.ts` on the SQL side. One
  flow is covered; the template as a whole is not.

- **The SELECT and DELETE halves of `care_period_pets`'s owner predicate (S-08).** All four
  policies are a conjunction over both parents (caller owns the period AND the pet), and the
  INSERT and UPDATE halves are pinned by mutation-tested cases in
  `tests/rls/care-period-pets.isolation.test.ts` — dropping either half fails exactly the
  case written for it. SELECT and DELETE are **not** pinned, deliberately: proving them needs
  a row whose two parents have different owners, and the application cannot produce one
  (INSERT and UPDATE both refuse it, and there is no pet-ownership-transfer path). The only
  producers are a `service_role` write — which would widen a fence §6.6 records as existing
  for exactly one call in one file — or a deliberately invalid row in `seed.sql`, which would
  land in every developer's database and show up in the UI. Both cost more than the residual
  risk: these two clauses are defense-in-depth against corrupt data a privileged process
  would have to create first.

- **Polish, user-facing validation messages on `/api/pets` and `/api/periods/[id]/token`
  (S-01 debt).** `/api/periods` now returns a zod issue's message and its island renders it
  verbatim, pinned by `tests/unit/period-schema.test.ts` against an exported message set. The
  other two routes still answer `{ error: "Validation failed" }`, and `AddPetForm` discards it
  for a generic sentence — the same defect, still live. It is NOT fixed here because copying
  the passthrough alone would leak English: `src/lib/schemas/pet.ts` carries messages on two
  fields only, so `species` would surface `Invalid option: expected one of "dog"|"cat"|"other"`.
  Fixing it properly means Polish messages at the type level in that schema plus the membership
  test extended to cover it — its own unit of work, in S-01's scope, not this change's.

- **The claim × release lost-update window (Phase 4).** `release_slot` carries no optimistic
  lock, so an owner releasing from a stale tab can silently wipe a caretaker claim that landed
  in between. Documented at `release_slot.sql:52-65` and recorded in `prd.md` §Open Questions #3
  with `Owner: użytkownik`. NOT pinned: closing it is a product decision and a migration, not a
  test. Re-evaluate if the product grows co-owners or realtime — the fix (`p_claimed_at` in the
  WHERE) would make it testable in the same breath.

- **The claim × revoke race — MEASURED 2026-09-11, and it is not a defect.** The window is real
  and wide: `claim_slots` resolves the period with `revoked_at is null` in one statement and
  updates `care_slots` in a later one, with no re-check and no lock on `care_periods`. Under READ
  COMMITTED each statement takes its own snapshot, so the migration's comment "carries
  revocation, since v_period was derived with revoked_at is null" describes a guarantee the
  function does not have across statements.

  Probed with 40 concurrent claim/revoke pairs: the claim landed **40/40** — not a narrow window
  but the normal outcome, because the claim's period lookup sits at the very start of its
  transaction and beats the revoke's commit. What the caretaker then sees was the open question,
  and the answer is the benign one: `get_claimed_details` returned `{revoked: true}` in **all 40**
  cases. Zero content reveals, zero sensitive rows, zero notes.

  So the end state — a claimed term on a revoked trip, and a caretaker holding the called-off
  card — is **indistinguishable from a sequence the product supports**: claim first, revoke
  after. Revocation deliberately does not release taken terms (`prd.md` §Open Questions #5), so
  that state is expected rather than anomalous; the race only compresses it into one instant.

  NOT pinned, and now for a measured reason rather than a guessed one. An earlier review
  described this as a caretaker "getting a reveal on a trip the owner has called off" — that
  description was wrong, and correcting it is the point of this entry. Re-evaluate if revocation
  ever grows a side effect on claimed rows, or if `get_claimed_details` ever serves content to a
  holder on a revoked period.

- **The deadlock branch, through the database (Phase 4).** `src/pages/invite/claim.ts` maps
  SQLSTATE `40P01` to a retryable 409. That branch cannot be reached by racing real claims:
  `claim_slots` allocates with one UPDATE carrying no `ORDER BY`, so both sessions run identical
  SQL, get the same plan and take row locks in the same order — a consistent global lock order
  makes deadlock impossible rather than merely unlikely. The mapping is covered by INJECTION
  instead (`tests/unit/claim-error-mapping.test.ts`), which is deterministic and Docker-free.
  Re-evaluate if the claim path ever gains a second statement or a different lock order.

- **The row lock itself (Phase 4).** `claim_slots` allocates with one guarded `update … where
claimed_by_name is null`. Every concurrency test in this repo — `tests/rls/claim-slots.test.ts`
  and the HTTP block in `tests/api/invite-claim.test.ts` — proves the OUTCOME (exactly one
  winner), not that the row lock was exercised: nothing forces the statements to interleave, so
  the same assertions would pass against a broken read-then-write that happened not to overlap.
  A deterministic proof needs two held transactions, which needs a `pg` client this repo
  deliberately does not carry. Both files say so about themselves. Re-evaluate if a `pg`
  dependency ever arrives for another reason.

- **`npm test` now needs a build (Phase 3).** `tests/unit/client-bundle.test.ts` scans
  `dist/client`, and it FAILS rather than skips when there is none — deliberately, because a
  green run against no artifact is the defect this whole change is about. The consequence is
  real and belongs here: on a fresh clone `npm test` fails until `npm run build` has run once,
  and the `unit` project's "runs with Docker down" property now also means "runs with a build
  present". **When CI is restored, `npm run build` must be ordered before `npm test`**, or the
  suite fails for a reason unrelated to secrets.

### What Phase 4 measured, and where this plan had been wrong

Two claims in the §2 Risk Response table read stronger than the code supports. Both were
corrected by mutation during Phase 4 and are recorded here so the next reader does not
re-inherit them.

- **Risk #4's anti-pattern is real, but the caretaker page was never the secrecy boundary.**
  `get_period_by_token` returns PUBLIC instruction rows only, so before a claim the page is
  never handed a sensitive row or the trip note — there is nothing there to withhold. Secrecy
  is enforced by the two `SECURITY DEFINER` doors plus `splitRevealAnswer`, pinned by
  `tests/rls/reveal-instructions.test.ts` and `tests/unit/invite-view.test.ts`. What Phase 4
  added at the page layer (`composeCaretakerView`) pins everything DOWNSTREAM of that gate:
  tier separation, id-keyed matching, no dropped or conjured pet, and the note travelling only
  with the reveal. Real, and narrower than "the API leaks the field anyway" suggests here.

  **What the 2026-09-13 e2e test does and does NOT add to this, measured rather than reasoned.**
  `tests/e2e/invite-reveal.spec.ts` carries a pre-claim check that the sensitive text is absent.
  That check is a co-assertion, NOT a guard, and the paragraph above is why: disabling the
  sensitive block's render in `[token].astro` and re-running left the pre-claim assertions GREEN
  and failed the test at the POST-claim assertion instead. So nobody should credit the e2e suite
  with defending the pre-claim boundary — `tests/rls/reveal-instructions.test.ts` does that, one
  layer down. What the e2e test genuinely adds is the chain no other layer touches: the browser's
  own cookie jar. Inverting the capability cookie's `Path` turns the reveal red; that failure is
  invisible to `tests/api/invite-claim.test.ts`, which drives the claim route with a FAKE jar.

- **Risk #5's owner routes are defended by two different fences, and which one holds depends on
  the caller.** With NO session cookie — the link-only caretaker Risk #5 is about — deleting a
  route's `locals.user` check does not produce a write: the client is anon-keyed and anon holds
  no EXECUTE on `revoke_period`, `release_slot`, `regenerate_period_token` or
  `create_pet_with_instructions`, so the write dies at the database (42501).
  `tests/api/token-scope.test.ts` therefore pins the ANSWER — a clean 401 rather than a 500
  carrying a database error. With a session cookie present but `locals.user` absent — the shape
  a middleware mistake actually produces — the client is `authenticated`, the grant layer lets
  it straight through, and the route check is the ONLY fence: measured, removing it from
  `pets.ts` yields **201 and a real row**. That half is pinned by
  `tests/api/revoke-period.test.ts` and `tests/api/pets.post.test.ts`. Quoting either half
  alone misleads.

- **A secret that is present in source but tree-shaken out (Phase 3).** `npm run check:secrets`
  scans the ARTIFACT, so a dead literal in `src/` passes it. That is correct — an eliminated
  constant does not ship — but it means the scan is not a source audit and must not be quoted as
  one. Re-evaluate if a secret-scanning pre-commit hook is ever wanted; that is a different tool.

- **Configuration state disclosed to a SIGNED-IN owner (Phase 3).** `pets.ts`, `periods.ts`,
  `token.ts`, `revoke.ts` and `release.ts` answer `{"error": "Supabase is not configured"}` — an
  English sentence among Polish ones, stating a server fact. (Counted as four until a review
  found the fifth — `release.ts`, one of the files that phase edited.) Phase 3 fixed only the
  PRE-AUTH pair (`signin`, `signup`), where an anonymous caller learned it. All five require
  `locals.user`,
  so the disclosure is bounded to an authenticated owner. Cosmetically inconsistent, low signal;
  `src/pages/invite/claim.ts` shows the intended shape if it is ever worth normalising.

- **`dist/server/.dev.vars` (Phase 3).** `@cloudflare/vite-plugin` writes the real
  `SUPABASE_URL` and `SUPABASE_KEY` there in plaintext on every build. Not acted on: `dist/` is
  gitignored and the file is named in `dist/client/.assetsignore`, so it reaches neither git nor
  the asset bucket — a local-disk exposure only. Recorded because a developer would not expect a
  build to write a secret, and because it is the reason the scan targets `dist/client` alone.

- **`pets.ts`'s zod `issues` in the 400 body (Phase 3).** Measured safe under zod v4: an issue
  carries `{code, maximum, path, message}` and no `input`/`received`, so a rejected instruction
  body is not echoed. It is the only route still shipping raw issues — `periods.ts` and
  `claim.ts` dropped them. The safety is a zod-version property, not a design one: re-evaluate on
  any zod major upgrade.

- **How wide the auth oracle actually was (Phase 3).** The research framing said sign-in
  disclosed "invalid credentials vs unconfirmed email vs already registered". Measured: GoTrue
  returns the SAME message for a wrong password and an unknown address, so sign-in was never an
  enumeration oracle on its own; sign-up's "User already registered" was the live one, and
  "Email not confirmed" is unreachable locally (`enable_confirmations = false`) and unknown in
  the hosted project. The fix swallows all of them regardless, which is why it did not depend on
  getting this right — but the record should.

- **`/api/auth/signout`'s two silent paths — COVERED since 2026-09-13, and the entry is kept
  because the reason it stood is more instructive than the fix.**

  What this said until now: the route skipped the sign-out entirely when `createClient` returned
  null and still redirected, so a caller could not tell a completed sign-out from one that never
  happened; `tests/api/signout.test.ts` named it in its header and did not assert it, because
  "reaching that branch needs a null-returning mock, and that file exists to talk to the real
  client". The argument for leaving it was that the branch is unreachable in practice and that its
  own failure is benign. The entry was careful to say that this is a claim about reachability, not
  about a gate — correcting its own first draft, which had cited `npm run check:secrets` as if it
  were one. That command does exit 2 without `SUPABASE_URL`/`SUPABASE_KEY` — the measurement was
  real — but it is a BUILD-time secret scan with a documented opt-out
  (`SECRET_SCAN_ALLOW_MISSING_ENV=1`), and it says nothing about whether the deployed worker holds
  its runtime bindings, which is what `createClient() === null` actually depends on.

  **That reasoning covered the smaller of the two silent paths and missed the larger one.** Measured
  2026-09-13 in `node_modules/@supabase/auth-js/dist/main/GoTrueClient.js` (v2.105.3): `_signOut()`
  returns EARLY when `admin.signOut()` errors with anything outside 404/401/403, so
  `_removeSession()` never runs. That function is the only thing in the library that removes the
  session from storage — measured, because "only" is the kind of word this document keeps having to
  take back: `removeItemAsync(this.storage, this.storageKey)` appears inside `_removeSession()` and
  nowhere else. (It has seven callers, so it is not that sign-out is its only entry point; it is
  that there is no second way to clear.) Storage here is the `@supabase/ssr` cookie adapter in
  `src/lib/supabase.ts`, so "not cleared from storage" means "the cookies stay in the browser". The route discarded that error, so a **failed** sign-out left the browser holding a
  working session and answered `302 → /` exactly like a successful one. Unlike the null-client
  branch, that needs no missing configuration: a 500 from GoTrue or a dropped connection is enough.

  Both paths now clear every `sb-` cookie the caller actually sent, and both log. The error path
  logs `code` and `message`; the null-client path logs a static line, because there is no error
  object on that branch — a reader grepping the logs for a `code` there will not find one, and
  that is the branch, not a lost log. A cookie name the caller sent that `cookie.serialize`
  refuses (a space in the name — non-ASCII cannot reach us, `new Request` rejects the header
  first) is skipped rather than thrown: it cannot be a name `@supabase/ssr` wrote, and the route's
  single 302 exit must survive a hostile header.
  The loop clears more than the request header, because the request header is not the whole story.
  Measured 2026-09-13 in the same `GoTrueClient.js`: `_signOut()` runs inside `_useSession()`, whose
  `__loadSession()` calls `_callRefreshToken()` when the session sits within `EXPIRY_MARGIN_MS`, and
  that persists through the adapter's `setAll`. So a sign-out attempt can itself STAGE a fresh
  session — under re-chunked names the request never carried — before it fails. Clearing only what
  the caller sent would have emitted a brand-new working session in the very response that says
  "signed out". The route therefore unions the request's names with Astro's outgoing jar
  (`cookies.headers()`); `delete` replaces an outgoing entry by name, so a staged set becomes a
  removal.

  **The one thing this assumes rather than measures**: that `{ path: "/" }` is the path the cookies
  were written with. It is today — `src/lib/supabase.ts` passes no `cookieOptions` to
  `createServerClient`, so `@supabase/ssr` uses its own default of `/` (grep: `cookieOptions`
  appears nowhere under `src/` or `tests/`). Give that factory a `cookieOptions.path` and this
  route's deletes stop matching, silently, with every test still green — the browser ignores a
  mismatched-path delete and nothing here would notice.

  `tests/api/signout-failure.test.ts` pins all of it, in a second file so that
  `tests/api/signout.test.ts`'s no-mock rule stands. The library behaviour the fix depends on has
  its own case there (a client against a closed port), so a future supabase-js that clears
  regardless turns it red rather than leaving dead code behind a confident comment.

  **What the fix does NOT do, measured rather than assumed**: clearing is not revoking. A probe
  confirmed the captured token still authenticates after the route has cleared the cookies — the
  browser loses the session, anyone holding a copy of the token does not. That limit is stated in
  `signout.ts`'s header. The probe was deliberately not kept as a test: it would go red the day
  someone adds real revocation, which is a bad property for a guard.

  This does not contradict `tests/api/signout.test.ts:99` ("leaves the caller's cookie unable to
  authenticate"), and the two are easy to read as opposites. That case drives a SUCCESSFUL sign-out,
  where GoTrue does revoke, and it asserts on the COOKIE. The probe held a copy of the access token
  and ran the failure path, where nothing is revoked at all. Cookie dead, token alive — different
  object, different path.

- **`tests/rls/release-reveal.test.ts` is intermittently red in a FULL suite run — recorded, not
  chased.** Observed 2026-09-13 during `signout-swallows-failure`: one failure across three full
  runs, then green. Measured again the same day in isolation — `vitest run
tests/rls/release-reveal.test.ts`, five consecutive runs, 4/4 passing every time — so whatever
  produces it is an interaction with the rest of the suite (shared Supabase state, ordering, or
  timing), not a defect inside that file. It predates this change and is unrelated to it: nothing
  in `signout-swallows-failure` touches release, reveal, or their tables.

  Left unfixed deliberately, and this is the uncomfortable half: a test that is red once in three
  runs teaches people to re-run instead of to read, which is exactly how a real regression gets
  waved through. Recorded here so the next person who sees it red knows it has been seen before,
  has NOT been diagnosed, and that "it passed on retry" is not the end of the story. Fixing it
  needs the suite-level interaction identified, which is its own change.

- **CSRF on `/api/pets` and `/api/periods`, which send `application/json`.**
  Measured 2026-09-12: Astro's `checkOrigin` skips JSON bodies, so a form POST
  with no `Origin` is refused 403 before the handler while a JSON POST reaches
  it. Those two routes therefore have no explicit origin check and rely on the
  session cookie's `SameSite=Lax` alone, unlike `invite/claim.ts:54` and
  `revoke.ts:62`, which carry one. This is a recorded trade-off
  (`context/archive/2026-09-09-close-care-period/plan.md:72-75`), and it is a
  different risk from #7 — noted here so the asymmetry is not mistaken for an
  oversight by the next reader of those four files.

- **Island props: covered now, and the coverage has a named edge.** A value read from
  `astro:env/server` in `.astro` frontmatter and passed to a `client:*` island is serialized into
  the SSR response — not into `dist/client`, which under `output: "server"` holds no HTML at all.
  Measured 2026-09-12: such a build exits 0, `npm run check:secrets` reports `clean`, and the secret
  arrives in the browser verbatim inside `<astro-island props="...">`. Astro does not prevent it:
  `ServerOnlyModule` is keyed on which Vite environment resolves the module, and frontmatter
  resolves in `ssr`.

  Three layers now stand on that boundary, and they catch different mistakes — worth stating
  separately, because each is useless against the others' shape:

  | Guard                                          | Catches                                                      | Blind to                                                 |
  | ---------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
  | `astro check` (pre-commit + gate)              | an undeclared prop; a field absent from the source object    | a secret in a prop already declared `string`             |
  | `no-restricted-imports` (`eslint.config.js`)   | the import itself, in any `.astro` file                      | the value arriving via a helper, a re-export or a spread |
  | `tests/render/island-props.test.ts`            | the rendered bytes, through any indirection                  | islands on branches that need a session                  |
  | `tests/e2e/invite-reveal.spec.ts` (2026-09-13) | sensitive INSTRUCTION TEXT in the props of a post-claim page | every page and branch but this one; key-shaped secrets   |

  **The correction this entry exists to carry.** `context/archive/2026-09-11-testing-secret-leak/research.md:82`
  records `claim_digest` as "guarded by `CaretakerLabel`'s prop type", and `src/lib/caretaker-name.ts:110-118`
  makes the same claim more precisely. Both are RIGHT, and an earlier reading in
  `context/archive/2026-09-12-testing-island-prop-leak/research.md` first judged them wrong and withdrew it:
  planting `leakedDigest={claimed.claim_digest}` fails `npm run check` twice over — `ts(2339)`
  because the field is already absent from the object, `ts(2322)` because the prop is not on the
  component's `Props`. What a type cannot do is reject a secret handed to a prop whose declared type
  is `string`, because a secret is a string. Say both halves: a reader who concludes types cover this
  is wrong, and so is one who concludes they cover nothing.

  **Not tested by the sweep, deliberately**: islands on gated branches. Without middleware it renders
  the degraded branch, so `periods/[id].astro` yields 1 island of its 4 and `invite/[token].astro` 1 of 2. Lighting them up needs an injected authenticated `locals`, which needs Docker — turning a
  3-second gate step into an integration test. The sweep pins per-page island floors instead, so a
  page that silently stops rendering islands fails rather than passes quietly.

  **One of those gated branches is now covered, by a different runner.** `tests/e2e/invite-reveal.spec.ts`
  reaches the post-claim `invite/[token].astro` — the one state where the page HOLDS sensitive rows
  and renders an island at the same time — and asserts the sensitive title, body and trip note appear
  in none of the page's `props` attributes. Proven by mutation on 2026-09-13: adding
  `revealed={details}` to `<ClaimSlots />` turns ONLY that test red, naming the leaked string. The
  sweep could not have caught it (no session, so no data) and `check:secrets` could not
  (SSR output never reaches `dist/client`). The remaining gated branches stay uncovered.

- **Build-time third parties: one is gone, the others are named rather than tested.** Measured
  2026-09-12 (`vendor-build-fonts`), and the measurement is the point — F9 of the CI-gate review
  said the font fetcher "throws `AstroError` with no fallback, so a transient 429 is a failed
  deploy". That was right about one of TWO code paths, and silent about the one that mattered more:

  | Blocked host           | What it carries    | Exit  | Result                                       |
  | ---------------------- | ------------------ | ----- | -------------------------------------------- |
  | `fonts.gstatic.com`    | the woff2 binaries | **1** | `CannotFetchFontFile`, no retry, no deploy   |
  | `fonts.googleapis.com` | the CSS metadata   | **0** | zero `@font-face`, published in system fonts |

  The second path goes through unifont, which Astro constructs with `throwOnError: false`; a failure
  there is a warning and an empty family list. So the same outage, on the same vendor, in the same
  subsystem, either kills the deploy or ships a silently degraded site depending on which host is
  unreachable. **Naming "Google Fonts" as the risk was too coarse to plan against** — the useful unit
  is the call path, not the dependency.

  Both are now unreachable-by-construction: the files are vendored into `src/assets/fonts/` and
  `tests/unit/font-source.test.ts` pins that no Google provider or host returns to the config.

  **What this exposed about the gate, and it generalises past fonts.** A build that produced zero
  webfonts passed `check`, `lint`, both test projects, the render sweep and `check:secrets`. Nothing
  asserted that the build produced what it is supposed to produce. `tests/unit/font-assets.test.ts`
  now does, for fonts — and it is the first instance of that assertion class in this repo, not the
  last one that will be needed.

  **The other two build-time network dependencies**, named here when this entry was written so they
  would be a decision rather than an oversight. `npm ci` reaches the registry, and the `supabase`
  dependency's postinstall downloads a Go binary from GitHub Releases on every cold Cloudflare build
  — a binary that container can never run, because it has no Docker.

  **One of the two is now closed, and it corrected this paragraph on the way out.** The sentence
  that stood here said removing fonts removed "the one with the worst failure modes". That was
  wrong: measured 2026-09-13, the supabase postinstall fails BEFORE the build command runs at all,
  so it could kill a deploy in a place no gate can reach. See the entry below. The registry remains,
  and it is not going away.

  **A correction to carry**: `context/archive/2026-09-11-ci-quality-gates/follow-ups/review-fixes.md:32-42`
  proposes vendoring into `public/`. That is wrong — `astro/dist/assets/fonts/providers/local.d.ts:11-13`
  says local font files must not live there, or Astro's public-dir copy duplicates them alongside the
  pipeline's own output. The correct home is `src/assets/fonts/`.

- **`wrangler.jsonc`'s asset scope: closed as EXPLAINED, not changed.** Follow-up #5 of
  `ci-quality-gates` (`context/archive/2026-09-11-ci-quality-gates/follow-ups/review-fixes.md:63`)
  records that the root config still publishes `./dist`, the parent of both halves, and flags it as
  partially closed. Measured 2026-09-12 and closed here, since the archive is read-only.

  The stake is real — `dist/server/.dev.vars` holds `SUPABASE_URL` and `SUPABASE_KEY` in plaintext,
  so an asset scope of `./dist` really would serve them. It is nevertheless unreachable, for two
  independent reasons:
  1. `npm run build` makes the adapter write `dist/server/wrangler.json` plus a redirect at
     `.wrangler/deploy/config.json`; wrangler then prints "Using redirected Wrangler configuration"
     and calls the root file "Original user's configuration". The generated scope is `../client`,
     and `assertAssetScope()` in `scripts/check-client-bundle.mjs` — inside `ci:gate` — refuses to
     report clean if it is anything else.
  2. Remove the redirect so wrangler DOES read the root file, and it fails before reaching
     `assets`: `main` is a bare package specifier, and wrangler errors with "The entry-point file
     at @astrojs/cloudflare/entrypoints/server was not found."

  Confirmed against production the same day: `/_astro/fonts/*.woff2` → 200, while `/server/index.js`,
  `/server/manifest.mjs`, `/_worker.js` and `/client/...` → 404.

  **Not changed deliberately.** Rewriting `directory` to `./dist/client` would look tidier and
  change nothing, since nothing reads it and anything that did would fail on `main` first. The file
  now carries a header saying so, because this was raised as a suspicious-looking value twice and
  would have been raised again.

- **A warning now stops a deploy, and the rule that produced them was the thing that was wrong.**
  Follow-up #3 of `ci-quality-gates` posed a choice: "clean up the ten warnings and add
  `--max-warnings 0`, or accept that warnings are advisory and stop adding rules at `warn`
  severity expecting them to bite." Measured 2026-09-12: **both horns were wrong.**

  All twelve warnings (ten when the follow-up was written) were `console.error` in Astro endpoints
  under `src/pages/**/*.ts` — deliberate observability. This project has no logging library and
  `wrangler.jsonc` enables Workers observability, so `console.error` IS the log sink; one call sits
  directly under the comment "Never log inviteToken". "Cleaning up" would have deleted working
  diagnostics to satisfy a rule that never applied to that code.

  `eslint.config.js` already carried the precedent it needed — `scripts/**/*.mjs` turns the rule
  off because "A CLI script's output IS its interface." Endpoints got the same treatment, narrower:
  `no-console: ["error", { allow: ["error", "warn"] }]`. An endpoint's output is its HTTP response,
  not its log, so a `console.log` left behind after debugging still fails. Deliberately NOT extended
  to `src/lib/**`, which client islands import.

  **That allowlist grew on 2026-09-13, and the paragraph above is left in the past tense because the
  reasoning is what carried over rather than the scope.** It now reads
  `files: ["src/pages/**/*.ts", "src/pages/**/*.astro"]` — server-rendered pages joined on the same
  argument, not a new one: `.astro` frontmatter runs on the server and its `console` output reaches
  the identical Workers sink an endpoint's does. `allow` is unchanged, so `console.log` still fails
  in a page, and `src/lib/**` is still out.

  What forced it was measurable rather than stylistic. `src/pages/invite/[token].astro` swallowed
  BOTH of its RPC errors, and a grep for `console.` across every `.astro` file in the repo returned
  **zero** — the base rule plus `--max-warnings 0` meant the obvious fix could not be committed. The
  worse of the two branches discarded `error` in a ternary, so a caretaker who HAD claimed was
  served the pre-claim page at status 200 with their instructions gone and nothing recorded
  anywhere. Both branches now log `error.code` and `error.message`, pinned by three cases in
  `tests/unit/invite-source.test.ts` — one per branch, plus one that no log line may carry the invite
  token or the capability secret, carrying its own call-count control so it cannot pass vacuously.
  No rendered byte changed — verified by diffing the dead-link page across the change, whose only
  difference was dev-only `data-astro-source-loc`, measured absent from `dist/` with a control grep.

  One property this did NOT gain: nothing mechanical stops the next `.astro` page from swallowing an
  error silently. The rule lives in `context/foundation/lessons.md`, read at the start of
  `/10x-plan`, `/10x-implement` and `/10x-impl-review` — a design-time gate, not a commit-time one. A
  regex sweep over `.astro` sources was considered and rejected as exactly the brittle
  source-assertion shape §7 already records this project getting wrong.

  Both thresholds then went up: `eslint . --max-warnings 0` and
  `astro check --minimumFailingSeverity warning`. Measured before choosing — `warning` exits 0
  today, `hint` exits 1 on five `ts(6387)` deprecations in `eslint.config.js`. `hint` was rejected
  for a reason that got sharper immediately after: adding one config block took the hint count from
  five to six, so that threshold would grow with every future block.

  **The asymmetry worth knowing before editing either flag.** `no-console` is `error` only for
  endpoints; everywhere else it is still `warn`. So a `console.error` in a client island fails ONLY
  because of `--max-warnings 0` — drop that one flag and client code silently returns to advisory
  while endpoints stay strict, which is the opposite of what the eslint config alone suggests.
  `tests/unit/ci-gate-source.test.ts` pins both flags and pins that both gates invoke them through
  the npm scripts rather than calling `eslint`/`astro check` directly, since a direct call in the
  workflow would quietly lose the threshold.

- **An install-time dependency fails where no gate can see it.** Measured 2026-09-13
  (`supabase-cli-build-cost`), closing the second of the three build-time third parties named in the
  entry above.

  `supabase`'s postinstall downloads a 98,396,160 B Go binary from GitHub Releases and ends in a
  bare `await main()` with no `catch`. Measured with an unroutable proxy: `POSTINSTALL_EXIT=1`. A
  failing lifecycle script fails `npm ci` — and on Workers Builds `npm ci` runs BEFORE the build
  command, so a GitHub outage or rate-limit killed the deploy in a place `ci:gate` never reaches.
  Every guard this project has ever added lives inside the build command. None of them can speak
  here. **That is the generalisable part: `ci:gate` is not the outermost thing that can fail.**

  Fixed by moving the dependency to `optionalDependencies`. Measured in an isolated npm project, for
  `npm ci` specifically:

  | placement              | `npm ci` with a failing postinstall | package present afterwards |
  | ---------------------- | ----------------------------------- | -------------------------- |
  | `devDependencies`      | exit 1                              | —                          |
  | `optionalDependencies` | **exit 0**                          | **no — npm drops it**      |

  **`--omit=optional` was ruled out by measurement, not preference**, and the next person should not
  re-derive this: the lockfile carries 152 optional entries (21 of them added by this very change) including `@cloudflare/workerd-linux-64`,
  `@esbuild/*` and `@img/sharp-*`. Omitting optional dependencies would strip the platform binaries
  the build itself needs. The 98 MB download therefore stays — waste, not a hazard, once the failure
  mode is gone. That was a deliberate scope decision, not an oversight.

  **THE OTHER TRADE, found in review and not noticed when the move was made.**
  `optionalDependencies` is a PRODUCTION section, not a development one. Measured against the commit
  before: 21 lockfile entries flipped from `"dev": true` to `"optional": true` — the CLI plus 20
  transitives — and a package in `optionalDependencies` survives `npm ci --omit=dev` where a
  devDependency does not.

  Nothing here runs an omit-dev install today, so the impact is zero. But the change INVERTS under a
  state this repo has already recorded as a likely mistake: F10 of the CI-gate review names
  `NODE_ENV=production` in the Cloudflare dashboard as "a common reflex". In that state the OLD
  placement skipped `supabase` outright — no download, no postinstall, so omit-dev was itself a
  complete fix for the original bug — while the NEW one downloads 98 MB for a binary that container
  still cannot run. The gate would already be broken there for other reasons, so this is cost rather
  than a new outage; it is written here so it is a known cost rather than a surprise.

  **The trade it creates, and why Actions needed a new step.** On failure npm drops the package
  entirely rather than leaving a broken one. On Cloudflare that is exactly right — nothing there can
  use the CLI. In Actions it would mean `npx supabase start` quietly fetching a copy from the
  registry instead of failing, and the 28 integration files are the only tests in this project that
  exercise RLS, so a silent skip is the worst outcome available. `.github/workflows/ci.yml` now runs
  `npx --no-install supabase --version` first; `--no-install` is the load-bearing flag, since it
  makes npx fail instead of fetch.

  **Pinned in two layers on purpose.** `tests/unit/ci-gate-source.test.ts` asserts the manifest
  section AND the lockfile's `"optional": true`. The lockfile is what `npm ci` acts on, so an
  assertion on the manifest alone would describe an intention rather than guard a behaviour — a
  mutation that stripped only the lockfile flag would pass it.

  **Still not addressed**: the npm registry itself, which every install depends on and which no
  change is going to remove.

- **Dead links in documents, and why the exclusions are the whole design.** Added 2026-09-13
  (`doc-link-checking`). Archiving a change moves `context/changes/<id>/` to
  `context/archive/<date>-<id>/` and silently breaks every reference to it; nothing in `ci:gate`
  read prose, so a document could rot indefinitely while every test stayed green.

  **The measurement that shaped it.** 439 path references across 118 files, 8 unique dead — and only
  **2 genuine**. At a 75% false-positive rate a gate step gets ignored, or worse, blocks a deploy on
  a template placeholder. So the work was not finding dead links; it was not crying wolf. The first
  run of the finished script reported 17 hits, of which 3 were real.

  SIX mechanisms suppress a match, and naming them all is the point — an earlier version of the
  script advertised "four exclusion rules", counted only its own array, and two of those four
  could never fire while three real suppressors went undocumented:

  | suppressor                              | the real string that forces it                                                                                                                                                                          |
  | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | the regex lookbehind                    | npm scopes: `@supabase/ssr`, `@astrojs/cloudflare`. This is what actually keeps them out — NOT the list of package names an earlier version carried, which could never fire and was deleted             |
  | truncation at an out-of-class character | a glob becomes its directory prefix, and so does a `<placeholder>` path. Silent, undocumented for a day, and the reason the "glob" rule was dead code                                                   |
  | `isCutAtASpace`                         | `context/design/Pupilownik Hi-fi.html`, cited from five files                                                                                                                                           |
  | GitHub Action ref                       | `supabase/setup-cli@v3` — 7 findings without it                                                                                                                                                         |
  | migration template                      | `supabase/migrations/YYYYMMDDHHmmss_short_description.sql` — 2 findings without it                                                                                                                      |
  | per-line `link-check:ignore`            | a document ABOUT a dead link, which must be able to name one. This change's own folder named one as an example and the first run flagged it — the same shape as an assertion matching its own rationale |

  **Two critical corrections came out of the impl-review**, both reproduced before being accepted,
  and each is the guard failing in the direction it was built to prevent.

  _It was blind to its own reason for existing._ `isCutAtASpace` compared against the bare prefix
  with no space — prefix-matching despite the name — so any dead reference whose truncated form
  was a prefix of a surviving sibling vanished. Measured: an archived change folder was swallowed
  by a later one sharing its name, which is exactly the archive-breakage shape the script exists
  to catch. One character fixed it, and the comparison must stay `prefix + " "`.

  _It could block every deploy._ `context/changes/**` was scanned as a source, and `/10x-plan`
  writes plans that NAME THE FILES THEY ARE ABOUT TO CREATE. With this step first in an
  `&&`-chained `ci:gate`, one in-flight plan would have stopped all publication, including
  unrelated changes. Closed by excluding that directory as a SOURCE while keeping it a valid
  TARGET — the same treatment `context/archive/` already had.

  **What it deliberately cannot catch**, so nobody mistakes the reach: a moved LINE number
  (`foo.ts:42` is checked as `foo.ts`), a reference that is wrong rather than dead (both files
  exist), and any URL — checking those would put the network back in the build, which is the exact
  failure class the two preceding changes removed.

  **It exits 2, not 1, when its own pattern stops matching.** A floor of 200 references separates a
  broken scan from a finding, because a pattern that matched nothing would print "clean" and guard
  nothing.

  **Three genuine findings on the first run**, two of them beyond the reach of the manual sweep an
  hour earlier — that sweep read only `context/foundation/*.md`, while the script reads source
  comments too, and `astro.config.mjs` and `src/assets/fonts/README.md` both pointed at a research
  document archived the day before.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-13
- Stack versions last verified: 2026-06-28
- AI-native tool references last verified: 2026-06-28

These three are DATES, not a changelog: what changed and why belongs in §7, and
`tests/unit/test-plan-shape.test.ts` enforces the shape.

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive (notably when S-01..S-03 ship, activating risks #3–#5),
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
