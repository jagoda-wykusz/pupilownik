import { test, expect } from "@playwright/test";
import { ownerClient } from "./fixtures/owner";
import { waitForHydration } from "./fixtures/hydration";

// THE SEED TEST — the exemplar every generated E2E test in this project is modelled on.
//
// Playwright's own docs are blunt about why this file matters: "Planner will also use this seed
// test as an example of all the generated tests." What you show is what you get. If this file used
// a CSS selector, generated tests would too; if it slept for two seconds, every generated test
// would inherit that. So each of the four patterns below is here deliberately, and none of them is
// decoration.
//
// WHAT THIS TEST IS NOT: it does not cover a risk from context/foundation/test-plan.md. It is the
// cheapest real flow in the app that can demonstrate all four conventions at once, chosen on the
// owner side on purpose — a failure here cannot be mistaken for a Risk #4 failure the way a
// failure inside the caretaker flow could. Risk coverage lives in invite-reveal.spec.ts.
//
// The four patterns:
//
//   1. ROLE-BASED LOCATORS. getByRole / getByLabel throughout — never CSS, never XPath, never DOM
//      structure. These survive a Tailwind refactor; `.btn-primary` does not. They are also what
//      the agent actually sees in an accessibility snapshot.
//   2. INDEPENDENCE. Setup, action, assertion and cleanup all live in this one test. Nothing here
//      depends on another test having run, which is what makes `fullyParallel` safe.
//   3. WAITING ON STATE, NEVER ON TIME. `waitForURL` and web-first `expect(...).toBeVisible()`,
//      which retry until the condition holds. There is no `waitForTimeout` in this project's E2E
//      suite and there must never be one — it passes on a laptop and flakes in CI.
//   4. UNIQUE TEST DATA + CLEANUP. A `Date.now()` suffix means two runs cannot collide, and the
//      teardown means the account does not accumulate a pet per run.
//
// On the cleanup: it goes through the DATABASE rather than the UI, and that is forced rather than
// chosen — this app has no delete affordance for a pet anywhere (no button in
// src/pages/pets/index.astro, no DELETE on /api/pets). The client is anon-keyed and signed in as
// the same owner, so RLS applies and the delete is one the owner could genuinely perform.

test("a pet created by its owner persists after page reload", async ({ page }) => {
  // Unique per run. Without this the second run creates a second "Burek" and the heading assertion
  // below becomes ambiguous — strict mode would fail on two matches, which reads as a product bug.
  const petName = `Testowy Burek ${Date.now()}`;

  await page.goto("/pets/new");

  // Before touching a controlled input inside a `client:load` island. Without it this fill is
  // silently undone by hydration and the form submits empty — see fixtures/hydration.ts.
  await waitForHydration(page);

  await page.getByLabel("Imię", { exact: true }).fill(petName);
  await page.getByRole("button", { name: "Pies" }).click();
  await page.getByRole("button", { name: "Zapisz zwierzę" }).click();

  // The form redirects to /pets on success (AddPetForm sets window.location.href). Waiting on the
  // URL rather than on the heading separates "the POST succeeded" from "the list rendered".
  await page.waitForURL("**/pets");

  const heading = page.getByRole("heading", { name: petName });
  await expect(heading).toBeVisible();

  // The actual point of the test: the row survived the round trip to Postgres, not merely the
  // optimistic render. A reload re-runs the SSR query.
  await page.reload();
  await expect(heading).toBeVisible();

  // Cleanup — see the header. Runs in the test body rather than in afterEach because this file
  // holds one test and the teardown needs `petName`.
  const { client } = await ownerClient();
  const { error } = await client.from("pets").delete().eq("name", petName);
  expect(error).toBeNull();
});
