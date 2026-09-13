import { test, expect } from "./fixtures/invite";
import { waitForHydration } from "./fixtures/hydration";

// Risk #4 ∩ #6 (context/foundation/test-plan.md §2), at the one layer that can see them together.
//
//   #4 — sensitive instructions (address, access codes) shown before a slot is claimed, or to
//        someone outside the invite link.
//   #6 — sensitive text escaping into the client bundle, logs, or error bodies.
//
// WHAT IS LOAD-BEARING HERE, AND WHAT IS NOT. Read this before adding an assertion.
//
// The load-bearing assertion is the POSITIVE one: after a real claim in a real browser, the
// sensitive tier is on screen. It is load-bearing because the chain it exercises is not covered
// anywhere else — the React island posts the claim, `/invite/claim` answers a `Set-Cookie` with
// four attributes, THE BROWSER'S OWN COOKIE JAR decides whether to keep it, the island reloads,
// and the server re-reads it to render the sensitive rows. `tests/api/invite-claim.test.ts` drives
// that route with a FAKE cookie jar (`createFakeCookies`), so it records the attributes and no
// browser ever enforces them. Three separate edits — a LAN-IP base URL, a drifting `Path`, a
// non-positive `Max-Age` — all produce the same silent symptom this assertion is here to catch:
// the claim succeeds and the reload renders the pre-claim page (see src/lib/claim-cookie.ts).
//
// The pre-claim absence check below is a CHEAP CO-ASSERTION, NOT A GUARD, and must never be
// promoted to one. test-plan.md §7 measured why: "the caretaker page was never the secrecy
// boundary. `get_period_by_token` returns PUBLIC instruction rows only, so before a claim the page
// is never handed a sensitive row or the trip note — there is nothing there to withhold." Break
// the template and it stays green, because the data never arrives. Confirmed again here on
// 2026-09-13: the pre-claim HTML does not contain the sensitive body at all. What DOES defend that
// boundary is `tests/rls/reveal-instructions.test.ts`, one layer down and far cheaper.
//
// BOUNDARIES. Everything is real — auth, routing, the two SECURITY DEFINER doors, Postgres, the
// cookie jar. Nothing is mocked, and there is nothing here worth mocking: this flow calls no
// external API, so the usual "mock the expensive non-deterministic third party" carve-out has no
// subject. Mocking any of the boundaries above would delete the test's entire reason to exist.
//
// Three tests in one file — a deliberate departure from "one test per file". This repository's
// convention is many related tests per file (tests/rls/*, tests/api/*), and all three share one
// seeded trip shape. Each seeds its OWN trip through the fixture, so they stay order-independent.

// The caretaker has no account and never will (PRD §Non-Goals). Drop the owner storageState the
// chromium project injects — with it, these pages would be fetched by a signed-in owner and the
// test would no longer describe the person the risk is about.
test.use({ storageState: { cookies: [], origins: [] } });

test("sensitive instructions reach the caretaker only after a slot is claimed", async ({ page, trip }) => {
  await page.goto(`/invite/${trip.token}`);
  await waitForHydration(page);

  // Pre-claim. The public tier is served to anyone holding the link...
  await expect(page.getByText(trip.publicTitle, { exact: true })).toBeVisible();
  // ...and the hint that explains the withholding is shown only before a claim.
  await expect(page.getByText("Część wskazówek", { exact: false })).toBeVisible();

  // CO-ASSERTION, not a guard — see the header. Kept because it is free and would notice a
  // truly gross regression, and labelled so nobody credits it with more.
  await expect(page.getByText("Tylko dla opiekuna")).toBeHidden();
  await expect(page.getByText(trip.secretBody, { exact: true })).toBeHidden();

  // The claim. A slot card's accessible name is composed of the time-of-day label, its status
  // pill and its call to action ("Rano WOLNE Wolny termin — możesz go wziąć. Zapisuję się"), so
  // anchor on the part that identifies it rather than matching the whole string.
  await page.getByRole("button", { name: /^Rano/ }).click();
  await page.getByLabel("TWOJE IMIĘ", { exact: true }).fill("Ania E2E");
  await page.getByRole("button", { name: /^Zapisuję się \(1\)$/ }).click();

  // THE LOAD-BEARING ASSERTIONS. The island reloads the page after a successful claim, so what is
  // asserted here is the server's re-render, reached only because the browser kept the cookie.
  await expect(page.getByText("Zapisano, Ania E2E!")).toBeVisible();
  await expect(page.getByText("Tylko dla opiekuna")).toBeVisible();
  await expect(page.getByText(trip.secretTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(trip.secretBody, { exact: true })).toBeVisible();

  // The trip note rides the same reveal rule as the sensitive rows, and is composed by a different
  // branch (`composeCaretakerView` returns it only for a proven claim), so it is worth its own line.
  await expect(page.getByText(trip.note, { exact: true })).toBeVisible();
});

test("the revealed sensitive tier never reaches an island's serialized props", async ({ page, trip }) => {
  // Risk #6 at the edge nothing else can see. `tests/render/island-props.test.ts` renders this page
  // with NO middleware and NO session, so it takes the degraded branch and has never once seen a
  // page that actually holds sensitive rows; and `npm run check:secrets` scans `dist/client`, which
  // under `output: "server"` contains no HTML at all. Only a real post-claim page has both the data
  // and the island on it at the same time.
  await page.goto(`/invite/${trip.token}`);
  await waitForHydration(page);

  await page.getByRole("button", { name: /^Rano/ }).click();
  await page.getByLabel("TWOJE IMIĘ", { exact: true }).fill("Basia E2E");
  await page.getByRole("button", { name: /^Zapisuję się \(1\)$/ }).click();
  await expect(page.getByText("Tylko dla opiekuna")).toBeVisible();

  // HALF ONE, and it is what stops half two from passing vacuously: the reveal really happened, so
  // the sensitive body IS in the bytes this response sent. Without this line, a silently failed
  // claim would satisfy the absence check below and the test would protect nothing.
  const html = await page.content();
  expect(html).toContain(trip.secretBody);

  // HALF TWO, the guard. Astro serializes EVERY prop of a `client:*` island into the `props`
  // attribute, declared by the component or not — so handing `details` to <ClaimSlots /> would ship
  // the sensitive tier to the browser as data while the visible page looked identical. Read the
  // attribute values specifically rather than grepping the page: the sensitive text is legitimately
  // present in the rendered body, so a page-wide substring check could never distinguish the two.
  const islandProps = await page
    .locator("astro-island")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("props") ?? ""));

  // The control: a page with no islands would make every assertion below vacuous.
  expect(islandProps.length).toBeGreaterThan(0);

  for (const props of islandProps) {
    expect(props).not.toContain(trip.secretBody);
    expect(props).not.toContain(trip.secretTitle);
    expect(props).not.toContain(trip.note);
  }
});

test("a browser without the capability cookie sees no sensitive tier on the same link", async ({
  page,
  browser,
  trip,
}) => {
  // The "or to someone outside the invite link" half of Risk #4, in its sharpest form: the outsider
  // holds the SAME valid link. What they lack is the capability cookie. This is what proves the
  // reveal is gated on the claim rather than on the token.
  await page.goto(`/invite/${trip.token}`);
  await waitForHydration(page);
  await page.getByRole("button", { name: /^Rano/ }).click();
  await page.getByLabel("TWOJE IMIĘ", { exact: true }).fill("Celina E2E");
  await page.getByRole("button", { name: /^Zapisuję się \(1\)$/ }).click();
  await expect(page.getByText("Tylko dla opiekuna")).toBeVisible();

  // A genuinely separate browser context: its own cookie jar, no capability, nothing shared.
  const outsiderContext = await browser.newContext();
  try {
    const outsider = await outsiderContext.newPage();
    // Absolute URL built from the page under test, so this does not hardcode a host a manually
    // created context would not inherit from the config.
    await outsider.goto(new URL(`/invite/${trip.token}`, page.url()).href);

    // The link still works — this is not a dead-link assertion, which would pass for the wrong
    // reason. The trip is visible; the sensitive tier is not.
    await expect(outsider.getByText(trip.publicTitle, { exact: true })).toBeVisible();
    await expect(outsider.getByText("Tylko dla opiekuna")).toBeHidden();
    await expect(outsider.getByText(trip.secretBody, { exact: true })).toBeHidden();
    await expect(outsider.getByText(trip.note, { exact: true })).toBeHidden();

    // And the claim someone else made is not attributed to them.
    await expect(outsider.getByText("Zapisano,", { exact: false })).toBeHidden();
  } finally {
    await outsiderContext.close();
  }
});
