# First E2E test — the caretaker reveal chain — Plan Brief

> Full plan: `context/changes/e2e-invite-reveal/plan.md`

## What & Why

Risk #4 in `context/foundation/test-plan.md` — sensitive instructions (address, access codes) shown
before a slot is claimed, or to someone outside the invite link — is covered at the SQL door, at the
composition function and at the claim route. What no test crosses is the chain between them: island
→ `/invite/claim` → `Set-Cookie` → the browser's own cookie jar → reload → SSR. That chain has three
documented failure modes that all look identical and all read as "it didn't work", and none of them
is visible below a real browser.

## Starting Point

`context/archive/2026-09-11-testing-domain-guardrails/plan.md:35` closed Phase 4 with e2e explicitly
off the table: _"No e2e runner, no Astro Container API, no rendered-HTML assertions… §4 defers
Playwright to post-Phase-4."_ This change is that post-Phase-4. Playwright is not installed; §5's
gate table still reads `e2e on critical flows | — | not present`.

## Desired End State

`npm run test:e2e` drives a real Chromium through a real claim on a freshly seeded trip and proves
two things that nothing else can: the sensitive tier appears after the claim, and it appears only in
the server-rendered body — never inside an island's serialized props. A second, cookie-less context
on the same link sees neither. The suite passes twice in a row without manual cleanup.

## Key Decisions Made

| Decision                        | Choice                                        | Why (1 sentence)                                                                                                                                                                         |
| ------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Load-bearing assertion          | Post-claim reveal + absence from island props | §7 measured that pre-claim absence cannot fail on a template break — the data never arrives — so making it the guard would ship a naive assertion.                                       |
| Seeding                         | Playwright fixture on `tests/helpers/`        | Reuses the anon-keyed harness and the shared leak constants; a UI prologue would make a setup failure read as a Risk #4 failure.                                                         |
| Where it runs                   | Local + GitHub Actions, never `ci:gate`       | The Cloudflare build container has no Docker, so `supabase start` cannot run there — the same forced split §5 already applies to the integration suite.                                  |
| `seed.spec.ts` scope            | Owner path, with `storageState`               | The caretaker path is deliberately account-less, so the lesson's `storageState` deliverable belongs on the owner side, where it is also the pattern future Risk #1/#2 tests will copy.   |
| Playwright in `package.json`    | Ordinary `devDependency`                      | Measured: `playwright@1.63.0` declares no `scripts` field, so the `supabase` install-hook failure class does not apply — and optional would break `astro check` inside the publish gate. |
| Risk #3                         | Out of scope                                  | Browser-level concurrency is the flakiest possible proof of atomicity, and two cheaper tests already hold it.                                                                            |
| Who drives each phase           | 1 and 3 `/10x-implement`, 2 `/10x-e2e`        | `/10x-e2e`'s own SKILL.md refuses to install Playwright, scaffold configs or wire CI, and stops when no config exists — so phase 1 is its prerequisite, not its job.                     |
| Home of the project's E2E rules | `AGENTS.md` + `docs/reference/e2e-rules.md`   | `CLAUDE.md` is a CLI-managed fence that `get m3l4` overwrote wholesale; anything written inside it is lost on the next `get`.                                                            |

## Scope

**In scope:** Playwright + config + `storageState`; `tests/e2e/seed.spec.ts`; `docs/reference/e2e-rules.md`;
the Risk #4 ∩ #6 spec with its seeding fixture; two independent mutation proofs; a CI job;
reconciliation of `test-plan.md` §4, §5, §6, §7.

**Out of scope:** Risk #3; visual/screenshot regression and vision mode; any production code change;
wiring into `ci:gate`; Playwright MCP and the planner/generator/healer agents; owner-side risk
coverage beyond the seed test.

## Architecture / Approach

```
fixture (anon-keyed, tests/helpers)  →  owner + pet + PUBLIC & SENSITIVE instruction + period + token
                                              │
caretaker context ── /invite/<token> ── pick slot ── POST /invite/claim ── Set-Cookie(HttpOnly,
     Secure, SameSite=Lax, Path=/invite) ── reload ── get_period_by_token + get_claimed_details
     ── composeCaretakerView ── SSR
                                              │
                        assert: sensitive tier visible  AND  absent from <astro-island props>
outsider context (no cookie, same link)  ──►  assert: neither
```

## Phases at a Glance

| Phase                                      | What it delivers                                                 | Key risk                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1. Runner, config, storageState, seed test | `npm run test:e2e` runs; conventions documented and demonstrated | `tests/e2e/` is inside the tsconfig include, so the specs must typecheck in the publish gate they never run in |
| 2. The Risk #4 ∩ #6 test                   | The spec plus two independent mutation proofs                    | A mutation that silently fails to apply, or one that reddens both assertions and so proves neither             |
| 3. CI wiring + document reconciliation     | Actions job; `test-plan.md` §4/§5/§6/§7 made true                | Correcting a claim in one table and leaving another saying the old thing — this repo has done it twice         |

**Prerequisites:** local Supabase up (`npm run db:start`), `.env.test` present, dev server on 4321,
`npx playwright install chromium`.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- The claim cookie is `Secure`, so the base URL must stay `127.0.0.1` / `localhost`; a LAN IP makes
  the browser drop it silently and the test fails for a reason unrelated to the risk.
- Playwright's `reuseExistingServer` attaches to a developer's running dev server, which makes the
  repo's standing `node_modules/.vite` hazard more likely, not less — kill dev before any build,
  `astro check` or commit.
- The Actions job reports but cannot block: the repo is private on GitHub Free.
- Assumption to verify in Phase 2: the sensitive tier is currently absent from island props. The
  plan asserts it because the page's comment claims it; Mutation B is what turns that claim into a
  guarded property.

## Success Criteria (Summary)

- A caretaker who claims a slot sees the sensitive tier — and breaking the cookie's `Path` turns
  that test red while leaving the outsider test green.
- The sensitive body never appears inside an island's props — and handing `details` to the island
  turns that test red while leaving the reveal test green.
- The suite runs twice back-to-back clean, and `test-plan.md` says what is true, including what this
  test still cannot fail on.
