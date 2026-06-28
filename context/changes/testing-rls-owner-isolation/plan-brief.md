# RLS Owner-Isolation Test Harness — Plan Brief

> Full plan: `context/changes/testing-rls-owner-isolation/plan.md`
> Research: `context/changes/testing-rls-owner-isolation/research.md`

## What & Why

Bootstrap a Vitest runner and write the first owner-isolation RLS integration test for
`public.profiles`, run against the local Supabase stack with two distinct user JWTs on the
anon key. This is Phase 1 of the frozen test plan and covers Risk #1 — a logged-in owner
reading or modifying another owner's rows. The real deliverable is the **reusable two-JWT
harness** every future owner-scoped table copies.

## Starting Point

One table exists (`public.profiles`, with `select_own`/`update_own` policies and no
INSERT/DELETE policy). There is no test runner at all — zero test files, no Vitest, no `test`
script. RLS verification was deliberately deferred at the baseline (manual two-user check);
this change is the explicit "revisit once a harness is worth it."

## Desired End State

`npm test` runs Vitest against the local stack and passes a suite proving owner A is fully
isolated from owner B across SELECT/UPDATE/INSERT/DELETE on `profiles`, plus a separate test
proving the `auth.users` → `profiles` delete-cascade. A `createOwnerClient` helper exists that
future table tests import. When the stack is down, the suite fails fast with an actionable
message.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Test framework | Vitest, standalone `vitest.config.ts` (Node env) | Pure-Node Supabase clients, no Astro runtime needed; avoids the `astro:env/server` virtual-module trap | Research / Plan |
| Client boundary | Anon key + real user JWT only | Service-role bypasses RLS → tautology; this is the whole point of the test | Research |
| Headline assertion | Prove INSERT/DELETE **denied**, not just SELECT isolation | Grants may already permit them; RLS deny-by-default is the real gate (impl-review F3) | Research |
| Owner B provisioning | Programmatic `signUp` in test setup | Keeps `seed.sql` minimal (F-01 decision); email confirmation is off locally | Plan |
| Stack precondition | Setup asserts reachable, fails with "run `npm run db:start`" | Fast, no Docker management in tests, honest DX | Plan |
| Key delivery | Gitignored `.env.test` (+ committed `.env.test.example`) | Explicit, mirrors app `.env` convention, stable across CLI versions | Plan |
| CI-gate wiring | Deferred to a fast follow | Running tests in CI needs a Supabase stack in the build env — its own change | Plan |
| Delete-cascade check | Separate test file, privileged client confined there | Keeps service-role out of the RLS-isolation test's boundary | Plan |

## Scope

**In scope:** Vitest install + config + `test` script; `.env.test` wiring; reachability guard;
`createOwnerClient` helper; owner-isolation suite (4 denial surfaces); FK-cascade test;
test-plan cookbook (§6.2/§6.5/§6.6) updates.

**Out of scope:** CI-gate wiring; service-role in the isolation test; a second seeded user;
e2e/Playwright; auth-route or app-logic tests (later phases); any schema/policy change.

## Architecture / Approach

Standalone Vitest, Node environment. Tests build their own `@supabase/supabase-js` clients with
the anon key and never import `src/lib/supabase.ts` (which pulls `astro:env/server`). Identity =
a real JWT from `signUp`/`signInWithPassword` through the anon client. Cross-tenant assertions
run two such clients side by side against the local Postgres. The local stack is a precondition
the setup asserts, not something tests manage.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Vitest harness bootstrap | Runner + config + `.env.test` + reachability guard + `createOwnerClient` + smoke test | Misconfigured key (service-role instead of anon) silently voids every later assertion |
| 2. Owner-isolation test + cascade + docs | The 4-surface isolation suite, the FK-cascade test, filled-in cookbook | Writing a tautological test that passes without exercising RLS |

**Prerequisites:** Local Supabase stack runnable (`npm run db:start`, Docker); `@supabase/supabase-js` already installed.
**Estimated effort:** ~1-2 sessions across 2 phases.

## Open Risks & Assumptions

- **Anon-key assumption is load-bearing**: if `.env.test`'s `SUPABASE_KEY` is the service-role
  key, every RLS assertion passes while proving nothing. The reachability guard checks for a
  local host but cannot tell anon from service-role — call it out in `.env.test.example`.
- **Tautology risk**: a green test that doesn't actually exercise RLS. Mitigated by the manual
  "relax a policy → test must go red" check in Phase 2.
- **Fail-closed confusion**: an unauthenticated client sees zero rows and can look "isolated"
  for the wrong reason — assertions must run authenticated clients.
- CI does not enforce these tests until the deferred wiring lands; green is local-only for now.

## Success Criteria (Summary)

- `npm test` proves owner A cannot SELECT, UPDATE, INSERT, or DELETE against owner B's
  `profiles` data, via two anon-keyed user sessions.
- A future table author can copy `createOwnerClient` + the test-plan §6.5 recipe to add RLS
  coverage for a new table with minimal edits.
- The stack-down path fails fast with an actionable message, not a cryptic error.
