import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The artifact half of vendor-build-fonts: a build that produced no fonts must turn the gate red
// instead of publishing quietly.
//
// WHAT CLASS THIS GUARDS, stated honestly because the live hole it was written for is already
// closed. Before vendoring, an unreachable `fonts.googleapis.com` made Astro's Google provider warn
// and return an empty family list, and the build EXITED 0 with zero @font-face — a green gate and a
// site silently reverted to system fonts. Vendoring removed that path: a missing local file throws
// inside CachedFontFetcher, loudly. So this file no longer guards a reachable failure; it guards the
// CLASS — a build that succeeds at producing the wrong thing — which nothing else in `ci:gate`
// looks at. `npm run check`, `lint`, the test projects and `check:secrets` all pass against a
// fontless build.
//
// LOOK IN dist/server, NOT dist/client, AND THIS COST ME A WRONG ANSWER ONCE. Under
// `output: "server"` the font CSS is compiled into a server chunk
// (`dist/server/chunks/_astro_assets_*.mjs`) and `dist/client` holds ZERO @font-face rules — only
// the woff2 binaries under `_astro/fonts/`. Grepping dist/client for `@font-face` returns nothing on
// a perfectly healthy build, which reads exactly like the failure this file exists to catch. The
// chunk name carries a content hash, so it is globbed rather than named.
//
// The two halves are checked against each other rather than counted separately: every `url()` in a
// @font-face must resolve to a file that actually shipped. A count of rules and a count of files can
// both be right while pointing at different things.

const ROOT = path.resolve(import.meta.dirname, "../..");
const CLIENT_DIR = path.join(ROOT, "dist/client");
const SERVER_DIR = path.join(ROOT, "dist/server");

/** Smallest vendored file is 26,568 B. A floor this far below it catches truncation and zero-byte
 *  writes without pinning the exact bytes, which would turn a routine font update into a failure. */
const MIN_FONT_BYTES = 10_000;

/** One per subset per family: Quicksand latin + latin-ext, Nunito latin + latin-ext. Raising this
 *  when a family or subset is added is deliberate maintenance — it is the moment someone re-reads
 *  what the build now ships. */
const EXPECTED_FONT_FILES = 4;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** Every @font-face block in the server bundle, as raw CSS text. */
function fontFaceRules(): string[] {
  const sources = walk(SERVER_DIR).filter((file) => /\.(mjs|js|css)$/.test(file));
  const rules: string[] = [];

  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("@font-face")) {
      continue;
    }
    for (const match of text.matchAll(/@font-face\s*\{[^}]*\}/g)) {
      rules.push(match[0]);
    }
  }

  return rules;
}

function firstFamilyOf(variable: string, bundle: string): string {
  const declaration = new RegExp(`${variable}:([^;}]+)`).exec(bundle);
  expect(declaration, `${variable} is not declared anywhere in the server bundle`).not.toBeNull();
  return (declaration?.[1] ?? "")
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/g, "");
}

describe("the build shipped the fonts it claims to", () => {
  it("has a build to inspect at all", () => {
    // FAIL, never skip. A green run against a missing artifact is the exact shape of check this
    // project keeps having to un-learn — see tests/unit/client-bundle.test.ts:29-30, which fails
    // for the same reason.
    expect(
      existsSync(CLIENT_DIR),
      "dist/client is missing — run `npm run build` before `npm test`. Without it this suite would pass having inspected nothing.",
    ).toBe(true);
    expect(
      existsSync(SERVER_DIR),
      'dist/server is missing — the font CSS lives there under `output: "server"`, so there is nothing to check.',
    ).toBe(true);
  });

  it("emitted the expected font files, none of them truncated", () => {
    const fonts = walk(CLIENT_DIR).filter((file) => file.endsWith(".woff2"));

    expect(
      fonts.length,
      `expected ${EXPECTED_FONT_FILES} woff2 under dist/client, found ${fonts.length}. Zero means the build produced a site with no webfonts and still exited 0 — check the fonts block in astro.config.mjs.`,
    ).toBeGreaterThanOrEqual(EXPECTED_FONT_FILES);

    for (const file of fonts) {
      const bytes = statSync(file).size;
      expect(
        bytes,
        `${path.relative(ROOT, file)} is ${bytes} B, below the ${MIN_FONT_BYTES} B floor — a truncated or empty font file still satisfies a count check.`,
      ).toBeGreaterThanOrEqual(MIN_FONT_BYTES);
    }
  });

  it("emitted @font-face rules that point at files which actually shipped", () => {
    const rules = fontFaceRules();
    const withUrl = rules.filter((rule) => rule.includes("url("));

    expect(
      withUrl.length,
      `found ${withUrl.length} @font-face rule(s) with a url() in dist/server. Zero means the CSS was generated without any faces — the site renders in fallback fonts. Note the rules are NOT in dist/client under \`output: "server"\`.`,
    ).toBeGreaterThanOrEqual(EXPECTED_FONT_FILES);

    for (const rule of withUrl) {
      for (const match of rule.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        const referenced = match[1];
        const onDisk = path.join(CLIENT_DIR, referenced.replace(/^\//, ""));
        expect(
          existsSync(onDisk),
          `a @font-face references ${referenced}, but dist/client has no such file — the CSS and the emitted assets disagree.`,
        ).toBe(true);
      }
    }
  });

  it("kept unicode-range on every real face", () => {
    // The one piece of hand-maintained data in the font setup. `LocalFontProvider` passes
    // `unicodeRange` straight through and never infers it (providers/local.js:44), so deleting the
    // arrays in astro.config.mjs does NOT fail the build — it emits faces with no `unicode-range`,
    // and every page then downloads both subsets instead of the one it needs. Nothing else would
    // notice: same exit code, same file count, same rendered text.
    const withUrl = fontFaceRules().filter((rule) => rule.includes("url("));

    for (const rule of withUrl) {
      const family = /font-family:([^;}]+)/.exec(rule)?.[1]?.trim() ?? "unknown";
      expect(
        rule,
        `the @font-face for ${family} has no unicode-range — check the LATIN / LATIN_EXT arrays in astro.config.mjs; without them every page pulls both subsets.`,
      ).toMatch(/unicode-range:/);
    }
  });

  it("resolves both CSS variables to a family that has a real face", () => {
    // Links the variables the app actually consumes (src/styles/global.css aliases them to
    // --font-heading / --font-body) to the faces in the bundle. A build can emit faces for one
    // family and drop the other; the counts above would still pass.
    const bundle = walk(SERVER_DIR)
      .filter((file) => /\.(mjs|js|css)$/.test(file))
      .map((file) => readFileSync(file, "utf8"))
      .filter((text) => text.includes("--font-quicksand:") || text.includes("--font-nunito:"))
      .join("\n");

    const rules = fontFaceRules().filter((rule) => rule.includes("url("));

    for (const variable of ["--font-quicksand", "--font-nunito"]) {
      const family = firstFamilyOf(variable, bundle);

      expect(family, `${variable} resolves to an empty family name`).not.toBe("");
      expect(
        rules.some((rule) => rule.includes(family)),
        `${variable} resolves to "${family}", but no @font-face with a url() declares that family — the variable points at a font that was never emitted, so text falls through to the fallback chain.`,
      ).toBe(true);
    }
  });
});
