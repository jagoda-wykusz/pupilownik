#!/usr/bin/env node
// Scan the browser-served build artifact for anything that must never reach a browser.
//
// WHAT THIS CAN AND CANNOT CATCH — stated here because the honest answer is narrower than the
// name suggests, and a check that is over-trusted is worse than one that is understood.
//
// It CANNOT catch "the framework leaked a secret". It cannot happen: `astro.config.mjs` declares
// both vars `context: "server", access: "secret"`, Astro throws `ServerOnlyModule` at build time
// if `astro:env/server` is resolved in a client environment, and there is no build-time value
// substitution anywhere in this pipeline — env is a runtime lookup against the worker binding.
// Measured: `dist/client` contains neither key nor even the project URL, because the browser
// never talks to Supabase at all (supabase-js is worker-only; islands call same-origin /api/*).
//
// What it CAN catch is the mistake a person makes: a key literal pasted into a client island,
// typically to "just call Supabase directly from the browser". That is the whole of its value,
// and it is worth having.
//
// TWO SCOPING DECISIONS, both load-bearing:
//
//   1. `dist/client` ONLY. `dist/server/.dev.vars` holds the real values in plaintext by design
//      — @cloudflare/vite-plugin writes it from .env on every build. It is gitignored and listed
//      in dist/client/.assetsignore, so it reaches neither git nor the asset bucket. A scan over
//      `dist/` would therefore FAIL ON A CORRECT BUILD, and the reflex fix would be to weaken
//      the check.
//   2. No `service_role` token. It appears 5+ times as JSDoc prose inside bundled supabase-js.
//      It is absent from dist/client today only because supabase-js is not client-bundled; the
//      day an island imports it, that pattern false-positives and the check gets disabled.
//
// Never prints a matched value — only the file and the pattern name.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const CLIENT_DIR = "dist/client";

/** Extensions with no text to scan. Reading them as utf8 produces noise, not findings. */
const BINARY = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff", ".woff2", ".ttf", ".ico", ".map"]);

/** Minimal .env reader — no dependency, and the file is a flat KEY=VALUE list.
 *  Real env wins, so a CI runner that exports the vars needs no file. */
function readEnv() {
  const fromFile = {};
  if (existsSync(".env")) {
    for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match) {
        fromFile[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  }
  return { ...fromFile, ...process.env };
}

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
    } else {
      found.push(full);
    }
  }
  return found;
}

function buildPatterns(env) {
  const patterns = [];

  // The literal values, which is the only check that is specific to THIS project's secrets.
  // Skipped rather than faked when a var is absent, and reported, so a run with no env cannot
  // look like a clean run.
  for (const name of ["SUPABASE_URL", "SUPABASE_KEY"]) {
    const value = env[name];
    if (value && value.length >= 8) {
      patterns.push({ name: `${name} literal value`, test: (text) => text.includes(value) });
    }
  }

  // The project host on its own, in case a URL is rebuilt from parts rather than pasted whole.
  const url = env.SUPABASE_URL;
  if (url) {
    try {
      const host = new URL(url).host;
      patterns.push({ name: "Supabase project host", test: (text) => text.includes(host) });
    } catch {
      // A malformed SUPABASE_URL is not this script's problem; the literal check above still runs.
    }
  }

  // Shape-based, independent of this project's env: a service-role key and any JWT.
  patterns.push({ name: "sb_secret_ key prefix", test: (text) => /sb_secret_[A-Za-z0-9_-]+/.test(text) });
  patterns.push({ name: "JWT-shaped string", test: (text) => /eyJ[A-Za-z0-9_-]{10,}/.test(text) });

  return patterns;
}

function main() {
  if (!existsSync(CLIENT_DIR)) {
    console.error(`check-client-bundle: ${CLIENT_DIR} does not exist. Run \`npm run build\` first.`);
    process.exit(2);
  }

  const files = walk(CLIENT_DIR).filter((file) => !BINARY.has(extname(file)));
  if (files.length === 0) {
    console.error(`check-client-bundle: ${CLIENT_DIR} holds no scannable files. Run \`npm run build\` first.`);
    process.exit(2);
  }

  const env = readEnv();
  const patterns = buildPatterns(env);
  const missingEnv = ["SUPABASE_URL", "SUPABASE_KEY"].filter((name) => !env[name]);

  const findings = [];
  let controlHits = 0;
  let scannedBytes = 0;

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    scannedBytes += text.length;

    // POSITIVE CONTROL. Without it an empty read, a wrong path or a broken matcher all look
    // exactly like a clean bundle — the failure mode that makes a check a description of the
    // thing it was meant to guard. `function` is present in any built JS and in no image.
    if (text.includes("function")) {
      controlHits += 1;
    }

    for (const pattern of patterns) {
      if (pattern.test(text)) {
        findings.push({ file: relative(process.cwd(), file), pattern: pattern.name });
      }
    }
  }

  if (controlHits === 0) {
    console.error(
      `check-client-bundle: scanned ${files.length} file(s), ${scannedBytes} bytes, and the positive control never matched. ` +
        `The scan is not reading what it thinks it is reading — treat this as a failure, not a pass.`,
    );
    process.exit(2);
  }

  if (findings.length > 0) {
    console.error("check-client-bundle: FOUND secrets in the browser-served bundle:");
    for (const finding of findings) {
      // The matched text is deliberately not printed.
      console.error(`  ${finding.file} — ${finding.pattern}`);
    }
    process.exit(1);
  }

  const skipped = missingEnv.length > 0 ? ` (skipped literal checks for: ${missingEnv.join(", ")})` : "";
  console.log(
    `check-client-bundle: clean — ${files.length} file(s), ${scannedBytes} bytes, ` +
      `${patterns.length} pattern(s), control matched in ${controlHits} file(s)${skipped}`,
  );
}

main();
