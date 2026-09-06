# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-07-12

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic check that already catches the
   regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is produced
   by `/10x-research` during each rollout phase. If the plan and research
   disagree about where the failure lives, research is the ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/` (excluding
build output, docs, fixtures). History is thin (5 commits/30d), so likelihood
leans on the PRD guardrails and the Phase 2 interview more than on churn.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (see §1
principle #3).

Note on maturity: **auth**, the **F-01 data foundation** (profiles +
owner-isolation RLS + signup trigger), **S-01** (pets + instructions) and **S-02**
(care periods, slots, invite-link token model) are implemented today. Risk #5 is
therefore live and covered (see the row below). Risks #3 and #4 remain real PRD
guardrails living in code that does not exist yet (S-03); they activate as that
slice ships (see §3 Phase 4).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|--------------------------|--------|------------|---------------------------------|
| 1 | A logged-in owner reads or modifies another owner's rows (data / instructions / sign-ups) through a missing or incorrect RLS policy | High | High | interview Q1; PRD §Access Control; AGENTS hard rule "RLS on every table"; hot-spot dir `supabase/migrations/` (2 commits/30d) |
| 2 | A protected route stops being gated, or signup/signin/session handling lets an unauthenticated user reach owner data | High | Med | interview Q1; PRD §Access Control; hot-spot dir `src/` (`middleware` + auth routes) |
| 3 | *(forward — S-03)* Two caretakers claim the same slot; allocation is not atomic, producing a double-booking | High | Med | PRD §NFR (atomic claim), §Business Logic; interview Q3 |
| 4 | *(forward — S-01/S-03)* Sensitive instructions (address, access codes) are shown before a slot is claimed, or to someone outside the invite link | High | Med | PRD FR-008, §NFR; interview Q1 |
| 5 | The link-only (no-auth) caretaker path grants more than its scope, or a leaked/guessed token exposes a period | High | Med | PRD FR-005/FR-007; interview Q3; abuse lens (IDOR / bearer token). **Active since S-02.** Covered by `tests/rls/invite-token.test.ts` (the SECURITY DEFINER function is the only anon door), `tests/api/periods.post.test.ts` (the minted token opens the period; no digest in the response) and `tests/middleware/auth-gating.test.ts` (`/invite` public by requirement, and its no-referrer/no-store headers) |
| 6 | A Secret/service-role key or sensitive instruction text escapes into the client bundle, logs, or error bodies | High | Low–Med | AGENTS hard rule "server-only secrets"; abuse lens (secret/PII leakage) |
| 7 | An API handler trusts client input (missing or weak zod), accepting malformed or forbidden data | Med | Med | AGENTS rule "validate input with zod"; abuse lens (untrusted input) |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | Owner A's session cannot SELECT or UPDATE owner B's row; an anonymous request sees nothing | "RLS enabled" ≠ "policies correct"; a SELECT-only test misses UPDATE/INSERT holes | How a user JWT is injected into a test request; the anon/publishable-keyed client path; which tables currently exist | integration vs local Supabase, two distinct JWTs | Asserting via the service-role/postgres client — it bypasses RLS, so the test always passes (tautology) |
| #2 | An unauthenticated request to a `PROTECTED_ROUTES` path redirects to signin and returns no owner data; auth flows succeed and fail correctly | "Happy-path login works" ≠ "the protected route is gated"; a redirect status ≠ data actually withheld | Middleware ordering; how `context.locals.user` resolves; session-cookie shape on the workerd runtime | integration on routes + middleware | Mocking the Supabase auth client so the test asserts the mock instead of real gating |
| #3 | A second concurrent claim on a taken slot is rejected; exactly one caretaker wins | "Final status 200" ≠ "only one winner"; sequential tests miss the race | (S-03 must exist) the claim entry point, the DB-level uniqueness/locking guarantee | integration with concurrent requests | Testing two sequential claims and calling it concurrency |
| #4 | Public instructions are visible pre-claim; sensitive fields appear only to a caretaker who has claimed, and never outside the link | "It's a separate column" ≠ "the API never serializes it pre-claim" | (S-01/S-03 must exist) where the public/sensitive split is enforced — query vs response shaping | integration on the caretaker read path | Asserting the DB column split while the API leaks the field anyway |
| #5 | A valid link grants access only to its own period; an invalid/old token is rejected; the link cannot reach the owner panel | "Has a token" ≠ "token is scoped"; absence of login ≠ absence of authorization | (S-02/S-03 must exist) token generation/validation, scope enforcement, revocation | integration on the link route | Treating an unguessable token as sufficient without a scope check (IDOR) |
| #6 | The built client bundle contains no Secret key; error responses carry no secret or PII | "It's a server env var" ≠ "it never reached the client"; absence in source ≠ absence in the built bundle | Build-output location; what error bodies serialize | deterministic build-artifact grep + response assertion | Grepping source instead of the built bundle |
| #7 | Malformed, oversized, or forbidden payloads are rejected server-side with a clean error | "The client validates" ≠ "the server validates"; a 200 ≠ stored correctly | Each handler's zod schema and what input the route actually trusts | unit / integration on API handlers | Re-asserting the zod schema's own shape (implementation mirror) |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|----------------|------------|--------|----------------|
| 1 | Bootstrap runner + RLS owner-isolation | Prove an owner cannot read/modify another's rows; establish the reusable RLS-test harness every future table copies | #1 | vitest setup + integration vs local Supabase | complete | context/archive/2026-06-28-testing-rls-owner-isolation/ |
| 2a | Auth gating | Protected routes gate unauthenticated access; auth/session flows behave; an invalid session cannot reach owner data | #2 | integration (routes + middleware) | complete | context/archive/2026-07-12-testing-auth-gating/ |
| 2b | Input validation | API handlers reject malformed/forbidden input server-side (zod), not just the client | #7 | unit / integration on API handlers | not started | — |
| 3 | Secret-leak & quality-gate wiring | Secrets never ship to the client; lock the cheap floor (lint/build/secret-grep) | #6 | deterministic build-artifact checks + gate wiring | not started | — |
| 4 | Domain guardrails (gated) | Instruction visibility scoping, link-only access enforcement, atomic slot claim | #3, #4, #5 | TBD per slice | not started | — |

Phase 2 was split into **2a (auth gating, #2)** and **2b (input validation, #7)**
when the gating work shipped in `context/changes/testing-auth-gating/` — Risk #2
landed there; Risk #7 remains its own pending change.

Phase 4 is blocked until slices S-01..S-03 exist — `/10x-research` cannot
ground code that has not been written. When those slices land, split Phase 4
per slice via `/10x-test-plan --refresh`.

## 4. Stack

The classic test base for this project: **none yet** (no runner configured, 0
test files). Phase 1 bootstraps it.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | Vitest | ^4.1 | wired in Phase 1 (`vitest.config.ts`, node env, `npm test`). Natural fit: the project already builds on Vite (Astro 6). |
| Supabase integration | local stack (`npx supabase start`) + `@supabase/supabase-js` | installed | Run RLS tests against the local Postgres with two distinct user JWTs; never the service-role client. |
| e2e | Playwright | TBD | none yet — optional, deferred until a domain flow exists (post-Phase 4). |
| build-artifact checks | grep over `dist/` build output | n/a | none yet — see §3 Phase 3 (secret-leak gate). |
| (optional) AI-native | none | n/a | not justified under cost × signal at this maturity. |

**Stack grounding tools (current session):**
- Docs: Supabase skill (RLS / migration / SSR best-practices) — available, used to ground the RLS-test approach (two JWTs, no service-role client); checked: 2026-06-28. Context7 / framework-docs MCP: not available in current session.
- Search: none — no Exa.ai / web-search MCP available in current session; checked: 2026-06-28.
- Runtime/browser: Playwright MCP — not available in current session; checked: 2026-06-28.
- Provider/platform: wrangler (Cloudflare) skill — available; relevant to future CI/quality-gate wiring (Cloudflare Workers Builds, no GitHub Actions); Supabase local stack available for integration tests; checked: 2026-06-28.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase N" means the gate is enforced once that rollout phase
lands; before that, it is `planned`.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint + typecheck | local (husky/lint-staged + `npm run lint`) + Cloudflare Workers Builds | required (wired) | syntactic / type drift |
| build | local (`npm run build`) + Cloudflare Workers Builds | required (wired) | broken SSR build |
| unit + integration | local + CI | required after §3 Phase 1 | logic + RLS regressions |
| secret-leak grep on build output | CI | required after §3 Phase 3 | Secret/PII shipped to client |
| Supabase advisors (security) | local (`npx supabase db advisors`) | recommended on every migration | RLS / definer-function issues |
| e2e on critical flows | CI on PR | optional (deferred to post-Phase 4) | broken critical user paths |

CI runs via Cloudflare Workers Builds connected to the GitHub repo; there is
no GitHub Actions workflow. New gates wire into that flow.

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
   **anon** key into `.env.test` (copy `.env.test.example`). `tests/setup.ts` loads it,
   guards the host is local, and fails fast if the stack is down.
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

- TBD — deferred until a domain flow exists (post-§3 Phase 4).

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
  *survives/is unchanged*, not that an error is thrown. Only INSERT (and the with-check
  reassignment) raise a hard RLS error. `.env.test` carries a service-role key solely for
  the cascade test's `auth.admin.deleteUser`; it is fenced to that one file.
- **S-07 (`ui-design-system`)**: splitting `vitest.config.ts` into `unit` + `integration`
  projects was the only way to test pure logic without Docker — `tests/setup.ts` is a global
  setup file whose `beforeAll` demands a live stack, so before the split every test file paid
  that cost. Note what is deliberately NOT tested here: no assertions on Tailwind classes or
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
  (1) asserting "anon sees nothing" is not enough — assert the failures are *indistinguishable*
  from each other, because a distinct answer for a revoked token confirms the period exists;
  (2) `revoke ... from public` does not revoke from `anon`/`authenticated`/`service_role` on
  Supabase (ALTER DEFAULT PRIVILEGES grants those separately), and the same gap exists at
  table level, so assert privileges from the catalog rather than trusting the migration's
  intent; (3) a plpgsql function returning a composite answers `return null` with a row of
  NULLs, not NULL, so an RLS miss reads as a hit at the client — return a scalar when the
  caller needs to tell "nothing happened" apart from "here it is". Also note what is
  deliberately NOT tested: the caretaker page is verified through HTTP by hand (§7 — no e2e
  runner), because an automated version would depend on a running dev server.

- **S-08 (`period-pets-relation`)**: the first table in this schema whose ownership is
  transitive through TWO parents, and the recipe changes because of it. §6.5's four denial
  surfaces are necessary but not sufficient: the predicate is a conjunction (`caller owns the
  period AND the pet`), and a single-parent version passes every one of those four. What
  catches it is a pair of with-check cases in opposite directions — A's period + B's pet, and
  B's period + A's pet. Two further lessons: (1) **mutation-test a conjunction, do not assume
  it** — breaking each half in turn showed exactly which cases guard which, and confirmed both
  are load-bearing; (2) **verify the mutation actually applied** — one run was a silent no-op
  because prettier had reformatted the call being patched, and the test "passed", which would
  have read as "the test does not guard this". Also note the enforcement asymmetry recorded in
  §7: SELECT and DELETE are deliberately unpinned because the application cannot produce the
  row they would need.

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

- **The caretaker page's rendered HTML (S-02).** `/invite/[token]` is verified through HTTP
  by hand, not by an automated test: an automated version would need a running dev server,
  so it would fail `npm test` whenever the server is down, and this project has no e2e runner
  by choice. What IS covered automatically is the part that decides the answer —
  `resolveInviteView` (`tests/unit/invite-view.test.ts`) pins the uniform-failure rule
  (identical status, title and body for unknown / tampered / malformed / revoked), and
  `tests/rls/invite-token.test.ts` pins the SQL side. The template itself is not asserted.

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

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-28
- Stack versions last verified: 2026-06-28
- AI-native tool references last verified: 2026-06-28

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive (notably when S-01..S-03 ship, activating risks #3–#5),
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
