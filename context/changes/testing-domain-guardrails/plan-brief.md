# Domain Guardrails (Test Rollout Phase 4) — Plan Brief

> Full plan: `context/changes/testing-domain-guardrails/plan.md`

## What & Why

Close `test-plan.md` §3 Phase 4 — the three domain guardrails the product is actually sold on: no double-booked slot (#3), no sensitive instruction before a claim (#4), and a link that grants only its own scope (#5). All three are already covered at the SQL layer; this change pins the places where **removing the protection causes no test to fail today**.

## Starting Point

28 test files exist. `tests/rls/reveal-instructions.test.ts` searches the whole serialized RPC payload for sensitive content; `tests/rls/claim-slots.test.ts` races six caretakers for one slot; `tests/api/revoke-period.test.ts` compares whole `{status, body}` objects across its misses. What is missing sits one layer above the database: the caretaker page's gate is undefended (delete it and the suite stays green), no release test ever calls `get_claimed_details`, no test presents a valid token to an owner endpoint, and the HTTP claim route has zero concurrency coverage.

## Desired End State

Every prose claim this project makes about the three guardrails is backed by a test that fails when the claim stops being true — verified per phase by breaking the protection and watching the named test fail.

## Key Decisions Made

| Decision                          | Choice                                                                         | Why (1 sentence)                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Layer for the #4 page gate        | Composition → `src/lib/invite-view.ts` + source guard                          | A pure function fails when the gate is removed, without an e2e runner or Container API, which §4/§7 both exclude.                          |
| Refactor boundary                 | Instruction + note composition only                                            | That is the decision that can leak; the cookie→RPC gate stays in the page, guarded by the source test.                                     |
| Depth of the #3 concurrency proof | Parallel claims at the HTTP handler; no `pg` client                            | Closes the layer with no coverage at all; a deterministic row-lock proof would need two held transactions and a second DB driver.          |
| Extra #3 cases                    | Overlapping multi-slot selections + negative `care_slots_claim_complete`       | The first is the only path to the untested `40P01` → 409 branch; the second underpins the freeness predicate the whole guarantee rests on. |
| Release × reveal                  | Both halves, at the RPC layer                                                  | Last term collapses the reveal, one of two leaves it alive — both are stated as fact in three documents and pinned nowhere.                |
| Token scope                       | Live token × 3 placements × 5 owner endpoints, + missing `/api/pets` 401       | Proves Risk #5 in its own words; today scope is proven only by Postgres role, not by the routes that read `locals.user`.                   |
| Uniform failure                   | `toEqual({status, body})` extended to release, mint and the caretaker resolver | Uniformity is a named security property defended on one endpoint of three.                                                                 |
| Accepted MVP gaps                 | Characterization where a test lands; §7 entry otherwise                        | Claim × release and claim × revoke get a written decision, not a test — both endings are permitted, and fixing them is a product call.     |
| Scope                             | All three risks, one change, five phases                                       | §3 defines Phase 4 as exactly these three risks and records that it opens as a single change.                                              |

## Scope

**In scope:** the #4 page gate (with a small production move into `invite-view.ts`); release × reveal; token → owner endpoints + the missing `/api/pets` 401; HTTP-layer claim contention, overlapping selections and the triple-CHECK negative; uniform 404 bodies on release, mint and the caretaker page; `RegenerateLinkButton` request shape; §6.6/§7 and Phase 4 status.

**Out of scope:** any e2e runner or rendered-HTML assertion; a `pg` client and a row-lock mechanism proof; any migration or product fix (`release_slot` gains no `p_claimed_at`); claim × release and claim × revoke race tests; `RegenerateLinkButton` UX coverage; rollout phases 2b and 3.

## Architecture / Approach

One production move, four test-only phases. The composition decision leaves `[token].astro`'s frontmatter for `src/lib/invite-view.ts` — the module that already owns this page's two other security-carrying decisions — and is pinned by a whole-result serialization search plus a source guard. Everything else extends the harness as it stands: `createAnonClient()` for link-only callers, direct handler imports with a hand-built context for routes, and `Promise.all` inside a single `it()` for contention, since Vitest serializes tests within a file.

## Phases at a Glance

| Phase                                 | What it delivers                                                           | Key risk                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1. Caretaker page gate (#4)           | Composition in `invite-view.ts`, whole-result test, source guard           | Touches the product's most sensitive page; refactor could creep past its boundary |
| 2. Release × reveal (#5)              | Both halves of the documented consequence pinned                           | RPC-layer only — does not prove what the page then shows                          |
| 3. Token scope (#5)                   | Live token refused by 5 owner endpoints, 3 placements each                 | Most tedious setup in the change; 5 handler context shapes                        |
| 4. HTTP contention + rest of #3       | One winner at the route, `40P01` mapping, triple-CHECK negative            | Overlapping-selection case is inherently non-deterministic — flakiness risk       |
| 5. Uniformity, mint island, documents | `toEqual` on failure bodies, island request shape, §6.6/§7, Phase 4 status | Prose drift — present-tense claims must be read against shipped code              |

**Prerequisites:** local Supabase stack running (`npm run db:start`) with `.env.test` populated; dev server killed before any build, check or commit.
**Estimated effort:** ~3–4 sessions across 5 phases; Phase 1 and Phase 4 carry most of it.

## Open Risks & Assumptions

- The Phase 1 refactor is a move, not a rewrite — if the composition turns out to need Astro or Supabase types to stay honest, the boundary was drawn wrong and the phase should stop rather than pull the page into the lib.
- The overlapping-selection race may be too flaky to keep; the plan's own exit is to delete it and record why in §7 rather than retry it.
- `[token].astro` is shared surface: enumerate every consumer of what moves before moving it (`lessons.md`, "wylicz konsumentów").
- Exit codes must not be read through a pipe, and the dev server must be down before every build/check/commit — both are recorded lessons that have already been broken once each after being read.

## Success Criteria (Summary)

- A caretaker who has not claimed cannot be shown a sensitive instruction row or the trip note without a test failing.
- Releasing a caretaker's last term provably ends their reveal; releasing one of two provably does not.
- Holding a valid invite link opens nothing on the owner side, and two simultaneous claims through the real route produce exactly one winner.
