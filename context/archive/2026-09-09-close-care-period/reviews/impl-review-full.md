<!-- IMPL-REVIEW-REPORT -->

# Full-Plan Review: Close / cancel a care period (FR-012, S-06)

- **Plan**: `context/changes/close-care-period/plan.md`
- **Scope**: all four phases, 9 commits (`a3454a6..8c05a7d`), 34 files, +4129/−97
- **Date**: 2026-09-11
- **Verdict**: NEEDS ATTENTION → all critical and warning findings fixed in-session
- **Findings**: 1 critical, 7 warnings, 11 observations

## Why this review found things the three per-phase reviews could not

Each per-phase review checked a phase against its contract **at that phase's commit**. This one
asked the two questions that structurally require the whole slice: does the FINAL state still
satisfy each phase's contract, and which statements became false one or more phases after they
were written. Both classes were already documented in this slice three times over — and both
recurred.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## What was verified clean, end to end

- **The core security property holds across the finished feature.** No caller can learn whether a
  period exists without proving a claim on it. Checked across all four surfaces (three anon SQL
  doors, the caretaker page, the claim POST, the owner's revoke route) for a nonexistent, a live
  and a revoked period, comparing status, body, page title, headers, response size, round-trip
  count and work performed inside the database.
- **The Phase 2 equalisation is present and does what it claims.** Both hashes and both lookups
  run before either gate; `found` is captured per-statement so neither capture is clobbered.
- **The other two anon doors still filter**, confirmed from each one's _current_ definition
  (`get_period_by_token` last redefined in `20260907180022`, `claim_slots` in `20260907171514`
  — which drops the prior version first, so its grants were correctly re-established).
- **The owner route's 403 discloses nothing**: decided from the `Origin` header before the client
  is built, before id validation, before the RPC — its outcome is independent of the row.
- **Zero scope creep.** All seven "What We're NOT Doing" items genuinely absent from the FINAL
  tree, not merely from each phase's own diff. `grep -rn "revoked_at" src/` returns only reads,
  prop plumbing and generated types — **no write anywhere**. `RegenerateLinkButton` still has
  three state hooks, no `armed`, no refs: no confirmation was added to link regeneration.
- **Migration replayability**: no forward dependencies; both `create or replace` calls preserve
  parameter names and volatility (a rename would raise 42P13 and fail the reset); no migration
  re-issues a contradicting grant.
- **Final catalog state matches the documentation**, read live: three anon doors
  `secdef=true`, granted to `anon`+`authenticated`, revoked from `service_role`; two owner-side
  writes `secdef=false`, `anon=false`; volatility `s`/`s`/`v` as rule 2 claims.

## Findings

### F1 — The bulk-release justification was inverted, in four places

- **Severity**: ❌ CRITICAL · **Impact**: 🔎 MEDIUM · **Dimension**: Plan Adherence
- **Location**: `docs/reference/data-access.md`, `context/foundation/prd.md` (Open Question 5),
  `context/foundation/roadmap.md` (Unknowns item 4), `context/changes/close-care-period/plan.md`
  (the source copy)
- **Detail**: All four said the caretaker's 404 comes from `revoked_at` killing token resolution
  **before** `claim_digest` is read, so a bulk release would change nothing the caretaker sees.
  That was true of the function as it stood when the plan was written. Phase 2 inverted **both**
  halves: the digest is now read first, and `release_slot` nulls `claim_digest`, so releasing a
  holder's terms makes them fail the claim gate.
- **Measured**, seeding a revoked period with a genuine claim and calling the reveal door before
  and after a release:

  ```
  A_holder_on_revoked   = {"revoked": true}
  B_after_bulk_release  = NULL
  ```

  Bulk release therefore changes exactly what the caretaker sees — and changes it for the
  **worse**, replacing "the trip was called off" with a stranger's dead link.

- **Why it is critical**: this sentence is the recorded reason for a product decision the owner
  made, and for two Open Questions a future reader would reason from. The decision itself is
  _better_ founded than the note claimed; the premise is backwards.
- **Aggravating**: `data-access.md` spells out the correct ordering **61 lines above** in the same
  numbered rule — and the Phase 4 commit rewrote those very lines while adding the contradicting
  paragraph in the same hunk.
- **Decision**: FIXED in all four, each as a dated correction rather than a silent rewrite.

### F2 — The slice's own security fix had zero assertions

- **Severity**: ⚠️ WARNING · **Impact**: 🔬 HIGH · **Dimension**: Safety & Quality
- **Detail**: The Phase 2 work-equalisation — the fix for a timing oracle with a documented
  attack scenario — was guarded by nothing. **Measured**: the equalisation was reverted in the
  live catalog (gates back beside their lookups, claim hash after the first gate, no `coalesce`)
  and the whole suite stayed green at **305/305**. Behaviour is identical; only work differs, and
  no test observes work.
- **Fix (applied, owner's decision)**: `tests/unit/claimed-details-ordering.test.ts` — five
  structural assertions over the newest migration that defines the reveal door, read with SQL
  comments stripped and bounded to the function body.
- **Why structural and not a counter**: the obvious test reads `idx_scan` around one
  unknown-token call and asserts it rose. That would be **worse than none** — vitest runs test
  files in parallel, so "rose by at least one" is satisfied by any other file's activity and
  would pass while the probe does not run. A direct Postgres connection would allow an honest
  measurement, but the repo has no pg client and adding one for a single test is the very
  infrastructure the counter option was meant to avoid. Reading the newest defining migration
  (rather than a hardcoded filename) is what makes the guard survive a future revert.
- **Measured to bite**: reverting the equalisation in the migration file fails **4 of its 5**
  assertions.
- **Decision**: FIXED

### F3 — "closes all three anon doors" survived as the fifth copy, and the migration written to retire it claimed otherwise

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality (documentation)
- **Detail**: `contract-surfaces.md`'s `revoke_period` row still carried both the "all three
  doors" claim and the un-hedged "no notification" that Phase 2's F7 corrected elsewhere. Worse,
  `20260911100000` — a migration whose only purpose is retiring that sentence — asserted in its
  header that the correction "was made in `data-access.md` **and in the contract-surfaces
  registry**". It was made in one registry row, not this one. Five copies, three fixed.
- **Decision**: FIXED — the row now matches the refreshed catalog comment, and the migration's
  own false completeness claim is corrected in place with a dated note.

### F4 — The registry overclaimed the equalisation as equal work

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality (documentation)
- **Detail**: `contract-surfaces.md` stated flatly that "a revoked period costs the same work as
  an unknown one". The migration header is explicitly careful **not** to say that ("It does not
  make the function constant-time"), and `data-access.md` repeats the hedge. The registry — the
  document later slices treat as ground truth — is the one place it was dropped.
- **Decision**: FIXED — now "the same work as a live one, and no more than an unknown one did
  before S-06 … **not constant-time**".

### F5 — `Status` corrected in one of three places

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence
- **Detail**: Phase 4 set the S-06 detail entry to `done` but left the roadmap's summary table at
  `ready` and its Backlog Handoff row at `yes` / "Ready for /10x-plan". The roadmap said S-06 was
  simultaneously done and awaiting planning. Same three-places-one-fixed shape as F3.
- **Decision**: FIXED

### F6 — The `Outcome` field overstated, and it becomes history verbatim

- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Plan Adherence
- **Detail**: `/10x-archive` copies `Outcome` into `## Done`, where it stops being a forecast.
  It said "nieodwracalnym" unqualified — irreversible against every product path, but a direct
  owner UPDATE clears the column, which the migration and the registry both state plainly.
  Phase 1's F7 recorded the instruction "police that no later slice cites the registry row as
  enforcement"; an unqualified "nieodwracalne" in the permanent record is the shortest route
  there. It also said a caretaker who claimed "dowiaduje się" without the condition that their
  capability still holds.
- **Decision**: FIXED — both qualified, and the `Unknowns` field's matching "wymuszone"
  (enforced) softened to "decyzja produktowa, nie ograniczenie".

### F7 — No test connected `revoke_period` to the caretaker-visible answer

- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Safety & Quality
- **Detail**: Both halves were covered and never joined: every test of the caretaker-facing
  answer sets `revoked_at` by a **direct owner UPDATE**. Nothing proved that the function this
  slice shipped is what produces the one bit the slice exists for. Meanwhile a comment in
  `tests/rls/revoke-period.test.ts` asserted that one `get_period_by_token` check covers the
  whole feature — false since Phase 2, and missed by the Phase 4 staleness sweep.
- **Decision**: FIXED — a new case revokes through the function and observes the reveal door
  (full payload before, `["revoked"]` after, plain NULL for a non-holder), and the false comment
  is corrected.

## Observations, all fixed

- **`revokedAtOf` replicated Phase 1's PENDING F3 vacuity** into a file written two phases later:
  `not.toBeNull()` accepts `undefined`, and the helper returned `undefined` on a missing row. Both
  helpers now throw on absence.
- **One unfailable line survived inside Phase 2's F3 fix** — a `not.toContain` standing behind an
  exact key-set equality on the same value. Removed.
- **"the all-zero uuid is not a generatable primary key" is false**: `care_periods` grants INSERT
  to `authenticated` with no column list, so an owner can plant that id. It changes nothing (the
  period gate returns first), but it asserted what the catalog permits without reading it, in the
  file whose header argues for reading it. Reworded.
- **`release_slot` on a revoked period withdraws the one-bit answer**, and nothing said so. Now
  recorded in the registry's blast-radius warning.
- **Five stale line references**, two created by Phase 4's own edits — the `+2`-line FR-012 note
  shifted two `prd.md` citations, one of them inside the very commit that wrote it. All converted
  to by-name references, the fix Phase 3 already adopted for this class.
- **The Desired End State's "byte for byte" clause was false as written** — Phase 2 change 4
  _required_ rewriting that card. Restated as indistinguishability between a revoked link and a
  typo, which is the property actually shipped.
- **Phase 1's migration header** still asserts the identical-predicate world while hedging Phase 2
  correctly fifteen lines below. Left standing as history with a dated note, since an applied
  migration should not be rewritten.
- **The migration count "16"** dropped rather than corrected; it would keep rotting.

## Left open, deliberately

- **Keyboard residual**: focus lands on the destructive confirm, so Enter key-repeat can still
  arm-then-confirm. Phase 3's geometry fix closes the pointer case only.
- **No `.astro` render harness**: the two cards' copy and the cookie shape gate rest on manual
  verification. Recorded since Phase 2's F6.
- **Sibling routes** `token.ts` and `release.ts` still rely on Astro's origin default alone;
  `revoke.ts` now owns an explicit check.
- **The `mounted` focus guard** is untested in both islands.
- **`src/lib/schemas/claim.ts`** holds a third inline copy of the capability regex, for the token;
  now stated in the registry rather than left implicit.

## Verification after fixes

Clean database, everything re-run with exit codes read from the tools: `db:reset` exit 0 ·
**311/311** across 30 files (was 305/29; +5 structural, +1 join) · `astro check` 0 errors
0 warnings · `lint` exit 0, 0 errors · `build` exit 0.
