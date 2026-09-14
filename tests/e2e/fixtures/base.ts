import { test as base } from "@playwright/test";

// The base `test` every E2E file in this project imports, instead of `@playwright/test` directly.
// It exists for exactly one reason, and that reason is measured rather than defensive.
//
// THE FAILURE IT REMOVES, observed 2026-09-14 on seed.spec.ts. `astro dev` injects an
// `<astro-dev-toolbar>` element fixed to the bottom centre of the viewport. Playwright's
// actionability check found the submit button "visible, enabled and stable", scrolled it into
// view, and then refused to click it 45 times over the full 30s timeout with one line repeating in
// the log:
//
//     <astro-dev-toolbar></astro-dev-toolbar> intercepts pointer events
//
// The form's submit button sits at the bottom of a long page — the toolbar's own spot. So the
// failure depends on viewport height and page length, which is what makes it worse than a plain
// break: it hits one machine and not another, and it reads as "the button is broken" rather than
// "something is on top of the button".
//
// WHY THE FIX IS BROWSER-SIDE AND NOT `devToolbar: { enabled: false }` IN astro.config.mjs. That
// switch would work, but it turns the toolbar off for everyone's normal development too — a real
// cost paid by every developer to satisfy a test runner. It is also the wrong lever for the case
// that actually breaks: playwright.config.ts sets `reuseExistingServer: !process.env.CI`, so
// LOCALLY Playwright attaches to a dev server the developer already started, with whatever config
// it was started under. A server-side switch cannot reach that server; an init script on the test's
// own browser context reaches every run, attached or spawned.
//
// `addInitScript` rather than `addStyleTag`: it runs before the page's own scripts on every
// navigation and reload, including the `page.reload()` seed.spec.ts performs, whereas a style tag
// added after `goto` is wiped by the next navigation.
//
// This suppresses ONLY the dev-server overlay. It touches nothing the product renders, so no
// assertion in this suite is weakened by it — the toolbar does not exist in a production build.
export const test = base.extend({
  page: async ({ page }, provide) => {
    // Named `provide`, not Playwright's usual `use`, for the reason fixtures/invite.ts records:
    // `react-hooks/rules-of-hooks` treats any `use(...)` call as a React hook and rejects it
    // outside a component. The name is arbitrary to Playwright.
    await page.addInitScript(() => {
      // Deferred to DOMContentLoaded rather than run immediately. An init script executes at
      // document-start, BEFORE the document has been parsed, so `document.head` is genuinely not
      // there yet — but it is typed non-nullable in lib.dom, and this project's type-aware ESLint
      // rejects a guard against it as a statically dead branch (`no-unnecessary-condition`). The
      // event sidesteps the contradiction instead of silencing it, and loses nothing: the toolbar
      // is injected by Astro's own client script, which itself runs after the document is ready.
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "astro-dev-toolbar { display: none !important; }";
        document.head.append(style);
      });
    });

    await provide(page);
  },
});

export { expect } from "@playwright/test";
