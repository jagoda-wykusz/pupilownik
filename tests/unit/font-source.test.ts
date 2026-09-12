import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Pins the outcome of vendor-build-fonts: no Google host may re-enter the build path through a
// config edit.
//
// WHY A SOURCE CHECK AND NOT AN OUTPUT CHECK. The failure this guards is not visible in the
// artifact. Measured 2026-09-12: with `fonts.googleapis.com` unreachable, Astro's Google provider
// emits a warning and returns an empty family list, and the build EXITS 0 having produced zero
// @font-face. So a build carrying the remote provider looks exactly like a healthy one right up
// until the day Google is slow — which is the property that makes it worth pinning in source
// rather than waiting to observe it. tests/unit/font-assets.test.ts covers the artifact half.
//
// COMMENTS COME OUT BEFORE ANY ASSERTION, and this is load-bearing rather than tidy. The config
// block this file guards NECESSARILY explains the Google provider and names both of its hosts —
// that is the whole rationale for vendoring. An assertion run against the raw source would match
// that explanation and pass while the provider itself had been restored. This project has shipped
// that exact hole twice (context/foundation/lessons.md: "Asercja podciągiem trafia we własne
// uzasadnienie"), and tests/unit/invite-source.test.ts strips comments for the same reason.
//
// The `sourceMentionsGoogle` control below is what keeps the stripping honest: it asserts the raw
// file DOES talk about Google, so a stripper that accidentally emptied the string would fail
// loudly instead of making every absence assertion vacuously true.

const ROOT = path.resolve(import.meta.dirname, "../..");
const CONFIG_PATH = path.join(ROOT, "astro.config.mjs");
const source = readFileSync(CONFIG_PATH, "utf8");

/** The config with every block and line comment removed, so assertions see code only.
 *
 *  Block comments first — a `/** ... *\/` run can contain `//` inside it, and removing line
 *  comments first would leave its tail behind.
 *
 *  WHAT ACTUALLY MAKES THE LINE STRIP SAFE, corrected after review said the original reason was
 *  the wrong one: the pattern is ANCHORED TO LINE START. An inline `//` inside a string — the
 *  `site: "https://example.com"` that any Astro config with @astrojs/sitemap eventually grows —
 *  is therefore untouched. It was never the risk.
 *
 *  THE REAL GAP, in the other direction: a TRAILING comment is not stripped at all. Write
 *  `provider: fontProviders.local(), // never fontProviders.google()` and the word survives into
 *  `code`, turning the guard red on its own rationale — the very failure class this stripper
 *  exists to prevent, alive in the half it does not cover. Keep "why" comments on their own lines
 *  in astro.config.mjs.
 *
 *  Also not string-aware for BLOCK comments: a future glob like `"src/<star><star>/*.ts"` contains
 *  a comment-close sequence and would be partly deleted. The stripping control below floors on
 *  `fonts:` surviving, which catches the catastrophic case but not a surgical one. */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const code = codeOnly(source);

describe("the font pipeline reaches no third party at build time", () => {
  it("strips comments without emptying the file", () => {
    // Guards the guard, both directions: the stripper must actually remove something, and it must
    // leave the config's code intact. Without this, a regex that ate everything would make every
    // assertion below pass against an empty string.
    expect(code.length, "comment stripping removed the whole file").toBeGreaterThan(200);
    expect(
      source.length - code.length,
      "comment stripping removed nothing — the guard is reading the raw file",
    ).toBeGreaterThan(200);
    expect(code, "the fonts block itself was stripped away").toContain("fonts:");
  });

  it("still explains Google in prose, which is what the stripping has to survive", () => {
    // The positive control for every absence assertion below. If this ever fails, the config no
    // longer mentions Google anywhere and the absence checks have stopped proving anything —
    // rewrite them rather than deleting this.
    expect(source, "the config no longer explains why the fonts are vendored").toMatch(/Google/);
  });

  it("uses the local provider", () => {
    expect(code, "astro.config.mjs does not use fontProviders.local()").toContain("fontProviders.local(");
  });

  it("names no Google font provider", () => {
    expect(code, "fontProviders.google() is back in astro.config.mjs").not.toMatch(/fontProviders\s*\.\s*google/);
  });

  it("names no Google font host", () => {
    // Catches the other shape of reintroduction: a hand-written @font-face or <link> pointing at
    // Google rather than a provider call.
    for (const host of ["fonts.googleapis.com", "fonts.gstatic.com", "fonts.google.com"]) {
      expect(code, `${host} appears in astro.config.mjs outside a comment`).not.toContain(host);
    }
  });

  it("points every variant at a file that exists", () => {
    // A missing file fails the build loudly (readFile throws inside CachedFontFetcher), so this is
    // not guarding a silent hole. It exists to name the problem precisely when someone moves or
    // renames a vendored file: "quicksand-latin.woff2 is referenced but missing" beats an
    // AstroError about a font file at an absolute temp path.
    const referenced = [...code.matchAll(/"(\.\/src\/assets\/fonts\/[^"]+\.woff2)"/g)].map((match) => match[1]);

    expect(referenced.length, "no vendored font files are referenced by the config").toBe(4);

    for (const relative of referenced) {
      const absolute = path.join(ROOT, relative);
      expect(existsSync(absolute), `${relative} is referenced by astro.config.mjs but missing on disk`).toBe(true);
    }
  });
});
