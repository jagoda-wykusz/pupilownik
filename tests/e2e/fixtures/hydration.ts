import { expect, type Page } from "@playwright/test";

// Wait until every Astro island on the page has hydrated.
//
// WHY THIS IS NECESSARY, measured 2026-09-13 rather than assumed. This app's forms are CONTROLLED
// React inputs inside `client:load` islands — `AddPetForm` holds `useState("")` for the pet name,
// and `ui/Input` renders `value={value}` (it was `FormField` when this was measured; S-09 deleted
// that component and AddPetForm moved onto ui/Input, which is controlled the same way). The server sends that input with `value=""`. If a test
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
// NESTED ISLANDS AND `await-children` ARE NOT HOLES, checked against Astro's client runtime rather
// than assumed: the element refuses to hydrate while `this.parentElement?.closest('astro-island[ssr]')`
// matches and retries on the parent's `astro:hydrate` event, so a child keeps its `ssr` attribute
// until its parent is done. `toHaveCount(0)` therefore waits for the whole tree.
//
// THE PRECONDITION THIS DOES HAVE: every island in this project is `client:load`. Verified by
// grepping `src/` for `client:only|client:visible|client:idle|client:media` — zero hits. That
// matters because the helper is BLIND to `client:only`: such an island is never server-rendered, so
// it carries no `ssr` attribute and this assertion is satisfied while the component is still being
// fetched. And `client:visible` would invert the failure — a below-fold island never hydrates, so
// this would burn its full timeout on a page that works perfectly. If either directive is ever
// introduced, this helper needs revisiting before it is trusted on that page.
//
// The `> 0` control comes first for the reason every other control in this suite exists: a page
// whose islands silently stopped rendering would satisfy `toHaveCount(0)` and sail through.
export async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator("astro-island")).not.toHaveCount(0);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}
