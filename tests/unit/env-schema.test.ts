import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The guard that actually holds Risk #6's headline, and the only check in this change that
// catches a mistake BEFORE it reaches an artifact.
//
// Astro's env system is what keeps a secret out of the browser: with `context: "server",
// access: "secret"`, importing `astro:env/server` from a client environment is a build error
// (`ServerOnlyModule`), and a secret name colliding with `vite.envPrefix` is another
// (`EnvPrefixConflictsWithSecret`). So the bundle is clean structurally, not by luck.
//
// There is exactly one legal way to undo that: redeclare a var as `context: "client"` (by
// convention `PUBLIC_`-prefixed) with `access: "public"`. Astro then inlines the VALUE into the
// client bundle — no error, no warning. tests/unit/client-bundle.test.ts would catch the
// consequence on the next build; this catches the intent at the moment it is written.
//
// A SOURCE-TEXT assertion is the right tool here and the reason is worth stating: the property
// is about configuration intent, and the alternative — importing astro.config.mjs — evaluates
// the Cloudflare adapter and two Google font providers to read two fields.

const CONFIG = path.resolve(import.meta.dirname, "../../astro.config.mjs");

/** The `env: { schema: { … } }` block, comments stripped, so an explanatory sentence naming a
 *  forbidden value cannot fail the suite on its own rationale. */
function envSchemaBlock(): string {
  const source = readFileSync(CONFIG, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  const start = source.indexOf("env:");
  expect(start, "astro.config.mjs has no `env:` block — the schema guard is gone entirely").toBeGreaterThan(-1);
  return source.slice(start);
}

describe("the env schema keeps both Supabase vars server-only", () => {
  const block = envSchemaBlock();

  it("declares SUPABASE_URL and SUPABASE_KEY, so the assertions below guard something real", () => {
    // Guards the guard: if the names change, every absence assertion here starts passing for
    // the wrong reason and keeps passing forever.
    expect(block).toContain("SUPABASE_URL");
    expect(block).toContain("SUPABASE_KEY");
  });

  it("gives every declared variable server context and secret access", () => {
    const fields = [...block.matchAll(/envField\.\w+\(\{([^}]*)\}/g)].map((match) => match[1]);
    expect(fields.length, "no envField declarations found — the parser is looking at the wrong text").toBeGreaterThan(
      0,
    );

    for (const field of fields) {
      expect(field).toContain('context: "server"');
      expect(field).toContain('access: "secret"');
    }
  });

  it("declares no client-context variable at all", () => {
    // The `PUBLIC_` route. Legal Astro, silent, and it inlines the value into dist/client.
    expect(block).not.toContain('context: "client"');
    expect(block).not.toContain('access: "public"');
  });
});
