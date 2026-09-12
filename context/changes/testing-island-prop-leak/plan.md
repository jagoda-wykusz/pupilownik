# Island-Prop Leak Implementation Plan

## Overview

Two layers on one boundary. A lint rule forbids the import that is the necessary first step of the
measured leak; a rendered-output sweep reads the bytes that actually ship and catches the
indirections no source rule can see. Neither exists today, and the leak they guard was proven
reachable — build green, `dist/client` clean, `check:secrets` clean, secret verbatim in the HTTP
response.

## Current State Analysis

From `research.md`, all measured rather than argued:

- A page importing `SUPABASE_KEY` in frontmatter and passing it to a `client:load` island **builds
  successfully**, leaves `dist/client` clean, and emits the value verbatim inside
  `<astro-island props="…">`.
- `ServerOnlyModule` does not fire: `env/vite-plugin-env.js:64-69` is keyed on which Vite
  environment resolves `astro:env/server`, not on where the value flows. Frontmatter resolves in
  `ssr`.
- Astro serializes **every** prop it is handed at runtime, declared or not (`serialize.js:33-48`,
  `hydration.js:64`). A prop type is a **build-time** partial boundary: measured, `astro check`
  rejects an undeclared prop and a field absent from the source object, but it cannot reject a secret
  passed to a prop already declared `string` — which is the shape that leaks.
- **No page does this today.** All 11 `client:load` sites inventoried; no prop derives from
  `astro:env/server`. The only importers reduce the secrets to a boolean and to a Supabase client.
- Astro's Container API renders all 11 pages in ~3 s with no build, no dev server and no Docker,
  and catches the leak **through an alias**.
- Under vitest the Vite mode is `test`, so `.env.test` overrides `.env` — and the two files hold
  different key formats (`sb_publishable_…` 46 chars vs a 153-char JWT).

**Two facts established while planning, both correcting something stated earlier:**

1. **Adding a step to `ci:gate` does NOT fail `tests/unit/ci-gate-source.test.ts`.** That guard
   asserts the presence and ordering of the steps it knows about; it does not assert exhaustiveness.
   Extending it to pin the new step is work in Phase 3, not a consequence of Phase 3.
2. `eslint.config.js:77-83` already carries an `**/*.astro` block, so the rule has an obvious home.

## Desired End State

- A `.astro` file that imports `astro:env/server` fails `npm run lint`, and therefore fails the
  publish gate.
- A sweep renders every page and fails if the response carries the resolved secret **or** anything
  shaped like a Supabase key, and fails if a page stops rendering the islands it renders today.
- Both run inside `npm run ci:gate`, so a leak of this shape cannot publish.
- `check-client-bundle.mjs` states that this route lies outside its reach, and `test-plan.md` §7
  records the boundary and corrects the "prop type as a guard" mechanism.

**How to verify**: plant the leak from `research.md` and watch both layers refuse it, then remove it.

### Key Discoveries

- `eslint.config.js:77-83` — the existing `**/*.astro` block
- `package.json:19` — the gate chain the render step joins
- `tests/unit/ci-gate-source.test.ts:55-60,68-71,98` — what the gate's guard pins, and what it does not
- `vitest.config.ts` — aliases `astro:env/server` to a shim, which is why the render sweep needs its own config
- `scripts/check-client-bundle.mjs` header — cites `ServerOnlyModule` as the reason a framework leak cannot happen
- `src/lib/caretaker-name.ts:110-125,171-177` — the digest dropped by construction AND absent from the output type, which `astro check` enforces (measured)

## What We're NOT Doing

- **Not writing a custom ESLint rule.** The blunt `no-restricted-imports` blocks the same first step
  in six lines, and the render sweep covers every indirection a custom rule would add.
- **Not injecting an authenticated `locals`** to light up the gated pages' islands. It would turn a
  3-second Docker-free sweep into an integration test and push it out of the publish gate. The
  limitation is pinned by island counts instead.
- **Not editing `context/archive/`.** Archived folders are read-only by convention; the correction
  goes to `§7` and to the new test's header.
- **Not touching Risk #3 territory** — sensitive instructions crossing the same boundary have their
  own coverage.
- **Not changing `check-client-bundle.mjs`'s scope.** `dist/client` only remains correct; it gains a
  sentence, not a new directory.

## Implementation Approach

Cheapest layer first, so that if the render harness turns out to be more trouble than the research
suggested, the repository still gained a real guard. Phase 2 builds the harness and proves it bites
before Phase 3 wires it anywhere. Phase 3 is deliberately separate because it edits a chain that
another test pins, and that test needs extending by hand.

## Critical Implementation Details

**The render assertion must be two-part, and the reason is measured.** Asserting only that the HTML
lacks the resolved `SUPABASE_KEY` guards whichever key `.env.test` supplies — a throwaway local
value in a different format from production's. Asserting only shapes passes even with an empty
environment, which is the "describes rather than guards" shape. Both halves together give a test
that proves the mechanism _and_ survives a key-format change.

**The Container API is `experimental_`-prefixed.** An Astro minor can change it. That is a knowing
cost, and the sweep's header should say so rather than let a future breakage read as a mystery.

## Phase 1: The lint rule

### Overview

Six lines that forbid the import the leak requires, inside a config already run by the publish gate.

### Changes Required

#### 1. Restrict `astro:env/server` in `.astro` files

**File**: `eslint.config.js`

**Intent**: Make importing `astro:env/server` from a `.astro` file an error. Verified: no `.astro`
file imports it today, so the rule is clean on arrival and forbids the measured leak's first step.

**Contract**: a `no-restricted-imports` entry inside the existing `**/*.astro` block
(`eslint.config.js:77-83`). The message must say what to do instead — read the value in a `.ts`
module and export a derived, non-secret result, which is what `src/lib/config-status.ts` already
does — because a rule whose message only says "forbidden" gets disabled rather than obeyed.

### Success Criteria

#### Automated Verification

- Lint passes unchanged on the current tree: `npm run lint`
- Typecheck passes: `npm run check`

#### Manual Verification

- Proven to bite: add `import { SUPABASE_KEY } from "astro:env/server";` to any `.astro` frontmatter,
  confirm `npm run lint` fails naming the file and the rule, then remove it

---

## Phase 2: The render sweep

### Overview

Render every page through Astro's Container API and assert that nothing secret-shaped reaches the
output. This is the layer that catches what the lint rule cannot: a helper, a re-export, a spread.

### Changes Required

#### 1. A vitest config for rendering

**File**: `vitest.render.config.ts` (new)

**Intent**: Give the sweep an environment where `.astro` files compile and `astro:env/server`
resolves for real — neither of which the existing `vitest.config.ts` provides, since it aliases that
module to a shim.

**Contract**: `getViteConfig()` from `astro/config`, fed the **real** `astro.config.mjs` with only
`adapter` removed. Two measured reasons this exact shape is required: the Cloudflare adapter rejects
vitest's SSR externals outright, and a hand-written config omits `fonts`, after which every render
dies with `FontFamilyNotFound`. Import and spread the real config; do not retype it.

#### 2. The sweep

**File**: `tests/render/island-props.test.ts` (new)

**Intent**: Render every page and assert the response carries no secret.

**Contract**: `import.meta.glob("/src/pages/**/*.astro")` to enumerate pages,
`experimental_AstroContainer` with the React server and client renderers registered, and
`renderToString` per page with a `request` and `params` sufficient for the dynamic routes.

Three assertions per page, and each earns its place:

- the rendered HTML does not contain the **resolved** `SUPABASE_KEY` / `SUPABASE_URL`;
- it does not match the **shape** patterns — `sb_publishable_`, `sb_secret_`, an anchored JWT — so
  the test does not depend on which key the environment happened to load;
- the page rendered **at least as many islands as it renders today**, recorded per page.

The island floor is the control, and it is why a green sweep means something: gated pages render
their degraded branch, so `periods/[id].astro` yields 1 island where the source has 4. Without the
floor a page that silently stopped rendering islands would pass while covering nothing. Same idea as
`controlHits` in `scripts/check-client-bundle.mjs`.

State in the header: that the API is experimental, that the floors are measured-today values and
will need raising when pages gain islands, and that the sweep sees degraded branches.

#### 3. An npm script

**File**: `package.json`

**Intent**: One name for the sweep, so the gate and the workflow both refer to the same definition.

**Contract**: a `test:render` script running vitest with `--config vitest.render.config.ts`.

### Success Criteria

#### Automated Verification

- The sweep passes: `npm run test:render`
- It renders every page: the count asserted equals the number of files under `src/pages/**`
- Existing suites unaffected: `npm test`
- Typecheck and lint: `npm run check`, `npm run lint`

#### Manual Verification

- Proven to bite, with the leak from the research: add a fixture page passing `SUPABASE_KEY` through
  an alias to an island, confirm the sweep fails, remove it
- Proven to bite on the control: lower one page's island floor below what it renders, confirm it
  still passes; raise it above, confirm it fails — so the floor is known to be a live assertion
- The failure message names the page and which half tripped (resolved value vs shape)

---

## Phase 3: Wire both into the publish gate

### Overview

A leak that cannot publish is the point. This phase edits the chain and — by hand — the test that
pins it.

### Changes Required

#### 1. Add the sweep to the chain

**File**: `package.json`

**Intent**: Put `npm run test:render` inside `ci:gate` so a leak of this shape blocks publication.

**Contract**: the render step joins the chain alongside the other vitest runs, before
`check:secrets`. It needs no build and no Docker, so it adds roughly three seconds.

#### 2. Extend the gate's guard — this will not happen on its own

**File**: `tests/unit/ci-gate-source.test.ts`

**Intent**: Pin the new step. **Measured while planning: adding a step to `ci:gate` does not fail
this test** — it asserts the presence and order of the steps it knows about, not that no others
exist. So the guard must be told about the render step explicitly, or the gate grows a link nothing
protects.

**Contract**: a presence assertion for the render step and its position in the ordering list, with
the same anchoring discipline the file already uses — the review of `ci-quality-gates` found two
assertions there satisfied by their own explanatory comments, so match on the step's distinctive
text, not on a word that also appears in prose.

#### 3. Add the sweep to the workflow

**File**: `.github/workflows/ci.yml`

**Intent**: Run it in Actions too, where the full suite already runs.

**Contract**: one step invoking the same npm script. It must run after `npm ci` and needs no
database, so its position is free; keeping it next to the other test step reads best.

### Success Criteria

#### Automated Verification

- The whole gate passes: `npm run ci:gate`
- The gate's guard passes with the new step pinned: `npx vitest run --project unit ci-gate-source`
- Whole suite green: `npm test`

#### Manual Verification

- Proven to bite: remove the render step from `ci:gate`, confirm `ci-gate-source` now fails naming
  it, restore
- The Actions run for this phase's push is green and its log shows the render step

---

## Phase 4: Say what the guards do and do not reach

### Overview

Three documents carry sentences this change makes incomplete or wrong.

### Changes Required

#### 1. The scan's header

**File**: `scripts/check-client-bundle.mjs`

**Intent**: Its header explains that a framework leak "cannot happen" and cites `ServerOnlyModule`.
That citation is correct for the module-graph route and silent on the prop route — which is measured
reachable. Add the missing half.

**Contract**: a paragraph in the existing header naming the island-prop route, why this script cannot
see it (`dist/client` holds no HTML under `output: "server"`), and where the guard for it now lives.
Do not widen the scan's scope.

#### 2. `test-plan.md` §7 and §2

**File**: `context/foundation/test-plan.md`

**Intent**: Record the boundary, the new guards, and the correction.

**Contract**: a §7 entry describing the island-prop route, what each of the two new layers covers,
and the degraded-branch limitation of the sweep.

It must also state the type system's real share, because this change re-measured it and the first
reading was wrong in the project's own notes: `astro check` DOES reject an undeclared prop and a
field absent from the source object (two errors, measured), so the existing `CaretakerLabel`
discipline is an enforced guard, not a review convention. What it cannot reject is a secret passed to
a prop already declared `string` — which is exactly the leak this change guards. Say both halves;
the entry is worth nothing if it leaves a reader thinking types cover this, and it is actively
misleading if it leaves them thinking types cover nothing.

The archive itself is not edited. Update §2's Risk #6 row if its wording implies the bundle scan
covers the whole risk.

### Success Criteria

#### Automated Verification

- Docs prettier-clean: `npx prettier --check scripts/check-client-bundle.mjs context/foundation/test-plan.md`
- The gate still passes: `npm run ci:gate`

#### Manual Verification

- No sentence added describes something that does not exist
- The §7 correction names the real mechanism, and a reader can check it against `caretaker-name.ts`

---

## Testing Strategy

### Unit Tests

- `tests/unit/ci-gate-source.test.ts` gains the render step

### Render Tests

- `tests/render/island-props.test.ts` — every page, two secret assertions plus an island floor

### Manual Testing Steps

1. Add the frontmatter import to a page; confirm `npm run lint` fails; remove it.
2. Add a fixture passing the secret through an alias to an island; confirm the sweep fails; remove it.
3. Raise one island floor above what the page renders; confirm failure; restore.
4. Remove the render step from `ci:gate`; confirm the guard fails; restore.

## Performance Considerations

The sweep measured ~3 s for 11 pages with no build and no Docker. The publish gate is currently
~183 s cold, so this is noise.

## Migration Notes

Every change is additive and reversible in one commit each. The lint rule is the only one that can
reject code that previously passed, and it was verified clean against the current tree before being
added.

## References

- Research: `context/changes/testing-island-prop-leak/research.md`
- The follow-up that opened this: `context/archive/2026-09-11-ci-quality-gates/follow-ups/review-fixes.md` §1
- The claim being corrected: `context/archive/2026-09-11-testing-secret-leak/research.md:82`
- Control pattern: `scripts/check-client-bundle.mjs` (`controlHits`)
- Gate guard: `tests/unit/ci-gate-source.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The lint rule

#### Automated

- [x] 1.1 Lint passes unchanged on the current tree: `npm run lint` — c55fcf5
- [x] 1.2 Typecheck passes: `npm run check` — c55fcf5

#### Manual

- [x] 1.3 Proven to bite: a frontmatter import of `astro:env/server` fails lint naming the file and rule, then removed — planted in src/pages/dashboard.astro, failed at 2:1 with the rule name and the actionable message, then reverted — c55fcf5

### Phase 2: The render sweep

#### Automated

- [x] 2.1 The sweep passes: `npm run test:render`
- [x] 2.2 It renders every page under `src/pages/**` — 11 on disk, 11 floors, asserted by a control
- [x] 2.3 Existing suites unaffected: `npm test`
- [x] 2.4 Typecheck and lint: `npm run check`, `npm run lint`

#### Manual

- [x] 2.5 Proven to bite: a fixture routing the secret through an alias fails the sweep, then removed — through a DECLARED `string` prop, the shape `astro check` cannot see; both the resolved-value and the shape assertion fired, and the lint rule caught the same fixture independently
- [x] 2.6 The island floor proven live: raising one above what the page renders fails, then restored — 1 → 4 on periods/[id].astro failed with "expected 1 to be greater than or equal to 4"; 1 → 0 passes, since it is a floor and not an equality
- [x] 2.7 The failure message names the page and which half tripped

### Phase 3: Wire both into the publish gate

#### Automated

- [ ] 3.1 The whole gate passes: `npm run ci:gate`
- [ ] 3.2 The gate's guard passes with the new step pinned: `npx vitest run --project unit ci-gate-source`
- [ ] 3.3 Whole suite green: `npm test`

#### Manual

- [ ] 3.4 Proven to bite: removing the render step from `ci:gate` fails the guard, then restored
- [ ] 3.5 The Actions run is green and its log shows the render step

### Phase 4: Say what the guards do and do not reach

#### Automated

- [ ] 4.1 Docs prettier-clean: `npx prettier --check scripts/check-client-bundle.mjs context/foundation/test-plan.md`
- [ ] 4.2 The gate still passes: `npm run ci:gate`

#### Manual

- [ ] 4.3 No sentence added describes something that does not exist
- [ ] 4.4 The §7 correction names the real mechanism, checkable against `caretaker-name.ts`
