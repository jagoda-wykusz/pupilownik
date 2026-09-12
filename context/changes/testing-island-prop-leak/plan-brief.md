# Island-Prop Leak — Plan Brief

> Full plan: `context/changes/testing-island-prop-leak/plan.md`
> Research: `context/changes/testing-island-prop-leak/research.md`

## What & Why

A secret read in `.astro` frontmatter and passed to a `client:*` island is serialized into the SSR
response — not into `dist/client`. Measured: the build exits 0, `npm run check:secrets` reports
clean, and the key arrives in the browser verbatim inside `<astro-island props="…">`. This change
builds the two guards that can see that route.

## Starting Point

Nothing does this today. All 11 `client:load` sites were inventoried and no prop derives from
`astro:env/server`; the only two importers reduce the secrets to a boolean and to a Supabase client.
What protects the boundary is authorial discipline — visible in three places where a sensitive value
is deliberately stopped before a prop, and enforced by nothing.

## Desired End State

A `.astro` file that imports `astro:env/server` fails lint. Every page is rendered in CI and the
output is checked for the resolved secret and for anything key-shaped. Both run inside
`npm run ci:gate`, so a leak of this shape cannot publish. The scan's header and `test-plan.md` §7
say plainly which route each guard reaches.

## Key Decisions Made

| Decision                     | Choice                                     | Why (1 sentence)                                                                                     | Source   |
| ---------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- | -------- |
| How many layers              | Both lint and render                       | The rule blocks the first step cheaply; only the render sweep sees helpers, spreads and re-exports.  | Plan     |
| Lint shape                   | `no-restricted-imports` on `**/*.astro`    | Six lines, already inside the gate, and verified clean against the current tree.                     | Plan     |
| Custom ESLint rule           | No                                         | It would under-cover the sweep for half a day's work.                                                | Plan     |
| Render assertion             | Resolved value **and** shape patterns      | Under vitest `.env.test` overrides `.env` with a different key format, so value-only guards a fluke. | Research |
| Where the sweep runs         | `ci:gate` and Actions                      | A secret leak is the one thing that must not publish, and only the gate can stop it.                 | Plan     |
| Gated pages' degraded branch | Accepted, pinned by per-page island floors | Injecting a session would need Docker and push the sweep out of the gate.                            | Plan     |
| Archive correction           | Goes to §7, archive untouched              | Archived folders are read-only by convention.                                                        | Plan     |

## Scope

**In scope:** the lint rule; `vitest.render.config.ts`; `tests/render/island-props.test.ts`; a
`test:render` script; the gate chain and its guard; `.github/workflows/ci.yml`; the scan header and
`test-plan.md` §2/§7.

**Out of scope:** a custom ESLint rule; injecting an authenticated `locals`; editing
`context/archive/`; Risk #3's sensitive-instruction boundary; widening the bundle scan's scope.

## Architecture / Approach

```
.astro frontmatter ──imports──> astro:env/server        ← Phase 1 forbids this edge
        │
        └─prop──> <astro-island props="…"> ──> SSR response bytes   ← Phase 2 reads these
```

Astro cannot help here: `ServerOnlyModule` is keyed on which Vite environment resolves the module,
not on where the value flows, and serialization keeps every prop whether or not the component
declares it. So the guards have to be ours.

## Phases at a Glance

| Phase                 | What it delivers                                   | Key risk                                                          |
| --------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| 1. Lint rule          | The import edge is forbidden                       | Blunt — also bans legitimate server-only frontmatter use          |
| 2. Render sweep       | Every page rendered, output checked                | A green sweep can cover a quarter of a page; island floors fix it |
| 3. Wire into the gate | A leak of this shape cannot publish                | The gate's guard does **not** notice a new step by itself         |
| 4. Documents          | Both guards' reach stated; the old claim corrected | Writing a reach that is wider than what was built                 |

**Prerequisites:** none beyond the repo — the sweep needs no Docker and no build.
**Estimated effort:** ~1 session across 4 phases.

## Open Risks & Assumptions

- **The Container API is `experimental_`.** An Astro minor can change it; the sweep's header says so.
- **Island floors are measured-today values.** They must be raised when a page gains an island, which
  is a deliberate maintenance cost in exchange for the control being real.
- **The sweep sees degraded branches.** Gated pages render 1 island where the source has 4, so the
  sweep covers less of the most sensitive page than its page count suggests.

## Success Criteria (Summary)

- Planting the measured leak fails lint, and planting it through an alias fails the sweep.
- Removing either guard from the gate fails a test.
- No document claims a reach that the built guards do not have.
