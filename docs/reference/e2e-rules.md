# E2E rules — what is specific to THIS project

The generic rules — role-based locators, never `page.waitForTimeout()`, test independence plus
cleanup, unique ids, `storageState` for auth — already live in `CLAUDE.md`, installed there by
`@przeprogramowani/10x-cli`. They are not repeated here.

> `CLAUDE.md` is a CLI-managed fence (`<!-- BEGIN @przeprogramowani/10x-cli -->`) and a
> `10x-cli get` replaces its entire contents. **Nothing project-specific may be written inside
> it.** That is why these rules live here, and why `AGENTS.md` — which carries no fence — is what
> points at them.

This file carries only what the generic rules cannot know, each one grounded in something measured
in this repository rather than in general good practice.

## 1. The base URL must stay on loopback — and on this platform that means `localhost`

The rule is about **loopback**, not about one literal: `localhost`, `127.0.0.1` and `[::1]` are all
secure contexts and all satisfy it. What violates it is a LAN IP.

The caretaker capability cookie is set `Secure` (`src/lib/claim-cookie.ts`). Browsers accept such a
cookie over plain http on loopback. A dev server reached over a LAN IP (`http://192.168.x.x:4321`)
is **not** a secure context, and Chromium drops the cookie **silently**.

**Use `localhost`, measured 2026-09-13.** `astro dev` binds only to `[::1]` here — `netstat` shows a
single `[::1]:4321` listener, and a request to `127.0.0.1:4321` is refused. The first revision of
`playwright.config.ts` used `127.0.0.1` and its `webServer` block timed out after 120s waiting for a
server that had been ready in 8. If you ever pin the config to an IPv4 literal, you must also pass
`--host 127.0.0.1` to the dev server — and that breaks `reuseExistingServer` against a plain
`npm run dev`, which is worse (two `astro` processes on one `node_modules/.vite`; see rule 6).

The symptom is indistinguishable from a product bug: the claim succeeds, the reload renders the
pre-claim page, and it reads as "it didn't work". Two other edits produce that same single symptom
— a drifting cookie `Path`, and a non-positive `Max-Age` (which is why `MIN_AGE_SECONDS` exists).
If a caretaker test fails that way, rule this out before reading any product code.

## 2. Never make "the sensitive text is absent before a claim" a load-bearing assertion

This is anti-pattern #1 ("Hallucinated assertion") wearing local clothes, and it is worth naming
because the wording of Risk #4 invites it.

`context/foundation/test-plan.md` §7 records the measurement: _"the caretaker page was never the
secrecy boundary. `get_period_by_token` returns PUBLIC instruction rows only, so before a claim the
page is never handed a sensitive row or the trip note — there is nothing there to withhold."_

So a pre-claim absence check stays **green even when the page template is broken**, because the
data never reaches the template. It is a fine cheap co-assertion; it is not a guard. The assertion
that guards Risk #4 at browser level is the **positive** one — after a real claim, the sensitive
tier is on screen — because that one goes red when the cookie chain breaks.

Control question, applied to every assertion: _would this fail if the risk materialised?_ If the
answer needs a paragraph, the answer is no.

## 3. Seeding goes through the anon-keyed client, never service-role

Fixtures build their data with a client keyed by the publishable (anon) key and signed in as a real
owner, exactly as `tests/helpers/auth.ts` does. The service-role key bypasses RLS, so a fixture
using it performs a different operation from the one the app performs, and every surrounding
assertion becomes a tautology.

Consequence to accept rather than work around: anything the fixture cannot do is something the
owner genuinely cannot do.

## 4. Cleanup goes through the database, because the UI has no delete

There is no delete affordance for a pet anywhere in this app — no button in
`src/pages/pets/index.astro`, nothing in `AddPetForm`, and `/api/pets` exposes POST only. A spec
that creates data therefore tears it down through an owner-scoped client (`tests/e2e/fixtures/owner.ts`).
This is forced, not preferred; if a delete route ever ships, prefer the UI.

## 5. No retries — not even in CI

`playwright.config.ts` sets `retries: 0` everywhere. A retry turns a flake green, and this
repository's whole testing posture is that a green result is not evidence unless you know why it is
green (`context/foundation/lessons.md`). A flake here is a signal about isolation or about a real
race; both are worth reading. Change this only against a measured flake rate.

## 6. Kill the dev server before `build`, `astro check` or `git commit`

`playwright.config.ts` uses `reuseExistingServer` outside CI, so the suite attaches to a dev server
you already have running. `astro dev` and `astro build` share `node_modules/.vite`, and the
pre-commit hook runs `astro check` — so after any build, check or commit, that server is serving
URLs that no longer exist. The failures read as React or SSR bugs (`Invalid hook call`,
`more than one copy of React`, empty SSR), never as a cache problem. See
`context/foundation/lessons.md`, which records this biting three times.

## 7. Call `waitForHydration(page)` before touching any island

Measured 2026-09-13, and it cost a debugging round on the very first test written here.

This app's forms are controlled React inputs inside `client:load` islands. The server sends
`<input value="">`; if a test fills it before React mounts, hydration runs `useState("")` and resets
the node to empty. The form then submits blank and fails on the app's own validation
(`Imię zwierzęcia jest wymagane`) — which reads exactly like a product bug.

Filling is the loud case. **Clicking is the silent one**: a click on an un-hydrated button has no
handler, so nothing happens and the test fails later, elsewhere, on a missing consequence. The
caretaker flow's `ClaimSlots` is that shape.

`tests/e2e/fixtures/hydration.ts` waits until no `<astro-island>` still carries the `ssr` attribute
that Astro removes on hydration — a framework-provided readiness bit, verified against the live
server's HTML. It is the one sanctioned exception to rule "never locate by DOM structure": it
locates no user-facing element and asserts nothing about the product.

```ts
await page.goto("/pets/new");
await waitForHydration(page);
await page.getByLabel("Imię", { exact: true }).fill(petName);
```

## 8. Prefer `{ exact: true }` on `getByLabel`

`getByLabel` matches on a **substring**. On the sign-in form `getByLabel("HASŁO")` resolves to two
elements — the password input, and `PasswordToggle`'s button whose accessible name is
"Pokaż hasło". Strict mode then fails. Exact matching is the default choice here, not the fallback.

## 9. Wait on state, not on a URL, after an auth redirect

`/api/auth/signin` answers `redirect("/")`, but `/` is itself a redirect and the browser lands on
`/periods`. An exact-URL wait never settles and pins a route the test has no opinion about. Assert
a signed-in affordance instead — `getByRole("button", { name: "Wyloguj" })`, which exists only once
a session does and is absent on the `?error=` bounce-back.

## Where things live

| Thing                              | Path                                                  |
| ---------------------------------- | ----------------------------------------------------- |
| Config                             | `playwright.config.ts`                                |
| Specs                              | `tests/e2e/*.spec.ts`                                 |
| Seed exemplar                      | `tests/e2e/seed.spec.ts`                              |
| Session capture                    | `tests/e2e/auth.setup.ts`                             |
| Fixtures                           | `tests/e2e/fixtures/`                                 |
| Hydration wait                     | `tests/e2e/fixtures/hydration.ts`                     |
| Owner client (cleanup)             | `tests/e2e/fixtures/owner.ts`                         |
| Generic rules + five anti-patterns | `CLAUDE.md`, and `.claude/skills/10x-e2e/references/` |
