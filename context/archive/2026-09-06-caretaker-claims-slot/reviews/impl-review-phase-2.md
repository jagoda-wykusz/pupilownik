<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Caretaker Claims Slot

- **Plan**: `context/changes/caretaker-claims-slot/plan.md`
- **Scope**: Phase 2 of 5
- **Date**: 2026-09-07
- **Commits reviewed**: `a02cb1f` (phase 2)
- **Verdict**: NEEDS ATTENTION → all 10 findings triaged and resolved 2026-09-07
- **Findings**: 0 critical, 4 warnings, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | PASS    |
| Success Criteria    | FAIL    |

## Automated criteria, re-verified from scratch

| Criterion                  | Result                                         |
| -------------------------- | ---------------------------------------------- |
| 2.1 `claim-slots` suite    | PASS — 11/11                                   |
| 2.2 full integration suite | PASS — 90/90, 13 files                         |
| 2.3 `npm run build`        | PASS                                           |
| 2.3 `npm run lint`         | **FAIL on first honest check — 3 errors (F2)** |

## Manual criteria

2.4–2.7 confirmed by the user. 2.4 and 2.5 were read from the catalog
(`has_function_privilege`, `pg_proc.provolatile` = `v`, exactly one overload); 2.6 was
reproduced in psql; 2.7 held across five consecutive runs, and a falsification pass
(removing `claimed_by_name is null` from the UPDATE) made it fail with six winners instead of
one, so the test is a check of the guarantee rather than a description of it.

## Ruled out (checked, not findings)

- The conflict-naming `select` sits **inside** the `if v_claimed <> v_requested` branch — the
  plan's highest-risk instruction ("do not invert that order") was honoured.
- No dynamic SQL, no `format()`, no `EXECUTE`. `search_path = ''` pinned, every function call
  `pg_catalog.`-qualified.
- Grant posture matches the sibling recipe byte-for-byte in shape; single overload.
- Revoked and unknown tokens are indistinguishable (both NULL) — rule 4's security half holds.
- `get_claimed_details` is marked as unbuilt in both reference documents. This is the exact
  regression `lessons.md` records for 2026-09-07 and it did not recur.
- Scope is clean: no `pg` devDependency, no caretaker name exposed to another caretaker (the
  PT409 DETAIL carries only `{slot_date, time_of_day}`), no occupancy view.

## Findings

### F1 — The capability credential is presented in the same form it is stored

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture / Safety & Quality
- **Location**: `supabase/migrations/20260907154125_claim_slots.sql:46,106,142,176`
- **Detail**: `claim_slots` takes `p_claim_digest` and compares it verbatim against the stored
  `care_slots.claim_digest`; one step earlier the same body takes the RAW token and hashes it
  inside. For the token the stored value cannot be replayed; for the capability the stored
  value IS the proof of identity. This is what the **plan** specified, so the finding is
  against the plan. It matters now because the plan's Phase 3 contract is
  `get_claimed_details(p_token text, p_claim_secret text)` — raw secret, hashed inside — so the
  two capability surfaces would use opposite conventions and Phase 4's route would hash for one
  and pass raw to the other. Exposure today is bounded: the digest never reaches a browser, and
  the only reader is the owner (verified from the catalog: `authenticated` holds SELECT+UPDATE
  on `care_slots` under `care_slots_select_own` / `care_slots_update_own`) inside their own
  trip, where they already hold full UPDATE. No privilege escalation exists today. What is
  real: the stored column is a live bearer credential, so any future disclosure is immediately
  replayable, and Phase 1's migration comment ("the raw secret is never stored, exactly as the
  raw invite token is never stored — rule 1, applied twice") describes a property the design
  does not have.
- **Fix A ⭐ Recommended**: Change the parameter to `p_claim_secret text`, bound it to 43 chars
  as `p_token` is, and hash it inside the function.
  - Strength: Restores symmetry with the read door and with Phase 3's already-specified
    contract; makes the column non-replayable and moves entropy server-side. Nothing consumes
    `claim_slots` yet, so the cost is one migration and one test edit.
  - Tradeoff: A second migration on a function one commit old.
  - Confidence: HIGH — the hashing expression already exists three lines above.
  - Blind spot: Whether S-04's occupancy view wants to match a capability without its secret.
- **Fix B**: Keep the digest-in contract, record the exposure in `data-access.md` rule 1 and
  correct the Phase 1 migration comment.
  - Strength: No schema churn; the route saves a hash round-trip.
  - Tradeoff: Leaves the convention split for Phase 3 to absorb.
  - Confidence: MEDIUM — workable, but every later reader must re-derive why they disagree.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — 20260907171514_claim_secret_not_digest.sql; parameter is now `p_claim_secret`, bounded at 43 and hashed inside. Grant posture and single overload re-verified from the catalog. Recorded as plan addendum A14.

### F2 — `npm run lint` was failing while Progress row 2.3 was ticked

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `plan.md` Progress 2.3; commit `a02cb1f` body
- **Detail**: `npm run lint 2>&1 | tail -20` reports `tail`'s exit code, not eslint's. The
  pipeline looked successful, "lint 0 errors" was reported at the phase gate and in the commit
  body, and 2.3 received `[x]` plus a SHA on that basis. Three real errors were present, all in
  files this phase added: `tests/rls/claim-slots.test.ts:44` (`bToken` assigned but never used),
  `tests/rls/claim-slots.test.ts:82` (unnecessary type assertion),
  `tests/unit/invite-token.test.ts:2` (prettier import formatting).
- **Fix**: Already applied in the working tree, uncommitted. Lint now exits 0 with only the 3
  pre-existing `no-console` warnings; 155/155 tests and build pass. Needs a follow-up commit.
- **Decision**: FIXED + ACCEPTED-AS-RULE: "Nie czytaj kodu wyjścia z potoku" (context/foundation/lessons.md). Three lint errors fixed; recorded as plan addendum A15.

### F3 — The "nothing leaked about B" assertion cannot fail

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `tests/rls/claim-slots.test.ts:194`
- **Detail**: `expect(error?.details ?? "").not.toContain(bSlotId)`. The DETAIL payload is built
  from `jsonb_build_object('slot_date', …, 'time_of_day', …)` and never carries a slot id, so
  the assertion passes unconditionally — and would keep passing if the conflicts query lost its
  `s.period_id = v_period.id` scope and started dumping another period's rows into DETAIL. The
  anti-pattern `lessons.md` records, in a file whose own header cites that lesson.
- **Fix**: `expect(JSON.parse(error?.details ?? "[]")).toEqual([])` — fails the moment
  cross-period rows reach DETAIL.
- **Decision**: FIXED — assertion replaced with `JSON.parse(error?.details ?? "null")).toEqual([])`, which also fails when DETAIL is absent entirely.

### F4 — The claim is not retry-safe

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `supabase/migrations/20260907154125_claim_slots.sql:173-215`
- **Detail**: The freeness guard has no exemption for the caller's own digest, so re-submitting
  a slot you already hold raises PT409 and lists your own slot as the conflict. Addendum A10
  justified this with "Phase 4's UI makes taken slots unselectable", which answers the wrong
  scenario. The case that bites is a RETRY: the POST succeeds, the response is lost, the client
  resends the identical set, and the caretaker is told the slot they just claimed is taken.
- **Fix**: Count already-mine rows as satisfied (`v_claimed + v_already <> v_requested`) and
  exclude `claim_digest = p_claim_digest` from the conflicts query. The single-statement write
  stays intact — the extra read is either on the already-doomed path or a cheap pre-count over
  rows only this capability writes.
- **Decision**: FIXED — folded into the F1 migration rather than a third one on the same function. Already-held rows count as satisfied, counted after the update and inside the shortfall branch; receipt gained `already_held_count`. Two tests added (retry-safe, mixed request still refuses). Recorded as plan addendum A13.

### F5 — "`claim_slots` is its only writer" is false, and two sentences went stale

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (documents)
- **Location**: `docs/reference/contract-surfaces.md` (claim-columns row, `get_period_by_token`
  row); `docs/reference/data-access.md` rule 3
- **Detail**: Verified from the catalog: `authenticated` holds UPDATE on `care_slots` and
  `care_slots_update_own` lets the owner write the claim columns directly, so the bolded "only
  writer" sentence contradicts the "A direct owner UPDATE can still break it" sentence in the
  same paragraph. Two more left behind by the same edit: rule 3 still says the function "reads
  those tables", and the `get_period_by_token` row still says "Future caretaker capabilities
  extend THIS function" — the point rule 2 was corrected on.
- **Fix**: "only _intended_ writer"; rule 3 → "reads and writes"; drop the
  extend-this-function sentence from the registry row.
- **Decision**: FIXED — "only _intended_ writer" with the catalog source named; rule 3 now says reads AND writes; the extend-this-function sentence replaced.

### F6 — Addendum A10's "the message is never empty" is wrong

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `plan.md`, Implementation Addenda A10
- **Detail**: Confirmed in psql: a slot uuid from another period yields
  `ERROR: claim_slots: 1 of 1 requested slots are no longer free / DETAIL: []`. The SQL is
  correct — naming a foreign slot would confirm it exists — but the addendum's blanket claim is
  false, and Phase 4's route will compose an empty sentence unless it handles `[]`.
- **Fix**: Correct A10 and record the empty-DETAIL case as a Phase 4 requirement.
- **Decision**: FIXED — A10 rewritten with both false claims struck explicitly rather than silently edited, and the empty-DETAIL case recorded as a Phase 4 requirement.

### F7 — The three DoS bounds have no test, and one test leans on shared state

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `claim_slots.sql:69,98,156`; `tests/rls/claim-slots.test.ts:228`
- **Detail**: The 43-char token bound, the 93-slot cap and the 80-char name bound are the DoS
  guards on the only anon-reachable write in the schema, and deleting any of them leaves the
  suite green. Separately, the malformed-arguments test asserts `free).toHaveLength(9)` against
  the shared `aPeriodId`; it holds only because no earlier test writes to A's period.
- **Fix**: Three assertions (81-char name → PT400, 94 uuids → PT400, 44-char token → null), and
  seed a dedicated period inside that `it()`.
- **Decision**: FIXED — three bound assertions added plus a dedicated period for the malformed-arguments test. Noted honestly in-file that the 43-char token assertion pins the uniform-failure ANSWER, not the bound itself, which is not observable through this API.

### F8 — The 80-character name bound has no TypeScript mirror

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `claim_slots.sql:156`
- **Detail**: `MAX_TITLE_LENGTH`, `MAX_SPAN_DAYS`, `MAX_PETS_PER_PERIOD` and `MAX_NOTE_LENGTH`
  all live in `src/lib/period-format.ts`, and contract-surfaces records why: so client and
  server cannot drift. The 80 is a bare SQL literal, deferred to Phase 4 to avoid an unused
  export. The cost is that Phase 4 will either hardcode a second 80 or surface a raw PT400.
- **Fix**: Add `MAX_CLAIMANT_NAME_LENGTH = 80` now, or record the deferral in an addendum.
- **Decision**: FIXED — `MAX_CLAIMANT_NAME_LENGTH = 80` added to src/lib/period-format.ts with a registry row, both flagging that it mirrors a function guard rather than a column CHECK.

### F9 — The row-count comparison silently changed shape from the plan's

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `claim_slots.sql:81-86`
- **Detail**: The plan prescribes comparing against `array_length(p_slot_ids, 1)`; the code
  compares against a NULL-stripped, de-duplicated array. Strictly safer — a literal `'{NULL}'`
  has length 1 and would otherwise pass the emptiness guard, the trap `20260906174022` fixed —
  and reasoned out in-comment, but it changes an explicitly prescribed comparison and appears
  in no addendum.
- **Fix**: Record as addendum A12.
- **Decision**: FIXED — recorded as plan addendum A12.

### F10 — Two residual correctness edges, both Phase-4-facing

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `claim_slots.sql:139-143` and `173-184`
- **Detail**: (a) Lock ordering is normally consistent because `array_agg(distinct …)` yields a
  sorted array and both callers get the same plan, but that is not guaranteed across a plan
  switch, and a `40P01` deadlock would reach Phase 4's route as an unhandled 500 since the route
  is specified to branch on PT409/PT400 only. (b) The name lookup is `limit 1` with no
  `order by`, so in the incoherent state the comment itself admits is representable, the
  propagated name is arbitrary.
- **Fix**: Handle `40P01` as a retryable refusal in Phase 4; add `order by s.claimed_at, s.id`
  to the name lookup.
- **Decision**: (b) FIXED — `order by s.claimed_at, s.id` added in the F1 migration, recorded as A16. (a) RECORDED AS PHASE 4 REQUIREMENT — plan addendum A17: handle 40P01 as a retryable refusal, and do not fix it with a locking SELECT before the update.
