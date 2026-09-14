import { experimental_AstroContainer as AstroContainer } from "astro/container";
import reactRenderer from "@astrojs/react/server.js";
import { SUPABASE_KEY, SUPABASE_URL } from "astro:env/server";
import { beforeAll, describe, expect, it } from "vitest";

// Risk #6 at the level the bundle scan structurally cannot reach.
//
// WHAT THIS EXISTS FOR, measured on 2026-09-12 rather than argued. A page that reads a secret in
// frontmatter and hands it to a `client:*` island BUILDS FINE, leaves `dist/client` clean, passes
// `npm run check:secrets` — and emits the value verbatim into the HTTP response, inside the island's
// own `props` attribute. `output: "server"` is what moves the target: dist/client holds zero HTML
// files, so the artifact the scan inspects never contains the disclosure.
//
// Astro does not stop it. `ServerOnlyModule` is keyed on which Vite environment resolves
// `astro:env/server`; frontmatter resolves in `ssr`, so the module loads and the secret becomes an
// ordinary string. Serialization then keeps EVERY prop, declared by the component or not.
//
// WHY THE LINT RULE IS NOT ENOUGH. eslint.config.js forbids importing `astro:env/server` from a
// `.astro` file, which blocks the direct route. It cannot see the same value arriving through a
// helper, a re-export or a spread. This file reads the bytes that ship, so it catches all of them.
//
// WHY THE TYPE SYSTEM IS NOT ENOUGH EITHER, and this is worth stating because it nearly is:
// `astro check` DOES reject an undeclared prop and a field absent from the source object — measured,
// two errors. What it cannot reject is a secret handed to a prop already declared `string`, because
// a secret IS a string. Passing SUPABASE_KEY to SignInForm's `serverError` type-checks today.
//
// WHICH KEY THIS GUARDS DEPENDS ON WHERE IT RUNS, and that asymmetry is free value rather than a
// problem. Locally and in GitHub Actions the Vite mode is `test`, so `.env.test` supplies a
// throwaway local key — the resolved-value half then proves the mechanism and the shape half does
// the real guarding. In the Cloudflare build there is no `.env` or `.env.test` at all (neither is
// tracked; only the two `.example` files are), so the only source is the build variables, i.e. the
// PRODUCTION key. Inferred rather than measured directly: the "has a secret to look for" control
// passed in that build, so a key was present, and build variables are the only place it could have
// come from. Same shape as SECRET_SCAN_HOSTS in scripts/check-client-bundle.mjs, without the
// configuration.
//
// THE API IS EXPERIMENTAL. `experimental_AstroContainer` is exactly that; an Astro minor can change
// it. If this file breaks after an upgrade, that is the first thing to check — not a leak.

const pages = import.meta.glob<{ default: unknown }>("/src/pages/**/*.astro");

/** Shape patterns, independent of whichever key the environment happens to hold.
 *
 *  This half is what makes the file a guard rather than a coincidence. Under vitest the Vite mode is
 *  `test`, so `.env.test` OVERRIDES `.env` — and the two hold different formats (a 46-character
 *  `sb_publishable_…` versus a 153-character JWT). An assertion written only against the resolved
 *  value would therefore pin whichever throwaway key the test environment supplied, and a production
 *  key in a different shape could ship past it. Same reasoning as `SECRET_SCAN_HOSTS` in
 *  scripts/check-client-bundle.mjs. */
const SECRET_SHAPES = [
  { name: "sb_secret_ key prefix", pattern: /sb_secret_[A-Za-z0-9_-]{8,}/ },
  { name: "sb_publishable_ key prefix", pattern: /sb_publishable_[A-Za-z0-9_-]{8,}/ },
  // Anchored and dot-terminated so an ordinary base64 run inside a hashed asset name cannot fire.
  { name: "JWT-shaped string", pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{20,}\./ },
];

/** The minimum number of islands each page renders TODAY, measured 2026-09-12.
 *
 *  This is the control, and without it the suite is the failure mode this project keeps recording:
 *  a page that silently stopped rendering its islands would render less HTML, contain no secret, and
 *  pass — while covering nothing.
 *
 *  The numbers are lower than the source in two places on purpose. Without middleware there is no
 *  authenticated session, so gated pages take their degraded branch: `periods/[id].astro` has four
 *  `client:load` sites and renders ONE; `invite/[token].astro` has two and renders one. Lighting the
 *  rest up needs an injected `locals` with a real session, which would make this an integration test
 *  and push it out of the publish gate — a trade recorded in test-plan.md §7.
 *
 *  Raising a floor when a page gains an island is deliberate maintenance, not friction: it is the
 *  moment someone re-reads what that page now sends to the browser. */
const ISLAND_FLOOR: Record<string, number> = {
  "/src/pages/auth/confirm-email.astro": 1,
  "/src/pages/auth/signin.astro": 2,
  "/src/pages/auth/signup.astro": 2,
  "/src/pages/dashboard.astro": 0,
  "/src/pages/invite/[token].astro": 1,
  "/src/pages/periods/[id].astro": 1,
  "/src/pages/periods/index.astro": 1,
  "/src/pages/periods/new.astro": 1,
  // 1, and that one is the AppBar's theme switch — added when this screen retired off
  // `bg-cosmic` onto the token ground. Each card is still a plain link to the detail page
  // rather than an edit or delete control, which is what keeps the floor at one.
  "/src/pages/pets/index.astro": 1,
  // 2: AddPetForm plus the AppBar's theme switch.
  "/src/pages/pets/new.astro": 2,
  // S-09: the edit form, and from Phase 2 the delete control beside it — TWO `client:load`
  // sites. Both render only when the pet resolves, and the container has no session, so the
  // floor stays 0: the row exists to pin the page into the sweep (its HTML is still scanned for
  // secrets) rather than to count a hydrated island. Same trade as periods/[id].astro, recorded
  // in test-plan.md §7.
  "/src/pages/pets/[id].astro": 0,
};

interface Rendered {
  path: string;
  html: string;
  islands: number;
}

let rendered: Rendered[] = [];

beforeAll(async () => {
  const container = await AstroContainer.create();
  container.addServerRenderer({ name: "@astrojs/react", renderer: reactRenderer });
  container.addClientRenderer({ name: "@astrojs/react", entrypoint: "@astrojs/react/client.js" });

  rendered = await Promise.all(
    Object.entries(pages).map(async ([path, load]) => {
      const mod = await load();
      const html = await container.renderToString(mod.default as never, {
        request: new Request("http://127.0.0.1/render-sweep"),
        // Enough for the two dynamic routes. Neither resolves to real data without a database, which
        // is the point of the island floors above.
        params: { id: "550e8400-e29b-41d4-a716-446655440000", token: "a".repeat(43) },
      });
      return { path, html, islands: (html.match(/<astro-island/g) ?? []).length };
    }),
  );
});

describe("no page sends a server secret to the browser", () => {
  it("swept every page under src/pages", () => {
    // Guards the guard: a glob that matched nothing, or a rename that emptied the floor table, would
    // make every assertion below vacuous.
    expect(rendered.length, "the page glob matched nothing").toBeGreaterThan(0);
    expect(rendered.length, "the island-floor table has drifted from the pages on disk").toBe(
      Object.keys(ISLAND_FLOOR).length,
    );
    for (const { path } of rendered) {
      expect(ISLAND_FLOOR[path], `${path} has no island floor — add one with the count it renders`).toBeDefined();
    }
  });

  it("has a secret to look for, so a clean sweep means something", () => {
    // Without this the whole file passes against an empty environment — the shape of a check that
    // describes rather than guards.
    expect(SUPABASE_KEY, "no SUPABASE_KEY in the test environment; this sweep would prove nothing").toBeTruthy();
    expect(SUPABASE_URL, "no SUPABASE_URL in the test environment").toBeTruthy();
  });

  it.each(Object.keys(ISLAND_FLOOR))("%s carries neither secret verbatim", (path) => {
    const page = rendered.find((entry) => entry.path === path);
    expect(page, `${path} was not rendered`).toBeDefined();

    expect(page?.html, `${path} contains the resolved SUPABASE_KEY`).not.toContain(SUPABASE_KEY);
    expect(page?.html, `${path} contains the resolved SUPABASE_URL`).not.toContain(SUPABASE_URL);
  });

  it.each(Object.keys(ISLAND_FLOOR))("%s carries nothing key-shaped", (path) => {
    const html = rendered.find((entry) => entry.path === path)?.html ?? "";

    for (const { name, pattern } of SECRET_SHAPES) {
      expect(pattern.test(html), `${path} contains something matching ${name}`).toBe(false);
    }
  });

  it.each(Object.entries(ISLAND_FLOOR))("%s still renders at least %i island(s)", (path, floor) => {
    const page = rendered.find((entry) => entry.path === path);

    expect(
      page?.islands,
      `${path} rendered fewer islands than it did when this floor was measured`,
    ).toBeGreaterThanOrEqual(floor);
  });
});
