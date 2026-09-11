# Domain Guardrails — Test Rollout Phase 4 Implementation Plan

## Overview

Close `test-plan.md` §3 Phase 4 (Risks #3, #4, #5) as **gap-finding over existing coverage**, not greenfield. 28 test files already exist and all three risks are substantially covered at the SQL layer. This plan pins the places where removing the protection **causes no test to fail today** — starting with the sensitive-instruction gate on the caretaker page, which has no defence above the database.

## Current State Analysis

**Risk #3 — atomic claim.** The whole guarantee is one statement, `supabase/migrations/20260907171514_claim_secret_not_digest.sql:186-198` (`update … where s.claimed_by_name is null`), made truthful by the triple CHECK `care_slots_claim_complete` (`20260907065515_claim_capability_and_note.sql:75-82`). Exactly one genuinely parallel test exists — `tests/rls/claim-slots.test.ts:509` (six `Promise.all` claims on one slot) — and the file states its own limit at `:499-508`: it proves the OUTCOME, not the row lock. The HTTP route has **zero** concurrency coverage (no `Promise.all` anywhere in `tests/api/`), so the entire TypeScript path — capability cookie, `conflictMessage`, and the `40P01` → 409 mapping at `src/pages/invite/claim.ts:120-122` — is unproven under contention. **CORRECTED 2026-09-11 (phase-4 review).** This analysis said the triple CHECK had no negative test. It was wrong, and the error came from the research pass being carried into the plan unverified: `tests/rls/care-slots.isolation.test.ts:123` already refuses all SIX invalid combinations, plus the complete triple and the release direction. Phase 4 first added a fourth-copy file duplicating a strict subset of it; that file was deleted and its one genuine improvement — asserting SQLSTATE 23514 and the constraint's NAME rather than `not.toBeNull()` — folded into the existing test. The mutation run did not catch the mistake, because dropping the constraint fails the existing test too.

**Risk #4 — instruction visibility.** Strong at SQL: `tests/rls/reveal-instructions.test.ts:202` searches the **whole serialized RPC payload** for the sensitive body, not a named field, which is precisely the anti-pattern §2 warns about — avoided. But the page-layer gate is undefended. Delete the `details &&` / `sensitiveByPet` gating in `src/pages/invite/[token].astro:196,380,424` — e.g. build the map from `payload.pets` instead — and **every test in the suite still passes**. There is no `[token].astro` counterpart to `tests/unit/period-detail-source.test.ts` (which guards `claim_digest` on the owner page, not instructions).

**Risk #5 — link scope, revoke, release.** Revoke is covered end-to-end, including response uniformity (`tests/api/revoke-period.test.ts:238` compares whole `{status, body}` objects). Three holes remain:

- **No release test calls `get_claimed_details`.** `release_slot.sql:16-22`, `data-access.md` and PRD §Open Questions #5 all rest on "freeing a capability's LAST term revokes that caretaker's reveal outright" — nothing pins it, in either direction.
- **No test presents a valid invite token to an owner-only endpoint.** The 401 tests simply omit `locals.user`; scope is proven only at the grant layer, by Postgres role. `POST /api/pets` has no 401 test at all, though the guard exists at `src/pages/api/pets.ts:11`.
- **Uniformity is pinned for revoke only.** `tests/api/release-slot.test.ts:198-261` checks four 404 statuses without ever comparing bodies; the token-mint 404 is checked once (`tests/api/periods.post.test.ts:258`). `RegenerateLinkButton` has no component test, so its no-Content-Type shape — the only CSRF defence on `token.ts`, which carries no Origin check — is unpinned.

### Key Discoveries:

- `src/lib/invite-view.ts` already exists and already carries this exact argument in its own header: a security property left in `.astro` frontmatter "lived in an `if` and a ternary, enforced by nothing". `splitRevealAnswer` and `resolveInviteView` are the precedent to extend; the instruction composition at `[token].astro:196` is the one decision of that class still in the frontmatter.
- `tests/helpers/auth.ts:46` `createAnonClient()` is synchronous and session-free, so N independent link-only callers are cheap to build — that is how `claim-slots.test.ts:513` builds six racers.
- `tests/api/*.test.ts` import handlers directly and pass a hand-built context (`request`, `url`, `createFakeCookies()`, `params`, `locals`). Auth is never mocked: the Cookie header is a genuine minted session while `locals.user` is set separately — which is what makes `tests/api/revoke-period.test.ts:130` ("checks auth BEFORE the write") meaningful.
- Vitest runs files in parallel but tests **within a file serially** (`claim-slots.test.ts:507`), so any contention must be built inside a single `it()`.
- `vitest.config.ts` carries three projects: `unit` (no setup file, Docker-free), `component` (happy-dom), `integration` (`tests/setup.ts`, needs the local stack).

## Desired End State

Every claim this project makes in prose about the three domain guardrails is pinned by a test that fails when the claim stops being true. Concretely: the caretaker page cannot serialize a sensitive instruction row or the trip note to an unclaimed visitor without a failing test; the documented consequence of releasing a caretaker's last term is enforced in both directions; holding a valid invite token opens nothing on the owner side; two simultaneous claims through the real HTTP handler produce exactly one winner; and every failure answer that must be an oracle-free 404 is compared as a whole object, not as a status.

Verified by: `npm test` green, plus a mutation pass per phase — break the protection, watch the named test fail, restore.

## What We're NOT Doing

- **No e2e runner, no Astro Container API, no rendered-HTML assertions.** §7 excludes the caretaker page's HTML deliberately and §4 defers Playwright to post-Phase-4. Phase 1 reaches the same defect class through a pure function instead.
- **No `pg` client and no deterministic row-lock proof.** The mechanism stays outcome-tested; `claim-slots.test.ts:499-508` keeps its honest disclaimer.
- **No product fixes.** `release_slot` does not gain `p_claimed_at`; the claim × release lost-update window stays open. It is PRD §Open Questions #3 with `Owner: użytkownik`.
- **No test for the claim × release or claim × revoke races.** Recorded in §7 with the reason and the re-evaluation trigger (Phase 5), not pinned.
- **No `RegenerateLinkButton` UX coverage** beyond request shape and the revoked refusal — arming, focus, error copy and double-submit are UX, not §2 risk.
- **No change to `get_claimed_details`, `claim_slots`, `release_slot` or `revoke_period`.** No migration lands in this change.
- **Phases 2b (input validation, Risk #7) and 3 (secret leak, Risk #6) of the rollout stay `not started`** — they are separate changes.

## Implementation Approach

Five phases, ordered so each earlier one closes a gap with **no defence at all today** and later ones strengthen something already defended one layer down. Phase 1 is the only one that touches production code, and it is a move, not a rewrite: the composition decision leaves the `.astro` frontmatter for `src/lib/invite-view.ts`, where the project already keeps the two other security-carrying decisions of this page. Everything else is test-only.

## Critical Implementation Details

**Timing & lifecycle.** `npm run build` and `npx astro check` rebuild `node_modules/.vite`, which a running `npm run dev` will not survive — and since `45432b6` the pre-commit hook runs `astro check`, so **every commit** has this property. Kill the dev server before any build, check or commit (`lessons.md`). A "the cache is fresh" argument is backwards: freshness counts only for a process started AFTER the rebuild.

**Debug & observability.** Never read a success criterion's exit code through a pipe — it is the pipe's code. Run `npm run lint > out.txt 2>&1; echo $?` and then read the file (`lessons.md`). This applies to `lint`, `build` and `test` alike, and to background runs whose notification wraps a pipe.

**State sequencing.** Phase 4's overlapping-selection race can deadlock by design — that is the point of the case — so the assertion must admit both permitted outcomes (one 200 + one 409, or one 200 + one 409-from-`40P01`), never a single expected interleave.

---

## Phase 1: The caretaker page's instruction gate (Risk #4)

### Overview

Move the public/sensitive composition out of `[token].astro`'s frontmatter into `src/lib/invite-view.ts` and pin it with a test that searches the whole serialized result for sensitive content, mirroring how the SQL layer does it. Add a source guard so the page cannot quietly go back to composing from the public payload.

### Changes Required:

#### 1. The composition function

**File**: `src/lib/invite-view.ts`

**Intent**: Own the decision "which instruction rows and which note may be rendered for this visitor" in one pure, exported function, for the same reason `splitRevealAnswer` already lives here — in frontmatter that decision is enforced by nothing. Pre-claim it must be structurally impossible for a sensitive row or the note to appear in the result.

**Contract**: A new export taking the public payload's pets and the reveal answer's `details` (or `null`), returning one view object per pet carrying its public rows and its sensitive rows separately, plus the caretaker note. Generic over the pet shape, as `splitRevealAnswer` is over its content shape — the module must keep knowing nothing about Astro or Supabase. Keying by pet id (not index) is load-bearing and already argued at `[token].astro:192-195`: the two payloads order pets identically today, and relying on that would turn a future ordering change into a silent mismatch of instructions to animals. When `details` is `null`, every sensitive list is empty and the note is `null`.

#### 2. The page consumes it

**File**: `src/pages/invite/[token].astro`

**Intent**: Replace the inline `sensitiveByPet` map and the `details?.caretaker_note` reference with the function's result, so the template reads only from a value that is already safe.

**Contract**: Frontmatter calls the new function; the template below the fence no longer references `details` for instructions or the note. `myDays`, the `ClaimSlots` props and `resolveInviteView`'s inputs are untouched — this phase moves one decision, it does not restructure the page (see §What We're NOT Doing).

#### 3. The behavioural test

**File**: `tests/unit/invite-composition.test.ts` (new, `unit` project — no Docker)

**Intent**: Fail when the gate is removed. The headline case is the one the SQL layer already protects itself with: serialize the **entire** result for a visitor with `details === null` and assert the sensitive body text and the note text appear nowhere in it.

**Contract**: Cases — pre-claim hides every sensitive row and the note; post-claim exposes exactly the sensitive rows for the right pet and the note; a pet with no sensitive rows still appears with an empty sensitive list; pets are matched by id when the two payloads disagree on order; a pet present in `details` but absent from the public payload does not conjure a pet. The sensitive-content search is over `JSON.stringify` of the whole result, not over a named field.

#### 4. The source guard

**File**: `tests/unit/invite-source.test.ts` (new, `unit` project)

**Intent**: Stop the page from re-acquiring the decision the function now owns. Mirrors `tests/unit/period-detail-source.test.ts`, including its honest header: this is a source check, not an output check, and it is here because the project has no page renderer by choice.

**Contract**: Reads `src/pages/invite/[token].astro`, splits on the frontmatter fence, and asserts: the frontmatter calls the composition function; below the fence there is no reference to `details` (the template must read only composed values). Name the reason in the test title, not only in a comment.

**Narrowed during implementation, 2026-09-11.** The blanket "no reference to `details` below the fence" cannot hold together with change #2's boundary: the template also reads `details.name` for the "Zapisano, X!" banner and `details !== null` for the island's `hasCapability` prop, and moving those into the lib is the restructuring change #2 and §What We're NOT Doing both forbid. The guard therefore bans the INSTRUCTION and NOTE readings specifically — `details.pets`, `details?.pets`, `sensitiveByPet`, `caretaker_note`, `pet.instructions` — in the template, and the same readings plus `new Map(` in the comment-stripped frontmatter, where the realistic bypass (an alias assigned above the fence and rendered below) would otherwise slip through every template-only assertion. Both halves of the file are comment-stripped before asserting, and the "guards the guard" case asserts the call SHAPE rather than the bare identifier, which the import line and the frontmatter's own rationale comment would otherwise satisfy forever.

### Success Criteria:

#### Automated Verification:

- Unit project passes: `npx vitest run --project unit`
- Full suite passes: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Mutation check: rebuild the sensitive map from the public payload instead of `details`; the composition test fails on the whole-result search. Restore. Confirm the mutation actually applied (prettier reformatting has silently produced a no-op mutation in this repo before).
- Mutation check: reintroduce a `details?.caretaker_note` reference in the template; the source guard fails.
- `/invite/<token>` in the browser is unchanged before and after a claim — public rows, the amber "Tylko dla opiekuna" callout and the note appear exactly as they did.

**Implementation Note**: After this phase's automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Releasing a term and the caretaker's reveal (Risk #5)

### Overview

Pin both halves of the documented consequence: freeing a capability's **last** term collapses its reveal to `null`; freeing **one of two** leaves the reveal alive, minus that term.

### Changes Required:

#### 1. The paired test

**File**: `tests/rls/release-reveal.test.ts` (new, `integration` project)

**Intent**: These two sentences are stated as fact in `release_slot.sql:16-22`, `docs/reference/data-access.md` and PRD §Open Questions #5 — and the S-06 correction rests on them — while no test calls `get_claimed_details` after a release. Pin them so a change in either direction fails rather than silently re-inverting the argument a second time.

**Contract**: Owner + anon caretaker in one file. Half A: one claimed term → full reveal payload present → owner releases via `release_slot` → the same `(token, secret)` answers `null` (not `{revoked: true}` — the trip is live). Half B: two claimed terms → release one → reveal still answers content, its `slots` no longer carry the freed term, and the note and sensitive rows survive. Assert the released row's three columns are nulled from the owner side, as `tests/rls/release-slot.test.ts:179-181` does, so the two halves are anchored to the same write.

### Success Criteria:

#### Automated Verification:

- New file passes: `npx vitest run --project integration tests/rls/release-reveal.test.ts`
- Full suite passes: `npm test`
- Lint passes: `npm run lint`

#### Manual Verification:

- Mutation check: remove `claim_digest` from `release_slot`'s SET list in a scratch migration; Half A fails (the reveal survives a release it should not). Restore and `npm run db:reset`.
- The two halves are genuinely independent — commenting out either does not affect the other.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: A valid token opens nothing on the owner side (Risk #5)

### Overview

Prove Risk #5 in its own words — "the link-only path grants more than its scope" — by presenting a **real, live invite token** to every owner-only endpoint, instead of proving the adjacent claim that a request with no session is refused.

### Changes Required:

#### 1. The scope table

**File**: `tests/api/token-scope.test.ts` (new, `integration` project)

**Intent**: Today the owner routes are proven closed only at the grant layer, by Postgres role; the routes themselves read `locals.user`, so a middleware or handler mistake would bypass that proof entirely. A table-driven test makes each new owner endpoint fall under the same guard the day it is added.

**Contract**: Seed one owner, one period, one live token. `it.each` over five entry points — `POST /api/periods/[id]/revoke`, `POST /api/periods/[id]/slots/[slotId]/release`, `POST /api/periods/[id]/token`, `POST /api/periods`, `POST /api/pets` — each driven three ways: token in the JSON body, token in a cookie, token as a path segment. Every call answers 401 and writes nothing (read the affected rows back through the owner's client). Handlers are imported directly with `locals.user = null`, matching the existing `tests/api/` pattern.

#### 2. The missing 401

**File**: `tests/api/pets.post.test.ts`

**Intent**: `src/pages/api/pets.ts:11` guards on `locals.user` and no test exercises it — the file always supplies a user. Close it here rather than leaving the only untested owner guard in the repo.

**Contract**: One case with `locals.user = null` → 401, and no `pets` row written.

### Success Criteria:

#### Automated Verification:

- New file passes: `npx vitest run --project integration tests/api/token-scope.test.ts`
- Full suite passes: `npm test`
- Lint passes: `npm run lint`

#### Manual Verification:

- Mutation check: delete the `locals.user` guard from one route; the matching `it.each` rows fail (all three token placements for that route).
- The token used is genuinely live — it resolves through `get_period_by_token` inside the same test, so the case cannot pass because the token was dead.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Contention at the HTTP layer, and the rest of Risk #3

### Overview

Move the one-winner assertion up to the route, where the 409 and deadlock mapping the user actually sees lives, and pin the constraint the freeness predicate depends on.

### Changes Required:

#### 1. Concurrent claims through the real handler

**File**: `tests/api/invite-claim.test.ts`

**Intent**: Every claim in this file is sequential, so nothing proves that two simultaneous requests produce one winner, nor that the losing path maps to a readable Polish 409. Both live in TypeScript and are unreachable from the RPC-level race.

**Contract**: A `describe("concurrency")` block issuing parallel `call()`s inside one `it()` (Vitest serializes tests within a file, so contention must be built with `Promise.all`). Two callers on one slot → exactly one 200 and one 409; the 409 names the term; exactly one row is claimed and its digest belongs to the winner; the loser receives no capability cookie — `tests/api/invite-claim.test.ts:350` already pins "no cookie on any refusal" sequentially, and this is the concurrent case. State the same honest limit the RPC file states: this is an outcome check, not a proof the row lock engaged.

#### 2. Overlapping multi-slot selections

**File**: `tests/rls/claim-slots.test.ts`

**Intent**: The only race today is a single contested slot. Overlapping sets are the scenario that actually produces the deadlock the route maps at `src/pages/invite/claim.ts:120-122` — a branch no test reaches.

**Contract**: Two capabilities claim overlapping slot sets in parallel. The assertion admits every permitted outcome — one all-or-nothing winner and one refusal, whether the refusal arrives as `PT409` or as a deadlock — and pins the invariant that matters in all of them: no slot carries a partial claim, and the loser wrote nothing. Add an HTTP-layer counterpart in `tests/api/invite-claim.test.ts` asserting the loser's status is 409 either way, so the `40P01` mapping is exercised rather than assumed.

**CORRECTED 2026-09-11 (phase-4 review).** The last clause was false and the tests written from it carried the false claim in their comments. `claim_slots` allocates with a single UPDATE that has no `ORDER BY`, so both racing sessions run identical SQL, get the same plan, and take row locks in the SAME order — a consistent global lock order makes deadlock impossible, not merely unlikely. Overlapping selections therefore always refuse with `PT409`, which is why ten runs at each layer never saw anything else. What they genuinely exercise is the multi-row all-or-nothing rollback. The `40P01` → 409 mapping is unreachable through the database and is now covered deterministically by injecting the error into a mocked client: `tests/unit/claim-error-mapping.test.ts`, which also covers `PT400`, the uniform 404 and the 500 fallthrough. The assertion that admitted `40P01` as a permitted refusal was tightened to `toBe("PT409")` — admitting it was strictly weaker and would have masked a regression that started producing deadlocks.

#### 3. The constraint the predicate rests on

**File**: `tests/rls/care-slots.isolation.test.ts` (or a sibling under `tests/rls/`)

**Intent**: `care_slots_claim_complete` is what makes `claimed_by_name is null` a truthful freeness test — the atomicity argument depends on it — and no test attempts a half-written row. `claim-slots.test.ts:353-361` would still pass with the constraint dropped.

**Contract**: Through the owner's own client (which holds `care_slots_update_own`), attempt each half-written combination — name without `claimed_at`, name without `claim_digest`, digest without name — and assert the write is refused with a constraint error, naming `care_slots_claim_complete`. Not an empty result: a refusal.

### Success Criteria:

#### Automated Verification:

- Claim suites pass: `npx vitest run --project integration tests/api/invite-claim.test.ts tests/rls/claim-slots.test.ts`
- Full suite passes: `npm test`
- Suite is not flaky: `npm test` three consecutive times, all green
- Lint passes: `npm run lint`

#### Manual Verification:

- Mutation check: drop `and s.claimed_by_name is null` from the UPDATE's WHERE in a scratch migration; the HTTP concurrency case fails with two winners. Restore and `npm run db:reset`.
- Mutation check: drop `care_slots_claim_complete`; the constraint cases fail.
- The overlapping-selection case is run ~10 times by hand and never fails for a reason other than a real defect — if it cannot be made stable, it is deleted rather than retried, and the reason is recorded in §7.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Uniform failure, the mint island, and closing the documents

### Overview

Spread the `{status, body}` uniformity pattern to the two endpoints that only check a status, pin the last unpinned island's request shape, and write down what this phase deliberately left alone.

### Changes Required:

#### 1. Uniform 404s on the owner routes

**File**: `tests/api/release-slot.test.ts`, `tests/api/periods.post.test.ts`

**Intent**: `tests/api/revoke-period.test.ts:238` compares whole `{status, body}` objects across its three misses; release checks four 404 statuses without comparing bodies, and the token mint checks one. Uniformity is named a security property in §2/§4 and is currently defended on one endpoint of three.

**Contract**: Release — all four misses (another owner's claimed slot, non-existent slot, already-free term, slot from another period of the same owner) compared with `toEqual` against one another. Mint — unknown, not-yours and revoked period compared the same way. Copy the existing pattern; do not invent a second idiom.

#### 2. Uniform failure on the caretaker page

**File**: `tests/unit/invite-view.test.ts`

**Intent**: The resolver's uniformity is asserted field by field. The caretaker's 404 is the one an unauthenticated stranger can probe, so it is the one that would actually be used as an oracle.

**Contract**: Compare the resolver's whole return object with `toEqual` across unknown, tampered, malformed and revoked-without-proof inputs, rather than comparing `status` and `title` separately. Keep the one permitted exception explicit: a proven claim-holder on a revoked trip differs in `kind` only.

#### 3. The mint island's request shape

**File**: `tests/component/regenerate-link-button.test.tsx` (new, `component` project)

**Intent**: `src/pages/api/periods/[id]/token.ts` carries no Origin check, so the island's no-Content-Type request shape is its only CSRF defence — pinned for the other two buttons and not for this one.

**Contract**: Two cases, on the model of `revoke-period-button.test.tsx:198`: the POST goes to `/api/periods/<id>/token` with no `Content-Type` header and no body; and no request is issued at all when the trip is revoked. Nothing about arming, focus or error copy.

#### 4. Record what stays untested

**File**: `context/foundation/test-plan.md`

**Intent**: The claim × release and claim × revoke races, and the absence of a row-lock proof, are decisions made in this plan. Written down they are decisions; unwritten they read as oversights — the failure mode `lessons.md` records for prose that states a system's posture.

**Two corrections this change owes §7, both measured during implementation and agreed with the user — they are commitments, not options.**

1. **The caretaker page was never the secrecy boundary (Phase 1).** `get_period_by_token` returns public instruction rows only, so before a claim the page is never handed a sensitive row or the trip note — there is nothing to withhold. Secrecy is enforced by the two SECURITY DEFINER doors plus `splitRevealAnswer`. What Phase 1 pins is everything downstream: tier separation, id-keyed matching, no dropped or conjured pet, the note travelling only with the reveal. §7 must use that narrower wording, not "leaks a house key".

2. **What defends the owner routes depends on whether a session cookie rides along, and §7 must say both halves (Phase 3).** This plan asserted that a handler mistake "bypasses the grant proof entirely, and nothing would fail". The first correction recorded here over-corrected it; the measured answer is two-sided, and the phase-3 review caught the second half.
   - **No session cookie at all** — the link-only caller Risk #5 is about. Deleting `if (!context.locals.user)` does NOT yield 200/201: the client is anon-keyed and anon holds no EXECUTE on `revoke_period`, `release_slot`, `regenerate_period_token` or `create_pet_with_instructions`, so the write dies at the database with SQLSTATE 42501. The grant layer is a real second fence, and `tests/api/token-scope.test.ts` pins the ANSWER — a clean 401 rather than a 500 carrying a database error.
   - **Session cookie present, `locals.user` absent** — the shape a middleware mistake actually produces. The client is `authenticated`, the grant layer lets it straight through, and the route guard is the ONLY fence. Measured: delete the guard from `pets.ts` and the request answers **201 with a real row**. Pinned by `tests/api/revoke-period.test.ts:130` and by the second case in `tests/api/pets.post.test.ts`.

   §7 records both, because either half alone misleads: the first makes the route check look redundant, the second makes the grant layer look absent.

**Contract**: §7 gains entries for: the claim × release lost-update window (owner's stale tab, PRD §Open Questions #3, re-evaluate if co-owners or realtime arrive); the claim × revoke race (both endings permitted, so a test would assert consistency rather than protection); and the row-lock mechanism (outcome-tested only — a deterministic proof needs two held transactions and therefore a `pg` client this repo does not carry). §6.6 gains a note for this phase. §3's Phase 4 row moves to `complete` with this change folder. Every sentence written in the present tense is read against the code at the moment of writing.

#### 5. Close the change

**File**: `context/changes/testing-domain-guardrails/change.md`, `context/foundation/roadmap.md`

**Intent**: Keep the record honest. `Outcome`-style prose is copied verbatim into historical sections by later tooling, so it must describe what landed, not what was intended.

**Contract**: `change.md` status → `complete`, `updated` stamped. The roadmap needs no new slice — this is a test-rollout phase, not a product slice — but any sentence there claiming domain-guardrail coverage is checked against what this change actually shipped.

### Success Criteria:

#### Automated Verification:

- Component project passes: `npx vitest run --project component`
- Full suite passes: `npm test`
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Mutation check: make one release miss return a different message; the `toEqual` comparison fails.
- Mutation check: add a `Content-Type` header in `RegenerateLinkButton`; the new component test fails.
- §7 and §6.6 are read back against the code that shipped — every present-tense claim is verified, not inherited from this plan.

**Implementation Note**: This is the closing phase; confirm the whole suite and the documents together before archiving.

---

## Testing Strategy

### Unit Tests (`unit` project — no Docker):

- Instruction composition: pre-claim hides every sensitive row and the note, asserted over the whole serialized result; post-claim exposes exactly the sensitive rows; id-keyed matching survives divergent ordering.
- Source guards on `[token].astro`.
- Resolver uniformity compared as whole objects.

### Integration Tests (`integration` project — local Supabase):

- Release × reveal, both halves.
- Token → owner endpoints, three placements × five routes.
- Concurrent claims at the HTTP handler; overlapping multi-slot selections at the RPC.
- `care_slots_claim_complete` refuses every half-written row.
- Uniform 404 bodies on release and mint.

### Component Tests (`component` project — happy-dom):

- `RegenerateLinkButton` request shape and the revoked refusal.

### Manual Testing Steps:

1. Kill `npm run dev` before any build, check or commit.
2. Per phase, run the named mutation, confirm the named test fails, confirm the mutation actually applied (diff it — prettier has produced a silent no-op mutation here before), restore, `npm run db:reset` where a migration was touched.
3. Open `/invite/<token>` before and after a claim and confirm Phase 1 changed nothing visible.
4. Run `npm test` three times after Phase 4 and watch for flakiness in the overlapping case.

## Performance Considerations

The integration project carries a 20s test timeout and each `createOwnerClient()` signs up a real user. Phase 3's `it.each` is 15 handler calls against one seeded owner — reuse the seed across rows rather than re-seeding per row. Phase 4's contention cases must stay inside single `it()` blocks, which also keeps their cost bounded.

## Migration Notes

None. No migration ships in this change; scratch migrations used for mutation checks are reverted and followed by `npm run db:reset`.

## References

- Test plan: `context/foundation/test-plan.md` §2 (Risks #3/#4/#5), §3 Phase 4, §6, §7
- Access model: `docs/reference/data-access.md` — the token model's four rules and both deliberate widenings
- PRD: §NFR (atomic claim), FR-008, FR-012, §Open Questions #3 and #5
- Recurring rules: `context/foundation/lessons.md`
- Pattern to copy: `tests/unit/period-detail-source.test.ts`, `tests/api/revoke-period.test.ts:238`, `tests/rls/claim-slots.test.ts:499-547`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The caretaker page's instruction gate (Risk #4)

#### Automated

- [x] 1.1 Unit project passes: `npx vitest run --project unit` — 877f970
- [x] 1.2 Full suite passes: `npm test` — 877f970
- [x] 1.3 Type check passes: `npx astro check` — 877f970
- [x] 1.4 Lint passes: `npm run lint` — 877f970
- [x] 1.5 Build passes: `npm run build` — 877f970

#### Manual

- [x] 1.6 Mutation check: sensitive map rebuilt from the public payload fails the composition test — 877f970
- [x] 1.7 Mutation check: a `details?.caretaker_note` reference in the template fails the source guard — 877f970
- [x] 1.8 `/invite/<token>` renders identically before and after a claim — 877f970

### Phase 2: Releasing a term and the caretaker's reveal (Risk #5)

#### Automated

- [x] 2.1 New file passes: `npx vitest run --project integration tests/rls/release-reveal.test.ts` — 0649961
- [x] 2.2 Full suite passes: `npm test` — 0649961
- [x] 2.3 Lint passes: `npm run lint` — 0649961

#### Manual

- [x] 2.4 Mutation check: dropping `claim_digest` from `release_slot`'s SET list fails Half A — 0649961
- [x] 2.5 The two halves are independent — commenting out either leaves the other passing — 0649961

### Phase 3: A valid token opens nothing on the owner side (Risk #5)

#### Automated

- [x] 3.1 New file passes: `npx vitest run --project integration tests/api/token-scope.test.ts` — 91d5f78
- [x] 3.2 Full suite passes: `npm test` — 91d5f78
- [x] 3.3 Lint passes: `npm run lint` — 91d5f78

#### Manual

- [x] 3.4 Mutation check: removing one route's `locals.user` guard fails all three token placements — 91d5f78
- [x] 3.5 The token is verified live inside the test, so no row can pass for the wrong reason — 91d5f78

### Phase 4: Contention at the HTTP layer, and the rest of Risk #3

#### Automated

- [x] 4.1 Claim suites pass: `npx vitest run --project integration tests/api/invite-claim.test.ts tests/rls/claim-slots.test.ts` — 71fdf87
- [x] 4.2 Full suite passes: `npm test` — 71fdf87
- [x] 4.3 Suite is not flaky: three consecutive `npm test` runs green — 71fdf87
- [x] 4.4 Lint passes: `npm run lint` — 71fdf87

#### Manual

- [x] 4.5 Mutation check: dropping `and s.claimed_by_name is null` produces two winners and fails the HTTP case — 71fdf87
- [x] 4.6 Mutation check: dropping `care_slots_claim_complete` fails the constraint cases — 71fdf87
- [x] 4.7 Overlapping-selection case run ~10 times by hand without spurious failure — 71fdf87

### Phase 5: Uniform failure, the mint island, and closing the documents

#### Automated

- [x] 5.1 Component project passes: `npx vitest run --project component`
- [x] 5.2 Full suite passes: `npm test`
- [x] 5.3 Type check passes: `npx astro check`
- [x] 5.4 Lint passes: `npm run lint`
- [x] 5.5 Build passes: `npm run build`

#### Manual

- [x] 5.6 Mutation check: a differing release miss message fails the `toEqual` comparison
- [x] 5.7 Mutation check: adding a `Content-Type` header in `RegenerateLinkButton` fails its test
- [x] 5.8 §7 and §6.6 read back against the shipped code, every present-tense claim verified
