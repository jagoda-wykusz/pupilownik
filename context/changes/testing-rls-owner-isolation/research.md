---
date: 2026-06-28T00:00:00Z
researcher: jagoda.wykusz
git_commit: a2317ec1cc86081b15305fe95d91f920414590a0
branch: master
repository: pupilownik (10xdev)
topic: "Phase 1 — Bootstrap test runner + RLS owner-isolation harness"
tags: [research, codebase, rls, supabase, vitest, testing, owner-isolation]
status: complete
last_updated: 2026-06-28
last_updated_by: jagoda.wykusz
---

# Research: Phase 1 — Bootstrap test runner + RLS owner-isolation harness

**Date**: 2026-06-28
**Researcher**: jagoda.wykusz
**Git Commit**: a2317ec1cc86081b15305fe95d91f920414590a0
**Branch**: master
**Repository**: pupilownik (10xdev)

## Research Question

Phase 1 of the frozen test plan (`context/foundation/test-plan.md` §3): **Bootstrap a
Vitest runner and prove an owner cannot read/modify another owner's rows**, establishing
the reusable RLS-test harness every future table copies. This covers **Risk #1** (a
logged-in owner reads/modifies another owner's rows through a missing or incorrect RLS
policy). Research must ground: how a user JWT is injected into a test request, the
anon/publishable-keyed client path, and which tables currently exist.

## Summary

The codebase is ready for this work and the approach is already frozen by convention —
there is no real design choice left, only execution.

- **One table exists today**: `public.profiles` (id + created_at), the owner-identity
  anchor. Its RLS is the *only* thing there is to test in Phase 1.
- **No test runner exists** — zero test files, no `vitest`, no `test` script. Must
  bootstrap from scratch.
- **The correct harness is pinned by `docs/reference/data-access.md` and the test plan**:
  run pure-Node integration tests against the **local Supabase stack** with **two distinct
  user JWTs**, using the **anon/publishable key** — *never* the service-role/postgres
  client (it bypasses RLS and makes the test a tautology). This was the explicit
  revisit-trigger logged when the RLS baseline deferred automated testing.
- **The single most important assertion** (from impl-review finding F3): deny-by-default
  must be proven for **INSERT and DELETE**, not just SELECT isolation — because Supabase
  default privileges may already `grant ALL` on new public tables, so a SELECT-only test
  would miss exactly the hole the design relies on RLS (not grants) to close.
- **A second owner does not exist yet.** `supabase/seed.sql` seeds exactly one owner
  (`owner@pupilownik.test`). The harness must provision owner B itself (programmatic
  `signUp` in test setup is the lowest-friction path; email confirmation is disabled
  locally).
- **Recommended runner config**: a standalone `vitest.config.ts` (Node environment). The
  tests should construct their own `@supabase/supabase-js` clients and **not import
  `src/lib/supabase.ts`**, which pulls the `astro:env/server` virtual module that only
  resolves inside Astro's build — sidestepping it entirely is simpler than mocking it.

## Detailed Findings

### Current schema — what there is to test

Only one migration, one table.

- `supabase/migrations/20260627125956_init_profiles_rls.sql:7-10` — `public.profiles`:
  `id uuid primary key references auth.users(id) on delete cascade`, `created_at`.
  Minimal by decision (no email/display_name).
- `…:16` — `enable row level security` (deny-by-default; no policy ⇒ access denied).
- `…:23` — `grant select, update on table public.profiles to authenticated` — **grants
  only make the table reachable; they do not restrict**. INSERT/DELETE are denied by the
  *absence of a policy*, not by a withheld grant (see F3 below).
- `…:27-31` — policy `profiles_select_own`: `for select to authenticated using ((select
  auth.uid()) = id)`.
- `…:33-38` — policy `profiles_update_own`: `for update … using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id)` — `with check` blocks reassigning `id` to another
  owner.
- `…:43-61` — `public.handle_new_user()` `security definer set search_path = ''`, inserts
  the profile `on conflict (id) do nothing`; `revoke execute … from public`; trigger
  `on_auth_user_created after insert on auth.users`.

No INSERT or DELETE policy exists — those operations must be **denied** for an
authenticated client. That is the harness's headline assertion.

### The security boundary: anon key, user JWT (never service-role)

- `src/lib/supabase.ts:10` — app client is `createServerClient<Database>(SUPABASE_URL,
  SUPABASE_KEY, …)`, cookie-bound. `SUPABASE_KEY` **must be the Publishable (anon) key**
  (`docs/reference/data-access.md:9-16`). The Secret/service-role key bypasses RLS
  entirely; there is no service-role client in the request path by design.
- `src/middleware.ts:11` — identity resolves via `supabase.auth.getUser()` into
  `context.locals.user`; `/dashboard` is the only `PROTECTED_ROUTES` entry (`:4`,`:18-22`).
- **Test implication**: the harness must connect with the **anon key + a real user JWT**.
  `(select auth.uid())` only resolves under an authenticated client; an unauthenticated or
  service-role client makes the isolation test meaningless (service-role passes always;
  anon-unauthenticated sees zero rows and looks green for the wrong reason).

### How to inject two distinct user JWTs (local stack)

- `supabase/config.toml`: API on `http://127.0.0.1:54321`, DB `54322`, Studio `54323`,
  Inbucket `54324`; JWT expiry 3600s; **`enable_confirmations = false`** and
  `enable_signup = true`. Email confirmation being off is what makes programmatic
  two-user setup trivial.
- Path: build a plain anon client per owner with `@supabase/supabase-js` (`^2.99.1`,
  `package.json`), `signUp({ email, password })` (or `signInWithPassword` for the seeded
  owner), read `session.access_token`, and run cross-tenant SELECT/UPDATE/INSERT/DELETE.
  Each authenticated client carries its own `auth.uid()`.
- Local URL + anon key come from `npm run db:start` output (or `npx supabase status`).
  Feed them to the test via env (e.g. a gitignored `.env.test` / process env in the setup
  file) — **anon key only**.

### Seed: one owner exists, owner B does not

- `supabase/seed.sql` seeds exactly one owner: `owner@pupilownik.test` / `password123`,
  fixed UUID `33333333-3333-3333-3333-333333333333` (rows in `auth.users` +
  `auth.identities`, `on conflict do nothing`; the trigger makes its profile).
- The RLS baseline deliberately kept the seed to a single owner. Owner-isolation needs
  **two**. Lowest-friction: keep the seeded owner as **A** and `signUp` owner **B** in test
  setup. (Alternative: add a second seeded user — heavier, and couples the seed to one test.)

### Vitest bootstrap requirements

- No runner today: `package.json` scripts are dev/build/preview/astro + `db:*` + lint/
  format only; neither `vitest` nor `@vitest/*` is installed.
- `tsconfig.json:10` — path alias `@/* → ./src/*` (extends `astro/tsconfigs/strict`).
- `astro.config.mjs:17-22` — `astro:env` schema declares `SUPABASE_URL`/`SUPABASE_KEY` as
  server-only secrets. **This virtual module (`astro:env/server`) is imported by
  `src/lib/supabase.ts:3` and `src/lib/config-status.ts:1` and will not resolve under
  Vitest.** The clean way around it: tests own their Supabase clients and never import app
  modules that touch `astro:env`. (If app code ever must be imported, alias
  `astro:env/server` to a mock — but Phase 1 does not need that.)
- `eslint.config.js:74` already ignores `src/db/database.types.ts`; no test-specific lint
  rules — a `**/*.{test,spec}.ts` block can be added if desired.
- **Recommended**: standalone `vitest.config.ts` with `environment: "node"` and the `@ →
  src` alias mirrored from tsconfig. `getViteConfig` from `astro/config` is unnecessary
  (no Astro component/SSR runtime is exercised).

### CI / quality-gate context

- No `.github/` workflows. CI is **Cloudflare Workers Builds** (GitHub-connected), config
  in `wrangler.jsonc` (worker name `pupilownik`). Test-plan §5 marks "unit + integration"
  as *required after Phase 1* — wiring the new test command into that flow is in-scope for
  this phase's gate story (or a fast follow), not a separate runner.

## Code References

- `supabase/migrations/20260627125956_init_profiles_rls.sql:7-61` — the only table + its
  RLS policies, grants, and signup trigger (the system under test).
- `supabase/seed.sql:9-37` — single seeded owner A; owner B must be provisioned by the test.
- `supabase/config.toml` — local ports, JWT expiry, `enable_confirmations = false`.
- `src/lib/supabase.ts:3,10` — anon-keyed server client + the `astro:env/server` import to avoid in tests.
- `src/middleware.ts:4,11,18-22` — protected-route gating + `auth.getUser()` identity (Risk #2, Phase 2).
- `docs/reference/data-access.md:9-16,18-51,86-95` — the frozen convention: anon key, deny-by-default, psql JWT-claims verification recipe.
- `astro.config.mjs:17-22`, `tsconfig.json:10`, `eslint.config.js:74` — runner config inputs.
- `package.json` — scripts (no `test`), deps (`@supabase/supabase-js ^2.99.1`).

## Architecture Insights

- **Deny-by-default is the contract, grants are not.** The design relies on the *absence*
  of a policy to deny INSERT/DELETE even when a grant exists. A test must assert the denied
  operations, not just the allowed-but-isolated SELECT/UPDATE. (impl-review F3.)
- **Tautology guards are the real risk in RLS testing**, named explicitly in test-plan §2
  Risk #1 row: asserting through service-role always passes; a SELECT-only test misses
  UPDATE/INSERT holes; an unauthenticated client sees zero rows and looks green. The
  harness's value is in *avoiding* these, not in the assertion count.
- **This harness is a reusable template** (test-plan §6.5, `data-access.md:146-150`): every
  future owner-scoped table (S-01+) copies "enable RLS → owner policy → two-JWT denial
  test." Phase 1 should produce something a slice author can copy with minimal edits.
- **Fail-closed everywhere**: a misconfigured anon→service_role swap voids the whole
  foundation silently; the harness authenticating as a real user with the anon key is what
  keeps the test honest.

## Historical Context (from prior changes)

From `context/archive/2026-06-27-owner-data-rls-baseline/`:

- `plan.md:34` (NOT Doing) — *"No new test framework / RLS automated harness — verification
  is `db reset` + typecheck/lint + a **manual** two-user check (decided for speed; revisit
  when table count grows)."* **This change is that revisit.**
- `plan.md:238-244` — the manual procedure to now automate: db:reset → signup makes exactly
  one profile → user A sees only A's row → user B cannot see A's row → deleting A in
  `auth.users` cascades the profile.
- `plan-brief.md:51-53` — standing risks: the anon-key assumption ("if `SUPABASE_KEY` is a
  service_role key … the whole foundation is void"); manual two-user check is "sufficient
  at one table; revisit (add a harness) once several RLS tables exist."
- `reviews/impl-review.md` — APPROVED, 0 critical. **F2**: trigger made idempotent (`on
  conflict do nothing`) — a test could assert a double signup doesn't break. **F3**: the
  real gate is RLS deny-by-default, not the withheld grant — **prove INSERT/DELETE are
  denied**. F4: irrelevant (`.gitkeep`).

## Related Research

- `context/foundation/test-plan.md` — §1 cost×signal strategy, §2 Risk #1 response guidance
  (what proves protection, what to challenge, anti-pattern to avoid), §3 Phase 1 row, §4
  stack (Vitest + local Supabase, two JWTs, no service-role), §6.2/§6.5 cookbook stubs this
  phase fills in.
- `context/archive/2026-06-27-owner-data-rls-baseline/research.md` — prior exploration of
  the RLS baseline (the system now under test).

## Open Questions

1. **Owner B provisioning** — programmatic `signUp` in test setup (recommended) vs. adding
   a second seeded user to `seed.sql`? Recommend programmatic to keep the seed minimal and
   the test self-contained.
2. **Local-stack precondition** — should the `test` script assume the stack is already up
   (fast, requires discipline) or run `supabase status`/`db:reset` first (hermetic, slower)?
   Recommend: test script asserts reachability and fails with a clear "run `npm run
   db:start`" message rather than auto-managing Docker.
3. **Anon key delivery to tests** — `.env.test` (gitignored) read in the setup file, or
   `supabase status -o json` parsed at setup time? The latter is zero-config but couples to
   CLI output shape.
4. **CI wiring scope** — wire the new test command into Cloudflare Workers Builds now, or
   land the runner + test first and wire the gate as a fast follow? (test-plan §5 makes it
   required *after* this phase.)
5. **DELETE-cascade assertion** — the manual step "delete A in `auth.users` cascades the
   profile" needs a privileged client to delete an auth user; decide whether that step
   belongs in the RLS-isolation test (it's a schema/cascade check, arguably separate).
