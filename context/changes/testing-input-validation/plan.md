# Input Validation — Implementation Plan

## Overview

Rollout phase 2b, Risk #7. Research found the phase's premise largely false: seven of nine routes
validate correctly and the classic "weak zod" defect — a handler that parses and then reads around
the parsed result — exists nowhere. So this plan does not hunt for missing validation. It pins the
one defect that was found and already fixed, closes three named gaps, and fixes one genuine weak-zod
case that following the trust boundary turned up.

## Current State Analysis

**What research measured** (`research.md`, and its follow-up against the running catalogue):

- Every parse site uses `parsed.data` and nothing else, including the two-parameter route that is
  the natural place to forget one.
- `/api/auth/signin` and `/api/auth/signup` answered **500** to a JSON body, an empty body and a
  `text/plain` body, because `await context.request.formData()` was unwrapped and `formData()`
  rejects for any other content type. **Fixed in `6206428`** — both now answer the same generic 302
  as every other failure. Nothing pins that.
- Astro's `checkOrigin` skips `application/json`, so a form POST with no `Origin` was refused 403
  before the handler while the JSON POST that crashed it went through.
- The database has **no length bound anywhere** — zero columns with `character_maximum_length`,
  verified from `information_schema`. `22001` is unreachable and zod is the only bound in the system.
- A non-uuid raises **22P02** at parse time, surfaced by PostgREST as a 400. The `z.guid()` guards on
  three routes are therefore load-bearing: without one, `revoke.ts:92` maps the PostgREST error to
  **500**.
- `z.guid()` is strictly stricter than Postgres's `uuid` parser — braces and the hyphenless 32-hex
  form are rejected by zod and accepted by the database.

**What this plan adds, found while writing it.** `create_pet_with_instructions` sets
`owner_id = (select auth.uid())` itself, so an RLS with-check refusal is **not reachable** through
`/api/pets` — a mapping for `42501` would cover a dead branch. But the function casts
`(i ->> 'sort_order')::int` on raw JSON, and `createInstructionSchema` bounds `sort_order` with
`z.number().int().min(0)` and **no upper bound**. Measured separately:

```
zod       1000000000000  -> ACCEPTS
Postgres  ('1000000000000')::int -> SQLSTATE 22003, out of range for type integer
```

`pets.ts:50` maps no error codes, so that composition should answer 500 to client input. **That
composition is a prediction until phase 3 runs it** — which is why running it is phase 3's first
step, before any fix.

## Desired End State

- The auth fix is pinned: three non-form body shapes and a missing field all produce the identical
  generic redirect, and a test fails if any of them diverges or throws again.
- `/api/auth/signout` has coverage for the first time.
- The three declared bounds in `createPetSchema` are pinned **at their values**, not merely as "some
  bound exists", by boundary pairs through the route.
- An oversized `sort_order` answers 400, not 500 — bounded in zod and mapped in the handler.
- `test-plan.md` §3 shows phase 2b `complete` **with the reason it closed narrower than its name**.

**How to verify**: `npm test` green with the new files; and the phase-4 mutation shows that removing
`z.guid()` from `revoke.ts` changes a 400 into a 500.

### Key Discoveries

- `src/pages/api/auth/signin.ts:8-30` — the wrapped `formData()` and the single failure shape
- `tests/api/auth-error-disclosure.test.ts:99-160` — the whole-object comparison pattern this change
  extends rather than reinvents
- `src/lib/schemas/pet.ts:13` — `sort_order` bounded below and not above
- `supabase/migrations/20260712204748_pets_and_instructions.sql:32` — the `integer` column behind it
- `src/pages/api/periods.ts:79-99` — the error-code mapping pattern, with its reasoning
- `tests/api/periods.post.test.ts:129-156` — the boundary-pair pattern (31 days accepted, 32 rejected)
- `context/foundation/lessons.md` — two rules bear directly: a claim of missing coverage is a claim
  about the whole directory, and a substring assertion matches its own rationale

## What We're NOT Doing

- **Not testing `periods`, `revoke`, `token`, `release` or `invite/claim`.** The coverage matrix in
  `research.md` shows them covered; `invite-claim.test.ts:506-531` alone pins five bad-input shapes.
  Adding more there would repeat the duplicate-file mistake `lessons.md` records.
- **Not re-asserting the zod schemas' own shape.** `test-plan.md` §2 names this as the anti-pattern
  for Risk #7. `tests/unit/period-schema.test.ts` already covers the period schema as a contract; no
  equivalent mirror is added for pets — the bounds are pinned through the route, where a violation
  has an observable consequence.
- **Not mapping `42501` in `pets.ts`.** Measured unreachable: the RPC sets `owner_id` itself.
- **Not replacing the `as string` casts** in the auth routes. A missing field reaches GoTrue as null
  and lands on the same redirect — measured. A zod gate there would add a rejection path _before_
  GoTrue, which is a new timing and shape difference on a pre-auth endpoint.
- **Not adding CSRF checks to `pets.ts` / `periods.ts`.** Their reliance on `SameSite=Lax` is a
  recorded decision (`context/archive/2026-09-09-close-care-period/plan.md:72-75`), and it is a
  different risk from #7.
- **Not touching the Polish-message debt** on `/api/pets` and `/api/periods/[id]/token`
  (`test-plan.md` §7) — still its own unit of work, for the reason recorded there.

## Implementation Approach

Pin before fixing, and measure before pinning. Phase 1 needs no database at all — the auth throw
happened before Supabase was touched, so it is a `unit`-project test. Phase 2 needs the stack.
Phase 3 starts by running the composition it intends to fix, so the fix is answering something
observed rather than something predicted. Phase 4 proves the guards elsewhere are load-bearing and
makes the documents true.

## Critical Implementation Details

**A value that is malformed for zod is not necessarily malformed for the database.** `z.guid()`
rejects `{550e8400-…}` and the hyphenless form; Postgres accepts both. Any assertion meant to say
something about the database behind the handler must use a value both parsers reject — `not-a-uuid`
does, braces do not. This matters in phase 4's mutation.

## Phase 1: Pin the auth fix

### Overview

`6206428` changed how two pre-auth routes answer a malformed body. Nothing asserts it. This phase
makes the fix falsifiable, at the `unit` project because the failure path never reaches Supabase.

### Changes Required

#### 1. A test for the body-shape contract

**File**: `tests/api/auth-body-shape.test.ts` (new) — or an added `describe` in
`tests/api/auth-error-disclosure.test.ts`; the implementer picks, but see the contract note.

**Intent**: Assert that a JSON body, an empty body and a `text/plain` body each produce the same
whole response as a genuine credential failure, on both routes — and that none of them throws.

**Contract**: whole-object comparison, following `auth-error-disclosure.test.ts:99-160`, which
compares `{status, location, header names, cookie names, body}` rather than a substring. The reason
is the same here: the property is sameness, and a substring check would pass if a future edit
appended a reason to the redirect.

Two constraints on where this lives. It must run in the **`unit`** project — the throw happened at
`signin.ts:9`, before `createClient`, so the test needs neither the stack nor `.env.test`, and
putting it in `integration` would make a Docker-free assertion depend on Docker. But
`auth-error-disclosure.test.ts` is an integration file (it creates a real account). So a new file in
the `unit` project is the likely answer, with the fake-context helper duplicated or extracted.

#### 2. A test for the missing-field path

**File**: same as above.

**Intent**: A form body missing `email` (and one missing `password`) answers the same redirect as a
wrong password. This pins the behaviour the `as string` casts produce, which is the reason the casts
were left in place.

**Contract**: this one needs a real credential failure to compare against, which needs GoTrue — so
it belongs in the integration file after all, or it compares against the constant from
`src/lib/auth-messages.ts` instead. Comparing against the constant keeps it in `unit`; state which
was chosen and why in the file header.

### Success Criteria

#### Automated Verification

- New tests pass: `npx vitest run --project unit auth-body-shape`
- Whole unit project green: `npx vitest run --project unit`
- The existing disclosure assertions still pass: `npx vitest run --project integration auth-error-disclosure`
- Typecheck and lint: `npm run check` and `npm run lint`

#### Manual Verification

- The test is proven to bite: revert `6206428`'s `try` in one route, confirm the new test fails with
  a message naming the content type, then restore

---

## Phase 2: First coverage for `/api/auth/signout`

### Overview

`src/pages/api/auth/signout.ts` has no test of any kind — zero references in `tests/`. It is ten
lines, but two of them are a silent-failure path.

### Changes Required

#### 1. Sign-out behaviour

**File**: `tests/api/signout.test.ts` (new), `integration` project

**Intent**: Assert that signing out with a live session clears the session cookies and redirects to
`/`, and that a caller with no session is answered identically — the route has no auth gate by
design and must not become an oracle for whether a session existed.

**Contract**: uses `createOwnerClient` / `mintCookieHeader` from `tests/helpers/`, following
`tests/api/token-scope.test.ts`'s cookie handling. Assert on the cookie names the route deletes
through the fake `cookies` store, not on a substring of a `Set-Cookie` header.

**The interesting case**: `signout.ts:6-8` skips the sign-out entirely when `createClient` returns
null and still redirects to `/`. The caller cannot distinguish "signed out" from "nothing happened".
Assert the current behaviour and state in the header that it is being pinned, not endorsed — a
follow-up may decide it should fail loudly instead.

### Success Criteria

#### Automated Verification

- New test passes: `npx vitest run --project integration signout`
- Whole integration project green: `npx vitest run --project integration`

#### Manual Verification

- Proven to bite: comment out the `await supabase.auth.signOut()` call and confirm the test fails on
  the cookie assertion, then restore

---

## Phase 3: `/api/pets` — the bounds, and the one real weak-zod case

### Overview

Three declared bounds that nothing pins, and one field bounded below but not above where the column
behind it is a 32-bit integer. Starts by measuring, because the composition is currently a
prediction.

### Changes Required

#### 1. Measure the `sort_order` composition first

**File**: none — a measurement, recorded in the phase commit message.

**Intent**: Before changing anything, send a real request to `/api/pets` with an instruction whose
`sort_order` is `1e12` and record what the caller receives. The two halves are measured
(`z.number().int().min(0)` accepts it; `('1000000000000')::int` raises 22003) but their composition
is not, and `lessons.md` is explicit that a sentence about what happens when a guard is absent is a
prediction until it is run.

**Contract**: if the observation is a 500, phases 3.2 and 3.3 proceed as written. If it is already a
400, the fix is unnecessary and this phase reduces to the boundary pairs — say so and adapt rather
than implementing a fix for a problem that is not there.

#### 2. Bound `sort_order` in the schema

**File**: `src/lib/schemas/pet.ts`

**Intent**: Give `sort_order` an upper bound so client input cannot reach a cast that overflows the
column. This is a production change inside a change named "testing-", and it is a fix, not a test —
the plan says so plainly so nobody later reads it as incidental.

**Contract**: an upper bound on `createInstructionSchema.sort_order`. The column is `integer`
(`20260712204748_pets_and_instructions.sql:32`), so `2147483647` is the type's limit; a smaller,
domain-meaningful cap is also defensible given `instructions` is capped at 50. Pick one, and say in
a comment which reasoning was used — the type's limit or the domain's.

#### 3. Map what still slips through

**File**: `src/pages/api/pets.ts`

**Intent**: `pets.ts:50` answers 500 for every database error. Bad client input should not read as a
server fault. Map the codes that are actually reachable — and only those.

**Contract**: follow `periods.ts:79-99` in shape and in discipline: log `error.code, error.message`
(never the whole error), map to a Polish sentence, keep 500 as the fallback. `42501` is **not** in
the reachable set — verified, the RPC sets `owner_id` itself. Which codes belong here follows from
3.1's measurement plus the casts in the function body.

#### 4. Boundary pairs for the three bounds

**File**: `tests/api/pets.post.test.ts` (extend)

**Intent**: Pin each declared bound at its value: a payload exactly at the limit is accepted, one
character or element over is rejected with 400. A one-sided "too long is rejected" test would keep
passing if someone tightened the limit to 10.

**Contract**: three pairs — `name` at 120/121, instruction `body` at 2000/2001, `instructions` array
at 50/51 — plus the `sort_order` case from 3.1. Follow `periods.post.test.ts:129-156`, which does
exactly this for the 31/32-day span. Each rejection asserts the side effect too (pet count
unchanged), matching the file's existing style.

### Success Criteria

#### Automated Verification

- Extended tests pass: `npx vitest run --project integration pets.post`
- Whole suite green: `npm test`
- Typecheck and lint: `npm run check` and `npm run lint`

#### Manual Verification

- 3.1's measurement is recorded in the commit message as an observation, with the status the caller
  actually received
- Each boundary pair is proven to bite: change one bound in the schema by one and confirm the
  matching pair fails, then restore

---

## Phase 4: Prove the guards elsewhere, and make the documents true

### Overview

One mutation that answers the question the whole risk rests on, and the document edits that follow
from a phase closing narrower than its name.

### Changes Required

#### 1. The mutation, run and recorded

**File**: none — no code is committed.

**Intent**: Remove the `periodIdSchema` guard from `revoke.ts`, send `not-a-uuid` with a valid
session, and record the status. Research predicts 400 → 500, because PostgREST answers 22P02 and
`revoke.ts:92` maps any database error to 500. If it holds, the `z.guid()` guards on three routes
are demonstrably load-bearing rather than decorative — which is the difference between a validation
test and a schema mirror.

**Contract**: use `not-a-uuid`, which both parsers reject. Do **not** use `{550e8400-…}` — zod
rejects it and Postgres accepts it, so it would only prove the zod layer exists. Restore the guard
immediately; the mutation lives in the commit message and in this plan, not in the repository.

#### 2. Close phase 2b, with its reason

**File**: `context/foundation/test-plan.md`

**Intent**: Flip §3's row 2b to `complete` and add the sentence that makes the status honest: the
research refuted the phase's premise, seven routes already validated correctly, so the phase closed
on the gaps rather than on a sweep of all nine routes. A bare `complete` here is the shape
`lessons.md` records as an aspirational sentence turning into a historical record.

**Contract**: §3 table row + a short paragraph under it, dated, naming this change folder. Also
update §5's gate inventory if any row is made stale by the new tests, and add a §6 cookbook entry
only if the boundary-pair pattern is not already described there.

#### 3. Record what was found but not done

**File**: `context/foundation/test-plan.md` §7

**Intent**: Two findings from this change are real and deliberately out of scope: `signout`'s silent
no-op when the client is unavailable, and the fact that Astro's origin check skips `application/json`
so `pets.ts` and `periods.ts` rely on `SameSite=Lax` alone. Both belong in §7 with their reasoning,
not in a follow-up file that archives with the change.

**Contract**: two §7 entries, each naming what was measured and why it was left.

### Success Criteria

#### Automated Verification

- Whole suite green after the mutation is reverted: `npm test`
- Publish gate green: `npm run ci:gate`
- Docs prettier-clean: `npx prettier --check context/foundation/test-plan.md`

#### Manual Verification

- The mutation was actually run and its observed status recorded — not predicted
- §3's phase-2b row and its explanation agree with what the change actually did
- No claim added to §5 or §7 describes something that does not exist

---

## Testing Strategy

### Unit Tests

- Auth body shapes: three non-form bodies × two routes, whole-response comparison, no stack needed

### Integration Tests

- `signout`: session cleared, no oracle for whether one existed
- `pets`: three boundary pairs plus the `sort_order` case, each asserting the side effect

### Manual Testing Steps

1. Run `npm run ci:gate` on a clean checkout.
2. Revert the `try` in `signin.ts`; confirm the phase-1 test fails naming the content type; restore.
3. Remove `periodIdSchema` from `revoke.ts`; send `not-a-uuid`; record the status; restore.
4. Change one schema bound by one; confirm the matching boundary pair fails; restore.

## Performance Considerations

None. The new tests add roughly a dozen requests to a suite that runs the integration project in
about 12 seconds locally.

## Migration Notes

Two production changes land here — the `sort_order` bound and the `pets.ts` error mapping. Both are
additive and reversible in one commit each. The schema bound is the only one that can reject a
payload that previously succeeded; a `sort_order` above the new cap would have failed at the database
anyway, with a worse status.

## References

- Research: `context/changes/testing-input-validation/research.md`
- The fix this plan pins: commit `6206428`
- Error-mapping pattern: `src/pages/api/periods.ts:79-99`
- Boundary-pair pattern: `tests/api/periods.post.test.ts:129-156`
- Whole-object comparison pattern: `tests/api/auth-error-disclosure.test.ts:99-160`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pin the auth fix

#### Automated

- [x] 1.1 New tests pass: `npx vitest run --project unit auth-body-shape` — 3fe8416
- [x] 1.2 Whole unit project green: `npx vitest run --project unit` — 3fe8416
- [x] 1.3 Existing disclosure assertions still pass: `npx vitest run --project integration auth-error-disclosure` — 3fe8416
- [x] 1.4 Typecheck and lint: `npm run check` and `npm run lint` — 3fe8416

#### Manual

- [x] 1.5 Proven to bite: revert the `try` in one route, confirm failure names the content type, restore — run on BOTH routes; signup.ts failed exactly its own six sign-up assertions while the nine sign-in ones passed, so the two routes are covered independently — 3fe8416

### Phase 2: First coverage for `/api/auth/signout`

#### Automated

- [x] 2.1 New test passes: `npx vitest run --project integration signout` — fd2d1e8
- [x] 2.2 Whole integration project green: `npx vitest run --project integration` — fd2d1e8

#### Manual

- [x] 2.3 Proven to bite: comment out `signOut()`, confirm the cookie assertion fails, restore — two of three tests failed (session and cookie); the uniformity test correctly still passed, since removing signOut does not change the redirect — fd2d1e8

### Phase 3: `/api/pets` — the bounds, and the one real weak-zod case

#### Automated

- [x] 3.1 Extended tests pass: `npx vitest run --project integration pets.post`
- [x] 3.2 Whole suite green: `npm test`
- [x] 3.3 Typecheck and lint: `npm run check` and `npm run lint`

#### Manual

- [x] 3.4 The `sort_order` composition was measured before any fix, and the observed status recorded — 1e12 answered 500 "Nie udało się zapisać zwierzęcia"; 2147483647 answered 201, so the ceiling is exactly the integer type's
- [x] 3.5 Each boundary pair proven to bite by moving its bound by one, then restoring — each mutation breaks its OWN named test; a fifth bound (instruction `title`) was found unpinned by a slipped mutation and covered; the 22003 mapping proven reachable by removing the zod bound, which answered 400 with the mapping's own message

### Phase 4: Prove the guards elsewhere, and make the documents true

#### Automated

- [ ] 4.1 Whole suite green after the mutation is reverted: `npm test`
- [ ] 4.2 Publish gate green: `npm run ci:gate`
- [ ] 4.3 Docs prettier-clean: `npx prettier --check context/foundation/test-plan.md`

#### Manual

- [ ] 4.4 The mutation was run and its observed status recorded, not predicted
- [ ] 4.5 §3's phase-2b row and its explanation agree with what the change did
- [ ] 4.6 No claim added to §5 or §7 describes something that does not exist
