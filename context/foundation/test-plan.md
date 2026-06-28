# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-28

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

Note on maturity: only **auth** and the **F-01 data foundation** (profiles +
owner-isolation RLS + signup trigger) are implemented today. Risks #3–#5 are
real PRD guardrails but live in code that does not exist yet (slices S-01..S-03);
they are tracked here and activate as those slices ship (see §3 Phase 4).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|--------------------------|--------|------------|---------------------------------|
| 1 | A logged-in owner reads or modifies another owner's rows (data / instructions / sign-ups) through a missing or incorrect RLS policy | High | High | interview Q1; PRD §Access Control; AGENTS hard rule "RLS on every table"; hot-spot dir `supabase/migrations/` (2 commits/30d) |
| 2 | A protected route stops being gated, or signup/signin/session handling lets an unauthenticated user reach owner data | High | Med | interview Q1; PRD §Access Control; hot-spot dir `src/` (`middleware` + auth routes) |
| 3 | *(forward — S-03)* Two caretakers claim the same slot; allocation is not atomic, producing a double-booking | High | Med | PRD §NFR (atomic claim), §Business Logic; interview Q3 |
| 4 | *(forward — S-01/S-03)* Sensitive instructions (address, access codes) are shown before a slot is claimed, or to someone outside the invite link | High | Med | PRD FR-008, §NFR; interview Q1 |
| 5 | *(forward — S-02/S-03)* The link-only (no-auth) caretaker path grants more than its scope, or a leaked/guessed token exposes a period | High | Med | PRD FR-005/FR-007; interview Q3; abuse lens (IDOR / bearer token) |
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
| 1 | Bootstrap runner + RLS owner-isolation | Prove an owner cannot read/modify another's rows; establish the reusable RLS-test harness every future table copies | #1 | vitest setup + integration vs local Supabase | change opened | context/changes/testing-rls-owner-isolation/ |
| 2 | Auth gating & input validation | Protected routes gate unauthenticated access; auth flows behave; handlers reject bad input | #2, #7 | integration (routes + middleware) | not started | — |
| 3 | Secret-leak & quality-gate wiring | Secrets never ship to the client; lock the cheap floor (lint/build/secret-grep) | #6 | deterministic build-artifact checks + gate wiring | not started | — |
| 4 | Domain guardrails (gated) | Instruction visibility scoping, link-only access enforcement, atomic slot claim | #3, #4, #5 | TBD per slice | not started | — |

Phase 4 is blocked until slices S-01..S-03 exist — `/10x-research` cannot
ground code that has not been written. When those slices land, split Phase 4
per slice via `/10x-test-plan --refresh`.

## 4. Stack

The classic test base for this project: **none yet** (no runner configured, 0
test files). Phase 1 bootstraps it.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | Vitest | TBD | none yet — see §3 Phase 1. Natural fit: the project already builds on Vite (Astro 6). |
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

- TBD — see §3 Phase 1 (runner bootstrap).

### 6.2 Adding an integration test (RLS / Supabase)

- TBD — see §3 Phase 1. Target pattern: run against the local Supabase stack,
  authenticate as two distinct owners, assert cross-tenant denial. Never assert
  through the service-role/postgres client (it bypasses RLS).

### 6.3 Adding an e2e test

- TBD — deferred until a domain flow exists (post-§3 Phase 4).

### 6.4 Adding a test for a new API endpoint

- TBD — see §3 Phase 2. Target pattern: exercise the handler request → response
  AND side-effects; assert zod rejection of bad input; mock only the external edge.

### 6.5 Adding RLS coverage for a NEW table

- TBD — see §3 Phase 1. This is the recurring pattern every slice (S-01+) copies:
  enable RLS, write owner-isolation policies, then add the two-JWT denial test from
  the Phase 1 harness. See also `docs/reference/data-access.md`.

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note here
capturing anything surprising the phase taught.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Generated Supabase types** (`src/db/database.types.ts`) — the generator is the
  test; asserting on them is tautological. Re-evaluate only if we hand-edit generated
  output (we don't). (Source: Phase 2 interview Q5.)
- **Tailwind styling / exact class output** — brittle and low-signal. Re-evaluate if a
  visual regression ever causes a real incident. (Source: Phase 2 interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-28
- Stack versions last verified: 2026-06-28
- AI-native tool references last verified: 2026-06-28

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive (notably when S-01..S-03 ship, activating risks #3–#5),
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
