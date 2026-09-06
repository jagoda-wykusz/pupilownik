---
date: 2026-09-05T23:12:03Z
researcher: jagoda.wykusz
git_commit: 4046be4d16a882d1b1a11a06e48f2ee935b9e7d8
branch: master
repository: pupilownik
topic: "S-02: care period with generated slots + invite-link access model"
tags: [research, codebase, rls, security-definer, invite-token, slots, supabase]
status: complete
last_updated: 2026-09-05
last_updated_by: jagoda.wykusz
---

# Research: S-02 — care period, generated slots, invite link

**Date**: 2026-09-05T23:12:03Z
**Researcher**: jagoda.wykusz
**Git Commit**: 4046be4d16a882d1b1a11a06e48f2ee935b9e7d8
**Branch**: master
**Repository**: pupilownik

## Research Question

Before planning S-02, ground the two things it introduces that no existing slice covers:

1. **Link-based access with no account.** Every policy in the codebase today keys on
   `auth.uid()`. A caretaker arriving with a token is the `anon` role and has no
   `auth.users` row. What is the right mechanism, given this project's stated constraints?
2. **Deterministic slot generation.** The roadmap's risk note says slots must be
   deterministic because S-03 claims them concurrently. What schema shape makes that
   claim atomic by construction?

Plus: what patterns from F-01 and S-01 must be copied rather than re-decided.

## Summary

**The existing owner-RLS pattern cannot be extended to cover the caretaker.** This is not a
discovery — `docs/reference/data-access.md` states it outright: *"Caretaker (link-based,
no-login) access is a different model introduced later (S-02/S-03); it will not reuse these
owner policies."* The research confirms why, and narrows the field to one viable option.

Three mechanisms were considered; two are ruled out by constraints this project already
committed to:

| Mechanism | Verdict |
|---|---|
| RLS policies `to anon` reading the token from a request GUC/header | Rejected — the token would have to ride every query context, and the mapping from an HTTP header to a Postgres setting is fragile. Wide surface for a narrow need. |
| Mint a scoped JWT carrying `period_id`, then `auth.jwt() ->> 'period_id'` in policies | **Rejected on an existing contract.** Signing requires the Secret key in the request path, and `docs/reference/data-access.md` forbids it: *"There is no service_role client in the request path, by design."* |
| A `SECURITY DEFINER` function taking the token, granted to `anon`, with **no anon policies on any table** | **Recommended.** The only thing `anon` can reach is one function with one parameter. Matches the hardening checklist already written in `data-access.md` for exactly this case. |

For slots, **materialising one row per (period, date, time-of-day)** is the shape that makes
S-03 correct by construction: claiming becomes a single `UPDATE … WHERE claimed_by IS NULL`,
which Postgres serialises for free. The alternative (computing slots on read, storing only
claims) also works but pushes the free/taken computation into every read path and makes the
occupancy view (S-04) harder.

The owner-facing half of S-02 is unremarkable: it copies S-01's pattern almost line for line.

## Detailed Findings

### The `anon` problem

Every policy in the schema is `to authenticated` with an `auth.uid()` predicate:

- `supabase/migrations/20260627125956_init_profiles_rls.sql:33-45` — profiles
- `supabase/migrations/20260712204748_pets_and_instructions.sql:57-119` — pets and
  care_instructions (the latter anchoring ownership transitively through `pets.owner_id`)

With RLS enabled and no `anon` policy, a caretaker's client is denied everything — which is
the correct fail-closed default, and the reason a function is needed rather than a policy.

The Supabase best-practices guidance (`security-rls-performance.md`) describes the
`SECURITY DEFINER` helper pattern and its two rules: keep an explicit identity check inside
the body, and revoke `EXECUTE` from roles that should not call it. `data-access.md` states
the same checklist in this project's own words (empty `search_path`, fully-qualified
objects, `revoke execute … from public`).

The difference here from the textbook case: the function is not a *policy helper* — it is
the caretaker's entire API. So it is granted to `anon` deliberately, and the identity check
inside the body is the token itself rather than `auth.uid()`.

**What the function must enforce in its body**, since nothing else will:
- exactly one period, resolved by token — never a list;
- the period is not revoked and (probably) not past its end date;
- it returns only fields a caretaker may see. `is_sensitive` instruction rows must not be
  reachable through it pre-claim (FR-008) — that boundary is S-03's, but the function shape
  is set here.

### Token handling

`gen_random_uuid()` is core in Postgres 17 (`supabase/config.toml:36`), but a UUID is a poor
share-token: 122 bits of entropy, and readers reasonably assume UUIDs are semi-public.

Two decisions worth making deliberately in the plan:

1. **Where the token is minted.** Generating it in the app (Web Crypto `getRandomValues`,
   available on the Cloudflare Workers runtime this deploys to) avoids depending on
   `pgcrypto` being enabled and keeps 256 bits of entropy. Generating it in SQL requires
   `gen_random_bytes`, i.e. the extension — unverified in this project, and something the
   plan would have to check.
2. **Whether the raw token is stored.** Storing only `sha256(token)` and looking up by
   digest means a database leak does not hand out working links. Postgres 17 has `sha256()`
   in core, and Web Crypto has `subtle.digest`, so neither side needs an extension. The cost
   is that the raw token exists exactly once, at creation — the owner must be shown the link
   then, and it can never be re-displayed, only regenerated.

That second point is a genuine product tradeoff, not just a security preference: "show the
link once" versus "the owner can reopen the period and copy the link again". It belongs in
the plan's questioning, not in an implementer's judgement.

### Slot generation

The roadmap now fixes three times of day — morning / afternoon / evening (settled
2026-09-06; the roadmap's earlier wording assumed two, which would have produced the wrong
row count per day).

Recommended shape, mirroring how `pet_species` was done at
`20260712204748_pets_and_instructions.sql:6`:

- `public.time_of_day` enum `('morning','afternoon','evening')`
- `care_periods` — owner-scoped, `owner_id → auth.users(id)`, `start_date`/`end_date` as
  **`date`, not `timestamptz`**: a slot is "the morning of 13 July" in the owner's calendar
  sense, not an instant, and storing an instant would drag timezone conversion into every
  read.
- `care_slots` — `period_id`, `slot_date date`, `time_of_day`, plus the columns S-03 fills
  when a caretaker claims. `unique (period_id, slot_date, time_of_day)` is what makes
  generation idempotent and double-booking impossible at the storage layer.
- Index `period_id` — Postgres does not index foreign keys automatically, and both the
  occupancy read and `ON DELETE CASCADE` need it (`schema-foreign-key-indexes.md`).

Row count is bounded by period length × 3. A `CHECK` on the date range (plus a zod bound on
the API) keeps a mistyped year from generating five figures of rows in one transaction —
this is the same class of problem as S-01's impl-review F1, where an unbounded instructions
array was flagged as a DoS vector and fixed with `.max()` caps
(`src/lib/schemas/pet.ts:9-24`).

**Why materialised rows beat computed-on-read**: S-03 claims a slot concurrently. With a
row per slot, the claim is `UPDATE care_slots SET claimed_by = … WHERE id = $1 AND claimed_by
IS NULL` — one statement, row-locked by Postgres, and the loser of a race updates 0 rows and
gets a clean "already taken". Nothing else is needed. Computing slots on read would move
that guarantee to a unique constraint on an inserted claim row, which also works, but leaves
"which slots are free" as a join-against-a-generated-series on every read, including S-04's
occupancy view.

### Owner-side patterns to copy, not re-decide

All established, all directly reusable:

- **Migration + RLS**: four policies per table (select/insert/update/delete), `to
  authenticated`, `(select auth.uid())` wrapped in a subselect. UPDATE carries both `using`
  and `with check` so `owner_id` cannot be reassigned. Transitive ownership via `exists (…)`
  against the parent — `care_slots` relates to `care_periods` exactly as `care_instructions`
  relates to `pets`.
- **Atomic write via RPC**: `create_pet_with_instructions`
  (`20260712204748_pets_and_instructions.sql:122-155`) is `SECURITY INVOKER` so the caller's
  RLS still applies. Creating a period and its slots has the same all-or-nothing requirement
  — a period without slots would be unusable and there is no edit path — so it wants the
  same treatment.
- **Execute grants**: S-01's impl-review F3 flagged that the RPC relied on the default
  PUBLIC execute grant; fixed in `20260831203038_harden_create_pet_rpc_grants.sql`. Write
  the revoke/grant in the first migration this time rather than as a follow-up.
- **API route**: `src/pages/api/pets.ts` — 401 gate on `context.locals.user`, JSON body,
  zod before any DB call, generic 500 message with the real error logged server-side (that
  last part is impl-review F2).
- **RLS test**: `tests/rls/pets.isolation.test.ts` and the recipe at
  `context/foundation/test-plan.md` §6.5 — assert all four denial surfaces, never through
  the service-role client.

### The route the link points at

`src/middleware.ts:6` gates by prefix: `PROTECTED_ROUTES = ["/dashboard", "/pets"]`, matched
with `startsWith`. The caretaker route must therefore **not** live under `/pets` — a path
like `/pets/invite/<token>` would be silently redirected to sign-in and the whole link model
would appear broken. A distinct prefix (`/z/<token>`, `/opieka/<token>`) avoids the trap.

The middleware still calls `getUser()` on the invite route; for an anonymous visitor it
returns null and `context.locals.user` is null, which is correct and costs one round-trip.

## Code References

- `docs/reference/data-access.md` — the binding contract: Publishable key only, no
  service_role in the request path, deny-by-default RLS, `SECURITY DEFINER` hardening
  checklist, and the explicit note that caretaker access is a different model
- `supabase/migrations/20260627125956_init_profiles_rls.sql:40-56` — `SECURITY DEFINER` +
  empty `search_path` + `revoke execute from public`, the template to copy for the token function
- `supabase/migrations/20260712204748_pets_and_instructions.sql:6` — enum pattern
- `supabase/migrations/20260712204748_pets_and_instructions.sql:88-119` — transitive-ownership
  policies, the model for `care_slots`
- `supabase/migrations/20260712204748_pets_and_instructions.sql:122-155` — atomic
  `SECURITY INVOKER` RPC
- `supabase/migrations/20260831203038_harden_create_pet_rpc_grants.sql` — the grant posture
- `src/pages/api/pets.ts:10-52` — API route contract
- `src/lib/schemas/pet.ts:9-24` — zod with explicit upper bounds
- `src/lib/supabase.ts:6-26` — the only client; anon-keyed, cookie-bound
- `src/middleware.ts:6,18-22` — prefix gating; the trap for the invite route
- `src/components/ui/` — the S-07 component layer the owner-facing UI consumes
- `supabase/config.toml:36` — Postgres 17

## Architecture Insights

- **The security model is layered, and each layer has one job.** Grants make a table
  reachable; the *absence* of a policy denies an operation; the policy predicate does
  authorization. `data-access.md` is emphatic that grants are not the deny mechanism. The
  caretaker model adds a fourth layer — a function whose body is the authorization — and it
  is worth stating in the plan that this is a deliberate widening, not an oversight.
- **`SECURITY INVOKER` is the default and `SECURITY DEFINER` is the exception.** The codebase
  has exactly one definer function today (`handle_new_user`), and it exists because a trigger
  must run regardless of caller. The token function will be the second, and the first that is
  callable by an untrusted role — which raises the bar on its body.
- **Every atomic multi-table write so far goes through an RPC, not multiple client calls.**
  Both prior cases had the same justification: no edit path exists, so a half-written entity
  is unrecoverable.
- **Bounds are applied at the zod layer, not the database.** S-01's impl-review made this a
  habit rather than an accident.

## Historical Context (from prior changes)

- `context/archive/2026-07-12-pet-and-instructions/reviews/impl-review.md` — F1 (unbounded
  input as a DoS vector), F2 (raw DB error leaked to the client), F3 (missing revoke/grant on
  the RPC), F5 (null Supabase client rendering an empty state instead of an error). All four
  apply almost verbatim to S-02 and should be designed in rather than found again.
- `context/archive/2026-09-05-ui-design-system/reviews/impl-review.md` — the standing debt
  list. `AddPetForm.tsx` still imports the superseded `FormField`; a new owner-facing form in
  S-02 should use `src/components/ui/Input.tsx` instead, or it will inherit the same debt.
- `context/foundation/lessons.md` — "Wylicz konsumentów, zanim zmienisz coś współdzielonego."
  S-02 mostly *adds*, so the rule bites less here, but it applies if the plan touches
  `PROTECTED_ROUTES`, the middleware, or any `src/components/ui/` component.
- `context/archive/2026-06-28-testing-rls-owner-isolation/` — the RLS test harness S-02's
  new tables will reuse.

## Related Research

- `context/archive/2026-07-12-pet-and-instructions/plan.md` — closest precedent; the
  schema → RPC → API → UI phase shape is directly transferable.
- `context/archive/2026-06-28-testing-auth-gating/research.md` — how the middleware is driven
  in tests, relevant if the plan wants an automated proof that the invite route is *not* gated.

## Open Questions

1. **Does S-02 ship a landing page for the token, or does the link dangle until S-03?**
   The roadmap assigns the caretaker screen to S-03, which argues for dangling. But the
   slice's own risk note says S-02 introduces the access contract the guardrail rests on —
   and a contract that cannot be exercised is not proven. A minimal page that resolves the
   token and shows the period (no claiming, no instructions) would make the scope testable.
   Owner: user. Blocks: scope of the plan.
2. **Store the raw token or only its hash?** Hash is materially safer and costs nothing
   technically, but forces "the link is shown once, then only regenerable". Raw storage lets
   the owner reopen and re-copy. This is a product decision. Owner: user. Blocks: schema.
3. **Does caretaker access expire with the period's end date?** Natural and cheap to enforce
   in the function body, but it means a caretaker cannot re-read instructions the morning
   after. Owner: user. Blocks: the function body, not the schema.
4. **Should `revoked_at` land now?** FR-012 (revoke the link) is S-06 and nice-to-have, but a
   nullable timestamp added now costs one column and saves a migration plus a function edit
   later. Recommend yes; confirm in planning. Owner: user. Blocks: nothing.
5. **Maximum period length.** Needs a number before the CHECK constraint and the zod bound
   can be written. 90 days (270 slots) is a guess, not a finding. Owner: user.
