# Secret-Leak Assertions (Risk #6) — Plan Brief

> Full plan: `context/changes/testing-secret-leak/plan.md`
> Research: `context/changes/testing-secret-leak/research.md`

## What & Why

Rollout phase 3 owes Risk #6 three things: prove no secret reaches the client bundle, prove none escapes an error body or log, and gate it in CI. Research measured all three and **none of them is what the test plan assumed**. The bundle is clean and structurally so; the real disclosure is an upstream auth error in a URL; and the CI gate has nowhere to live because there is no CI.

## Starting Point

`dist/client` is clean against every pattern tested — not even the publishable key reaches the browser, because the browser never talks to Supabase. Env is a runtime binding with no build-time substitution, and Astro hard-fails the build on a client-side `astro:env/server` import. Meanwhile `signin.ts:16` and `signup.ts:16` forward the raw GoTrue `error.message` into a query string, `/auth` gets no `no-referrer` header, and no CI has run on push since 2026-06-27.

## Desired End State

A `PUBLIC_` rename or a hardcoded key literal fails a test. Signing in with a wrong password, an unknown address or an unconfirmed email produces one identical sentence and a clean URL. `test-plan.md` §5 describes the gates that exist rather than a phantom CI, and four route comments justify their practice with the reason that is actually true.

## Key Decisions Made

| Decision               | Choice                                                | Why (1 sentence)                                                                              | Source   |
| ---------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------- |
| Auth error in URL      | Fix and pin                                           | The one live disclosure, and a user-enumeration oracle on signup.                             | Plan     |
| Replacement copy       | One sentence for every failure                        | Wrong password, unknown address and unconfirmed email must be indistinguishable.              | Plan     |
| Where the check lives  | Script + unit test                                    | Runs today without CI; wires in one line when CI returns.                                     | Plan     |
| Schema-shape assertion | In                                                    | It is the only check that catches a `PUBLIC_` rename _before_ the artifact.                   | Plan     |
| Grep target            | `dist/client` only                                    | `dist/server/.dev.vars` holds real values by design; a `dist/` grep fails on a correct build. | Research |
| Grep tokens            | Literal values, `sb_secret_`, JWT shape, project host | `service_role` is JSDoc prose inside bundled supabase-js.                                     | Research |
| Prose corrections      | Both, here                                            | Four comments and §5 are this phase's measurements; unwritten they are lost.                  | Plan     |
| CI                     | Out of scope                                          | Restoring it is an infrastructure change; folding it in repeats `b1fd059`'s mistake inverted. | Plan     |

## Scope

**In scope:** `scripts/check-client-bundle.mjs` + `npm run check:secrets`; unit tests for the bundle check and the env schema; `signin.ts`/`signup.ts` stop forwarding upstream errors and configuration state; an integration test pinning redirect uniformity; corrections to four route comments and to `test-plan.md` §5/§6.6/§7.

**Out of scope:** restoring CI; chaining the check into `npm run build`; the four authenticated routes that disclose configuration state to a signed-in owner; `dist/server/.dev.vars`; `pets.ts`'s zod `issues`; mapping GoTrue codes to Polish sentences; e2e.

## Architecture / Approach

Three phases ordered by how much each can fail. Phase 1 is structural and narrow — it cannot catch a framework leak, only a hardcoded literal, and it says so. Phase 2 is the only phase that changes user-visible behaviour and the only one closing a live disclosure. Phase 3 writes down what was measured, including the two places the prose was wrong.

## Phases at a Glance

| Phase                  | What it delivers                                 | Key risk                                                 |
| ---------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| 1. Artifact and schema | Bundle check, `check:secrets`, schema-shape test | A check that silently passes on a stale or missing build |
| 2. Auth routes         | No upstream error or config state in a URL       | Losing the "unconfirmed email" hint is a real UX cost    |
| 3. Prose               | Four comments corrected; §5 describes reality    | Writing a new claim that is also unverified              |

**Prerequisites:** local Supabase stack for phase 2; a fresh `npm run build` for phase 1; dev server killed before any build, check or commit.
**Estimated effort:** ~1–2 sessions across 3 phases; smaller than the preceding change.

## Open Risks & Assumptions

- The bundle assertion is narrow by construction. If it is ever described as "secret-leak detection" it will be over-trusted — the file header and §7 both have to keep saying what it does not do.
- Swallowing the sign-in error removes a genuine hint for users with unconfirmed accounts. The decision accepts that cost; watch for support friction.
- §5 is being rewritten by the same process that got it wrong before. Every present-tense claim must be read against the repo at the moment of writing (`lessons.md`).
- No CI remains the largest open issue in the project and this change deliberately does not address it.

## Success Criteria (Summary)

- A pasted key literal or a `context: "client"` schema entry fails a test.
- Three different sign-in failures produce one identical URL and one identical sentence, with no GoTrue wording anywhere.
- `test-plan.md` §5 names only gates that exist, and says plainly that no CI does.
