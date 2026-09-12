---
date: 2026-09-12T17:28:17+02:00
researcher: jagoda.wykusz
git_commit: 3655a23
branch: master
repository: pupilownik
topic: "Can a server-only secret reach the browser through a client island's props, where the bundle scan cannot look?"
tags: [research, codebase, risk-6, astro-islands, ssr, secret-leak, container-api]
status: complete
last_updated: 2026-09-12
last_updated_by: jagoda.wykusz
last_updated_note: "Withdrew a criticism of an archived claim after measuring astro check"
---

# Research: the island-prop route out of the server

**Date**: 2026-09-12T17:28:17+02:00
**Researcher**: jagoda.wykusz
**Git Commit**: `3655a23`
**Branch**: master
**Repository**: pupilownik

## Research Question

Rollout phase 3's Risk #6, reopened at a level the assertion layer did not reach: a value imported
from `astro:env/server` in `.astro` frontmatter and passed as a prop to a `client:*` island is
serialized into the SSR response, never into `dist/client`. Is that actually reachable, is it
happening today, and what would close it?

Scope: **environment secrets only**. Sensitive domain data crossing the same boundary belongs to
Risk #3, which already has coverage.

## Summary

**The gap is real, and it is now measured rather than argued.** A deliberate leak was planted,
built and served:

| Question                                             | Answer                           |
| ---------------------------------------------------- | -------------------------------- |
| Does Astro reject a secret passed to an island prop? | **No** — `npm run build` exits 0 |
| Does the value reach `dist/client`?                  | No                               |
| Does `npm run check:secrets` report it?              | **No — it reports `clean`**      |
| Does the value reach the HTTP response?              | **Yes, verbatim**                |

The response carried it in the island's own attribute:

```html
<astro-island … props='{"probeValue":[0,"<<<THE-KEY>>>"]}' ssr client="load"></astro-island>
```

**But nothing does this today.** Every one of the 11 `client:load` sites was inventoried: no prop
carries a value derived from `astro:env/server`. The only two importers are `src/lib/config-status.ts`,
which reduces both secrets to a boolean, and `src/lib/supabase.ts`, which passes them to
`createServerClient` and returns a client no page hands to an island.

So this change would build a **regression guard, not a fix**. What protects the boundary today is
authorial discipline, and three places prove the team sees it — `claim_digest`, `claimed_by_name`
and `revoked_at` are each deliberately stopped before a prop. Nothing checks that the next person
sees it too.

**A claim I first judged wrong turns out to be right, and the correction matters more than the
original criticism.** `context/archive/2026-09-11-testing-secret-leak/research.md:82` records
`claim_digest` as "guarded by `CaretakerLabel`'s prop type", and four comments in `src/` say the same
thing more precisely — `src/lib/caretaker-name.ts:110-118` calls it turning "a leak into a type error
instead of a review catch".

**Measured: it does.** Planting `leakedDigest={claimed.claim_digest}` on the island in
`src/pages/periods/[id].astro` fails `npm run check` on two independent grounds —
`ts(2339)` because `groupCaretakers` already dropped the field from the object, and `ts(2322)`
because the prop is not on the component's `Props`. `astro check` runs in both the pre-commit hook
and the publish gate, so that is a real, enforced guard.

**What the type does NOT cover is the whole of this research.** It stops a value that is absent from
the source object or a prop the component never declared. It cannot stop a secret handed to a prop
the component **does** declare, because a secret is a `string` and so is the prop — the measured leak
used `probeValue: string`, and passing `SUPABASE_KEY` to `SignInForm`'s `serverError` would type-check
today. Nor does it survive an `any`, a cast, or a spread of a wider object. So the boundary is
type-guarded on one path for one shape, and unguarded for the shape that actually leaks.

## Detailed Findings

### 1. The mechanism, from Astro's source

`runtime/server/hydration.js:64` keeps every non-`client:*` key; `runtime/server/serialize.js:33-48`
walks `Object.entries` with no filter, so **props a component never declares are serialized anyway**;
`hydration.js:103` writes `escapeHTML(serializeProps(props))` into the `props` attribute; and
`render/component.js:324` renders the element with `shouldEscape = false`, so there is no second
pass. The HTML entities are an injection defence, not a confidentiality one — `getAttribute` returns
the unescaped text and `JSON.parse` restores the original string (`astro-island.js:164`).

**Why `ServerOnlyModule` does not fire.** `env/vite-plugin-env.js:64-69` throws only when
`astro:env/server` is resolved in the **client** Vite environment. It is a module-graph check keyed
on environment name, not a data-flow check. A `.astro` frontmatter import resolves in `ssr`, so the
module loads and the secret becomes an ordinary string binding with no taint marker
(`vite-plugin-env.js:143-149`). By the time it reaches serialization it is indistinguishable from
any other string.

This matters because `scripts/check-client-bundle.mjs`'s header cites exactly that guard as the
reason a framework leak "cannot happen". The citation is true for the module-graph route and silent
on the prop route.

### 2. What crosses the boundary today (all 11 sites)

| Prop source               | Sites | Example                                                    |
| ------------------------- | ----- | ---------------------------------------------------------- |
| Cookie (3-way theme enum) | 5     | `initialTheme={theme}`                                     |
| URL query / origin        | 3     | `serverError={error}`, `origin={Astro.url.origin}`         |
| `Astro.params`            | 1     | `token={token}` on `ClaimSlots`                            |
| Database rows             | 4     | `pets={pets}` (`id, name` only), `byDay`, `periodId`       |
| Derived booleans          | 3     | `hasCapability={details !== null}`, `revoked={… !== null}` |
| **`astro:env/server`**    | **0** | —                                                          |

`token={token}` is the raw invite token, which is the path segment the caretaker already typed to
reach the page — the page's own comment records that, corrected during a previous review. The
capability secret never crosses; only a boolean does, and `CLAIM_COOKIE` is HttpOnly.

`byDay` is built by `get_period_by_token`, whose SQL assembles the slot objects key by key and
carries an in-SQL comment that `claimed_by_name` and `claim_digest` must never appear.

### 3. Three ways to close it, all priced

**A — `no-restricted-imports` scoped to `**/\*.astro`.** Verified: **no `.astro`file imports`astro:env/server`today**, so the rule passes clean immediately and forbids the necessary first
step of the measured leak. About six lines in`eslint.config.js`, already inside `npm run ci:gate`via`npm run lint`. Blunt — it bans the import even for legitimate server-only frontmatter use —
which costs nothing in this codebase today.

**B — a rendered-output sweep via Astro's Container API.** Verified by running it:
`experimental_AstroContainer` exists in astro 6.3.1 (`package.json` exports `./container`), and a
sweep rendered **all 11 pages in ~3 s** with no build, no dev server and no Docker. A fixture page
routing the secret through an alias produced the key **verbatim** in the rendered HTML, so this path
catches indirection that no source rule can see.

Three conditions found while running it, each load-bearing:

- The Cloudflare adapter rejects vitest's SSR externals, so the config must import the real
  `astro.config.mjs` and drop **only** `adapter`. Retyping the config instead loses `fonts` and every
  render dies with `FontFamilyNotFound`.
- **Gated pages render their degraded branch.** Measured island counts: `periods/[id].astro` rendered
  **1** island where the source has **4**; `invite/[token].astro` rendered 1 of 2. A naive sweep would
  be green while covering a quarter of the most sensitive page. A per-page minimum-island assertion
  is required, in the same idiom as the scan's `controlHits`.
- It cannot join the existing vitest projects: `vitest.config.ts` aliases `astro:env/server` to a
  shim and does not use `getViteConfig`. It needs its own config, its own script and a new link in
  `ci:gate` — which also means updating `tests/unit/ci-gate-source.test.ts`, whose assertions pin the
  gate's exact step list.

**C — a source-level guard in this repo's idiom.** `astro-eslint-parser` can be imported in a test
(through its CJS entry) and yields one AST spanning frontmatter and template. But it returns
`scopeManager: false`, so binding resolution would be hand-rolled — path A's rule reimplemented
without ESLint's scope manager. Its only advantage is a global sweep control, which path B also has,
against real output.

### 4. A trap neither agent surfaced

Under vitest the Vite mode is `test`, so `.env.test` is loaded **and overrides `.env`**. Measured:

```
.env       SUPABASE_KEY=sb_publish…   (46 chars, current format)
.env.test  SUPABASE_KEY=eyJhbGciOi…   (153 chars, legacy JWT)
```

The container probe read the 153-character one. So a render assertion written as "the response must
not contain `SUPABASE_KEY`" guards **whichever throwaway key the test environment resolves**, not the
production value — structurally the same problem `check-client-bundle.mjs` solved with
`SECRET_SCAN_HOSTS`. Shape-based patterns (`sb_publishable_`, `sb_secret_`, an anchored JWT) are what
make such an assertion independent of which key is loaded.

## Code References

- `node_modules/astro/dist/runtime/server/hydration.js:64,103` — every non-directive prop kept, then serialized into the attribute
- `node_modules/astro/dist/runtime/server/serialize.js:33-48` — no filter against the component's declared props
- `node_modules/astro/dist/env/vite-plugin-env.js:64-69` — the `ServerOnlyModule` throw, keyed on the Vite environment
- `scripts/check-client-bundle.mjs` header — cites that throw as the reason a framework leak cannot happen
- `src/lib/config-status.ts:14` and `src/lib/supabase.ts:10` — the only two consumers of the secrets
- `src/lib/caretaker-name.ts:120-125,171-177` — the digest dropped by construction, not by type
- `src/pages/invite/[token].astro:457` — `token={token}`, the raw path segment
- `tests/unit/env-schema.test.ts` — pins the config's intent; would not prevent this leak

## Architecture Insights

- **Both existing gates are the wrong shape for this leak.** `env-schema.test.ts` asserts
  configuration text; `check-client-bundle.mjs` scans a build artifact. This is a data-flow leak into
  a per-request response, which lives in neither.
- **`output: "server"` is what moves the target.** With a static build the secret would land in HTML
  inside `dist/client` and the existing scan would catch it. SSR moves the disclosure to a byte
  stream no artifact retains — which is why `dist/client` contains zero HTML files.
- **A prop type is a partial boundary, enforced at build rather than at runtime.** `astro check`
  rejects an undeclared prop and a field absent from the source object — measured. It cannot reject a
  secret passed to a prop whose declared type is `string`, which is the shape that leaks, and it is
  bypassed by `any`, a cast, or a spread. Astro's runtime ignores declarations entirely
  (`serialize.js:33-48`), so nothing catches those at request time.

## Historical Context (from prior changes)

- `context/archive/2026-09-11-testing-secret-leak/research.md:82` — the "guarded by the prop type"
  sentence. Re-measured and upheld: `astro check` does reject the mistake it describes. This document
  first judged it wrong and that judgement is withdrawn; the gap is narrower than "the type does not
  guard" and sharper — the type cannot see a secret passed to a `string` prop.
- `src/lib/caretaker-name.ts:110-118`, `src/components/periods/ReleaseSlotButton.tsx:22-24`,
  `src/pages/periods/[id].astro:45-49`, `src/pages/invite/[token].astro:448-456` — four places where
  this codebase already reasons about island-prop serialization correctly, including the one
  deliberate exception (the invite token, which the reader already holds).
- `context/archive/2026-09-11-ci-quality-gates/follow-ups/review-fixes.md` §1 — where this change came
  from, including the two closing paths it proposed.
- `context/foundation/test-plan.md` §2 Risk #6, §5, §6.6 — all three describe the reach as "a secret
  literal pasted into a client island"; island props and the SSR response body appear in neither the
  scope nor the deliberate exclusions of §7.

## Related Research

- `context/archive/2026-09-11-testing-secret-leak/research.md` — the pass that built the assertion layer this one extends
- `context/archive/2026-09-11-ci-quality-gates/research.md` — the gate the leak slips past

## Open Questions

1. **Which paths does the plan take — A, B, or both?** They cover different things: A fails fast and
   in the editor but only sees the direct import; B reads the bytes that ship and catches every
   indirection, at the cost of a second vitest config and a new link in the publish gate.
2. **How should a render assertion be written so it is not tied to whichever key `.env.test`
   resolves?** Shape patterns, the resolved value, or both.
3. **Does the sweep run in `ci:gate` or only in GitHub Actions?** It needs no Docker, so the gate is
   possible — but it adds a second config to a chain whose exact step list is pinned by a test.
4. **Should `check-client-bundle.mjs`'s header gain a line naming this route?** It is unusually honest
   about its own reach, and this is the one case where its stated reason is sound but incomplete.
5. **Is the degraded-branch limitation acceptable?** Lighting up all four islands on `periods/[id].astro`
   needs an injected authenticated `locals`, which turns a 3-second Docker-free sweep into an
   integration test.
