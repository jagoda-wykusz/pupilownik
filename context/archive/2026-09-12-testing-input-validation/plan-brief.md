# Input Validation — Plan Brief

> Full plan: `context/changes/testing-input-validation/plan.md`
> Research: `context/changes/testing-input-validation/research.md`

## What & Why

Rollout phase 2b, Risk #7: "an API handler trusts client input (missing or weak zod), accepting
malformed or forbidden data." Research refuted most of the premise — seven of nine routes validate
correctly and no handler reads around its own parse — so this change pins the one defect that was
found, closes three gaps nothing covers, and fixes the single genuine weak-zod case that following
the trust boundary turned up.

## Starting Point

Both pre-auth auth routes answered **500** to any body that was not form-encoded, because
`formData()` rejects rather than returning empty. That was measured during research and **already
fixed** (`6206428`) — and nothing pins it. Beyond that: `/api/auth/signout` has no test at all,
`createPetSchema`'s three declared bounds are unpinned at every layer, and `pets.ts` maps no database
error codes, so bad client input reads as a server fault.

## Desired End State

A malformed body on either auth route produces the same generic redirect as a wrong password, and a
test fails if that ever diverges again. Signing out is covered for the first time. The pet bounds are
pinned at their values by boundary pairs, not merely as "some bound exists". An oversized
`sort_order` answers 400 instead of overflowing an `integer` column into a 500. And `test-plan.md`
§3 shows phase 2b closed, with the reason it closed narrower than its name.

## Key Decisions Made

| Decision                  | Choice                                     | Why (1 sentence)                                                                                     | Source   |
| ------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- | -------- |
| Which routes              | auth (3) + pets only                       | The other five are covered; adding there repeats a duplicate-file mistake already recorded.          | Plan     |
| Schema mirror tests       | No — pin through the route                 | §2 names the mirror as this risk's anti-pattern, and the database has no bounds to fall back on.     | Research |
| Bound testing             | Boundary pairs (N accepted, N+1 rejected)  | A one-sided test keeps passing if someone tightens the bound to 10.                                  | Plan     |
| `pets.ts` error mapping   | Fix it, following `periods.ts`             | Same defect `periods.ts:81-83` already fixed; leaving it one route over is maintained inconsistency. | Plan     |
| `42501` in that mapping   | Excluded                                   | Measured unreachable — the RPC sets `owner_id` from `auth.uid()` itself.                             | Plan     |
| `as string` casts in auth | Left in place, behaviour pinned            | A zod gate there would add a rejection path before GoTrue on a pre-auth endpoint.                    | Plan     |
| The `z.guid()` mutation   | A phase criterion, not a committed test    | It proves the guards are load-bearing; a source test for it would match its own comments.            | Plan     |
| Phase 2b status           | `complete`, with the narrowing written out | A bare tick is the shape that turns an aspiration into a historical record.                          | Plan     |

## Scope

**In scope:** a unit-level test of the auth body-shape fix; first coverage for `/api/auth/signout`;
boundary pairs for `createPetSchema`'s three bounds; an upper bound on `sort_order`; database
error-code mapping in `pets.ts`; the `z.guid()` mutation; `test-plan.md` §3/§5/§7 updates.

**Out of scope:** `periods`, `revoke`, `token`, `release`, `invite/claim` (all covered); schema-mirror
tests; `42501` mapping (unreachable); replacing the `as string` casts; CSRF checks on `pets.ts` /
`periods.ts` (a recorded decision, and a different risk); the Polish-message debt in §7.

## Architecture / Approach

Pin before fixing, measure before pinning. Phase 1 runs in the `unit` project because the auth
failure never reached Supabase. Phase 3 opens by _running_ the `sort_order` composition it intends to
fix — both halves are measured, the composition is not — so the fix answers an observation rather
than a prediction. Phase 4 proves, by mutation, that the `z.guid()` guards elsewhere actually change
the outcome.

## Phases at a Glance

| Phase                      | What it delivers                                        | Key risk                                                      |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| 1. Pin the auth fix        | Three body shapes + missing field, whole-response equal | Choosing the wrong project — it must not need Docker          |
| 2. `signout` coverage      | First test for a route that had none                    | Pinning the silent no-op reads as endorsing it unless stated  |
| 3. `pets` bounds + mapping | Boundary pairs, `sort_order` bound, error mapping       | The 500 is predicted, not yet observed — measure first        |
| 4. Mutation + documents    | Proof the guards bite; §3 closed with its reason        | Using a value zod rejects but Postgres accepts proves nothing |

**Prerequisites:** Docker running for phases 2–4; the local stack applied. Phase 1 needs neither.
**Estimated effort:** ~1–2 sessions across 4 phases.

## Open Risks & Assumptions

- **The `sort_order` 500 is a prediction.** zod accepts `1e12` and Postgres raises 22003 — both
  measured — but the composition through the route has not been run. Phase 3.1 exists to settle it,
  and the plan says what to do if the answer is already 400.
- **Two production changes land in a change named "testing-".** The `sort_order` bound and the error
  mapping are fixes, stated as such so they are not later read as incidental.
- **`z.guid()` is stricter than Postgres.** Braces and the hyphenless form are rejected by zod and
  accepted by the database, so a "malformed" value can prove less than it appears to.

## Success Criteria (Summary)

- A malformed body on either auth route can never silently become a 500 again without a test failing.
- Every declared bound in `createPetSchema` is pinned at its value, and bad input to `/api/pets`
  answers 400 rather than reading as a server fault.
- Phase 2b is closed in `test-plan.md` with an explanation a reader can check against the change.
