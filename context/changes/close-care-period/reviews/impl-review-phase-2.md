<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Close / cancel a care period (FR-012, S-06)

- **Plan**: `context/changes/close-care-period/plan.md`
- **Scope**: Phase 2 of 4 — "The caretaker's answer"
- **Commit reviewed**: `8e32a65`
- **Date**: 2026-09-10
- **Verdict**: NEEDS ATTENTION → all six warnings fixed in-session
- **Findings**: 0 critical, 6 warnings, 4 observations

## Verdicts

| Dimension           | Verdict (at review) |
| ------------------- | ------------------- |
| Plan Adherence      | WARNING             |
| Scope Discipline    | PASS                |
| Safety & Quality    | WARNING             |
| Architecture        | PASS                |
| Pattern Consistency | PASS                |
| Success Criteria    | PASS                |

## What was verified clean

- **The digest gate is genuinely upstream of the revoked branch.** No path reaches the revoked
  answer without clearing it. `found` is captured per-lookup, no null-deref, `security definer` +
  `search_path = ''` with fully-qualified calls intact.
- **The revoked payload leaks nothing.** `jsonb_build_object('revoked', true)`, returned _instead
  of_ the payload. On the page, `payload` is also null in that state, so the entire
  `payload && (…)` subtree — headings, title, `formatRange`, pets, instructions, the sensitive
  callout, the note, and `<ClaimSlots>` — never renders. **The token itself is not serialized
  into island props in this state**, though it normally is.
- **Both revoke races fail safe.** Owner revokes between the two RPCs → full trip renders once to
  someone authorized a moment earlier. Reverse order → `hasClaims: true, periodTitle: null` →
  `inactive`, and the fetched sensitive rows are dropped rather than rendered.
- **The other two anon doors still filter.** Confirmed from each one's _current_ definition:
  `get_period_by_token` (`20260907180022:57-59`) and `claim_slots`
  (`20260907171514:125-127`) both keep `and p.revoked_at is null`; no later migration redefines
  either.
- **Grant posture**: signature unchanged, so `20260907180022`'s grants survive; all three roles
  still asserted.
- **Scope discipline**: zero creep. No owner route, no island, nothing under `src/pages/api/` or
  `src/components/`. The migration adds no DDL at all.
- **No order-dependent shared mutable state** in the test files.
- **No Phase-3 present-tense overreach** in any prose this phase added.

## Findings

### F1 — Registry and live catalog false in four places

- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Plan Adherence
- **Detail**: `contract-surfaces.md`'s `care_periods.revoked_at` row still claimed all three
  functions share the identical `revoked_at is null` predicate, and still carried the
  **"Planned — S-06 Phase 2 … will resolve"** hedge for behaviour this very commit shipped. The
  `resolveInviteView` row still stated the pre-commit absolute ("unknown, tampered, malformed and
  revoked tokens must all produce one identical answer"). The `get_claimed_details` row never
  mentioned the revoked answer. And `20260910120000_revoke_period.sql:181`'s live
  `comment on column` carried the same stale hedge — in a migration containing a section titled
  "The column comment, which was wrong", fixing the identical class.
  The hedge was written in Phase 1 _to avoid lying_, and Phase 2 made it lie in the other
  direction. Phase 4 schedules this re-read, so it is not drift — but the document was false now,
  and `lessons.md` requires truth at writing time.
- **Fix A ⭐ (applied)**: three registry rows corrected; `comment on column` refreshed by a new
  statement in the Phase 2 migration — the same supersede-by-new-statement move Phase 1 used on
  `20260906003122`'s "Written by S-06".
- **Decision**: FIXED via Fix A

### F2 — The widening introduced a timing oracle

- **Severity**: ⚠️ WARNING · **Impact**: 🔬 HIGH · **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260910140000_claimed_details_revoked_answer.sql`
- **Detail**: Dropping the filter means a revoked token now RESOLVES, so the function carried on
  past the first gate — a second `sha256` and a second index probe — where an unknown token had
  already returned. Before this slice both exited at the same line. `anon` holds EXECUTE, so an
  attacker calls the RPC directly with a fixed 43-char secret and strips all SSR noise; the
  distinguished bit is exactly the one rule 4 protects, in exactly the forwarded-link scenario it
  exists for. Content was uniform; **work was not**, and the docs' language did not distinguish
  the two.
- **Fix A ⭐ (applied)**: equalise. Both hashes and both lookups now run for every caller who
  clears the length checks; the `care_slots` probe uses
  `coalesce(v_period.id, '00000000-…-0'::uuid)` so it runs even on a missed period lookup
  (verified: `SELECT * INTO` on a miss gives `found=f`, `id is null`). Only then do the gates
  decide. **Measured**: with `pg_stat_reset()` then one call carrying an unknown token,
  `care_slots` `idx_scan` went 9 → 10 — the probe genuinely runs.
  Recorded honestly in the SQL header and in rule 4: this removes the asymmetry _this slice
  introduced_; it does **not** make the function constant-time, since a digest matching an
  existing period still reads a heap tuple that a non-existent one does not — equally true before
  S-06.
- **Decision**: FIXED via Fix A

### F3 — Five assertions in the new RLS test were unfailable

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality (test quality)
- **Location**: `tests/rls/reveal-instructions.test.ts` (was `:415-423`)
- **Detail**: Four `not.toContain` lines followed `expect(after).toEqual({ revoked: true })` on
  the same value — if the exact-equality assertion passes, `JSON.stringify` is `{"revoked":true}`
  and none of them can fail. The fifth was worse: "Access really is gone, not merely relabelled"
  routed through `revealDetails`, which returns `null` for **any** answer carrying a `revoked`
  key — it is the definition of relabelling, not a test of it. Exactly the lesson this repo
  records, in a test written to honour it.
- **Fix (applied)**: replaced with a KEY-SET assertion —
  `expect(Object.keys(after ?? {})).toEqual(["revoked"])` plus a `not.toContain("caretaker_note")`
  — so an edit attaching the title, note or name adds a key and the assertion bites.
- **Decision**: FIXED

### F4 — The page change was untested at every layer

- **Severity**: ⚠️ WARNING · **Impact**: 🔬 HIGH · **Dimension**: Safety & Quality
- **Detail**: The security-relevant edits — removing `payload &&` from the RPC guard, and the
  `details`/`claimed` split — had no assertion anywhere. `tests/unit/invite-view.test.ts` tests
  the _pure function_, whose contract the page could silently stop honouring. The commit's own
  claim ("the called-off card cannot grow a name, note or day list") rested on one untested line.
- **Fix A ⭐ (applied)**: extracted the split into `splitRevealAnswer<T>()` in
  `src/lib/invite-view.ts`, beside `resolveInviteView` and pinned by the same test file — four
  new cases including an answer carrying BOTH content and the marker, which must suppress the
  content rather than trust it. The page now destructures that function.
- **Not covered, deliberately**: the `.astro` render itself. No render harness exists in this
  repo (`tests/component/` holds one React component test), so asserting "the card contains
  neither the trip title nor `SECRET_BODY`" needs new infrastructure. Deferred as debt; the
  security property is now pinned one layer in.
- **Decision**: FIXED via Fix A (partial coverage, gap recorded)

### F5 — A test case was mislabeled and duplicated another

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence
- **Location**: `tests/rls/reveal-instructions.test.ts:447,468-470`
- **Detail**: The plan required "an unknown token on a revoked period → NULL". It was implemented
  as `reveal(generateInviteToken(), otherSecret)` with the comment "a genuine capability for the
  revoked trip" — but `otherSecret` came from `A-inny-wyjazd`, and the revoked period's real
  capability was discarded (`claimOne`'s return unused). The comment was false and the assertion
  duplicated an existing case.
- **Fix (applied)**: capture the revoked period's own secret and use it.
- **Decision**: FIXED

### F6 — The card copy is still unpinned

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence
- **Detail**: The plan stated "No test asserts this string today; **this phase's unit test
  will**." No test asserts either card — `resolveInviteView` holds no strings and no render test
  exists. Step 2.11 rests on manual verification alone.
- **Decision**: PENDING — same blocker as F4's uncovered half (no `.astro` render harness).

## Observations

### F7 — "no notification" contradicted the card the same commit shipped

- **Severity**: 🔵 OBSERVATION · **Dimension**: Prose correctness
- **Detail**: rule 4's new paragraph said revocation happens "with no notification", twenty lines
  below introducing a card that tells a proven holder the trip was called off. Intended meaning
  was "no _push_ notification" (`prd.md:146`). "Closes all three doors at once" was also
  imprecise — the third door now answers rather than closing.
- **Decision**: FIXED — "no **push** notification … a caretaker who returns to the link learns it
  there and nowhere else"; "closes the read and write doors and reduces the third to a one-bit
  status".

### F8 — Stale line-range citation

- **Severity**: 🔵 OBSERVATION · **Dimension**: Prose correctness
- **Detail**: The new migration cited `data-access.md:147-158` for S-03's widening. The same
  commit rewrote rule 4 and shifted it; that range now opens rule 4 and cuts off mid-sentence.
  The citation was accurate pre-edit and was not re-checked after the author's own change.
- **Decision**: FIXED — cited by name ("the WRITE widening under rule 4"), not by line range.

### F9 — Cookie shape unvalidated before the second RPC

- **Severity**: 🔵 OBSERVATION · **Dimension**: Safety & Quality
- **Detail**: The page reads the claim cookie with no shape check, unlike
  `src/pages/invite/claim.ts:96` (`CAPABILITY_SHAPE`). `HttpOnly` binds browsers, not `curl`, so
  any `Cookie: pupilownik_claim=x` on `/invite/<anything>` fires the RPC. Every `/invite/*`
  request carrying a cookie now costs 3 DB calls instead of 2, and there is no rate limiting
  anywhere. The length bound is the first cost _inside_ the function, not the first cost of the
  request. A one-line `length === 43` in the frontmatter would remove the parse-then-reject trip
  and make the page agree with the route about what a well-formed capability looks like.
- **Decision**: SCHEDULED — pulled into Phase 3 with the owner's approval (plan addendum item 6).

### F10 — `ClaimSlots` still carries the promise the card just dropped

- **Severity**: 🔵 OBSERVATION · **Dimension**: Pattern Consistency
- **Detail**: `src/components/invite/ClaimSlots.tsx:152` still says "Ten link przestał działać.
  **Poproś właściciela o nowy.**" — reachable via the claim-POST 404 on a revoked trip.
  `research.md:136` already flagged this alongside the card copy; Phase 2's contract scoped the
  fix to `[token].astro` only, so it is not drift — but it is a known surviving instance.
- **Decision**: SCHEDULED — pulled into Phase 3 with the owner's approval (plan addendum item 7).

### F11 — `release_slot` + revoked interaction untested

- **Severity**: 🔵 OBSERVATION · **Dimension**: Safety & Quality
- **Detail**: `release_slot` nulls `claim_digest`. A caretaker whose last term was released and
  whose trip is then revoked fails the digest gate and gets the uniform inactive page — intended,
  and the one path where a genuine claimant is deliberately denied the new bit. Nothing asserts
  it.
- **Decision**: PENDING

## Verification after fixes

Clean database, everything re-run: `db:reset` exit 0 · full suite **280/280** (was 276; +4 from
the split-function cases) · `astro check` 0 errors 0 warnings · `lint` exit 0, 0 errors ·
`build` exit 0.

**Ordering re-measured after the gate restructure**, because F2's fix moved the gates: hoisting
the revoked branch above the claim gate still fails the non-holder case with
`expected { revoked: true } to deeply equal null`. Database restored, suite green.

**One self-inflicted defect found and fixed during the F2 work**: the first attempt wrote
`pg_catalog.coalesce(...)`. COALESCE is a SQL construct, not a function, so it cannot be
schema-qualified — it raised 42883 at **runtime** while `supabase db reset` applied the migration
happily, because a plpgsql body is not validated at creation. 11 tests failed. Worth remembering:
a green `db:reset` is not evidence that a function body works.
