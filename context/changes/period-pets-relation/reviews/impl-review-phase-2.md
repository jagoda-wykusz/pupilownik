<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Period ↔ Pets Relation — Phase 2

- **Plan**: `context/changes/period-pets-relation/plan.md`
- **Scope**: Phase 2 of 3, commit `bd93988`
- **Date**: 2026-09-06
- **Verdict**: NEEDS ATTENTION at review time → 9 findings triaged; 7 fixed, 2 recorded
- **Findings**: 0 critical, 4 warnings, 5 observations

## Verdicts (at review time)

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING (F4, F9) |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (F1, F3, F6, F7, F8) |
| Architecture | PASS |
| Pattern Consistency | WARNING (F4, F5) |
| Success Criteria | WARNING (F2) |

Automated criteria passed at review time and after triage: `astro check` 0 errors, lint 0
errors, build complete, **124/124** tests (116 before triage). Scope was clean — six files,
`plan.md` purely additive, no migrations, every guardrail held. Colour fidelity was exact:
`--secondary` and `--primary` are the design's `rgb(246,234,239)` and `rgb(156,84,112)`.

## Findings

### F1 — "Every 400 carries a Polish sentence" was false on two branches

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality
- **Location**: `src/pages/api/periods.ts:29`, `:37`
- **Detail**: measured against the installed zod — a body of `null`, `"x"`, `42` or `[]` yields
  `Invalid input: expected object, received …` with `path: []`. The type-level messages added
  in this phase covered the four FIELDS, not the object SHAPE, and each of those bodies is
  valid JSON, so it survives the parse guard and the island renders zod's English verbatim.
  `"Invalid JSON body"` at `:29` was the second English branch. Two comments asserted the
  opposite.
- **Fix**: the schema's object shape carries `PERIOD_MESSAGES.notAnObject`; the route prefers
  an issue with `path.length > 0` and falls back to the shape's message; the JSON guard is
  Polish. The unused `issues` array was dropped from the body at the same time (F6).
- **Decision**: FIXED

### F2 — The test written to prevent English messages did not

- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Success Criteria
- **Location**: `tests/unit/period-schema.test.ts:41-43`
- **Detail**: the "not English" heuristic (not `/^Invalid input/`, not `/^Too (small|big)/`, no
  `expected|received`) misses zod's entire `invalid_format` family. Measured: `z.uuid()`
  defaults to `"Invalid UUID"` and `z.iso.date()` to `"Invalid ISO date"` — neither matches any
  of the three patterns. Deleting a message argument left the case green while an owner would
  see English. This is the `lessons.md` pattern inside the very file written to prevent it.
- **Fix A ⭐ (chosen)**: the schema exports `PERIOD_MESSAGES` and the test asserts membership,
  which fails on every zod default rather than on a list of known phrasings. Cases added for
  the root non-object bodies and for present-but-malformed dates. Mutation-tested three ways:
  removing the uuid message fails 1 case, the date message 3, the object message 4.
- **Fix B (not chosen)**: extend the regexes. Rejected — still a proxy, and the next zod format
  slips through.
- **Note on method**: the third mutation was initially a **no-op** — prettier had reformatted
  the multi-argument `.object(…)` call so the search string never matched, and the test
  "passed". Checking that the mutation had actually been applied is what prevented reporting
  that the test did not guard the shape.
- **Decision**: FIXED via Fix A

### F3 — The chip group was inaccessible

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality
- **Location**: `src/components/periods/NewPeriodForm.tsx:157-158`, `:194`
- **Detail**: no `role="group"` or accessible name (`AddPetForm` does this correctly for its
  species control), the field error carried no `id` / `aria-describedby` / `role="alert"`
  (`ui/Input` and `ServerError` both do), and the chip had no `focus-visible` ring — the only
  interactive surface in the layer without one. A screen-reader user submitting with no pet
  selected got silence and no reason.
- **Fix**: `role="group"` + `aria-labelledby` + conditional `aria-describedby` on the wrapper,
  `id` + `role="alert"` on the error, `focus-visible:ring-*` on the chip. `aria-pressed` was
  already correct for a multi-select toggle.
- **Decision**: FIXED

### F4 — The geometry pass left the one visible gap wrong

- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence
- **Location**: `src/components/periods/NewPeriodForm.tsx:158`, `:173`, `:181`
- **Detail**: the design has two gaps — the row's `10px` and the chip's inner `8px`. Both were
  set to `gap-2` (8px), and the comment justified the INNER one, which is inert because the
  chip has a single child (the design's circular pet photo is unimplementable — `pets` has no
  photo column). So the only geometry value this phase existed to correct was still wrong while
  its comment explained a value that does nothing. Separately, the chip is a bare `<button>`
  inheriting `font-body` (Nunito) where the design specifies Quicksand; `ui/button.tsx` sets
  `font-heading` explicitly for exactly this reason.
- **Fix**: `gap-[10px]` on the row, `font-heading` on the chip, comment corrected.
- **Decision**: FIXED

### F5 — Three routes, two meanings for the same envelope

- **Severity**: 💡 OBSERVATION · **Impact**: 🔎 MEDIUM · **Dimension**: Pattern Consistency
- **Location**: `src/pages/api/pets.ts:29`, `src/pages/api/periods/[id]/token.ts:24`
- **Detail**: both still answer `{ error: "Validation failed" }`, and `AddPetForm` discards it
  for a generic Polish sentence — the same defect this phase fixed for periods, still live for
  pets. Not user-visible today; the risk is a future island copying the passthrough and
  rendering `Validation failed` at an owner.
- **Decision**: RECORDED as S-01's debt in `test-plan.md` §7, not fixed. Copying the
  passthrough alone would leak English: `schemas/pet.ts` carries messages on two fields only,
  so `species` would surface `Invalid option: expected one of "dog"|"cat"|"other"`. Fixing it
  properly means Polish type-level messages in that schema plus the membership test extended to
  cover it — its own unit of work, in another slice's scope. This change has already reached
  into other slices twice.

### F6 — `issues` in the 400 body had no consumer

- **Severity**: 💡 OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality
- **Location**: `src/pages/api/periods.ts:37`
- **Detail**: nothing in `src/` read it. It carried no echo of submitted input (zod 4 does not
  serialize `input`) but did ship the compiled uuid and ISO-date regexes, and sat as the English
  half of a body whose other half had just been made Polish.
- **Fix**: dropped, as part of F1's edit.
- **Decision**: FIXED

### F7 — The 400 mapping gave the wrong sentence for two codes

- **Severity**: 💡 OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality
- **Location**: `src/pages/api/periods.ts:66-69`
- **Detail**: `P0001` (the RPC's "at least one pet" raise) and `23502` answered "Wybrane
  zwierzę nie należy do Ciebie", which tells an owner their pet is not theirs when in fact they
  named none. Near-unreachable — zod catches both first.
- **Fix**: codes split; `42501`/`23503` keep the ownership sentence, `P0001`/`23502` answer
  "Wybierz co najmniej jedno zwierzę".
- **Decision**: FIXED

### F8 — The response body's `error` was cast, not checked

- **Severity**: 💡 OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality
- **Location**: `src/components/periods/NewPeriodForm.tsx:113-114`
- **Detail**: a 400 from an intermediary carrying a non-string `error` would be handed to
  `ServerError` and React would throw on an invalid child.
- **Fix**: `typeof body.error === "string"` guard with the generic fallback.
- **Decision**: FIXED

### F9 — `PetOption` narrowed without a record

- **Severity**: 💡 OBSERVATION · **Impact**: 🏃 LOW · **Dimension**: Plan Adherence
- **Location**: `src/components/periods/NewPeriodForm.tsx:24-27`
- **Detail**: the plan's Phase 2 contract specified `{ id, name, species }[]`; the shipped type
  is `{ id, name }`. The narrowing landed in the Phase 1 F1 fix, not this commit, and was never
  recorded.
- **Decision**: RECORDED in the plan's addenda. `species` has nowhere to appear — the design
  puts a circular pet photo in the chip and `pets` has no photo column, so the chip shows the
  name alone.

## Post-triage state

124/124 tests, lint and types clean, build complete. Two items recorded rather than fixed, both
with the reasoning written down where the next reader will find it.
