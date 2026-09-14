import { test as setup, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createOwnerClient } from "../helpers/auth";
import { waitForHydration } from "./fixtures/hydration";
import type { OwnerCredentials } from "./fixtures/owner";

// Captures one owner session per RUN, so no individual spec ever logs in through the UI.
//
// WHY THE IDENTITY IS MINTED THROUGH supabase-js AND THE SESSION THROUGH THE FORM. Those are two
// different things and each is done where it is honest:
//
//   - The USER is created by `createOwnerClient()` — the same anon-keyed primitive the 28-file
//     vitest suite builds on. Reusing it means the account this suite drives is indistinguishable
//     from the one the RLS tests drive, and it is never service-role.
//   - The SESSION is obtained by posting the REAL sign-in form. Injecting cookies by hand would
//     save a page load and quietly stop testing `/api/auth/signin`, the middleware and the cookie
//     shape `@supabase/ssr` writes on the workerd runtime. What `storageState` then holds is what
//     the app actually issues.
//
// The credentials are written next to the state so a spec can rebuild a client for the SAME
// identity and tear its data down through the database.
//
// CORRECTED 2026-09-14 (S-09 Phase 2). This paragraph used to say the project had no way to
// delete a pet at all — true when it was written, false now: `/pets/<id>` carries a delete
// control and `/api/pets/[id]` exposes DELETE. Teardown still goes through the database, and
// that is now a CHOICE rather than a necessity: the product path can legitimately REFUSE (a pet
// covered by an unrevoked trip answers 409), so a spec that cleaned up through the UI would
// fail on the state it is cleaning up rather than on the behaviour it tested. See
// docs/reference/e2e-rules.md §4. Both files are gitignored; `owner-credentials.json` holds a
// throwaway local account and must never be committed.

const AUTH_DIR = path.resolve("playwright/.auth");
const STATE_FILE = path.join(AUTH_DIR, "owner.json");
const CREDENTIALS_FILE = path.join(AUTH_DIR, "owner-credentials.json");

setup("authenticate as a fresh owner", async ({ page }) => {
  const owner = await createOwnerClient();

  await page.goto("/auth/signin");

  // `SignInForm` is a `client:load` island with controlled inputs, so the same hydration race that
  // silently empties the pet form applies here. It happened to pass without this wait; a race that
  // passes today is still a race.
  await waitForHydration(page);

  // Role- and label-based, per docs/reference/e2e-rules.md. `ui/Input` renders a real <label>
  // bound to the input (Input.tsx:52), which is what makes getByLabel work here at all.
  //
  // `exact: true` is load-bearing on the password field, measured rather than precautionary:
  // getByLabel matches on a SUBSTRING by default, and the reveal control inside `ui/Input`
  // renders a button whose accessible name is "Pokaż hasło" (Input.tsx:86) — which contains
  // "hasło". Without exact matching the locator resolves to two elements and strict mode fails.
  // Kept on both fields for symmetry.
  //
  // (Both sentences named `FormField` and `PasswordToggle` until S-09 deleted them; the reveal
  // control moved INTO ui/Input, so the behaviour and this rule are unchanged.)
  await page.getByLabel("E-MAIL", { exact: true }).fill(owner.email);
  await page.getByLabel("HASŁO", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Zaloguj się" }).click();

  // Wait on STATE — "this browser is now authenticated" — not on a URL.
  //
  // The obvious version of this line was `waitForURL("http://localhost:4321/")`, because
  // `/api/auth/signin` answers `context.redirect("/")`. Measured: it never settles there. `/` is
  // itself a redirect and the browser lands on `/periods`, so an exact-URL wait pins a route this
  // file has no opinion about and would break again the day the landing page moves.
  //
  // `Wyloguj` appears only once a session exists, and a FAILED sign-in returns to
  // `/auth/signin?error=…` where it does not exist — so this separates the two outcomes rather
  // than merely proving the click registered.
  await expect(page.getByRole("button", { name: "Wyloguj" })).toBeVisible();

  await mkdir(AUTH_DIR, { recursive: true });
  await page.context().storageState({ path: STATE_FILE });

  const credentials: OwnerCredentials = {
    email: owner.email,
    password: owner.password,
    userId: owner.userId,
  };
  await writeFile(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), "utf8");

  // Prove the state is actually authenticated before any spec depends on it. Without this, a
  // storageState that captured nothing produces a cascade of redirect failures in every spec,
  // and the real cause — this file — is the last place anyone looks.
  await page.goto("/pets");
  await expect(page.getByRole("heading", { name: "Moje zwierzęta" })).toBeVisible();
});
