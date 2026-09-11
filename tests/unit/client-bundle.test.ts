import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Risk #6, the build-artifact half — `scripts/check-client-bundle.mjs` inside `npm test`, so it
// is not a script that exists until someone remembers it.
//
// WHAT THIS DOES AND DOES NOT PROVE, because the honest reach is narrower than the name:
// it CANNOT catch a framework leak. Astro declares both vars `context: "server", access:
// "secret"` and throws `ServerOnlyModule` at build time if `astro:env/server` is resolved in a
// client environment, and nothing in this pipeline substitutes a value at build time. The check
// catches a key literal PASTED INTO A CLIENT ISLAND, which is the mistake a person actually
// makes. tests/unit/env-schema.test.ts covers the other realistic route — a `PUBLIC_` rename.
//
// It also inspects whatever build happens to be on disk, which is why a missing `dist/client`
// must FAIL rather than skip: a green run against no artifact is exactly the "describes the
// thing it was meant to guard" failure `context/foundation/lessons.md` records.

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCRIPT = path.join(ROOT, "scripts/check-client-bundle.mjs");
const CLIENT_DIR = path.join(ROOT, "dist/client");

describe("the browser-served bundle carries no secret", () => {
  it("has a build to inspect at all", () => {
    // Deliberately a failing assertion rather than `it.skip`: a skipped test reads as "fine" in
    // a green run, and this whole file is meaningless without an artifact.
    expect(
      existsSync(CLIENT_DIR),
      `dist/client is missing — run \`npm run build\` before \`npm test\`. Without it this suite would pass having scanned nothing.`,
    ).toBe(true);
  });

  it("passes the secret scan, with the scan proving it actually read the bundle", () => {
    // The script exits 2 when it finds nothing to scan or when its own positive control never
    // matches, and 1 when it finds a secret. Both are failures here; execFileSync throws on
    // either, and the script's stderr names the file and the pattern (never the value).
    const output = execFileSync("node", [SCRIPT], { cwd: ROOT, encoding: "utf8" });

    expect(output).toContain("clean");
    // The control line is part of the contract, not decoration: it is what distinguishes
    // "scanned the bundle and found nothing" from "scanned nothing".
    expect(output).toMatch(/control matched in [1-9]\d* file\(s\)/);
  });
});
