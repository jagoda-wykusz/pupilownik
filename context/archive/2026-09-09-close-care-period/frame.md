# Frame Brief: Close / cancel a care period (FR-012, S-06)

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

FR-012 (`prd.md:100`): "Właściciel może zamknąć / odwołać okres opieki, unieważniając link
zapraszający." Priority: **nice-to-have**. `roadmap.md:206` records S-06 with **`Unknowns: —`**
and frames the path as "już częściowo pokryta" (`roadmap.md:207`).

## Initial Framing (preserved)

- **User's stated cause or approach**: S-06 is a small slice — a guarded write plus a button,
  structurally identical to S-04's `release_slot`.
- **User's proposed direction**: plan and implement `close-care-period` as that slice.
- **Pre-dispatch narrowing** (Step 1.5): the leading case is **"the trip is called off"**
  (cancellation), not the leaked link. The already-claimed caretaker seeing the identical
  "Link nieaktywny" 404 as a stranger is **"a defect, in scope here"**. The fact that a
  finished trip's link stays live forever was **"news to me"** — to weigh, not yet scoped.

## Dimension Map

1. **Column semantics** — one binary nullable `revoked_at` carrying two situations that demand
   opposite caretaker-facing answers. If it breaks here, S-06 is a schema change.
2. **The caretaker-facing answer** — `invite-view.ts:36-42` tests `periodTitle === null` before
   `hasClaims` _on purpose_; telling a claim-holder apart is a rule-4 widening.
3. **Reachability** — cancellation is an outbound message; if no addressable caretaker identity
   exists, the revisited page is the only in-product surface.
4. **Claimed slots** — a cancelled trip leaves slots taken by caretakers no longer needed.
5. **The guarded write itself** — RPC + route + button. ← initial framing (null hypothesis)

## Hypothesis Investigation

| Hypothesis                                                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Verdict                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **1. Needs a schema change (reason/state axis)**            | Premise verified: `revoked_at` is provably the only lifecycle axis (`20260905234144:21-32`, `20260906003122:33`, `20260907065515:29`); zero `status`/`state`/`reason` columns across all six tables; only two enums exist, both for identity not lifecycle. `prd.md:101` names both meanings in one sentence. **But the conclusion is not forced**: `care_slots.claim_digest` is an existing second axis that can carry a differentiated answer. S-06 would introduce the codebase's first reason column — unnecessarily.                                                                                                                                                                                                                                                                | **PREMISE STRONG / CONCLUSION WEAK**                     |
| **2. The rule-4 widening is the slice's centre of gravity** | Real and clean, but **cheap**: `get_claimed_details` already resolves period→capability (`20260907193000:55-62`, then `:74-80`), so moving `revoked_at is not null` _past_ the digest gate is ~4 lines in one `create or replace` (no signature change; grants preserved per `:20-22`). Leak-free by construction — a non-holder's answer stays byte-identical NULL. A matching digest is unforgeable and provable only by having claimed while the link was live (`claim.ts:96-105`, `20260907171514:1-29`), so the leak is one bit the holder already had: a _weaker_ widening than S-03's accepted one (`data-access.md:147-158`). Cost: 2 test amendments (`reveal-instructions.test.ts:390-404`, `invite-view.test.ts:10`) plus ~3 new tests. The read door need not change at all. | **WEAK as centre of gravity / STRONG as a cheap option** |
| **3. Reachability is a hard structural constraint**         | Premise verified: zero contact columns in all 16 migrations; identity is cookie+digest only, not reconstructible server-side (`claim-cookie.ts:14,35`; `caretaker-name.ts:151` — "there is no stable caretaker identity in this product"); no mail/SMS/webhook dependency anywhere. **But the conclusion breaks**: `prd.md:97` makes the owner's own channel the _design_ — "jeden link do wysłania **dowolnym kanałem** to najniższe tarcie". The owner already messages these people. And "no notification to the caretaker" is settled precedent for the structurally identical case (`release_slot.sql:20-25`: "a scope decision, not an oversight").                                                                                                                                | **PREMISE STRONG / CONCLUSION REFUTED**                  |
| **4. Cancellation must release claimed slots**              | Asymmetry is real and nowhere decided. `release_slot` is **not** usable for bulk as written: scalar arity, a scalar return that cannot express "released 7 of 12", and this repo's own rule makes a signature change a drop+create with fresh grants (`caretaker-claims-slot/plan.md:92-95`). **Decisive independence finding**: the 404 comes from `revoked_at` killing token resolution _before_ `claim_digest` is read, so bulk-releasing changes **nothing** the caretaker sees, and fixing the 404 does not decide the slots. `revoked_at` appears nowhere in S-04's slice.                                                                                                                                                                                                         | **STRONG — but a SEPARABLE decision**                    |
| **5. Small slice: RPC + route + button**                    | **Holds plainly.** Already shipping: the column, the uniform-failure predicate in all three doors, both owner-side revoked indicators (`periods/index.astro:149`, `periods/[id].astro:201`), the `revoked` prop already passed into an island (`:318`), and the tests pinning uniformity. Left to build: 3 new files + 1 line + 1 registry row + 2 test files. `data-access.md:181-193` states this exact shape as a **rule**, using S-04 as its worked example.                                                                                                                                                                                                                                                                                                                         | **STRONG on size / `Unknowns: —` REFUTED**               |

## Narrowing Signals

- **The leading case is cancellation, not a leaked link.** This is the signal that reshapes
  everything: `revoked_at`'s behaviour was built for the leak case, which research rates "Good",
  while cancellation it rates "Poor — worst of both".
- **The caretaker's 404 was named a defect in scope**, pulling Open Question E from deferred
  into the slice.
- **Two probes converged independently** on `claim_digest` as the existing second axis, from
  different files, neither told the other's hypothesis. That is why dimension 1 collapses.
- **`prd.md:146`'s non-goal is literally about push/email** — "w v1 nie ma automatycznych
  przypomnień ani maili". It governs messages the system pushes _outward_; it says nothing about
  the content of a page the caretaker opens themselves. **The in-page fix violates no non-goal.**
- **`prd.md:140` treats close and revoke as one identical effect** — "po zamknięciu/odwołaniu
  okresu link przestaje działać" — a third textual pull toward one action rather than two.
- **The dead end is already shipped and self-contradictory**: the caretaker is told "Poproś
  właściciela o nowy [link]" (`invite/[token].astro:176`) while the owner is refused one and told
  "Zaplanuj nowy wyjazd" (`RegenerateLinkButton.tsx:57-64`). A revoke button makes this reachable
  **by design** rather than by accident.

## Cross-System Convention

Owner-side writes in this repo are named guards over permissions the owner already holds:
SECURITY INVOKER, `search_path = ''`, scalar return, one NULL for every miss, the three-line grant
recipe (`release_slot.sql`, `regenerate_period_token`). `data-access.md:181-193` states it as a
rule. **The leading hypothesis matches the convention exactly** — S-06 is that shape, and the
convention says nothing about needing a schema change.

## Reframed Problem Statement

> **The actual problem to plan around is**: the owner cannot revoke a period at all, and the
> answer the product gives a caretaker when one _is_ revoked is advice the owner cannot satisfy —
> so the slice must settle what cancellation _means to the caretaker_ before shipping the write,
> not after.

The initial framing was **right about the build and wrong about the certainty**. The roadmap's
sizing is accurate; its `Unknowns: —` is false on the codebase's own evidence, since two migration
comments hand decisions to S-06 _by name_ (`20260906003122:120-121`, un-revoke) and the regenerate
refusal already ships copy that contradicts the caretaker's card. What changed under questioning is
the _leading case_: built for the leaked link, S-06 is now asked to serve cancellation, where the
same mechanism is a poor fit — not because it is too small, but because it says the wrong thing to
the person who committed their days.

The highest-value, lowest-cost item is **neither** the widening **nor** bulk release: it is that the
dead-end copy is incoherent regardless of which product decisions land. Fixing it touches no SQL,
no security property, and no test (no test asserts that body string).

## Confidence

**MEDIUM–HIGH.** Every dimension was investigated against this repo with file:line evidence, and
the two probes that mattered converged independently. Held below HIGH for one reason: an unprimed
cross-check (independent option ranking plus strongest-case-against) was still running when this
brief was written, so the "copy is the cheapest real win" conclusion has not yet survived a
hostile read.

## What Changes for /10x-plan

Keep the `release_slot`-shaped build — it is correct, and the `nice-to-have` priority argues
against expanding it. But the plan must **open with three named product decisions instead of
recording none**: (1) is revocation reversible (deferred to S-06 by name); (2) does a claim-holder
get a distinct "the trip was called off" answer, or does uniform failure stand; (3) does
cancellation release claimed slots — a separable decision that would need its own bulk function.
Correct `roadmap.md:206`'s `Unknowns: —` whichever way they land, and add the missing
`care_periods.revoked_at` registry row, which is owed regardless.

## References

- Source: `prd.md:97,100-101,140,146`; `roadmap.md:198-208`
- SQL: `20260905234144:21-32,88`; `20260906003122:33,46-49,120-121`; `20260907193000:55-62,74-80`;
  `20260909090000_release_slot.sql`
- App: `src/lib/invite-view.ts:3-7,36-49`; `src/pages/invite/[token].astro:176`;
  `src/components/periods/RegenerateLinkButton.tsx:57-64`; `src/lib/claim-cookie.ts:14,35`
- Docs: `docs/reference/data-access.md:147-158,181-193`; `docs/reference/contract-surfaces.md`
- Related research: `context/changes/close-care-period/research.md`
- Investigation: 4 parallel dimension probes + 1 unprimed cross-check (TaskCreate unavailable in
  this session, so no task ids were registered)
