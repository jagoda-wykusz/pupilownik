import { expect, type Page } from "@playwright/test";

// Wait until every Astro island on the page has hydrated.
//
// WHY THIS IS NECESSARY, measured 2026-09-13 rather than assumed. This app's forms are CONTROLLED
// React inputs inside `client:load` islands — `AddPetForm` holds `useState("")` for the pet name,
// and `FormField` renders `value={value}`. The server sends that input with `value=""`. If a test
// fills it before React mounts, hydration runs `useState("")` and React resets the DOM node back
// to empty. The test then submits an empty form and fails on the app's own validation
// ("Imię zwierzęcia jest wymagane") — a failure that looks like a product bug and is a race.
//
// Filling is the visible case; clicking is the silent one. A click on an un-hydrated button has no
// handler attached, so nothing happens at all and the test fails later, somewhere else, on a
// missing consequence. `ClaimSlots` in the caretaker flow is exactly that shape.
//
// THE SIGNAL. Astro's SSR output marks each island `<astro-island … ssr>`; the custom element
// removes that attribute once it has hydrated. So "no island still carries `ssr`" is a precise,
// framework-provided readiness bit — verified against the live server's HTML, not inferred from
// docs. `toHaveCount(0)` retries until it holds, so this waits on STATE, never on time.
//
// Reaching for a DOM attribute is a deliberate exception to the "never locate by DOM structure"
// rule and not a loophole in it: this locates no user-facing element and asserts nothing about the
// product. It waits for the FRAMEWORK to be ready, which has no accessible-name equivalent.
//
// A page with no islands passes trivially — the locator matches nothing, which is already 0.
export async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}
