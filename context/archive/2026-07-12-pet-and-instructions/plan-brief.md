# Pet & Instructions (S-01) — Plan Brief

> Full plan: `context/changes/pet-and-instructions/plan.md`

## What & Why

Roadmap slice **S-01**: a logged-in owner defines a pet (name, species, breed, age) with **structured care instructions**, each flagged public or sensitive, stored under owner-isolation RLS. It's the first domain slice and the project's first authenticated DB write, so it sets the patterns every later slice copies. The public/sensitive split must be right now because S-03 reveals sensitive instructions only after a caretaker claims a slot.

## Starting Point

Auth, protected routes, and the F-01 data-access pattern (owner FK + deny-by-default RLS on `profiles`) exist. There is **no** domain table, no `.from()` query, no zod, no Astro Actions — only the auth pattern (form POST → API route → redirect) and two React-island forms. The RLS test harness (`tests/rls/*`, cookbook §6.5) is ready to copy. The hi-fi visual system belongs to S-07 and is not built yet.

## Desired End State

An owner visits `/pets/new`, adds a pet with one or more instruction rows (public/sensitive toggle), saves, and sees it on `/pets` — their pets only. The write is atomic, input is validated server-side, and another owner can never see or touch these rows (proven by RLS isolation tests).

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Instructions model | `care_instructions` child table (title, body, is_sensitive, sort_order) | Matches the design's list; per-item public/sensitive; body free text (not the parked v2 schedule) | Plan |
| Scope | Add pet + list own pets (no edit/delete) | Full "add and see" loop, narrow per the speed goal | Plan |
| Pet fields | name (req) + species enum (dog/cat/other) + breed/age (optional) | Matches design + FR-002 "basic data" | Plan |
| Photo | Deferred | Needs a Storage bucket + storage RLS; not in FR-002 | Plan |
| Validation | zod, server-side in the API route | Sets the Risk-#7 precedent; server never trusts the client | Plan |
| Submission | React island → JSON `POST /api/pets` + zod | Clean for the dynamic instruction list; typed | Plan |
| Child RLS | Transitive via `pets.owner_id` | Single source of truth; sanctioned by data-access.md | Plan |
| Atomic write | `security invoker` RPC `create_pet_with_instructions` | No edit path in S-01 → partial write is unrecoverable; RLS still applies | Plan |
| Styling | Current tokens; S-07 reskins | Keeps slice boundaries clean; no duplicated design work | Plan |

## Scope

**In scope:** `pets` + `care_instructions` tables with owner-isolation RLS; atomic create RPC; RLS isolation tests; zod + `POST /api/pets`; API handler tests; add-pet React island; `/pets` list + `/pets/new` pages; `/pets` gated in middleware.

**Out of scope:** photo upload; edit/delete; hi-fi reskin (S-07); caretaker reveal (S-03); care periods/slots (S-02/S-03); structured feeding schedule (v2).

## Architecture / Approach

Data → API → UI. Postgres holds `pets` (owner FK) and `care_instructions` (child, transitive RLS); a `security invoker` RPC writes both atomically. A React island collects fields + a dynamic instruction list and POSTs JSON to `/api/pets`, which zod-validates and calls the RPC. A server-rendered `/pets` page reads the owner's pets (RLS-scoped) with instructions embedded. Every piece mirrors an existing pattern (F-01 migration, auth API route, auth island).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema, RLS & atomic write | Tables + deny-by-default RLS + atomic RPC + seed + RLS isolation tests | Getting the transitive child policy / four denial surfaces right |
| 2. Validated API endpoint | zod schema + `POST /api/pets` over the RPC + handler tests | Server-side validation contract; auth-scoped insert |
| 3. Add-pet form & list UI | React island + `/pets/new` + `/pets` list + route gating | Dynamic instruction list UX; RLS-scoped list query |

**Prerequisites:** F-01 (done); Docker + local Supabase stack up; `.env.test` present.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Species as a Postgres enum (fixed dog/cat/other) — adding values later needs a migration; acceptable for the fixed set.
- The API handler test reuses the auth-gating session/cookie harness; if that helper shape shifts, the test adapts.
- Screen won't match the hi-fi design until S-07 reskins — expected, not a defect.

## Success Criteria (Summary)

- An owner adds a pet with public + sensitive instructions and sees it in their own list; a second owner never sees it.
- Malformed input is rejected server-side (400); valid input persists atomically (201).
- `npm run db:reset`, security advisors, `npm test` (RLS + API), `npm run build`, `npm run lint` all green.
