# RLS Owner-Isolation Test Harness Implementation Plan

## Overview

Bootstrap a Vitest runner and write the first owner-isolation RLS integration test for
`public.profiles`, run against the **local Supabase stack** with **two distinct user JWTs**
on the **anon (publishable) key**. This is Phase 1 of the frozen test plan
(`context/foundation/test-plan.md` §3) and covers **Risk #1** (a logged-in owner reads or
modifies another owner's rows). The deliverable is not just one test — it is the reusable
two-JWT harness every future owner-scoped table (S-01+) copies.

## Current State Analysis

- **One table exists**: `public.profiles` (id + created_at), the owner-identity anchor,
  with `profiles_select_own` and `profiles_update_own` policies and **no INSERT/DELETE
  policy** (`supabase/migrations/20260627125956_init_profiles_rls.sql:7-61`).
- **No test runner**: zero test files, no `vitest`, no `test` script
  (`package.json`). Standing gates are `eslint` + `astro check` only.
- **The approach is frozen by convention**, not open: `docs/reference/data-access.md:9-16`
  pins the anon-key boundary; test-plan §4 pins Vitest + local Supabase + two JWTs + no
  service-role client. There is no architecture to invent.
- **Local stack is test-ready**: `supabase/config.toml` has `enable_confirmations = false`
  and `enable_signup = true`, so programmatic `signUp` yields an authenticated session with
  no email step. API on `http://127.0.0.1:54321`.
- **Owner B does not exist**: `supabase/seed.sql` seeds only owner A
  (`owner@pupilownik.test`). The harness provisions owner B itself.
- **`astro:env/server` is a Vitest trap**: imported by `src/lib/supabase.ts:3`; it only
  resolves inside Astro's build. Tests must build their own `@supabase/supabase-js` clients
  and not import app modules that touch it.

## Desired End State

- `npm test` runs Vitest against the local Supabase stack and, when the stack is up, passes
  a suite that proves owner-isolation on `profiles`.
- A reusable helper (`createOwnerClient`) exists that any future table's test imports to get
  an authenticated, anon-keyed client for a fresh owner.
- The owner-isolation suite proves all four denial surfaces: cross-tenant **SELECT**
  isolation, cross-tenant **UPDATE** denial, and authenticated **INSERT** and **DELETE**
  denial (deny-by-default, the F3 headline).
- A separate test proves the `on delete cascade` FK: deleting an owner in `auth.users`
  removes their profile.
- When the stack is down, the suite fails fast with an actionable message, not a cryptic
  connection error.
- The test-plan cookbook stubs (§6.2, §6.5) are filled in to point future authors at this
  harness.

### Key Discoveries:

- Deny-by-default, not grants, is the security gate — prove INSERT/DELETE are **denied**
  (`context/archive/2026-06-27-owner-data-rls-baseline/reviews/impl-review.md`, finding F3).
- Service-role/postgres client bypasses RLS → any test using it is a tautology
  (`context/foundation/test-plan.md` §2 Risk #1 anti-pattern; `docs/reference/data-access.md:9-16`).
- An unauthenticated anon client sees **zero** rows (fail-closed) — tests must authenticate
  as the user or a green-looking empty result misleads (`plan-brief.md:51-53` of the baseline).
- `enable_confirmations = false` makes runtime `signUp` for owner B trivial (`supabase/config.toml`).
- `@/* → ./src/*` alias (`tsconfig.json:10`) must be mirrored in the Vitest config.

## What We're NOT Doing

- **No CI-gate wiring** into Cloudflare Workers Builds this phase — running tests in CI needs
  a Supabase stack in the build env, a non-trivial problem worth its own change. Test-plan §5
  only requires the gate *after* this phase. Recorded as a fast follow.
- **No service-role/admin client in the RLS-isolation test** — it would void the boundary the
  test exists to prove. (The cascade test is the one place a privileged delete is needed; see
  Phase 2.)
- **No second seeded user** in `seed.sql` — owner B is created at runtime to keep the shared
  seed minimal (the F-01 decision).
- **No e2e / Playwright, no unit tests of app code, no auth-route tests** — those are later
  test-plan phases (§3 Phase 2+).
- **No new RLS policies or schema changes** — this phase tests the existing baseline; it does
  not modify it.

## Implementation Approach

Standalone Vitest (Node environment), not `getViteConfig` — the tests are pure-Node Supabase
clients with no Astro runtime. The harness owns its clients via `@supabase/supabase-js` and
never imports `src/lib/supabase.ts`. Identity is a real user JWT obtained by signing up/in
through the anon-keyed client; cross-tenant assertions run two such clients side by side. The
local stack is a precondition the setup asserts (fail-fast), not something the test manages.

## Phase 1: Vitest harness bootstrap

### Overview

Install and wire Vitest, deliver the reusable auth helper and the stack-reachability guard,
and prove the plumbing with a trivial smoke test (two owners → two distinct `auth.uid()`s).

### Changes Required:

#### 1. Test runner dependency + script

**File**: `package.json`

**Intent**: Add Vitest as a dev dependency and a `test` script so the suite is runnable and
later wireable into a gate.

**Contract**: New devDependency `vitest`. New script `"test": "vitest run"` (and optionally
`"test:watch": "vitest"`). No change to existing scripts.

#### 2. Vitest config

**File**: `vitest.config.ts` (new)

**Intent**: Configure a Node-environment runner that resolves the project's `@` alias and
loads the shared setup before tests.

**Contract**: `defineConfig` from `vitest/config`; `test.environment = "node"`,
`test.globals = true`, `test.setupFiles = ["./tests/setup.ts"]`, and
`resolve.alias` mapping `@` → `./src`. Pure-Node — do **not** pull in Astro's Vite config.

#### 3. Test env file + gitignore

**Files**: `.env.test` (new, gitignored), `.env.test.example` (new, committed), `.gitignore`

**Intent**: Deliver the local Supabase URL + anon key to tests without committing secrets,
mirroring the app's `.env` convention.

**Contract**: `.env.test` holds `SUPABASE_URL` and `SUPABASE_KEY` (anon/publishable key from
`npm run db:start`). Add `.env.test` to `.gitignore` (currently lists `.env`,
`.env.production` at `.gitignore:16-18`). Commit `.env.test.example` with the two key names
and placeholder values + a comment that this MUST be the anon key and point at the **local**
stack.

#### 4. Shared setup: stack-reachability guard

**File**: `tests/setup.ts` (new)

**Intent**: Load `.env.test`, then assert the local Supabase API is reachable so a down stack
fails fast with an actionable message instead of a cryptic per-test connection error.

**Contract**: Reads `SUPABASE_URL`/`SUPABASE_KEY` from `.env.test`; in a global `beforeAll`,
performs a lightweight reachability check against `SUPABASE_URL`; on failure throws a clear
error instructing the developer to run `npm run db:start`. Also guards that `SUPABASE_URL`
points at a local/loopback host (defense against pointing tests at the hosted project).

#### 5. Reusable owner-client helper

**File**: `tests/helpers/auth.ts` (new)

**Intent**: Provide the single primitive the whole harness (and every future table's test)
builds on: an authenticated, anon-keyed Supabase client for a distinct owner.

**Contract**: Export `createOwnerClient(opts?)` returning `{ client, userId, email }` where
`client` is a `@supabase/supabase-js` client created with the **anon key** and carrying a
session for a freshly signed-up owner (unique email per call). Uses `signUp` (or
`signInWithPassword` when reusing the seeded owner A). Never uses the service-role key. The
returned `client.auth.getUser()` resolves to the new owner; `userId` is exposed for
cross-tenant assertions.

#### 6. Smoke test

**File**: `tests/harness.smoke.test.ts` (new)

**Intent**: Prove the plumbing end-to-end before writing the real assertions — two owners are
genuinely distinct identities under the anon key.

**Contract**: Creates two owners via `createOwnerClient`, asserts their `userId`s differ and
each client's `auth.getUser()` returns its own id. This file is removable once Phase 2 lands,
or kept as a harness sanity check.

### Success Criteria:

#### Automated Verification:

- Dependencies install: `npm install`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- With the local stack up (`npm run db:start`), the smoke test passes: `npm test`
- With the stack **down**, `npm test` fails with the actionable "run `npm run db:start`"
  message (not a raw connection error)

#### Manual Verification:

- `.env.test` is gitignored and absent from `git status`; `.env.test.example` is committed
- A developer can go from clean checkout → `npm run db:start` → copy values into `.env.test`
  → `npm test` green, using only the example file's instructions

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Owner-isolation RLS test + cascade test + docs

### Overview

Write the real owner-isolation suite on `profiles` (all four denial surfaces), the separate
FK-cascade test, and fill in the test-plan cookbook so future table authors copy this harness.

### Changes Required:

#### 1. Owner-isolation RLS test

**File**: `tests/rls/profiles.isolation.test.ts` (new)

**Intent**: Prove that under the anon key with real user JWTs, an owner is fully isolated from
another owner's `profiles` row across every operation — the core Risk #1 protection.

**Contract**: Using two `createOwnerClient` owners (A and B), assert:
- **SELECT isolation**: A's `select * from profiles` returns only A's row (never B's); same for B.
- **UPDATE denial**: A updating B's row (by id) affects 0 rows / is rejected — A cannot mutate B.
- **INSERT denial**: A inserting any `profiles` row is denied (no INSERT policy → deny-by-default).
- **DELETE denial**: A deleting a `profiles` row is denied (no DELETE policy → deny-by-default).
- **with-check on self-update**: A updating its own row to set `id` to B's id is rejected
  (the `with check` predicate), if reachable given the PK.

Each client is anon-keyed and authenticated — assert via these clients only, never a
service-role client. (INSERT/DELETE denial is the F3 headline: prove the *operation* is
blocked even though a grant may exist.)

#### 2. FK on-delete-cascade test

**File**: `tests/rls/profiles.cascade.test.ts` (new)

**Intent**: Prove the data-integrity guarantee that deleting an owner removes their profile —
kept separate from the isolation suite because it requires a privileged delete of an
`auth.users` row, which must not leak into the RLS boundary the isolation test proves.

**Contract**: Create an owner (profile auto-created by the signup trigger), delete that user
from `auth.users` via a privileged path (service-role/admin client confined to this file),
then assert the matching `public.profiles` row is gone. Document inline that the service-role
client lives here **only** for the auth-user delete and is never used to assert RLS.

#### 3. Cookbook + phase notes in the test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.2 / §6.5 "TBD" stubs with the now-real recipe and record the
phase-1 note, so the next slice author copies the harness instead of re-deriving it.

**Contract**: §6.2 (integration/RLS test) and §6.5 (RLS for a new table) describe: create two
owners with `createOwnerClient`, assert cross-tenant SELECT/UPDATE/INSERT/DELETE denial via
anon-keyed clients, never service-role. Add a 2-3 line §6.6 note for this phase. Update §3
Phase 1 Status. Pure-prose edit; no change to §1-§5 strategy.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- With the local stack up, the full suite passes: `npm test`
- The isolation suite explicitly asserts INSERT and DELETE denial (not only SELECT) — present
  as named test cases
- The cascade test passes: deleting the auth user removes the profile

#### Manual Verification:

- Sanity check the test is not a tautology: temporarily relax one policy (e.g. broaden the
  SELECT `using` predicate) via a scratch migration and confirm the isolation test **fails** —
  then revert. (Proves the test actually exercises RLS.)
- Confirm no service-role key appears in the isolation test (`profiles.isolation.test.ts`);
  it is confined to the cascade test
- Test-plan §6.2/§6.5 now read as a usable recipe for the next table

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- None. This phase produces integration tests only; there is no app logic unit to isolate.

### Integration Tests:

- `profiles.isolation.test.ts` — cross-tenant SELECT/UPDATE/INSERT/DELETE denial under two
  anon-keyed user JWTs (Risk #1).
- `profiles.cascade.test.ts` — `auth.users` delete cascades to `profiles`.
- `harness.smoke.test.ts` — two owners are distinct identities (plumbing check).

### Manual Testing Steps:

1. `npm run db:start`, copy URL + anon key into `.env.test`, `npm test` → green.
2. Stop the stack (`npm run db:stop`), `npm test` → fails fast with the actionable message.
3. Tautology check: relax a policy via scratch migration → isolation test goes red → revert.

## Performance Considerations

Negligible. A handful of integration tests against a local Postgres; each `signUp` is a couple
of round-trips. No load concern at this scale.

## Migration Notes

No schema migration. Tests run against the existing baseline schema via `db:reset` state. The
only data side effect is runtime-created owner rows in the local stack — ephemeral and
re-seedable with `npm run db:reset`.

## References

- Research: `context/changes/testing-rls-owner-isolation/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 Risk #1, §3 Phase 1, §4 stack, §6.2/§6.5)
- Convention: `docs/reference/data-access.md:9-16` (anon-key boundary), `:86-95` (JWT verify recipe)
- System under test: `supabase/migrations/20260627125956_init_profiles_rls.sql:7-61`
- Prior decision to defer the harness: `context/archive/2026-06-27-owner-data-rls-baseline/plan.md:34`
- F3 (deny-by-default headline): `context/archive/2026-06-27-owner-data-rls-baseline/reviews/impl-review.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Vitest harness bootstrap

#### Automated

- [x] 1.1 Dependencies install: `npm install` — 89e2ca8
- [x] 1.2 Type checking passes: `npx astro check` — 89e2ca8
- [x] 1.3 Linting passes: `npm run lint` — 89e2ca8
- [x] 1.4 With the local stack up, the smoke test passes: `npm test` — 89e2ca8
- [x] 1.5 With the stack down, `npm test` fails with the actionable "run `npm run db:start`" message — 89e2ca8

#### Manual

- [x] 1.6 `.env.test` is gitignored and absent from `git status`; `.env.test.example` is committed — 89e2ca8
- [x] 1.7 Clean checkout → db:start → copy values → `npm test` green using only the example file's instructions — 89e2ca8

### Phase 2: Owner-isolation RLS test + cascade test + docs

#### Automated

- [x] 2.1 Type checking passes: `npx astro check`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 With the local stack up, the full suite passes: `npm test`
- [x] 2.4 The isolation suite explicitly asserts INSERT and DELETE denial as named cases
- [x] 2.5 The cascade test passes: deleting the auth user removes the profile

#### Manual

- [x] 2.6 Tautology check: relaxing a policy makes the isolation test fail, then revert
- [x] 2.7 No service-role key in `profiles.isolation.test.ts`; confined to the cascade test
- [x] 2.8 Test-plan §6.2/§6.5 read as a usable recipe for the next table
