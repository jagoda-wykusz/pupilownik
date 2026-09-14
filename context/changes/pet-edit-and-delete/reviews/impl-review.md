<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Pet edit + delete (S-09)

- **Plan**: `context/changes/pet-edit-and-delete/plan.md`
- **Scope**: Phase 1 + Phase 2 (full plan)
- **Date**: 2026-09-14
- **Verdict**: REJECTED at review time; ALL TEN FINDINGS TRIAGED AND ADDRESSED on 2026-09-14 (see Decision on each)
- **Findings**: 1 critical, 6 warnings, 3 observations
- **Commits reviewed**: `a74bd29` (p1), `0c3e9f0` (out-of-plan reskin + AppBar navigation), `08f7aaf` (p2), `d9e7860` (epilogue)

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Findings

### F1 — delete_pet's guard loses the race it exists to win

- **Severity**: CRITICAL
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260914090000_delete_pet.sql:61-98
- **Detail**: MEASURED (two psql sessions, local stack). Session A: `begin; insert into care_period_pets(trip, pet); pg_sleep(4); commit`. Session B one second later: `select delete_pet(pet)`. B returned the pet id (SUCCESS); afterwards the pets row count was 0, the link count 0, and the trip "RaceTrip" was still live with zero pets. The blocker SELECT takes no lock, so an uncommitted covering link is invisible to it; the DELETE then waits on the inserter's FOR KEY SHARE and, once that commits, proceeds — and `on delete cascade` silently removes the just-created link. That is exactly the state the migration header (lines 3-12) says the function exists to prevent, reached THROUGH the guard and undetectable afterwards.
- **Fix**: `perform 1 from public.pets where id = p_pet_id for update;` as the function's first statement, plus a header line saying what the lock is for (the current "either order ends in the same state" argument holds for the abort path, not for concurrency).
  - Strength: Measured to close it — the same interleaving with the lock in place raised PT409, DETAIL named RaceTrip, and the pet survived.
  - Tradeoff: One extra lock on a row the function is about to delete anyway.
  - Confidence: HIGH — both the failure and the fix were run, not reasoned. The patch was applied to the live DB only, then `npm run db:reset`; the repo stayed clean.
  - Blind spot: update_pet's freeze guard has the same snapshot-based shape (F10) and no cheap lock — the claim path never touches `pets`.
- **Decision**: FIXED — 20260914120000_delete_pet_locks_the_row.sql. Re-measured: same interleaving now raises PT409 naming the trip, pet and link survive.

### F2 — The island floor on /pets/[id] asserts nothing

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/render/island-props.test.ts:91
- **Detail**: MEASURED — floor 1 passes, floor 2 fails, so the page renders exactly 1 island. AppBar sits outside the `pet &&` branch and always receives `theme`, so ThemeToggle hydrates even on the not-found branch, which is why /pets/index.astro was raised to 1. With `toBeGreaterThanOrEqual`, a floor of 0 is unconditionally true: the page could stop rendering every island and the sweep stays green. The row's comment ("the floor stays 0 … the container has no session") is the wrong reason for this page.
- **Fix**: Floor 1, and name what the 1 is (the AppBar toggle), the way the index.astro row does.
- **Decision**: FIXED — floor 1 with the measured reason.

### F3 — The detail page swallows both failures without a log

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/pets/[id].astro:62-70
- **Detail**: `invite-page-silent-failures` repeated verbatim. The remedy that lesson bought is already in place — eslint.config.js:127 extends `no-console: allow error/warn` to `src/pages/**/*.astro` so pages may log, and invite/[token].astro:99,114,170 does, including the identical "supabase client unavailable" branch. pets/[id].astro logs zero times. The owner sees "Odśwież stronę" and the server remembers nothing.
- **Fix**: console.error on both branches, mirroring invite/[token].astro.
- **Decision**: FIXED — console.error on both branches, mirroring invite/[token].astro.

### F4 — PUT is last-write-wins over the whole instruction set

- **Severity**: WARNING
- **Impact**: HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260913210000_update_pet_with_instructions.sql:131-138
- **Detail**: "Rows absent from the payload are deletions" is the plan's deliberate PUT contract, but the payload is seeded from whatever the page rendered and nothing carries a version. Tab A loads 3 instructions, tab B adds a 4th, A saves only the name, and B's row is deleted with a 200 and no mention. The only destructive path in the slice with no confirmation and no test; DeletePetButton gets a two-tap confirm for a smaller loss.
- **Fix A (Recommended)**: Echo a version (pets.updated_at or a row version) in the PUT and raise PT409 on mismatch.
  - Strength: The PT409 plumbing already exists on both sides — RPC raises, route maps, island renders verbatim. Closes it rather than naming it.
  - Tradeoff: Schema/type churn plus a new test axis; a second concurrency contract to understand.
  - Confidence: MED — the mechanism is proven here, but whether `pets` has a usable version column was not checked.
  - Blind spot: Whether two-tab editing is real for this single-owner product or theoretical.
- **Fix B**: Leave the behaviour; state it as a posture in the migration header and next to the registry's "stored rows … are DELETED".
  - Strength: Cheap and honest; the registry line currently reads as a shape note, not a concurrency posture.
  - Tradeoff: The silent loss stays. Documentation is not a control.
  - Confidence: HIGH — prose only.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — 20260914130000_pet_version_token.sql adds pets.updated_at, the RPC locks the row and raises PT412 on a stale token, the route maps it to 409, the form echoes it. Mutation-checked: with the guard disabled a stale save returns SUCCESS and the other tab's row count drops 2 -> 1.

### F5 — /pets/<id> serves the sensitive tier with no Cache-Control

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:59-62, src/pages/pets/[id].astro:59
- **Detail**: The page selects every instruction row unfiltered and serialises the sensitive bodies — what the migration header calls "the address and the gate code" — into island props. Middleware sets `no-store` for /invite only, reasoning "out of shared caches and out of the back-button cache on a borrowed device". That applies here at least as strongly: the caretaker page shows sensitive rows only post-claim, this one shows all of them, always. The response carries no Cache-Control at all.
- **Fix**: Extend no-store to PROTECTED_ROUTES (or the /pets prefix), citing the reason already written at middleware.ts:13.
- **Decision**: FIXED — Cache-Control: no-store on every PROTECTED_ROUTES response, pinned by an it.each over that list.

### F6 — No error-mapping unit test for the new route's dead branches

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/unit/pets-error-mapping.test.ts (imports POST only)
- **Detail**: The plan's Testing Strategy names this test; it was never written. The host file records why it exists: deleting the whole mapping once left the route test green. Four branches in the new code are unreachable from the database — blockingTitles' three defensive paths, blockedMessage's more-than-two-titles tail and empty fallback, frozenMessage's two fallbacks, and the 22P05/22021 pair the file's own comment calls belt-and-braces.
- **Fix**: tests/unit/pet-detail-error-mapping.test.ts on the existing `vi.mock("@/lib/supabase")` shape. No Docker; runs in the `unit` project.
- **Decision**: FIXED — tests/unit/pet-detail-error-mapping.test.ts, 27 cases over the branches no integration test can reach.

### F7 — The integration suite flaked twice in five runs

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: tests/api/pets.delete.test.ts:98, tests/rls/delete-pet.test.ts:110
- **Detail**: Five full `--project integration` runs: 3 green, 2 with one failure each, in different tests. Isolated: 3/3 green. Run 1's error was `{message: "An invalid response was received from the upstream server"}` — an object with no `code`, which also explains run 2's `expected undefined to be '42501'`. A catalog check rules out a real grant leak (`has_function_privilege`: anon f, service_role f, authenticated t). Transport-shaped, but the CAUSE IS UNKNOWN, and both failures landed in this slice's new files — coincidence or a load signal.
- **Fix**: Record it as an open flake with these counts, and make the service_role assertion distinguish its three outcomes (no error / wrong code / transport error) so the next red says which one it is.
- **Decision**: RECORDED + assertion strengthened — the service_role case now separates "no error" / "wrong code" / "transport error"; counts recorded in the plan. Cause still unknown.

### F8 — Roadmap row is uncommitted and partly retracted

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/roadmap.md:45, 211-221, 236
- **Detail**: A consequence of the "leave non-slice paths out" call at commit time. Phase 1's item #1 (register S-09 in the roadmap) never landed in git; `Status` still reads "in progress" after the epilogue; the `Risk` field still promises /pets and /pets/new stay on bg-cosmic, which the Deviations block retracted.
- **Fix**: Commit the row with Status set to done and the Risk line corrected.
- **Decision**: FIXED — roadmap S-09 row set to done and the retracted Risk sentence corrected.

### F9 — Three stale references to the components this slice deleted

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/e2e/auth.setup.ts:47,51 · tests/e2e/fixtures/hydration.ts:7 · docs/reference/e2e-rules.md:127
- **Detail**: All three explain a rule by naming FormField or PasswordToggle, both deleted in 0c3e9f0. The behaviour survives (ui/Input renders the label and the "Pokaż hasło" button), so the rules hold — but their cited cause names files that are gone. Consumers were enumerated for the code and missed for the prose. Same class: EditPetForm.tsx:170 justifies rendering the server sentence because the server "knows whether an instruction id is really this pet's" — it does not report that; a foreign id is silently ignored, and update-pet.test.ts:233-266 pins exactly that.
- **Fix**: Repoint the three at ui/Input (revealable); correct the EditPetForm comment's stated reason.
- **Decision**: FIXED — the three references repointed at ui/Input; the EditPetForm comment's false reason corrected.

### F10 — Four small correctness/polish items

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence / Safety & Quality
- **Location**: api/pets/[id].ts:230 · DeletePetButton.tsx:127 · EditPetForm.tsx:276 · api/pets/[id].ts:114
- **Detail**: (a) The plural branch gives "i 5 inne" at seven or more blocking trips; the Polish genitive plural is "innych". (b) DeletePetButton.tsx:127-128 opens with the Polish quote and closes with an ASCII one, while the route's sentences use the matched pair. (c) EditPetForm's instruction Textarea is the only control missing `disabled={submitting}`; keystrokes mid-save are discarded by the reload with no sign. (d) The plan's 22003 → 400 branch was deliberately omitted with a sound argument in a source comment, but the omission never reached the Deviations block.
- **Decision**: FIXED — three-form Polish agreement (1/2-4/5+) with a table-driven test, matched quotation marks, and Textarea gained `disabled` so the instruction body locks mid-save. (d) recorded in the plan's Deviations.

## Success criteria re-run (committed tree, 2026-09-14)

| Check                                  | Result                      |
| -------------------------------------- | --------------------------- |
| `npm run db:reset`                     | pass                        |
| `supabase db advisors --type security` | pass — "No issues found"    |
| `npm run db:gen-types`                 | pass — no diff              |
| `npm run check`                        | pass — 0 errors, 0 warnings |
| `npm run lint`                         | pass                        |
| `npm run build`                        | pass                        |
| unit + component                       | pass — 280/280              |
| integration                            | 3 of 5 runs green; see F7   |
| `npm run test:render`                  | pass — 35/35                |
