# Owner-data RLS baseline (F-01) — Plan Brief

> Full plan: `context/changes/owner-data-rls-baseline/plan.md`

## What & Why

Establish Pupilownik's data-access contract — a working local migration loop, the owner-isolation Row-Level Security (RLS) pattern, a typed Supabase client, and a minimal seed — so every future slice persists data the same safe way. The single non-negotiable goal: an owner can read/write only their own rows, enforced by RLS on `auth.uid()`. The PRD's privacy guardrails ("pełny dostęp wyłącznie do własnych danych", instructions must not leak outside the circle) make this the load-bearing foundation before any user-facing feature.

## Starting Point

Auth is fully wired (Supabase SSR client at `src/lib/supabase.ts:9`, middleware guards `/dashboard`, owner identity in `auth.users`). But the data layer is empty: `supabase/` has only `config.toml` — no `migrations/`, no `seed.sql`, no generated types, and no db npm scripts. The Supabase client is untyped (no `<Database>` generic). No test framework; standing gates are `eslint` + `astro check`.

## Desired End State

`npm run db:start && npm run db:reset` gives a clean local Postgres with a `profiles` table (1:1 with `auth.users`), its deny-by-default RLS policies, a signup trigger that auto-creates a profile, and a seed applied. Signing up creates exactly one profile row; an owner sees only their own row. `src/lib/supabase.ts` is typed via generated `src/db/database.types.ts`, and a short convention doc lets S-01 add `pets` the same way. No domain tables exist yet.

## Key Decisions Made

| Decision                             | Choice                                                                 | Why (1 sentence)                                                                                                | Source |
| ------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ |
| Owner anchor / F-01's concrete table | `profiles` table (1:1 with `auth.users`) + signup trigger              | Gives the foundation a real, verifiable table to demonstrate RLS and a uniform FK target for all domain tables. | Plan   |
| Dev migration loop                   | Local Supabase (Docker): `db reset`; push to remote separately         | Fast, offline, deterministic iteration with a clean reset every time.                                           | Plan   |
| Typed client timing                  | Generate types + wire `<Database>` now (in F-01)                       | Establishes a typed query contract from day one; slices inherit type safety.                                    | Plan   |
| RLS verification                     | No new framework — `db reset` + typecheck/lint + manual two-user check | Zero new deps, aligns with the `speed` goal; manual RLS check is reliable for one table.                        | Plan   |
| Seed convention                      | Minimal `seed.sql` with one test owner                                 | Establishes the seed slot and supports the manual isolation check; domain rows come from slices.                | Plan   |
| Scope under deadline                 | Ship migration + RLS + types + seed together (cut nothing)             | Slices start on a complete, typed contract with no debt.                                                        | Plan   |

## Scope

**In scope:** db npm scripts + `supabase/migrations/`; `profiles` table; owner-isolation RLS (deny-by-default); `security definer` signup trigger; minimal `seed.sql`; generated `database.types.ts` + typed client; `docs/reference/data-access.md`; `.env.example` anon-key note.

**Out of scope:** domain tables (pets/instructions/care periods/slots — S-01+); invite-link/caretaker access (S-02/S-03); service_role/admin client; automated RLS test harness; CI migration wiring; owner profile attributes beyond identity.

## Architecture / Approach

`auth.users` (Supabase auth, already wired) → `after insert` trigger `handle_new_user()` (security definer) → inserts into `public.profiles`. Client access flows through the anon-keyed SSR client where RLS (`auth.uid() = id`) is the security boundary; the trigger is the only path that bypasses RLS, by design. Generated `Database` types make all queries type-checked. The pattern (owner FK + enable RLS + explicit `auth.uid()` policies + regen types) is documented for slices to copy.

## Phases at a Glance

| Phase                               | What it delivers                                           | Key risk                                                                        |
| ----------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1. Migration workflow & local stack | db npm scripts + `migrations/`; `db:start`/`db:reset` loop | Requires Docker locally; CLI/config mismatch                                    |
| 2. profiles + RLS + trigger + seed  | The security spine: owner-only access, auto-profile, seed  | RLS misconfig → data leak or fail-closed zero-rows; trigger errors break signup |
| 3. Typed client & convention doc    | Generated types, typed client, documented pattern          | Stale generated types silently lying to the type checker                        |

**Prerequisites:** Docker running; a hosted Supabase project for `db:push` (only when promoting); existing auth flow intact.
**Estimated effort:** ~1-2 focused sessions across 3 phases; Phase 2 is the careful one.

## Open Risks & Assumptions

- **Assumption:** `SUPABASE_KEY` is the anon/publishable key, not service_role — otherwise RLS is bypassed and the whole foundation is void. Phase 3 documents this; verify it during Phase 2's manual check.
- **Risk:** seeding `auth.users` via SQL must go through the supported path so the trigger fires and emails/identities are valid; if the seed user is malformed, the manual isolation check can't run.
- **Assumption:** manual two-user verification is sufficient regression coverage at one table; revisit (add a harness) once several RLS tables exist.

## Success Criteria (Summary)

- A clean `npm run db:reset` applies the `profiles` migration, trigger, and seed from scratch.
- Signing up auto-creates exactly one profile; an owner can see only their own row (two-user check passes).
- The typed client compiles (`astro check`), and a slice author can add `pets` by following `docs/reference/data-access.md`.
