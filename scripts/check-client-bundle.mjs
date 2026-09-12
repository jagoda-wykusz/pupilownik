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
// typically to "just call Supabase directly from the browser". That is the whole of its value.
//
// AND BE PRECISE ABOUT *WHICH* SECRETS, because a review found the first version of this header
// overstating it. Two of the patterns are derived from whatever `.env` the run has — which in
// every local checkout is the throwaway stack from `npm run db:start`. So the literal and host
// checks guard `127.0.0.1:54321`, not production. What is project-independent is the pair of
// key-prefix patterns (`sb_secret_`, `sb_publishable_`) and the JWT shape. To guard a real
// project's host, pass it in: `SECRET_SCAN_HOSTS=abcd.supabase.co npm run check:secrets` — a
// project ref is not a secret and can live in CI config or a committed script.
//
// TWO SCOPING DECISIONS, both load-bearing:
//
//   1. `dist/client` ONLY. `dist/server/.dev.vars` holds the real values in plaintext by design
//      — @cloudflare/vite-plugin writes it from .env on every build. A scan over `dist/` would
//      therefore FAIL ON A CORRECT BUILD, and the reflex fix would be to weaken the check.
//
//      WHY THAT IS SAFE, corrected 2026-09-12 after a review found this comment giving the wrong
//      reason. It is NOT `.assetsignore`: that file lands at `dist/client/.assetsignore`, and
//      wrangler reads it from the root of the assets directory — so it governs `dist/client/**`
//      and cannot reach `dist/server/**` at all. What actually protects the server half is
//      DIRECTORY SCOPING: the adapter generates `dist/server/wrangler.json` with
//      `assets.directory: "../client"`, and that generated config is what `wrangler deploy`
//      resolves to. The root `wrangler.jsonc` still says `"./dist"` — the parent of both halves —
//      so a deploy that bypassed the generated config would upload the server directory. Measured
//      against production on 2026-09-12: `/server/entry.mjs`, `/server/wrangler.json` and
//      `/server/.dev.vars` all 404 while a real client asset returns 200, so the generated config
//      is what runs today. `assertAssetScope` below pins it, because a wrong reason in a comment
//      is what licenses the change that breaks the real one.
//   2. No `service_role` token. It appears 5+ times as JSDoc prose inside bundled supabase-js.
//      It is absent from dist/client today only because supabase-js is not client-bundled; the
//      day an island imports it, that pattern false-positives and the check gets disabled.
//
// Never prints a matched value — only the file and the pattern name.
//
// WHAT CHANGED WHEN THIS BECAME A DEPLOY GATE (2026-09-11, `ci-quality-gates`). This script is
// now the last link of `npm run ci:gate`, which is the Cloudflare Workers Builds build command.
// A non-zero exit here therefore produces no version, and no version means NO DEPLOY. That
// re-prices the missing-env branch below: it used to mean "this developer gets a weaker scan",
// and it now means "nothing publishes until the build variables come back". `SUPABASE_URL` and
// `SUPABASE_KEY` are declared `optional: true` in astro.config.mjs, so their absence does not
// fail a build — it fails THIS, which is the same outcome by a different route. If that is ever
// the wrong tradeoff for a given context, `SECRET_SCAN_ALLOW_MISSING_ENV=1` is the deliberate
// opt-out; weakening the exit code is not.
//
// AND ONE FLAG THAT MUST NEVER BE SET IN WORKERS BUILDS: `CLOUDFLARE_INCLUDE_PROCESS_ENV`.
// @cloudflare/vite-plugin writes `dist/server/.dev.vars` from local secrets; with that flag set
// it serializes the PROCESS environment instead — which in the build container is the production
// SUPABASE_KEY, written to a plaintext file inside the build output. Unset, as it is today, no
// such file is produced in CI at all.

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
      // `export ` accepted, and an UNQUOTED trailing `# comment` stripped. Both cost a real leak
      // if missed: a greedy value that swallows "# prod" can never match the bundle, and the run
      // still prints "clean" because the variable is present. Found in review.
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) {
        continue;
      }
      const raw = match[2].trim();
      const quoted = /^(["'])([\s\S]*)\1$/.exec(raw);
      fromFile[match[1]] = quoted ? quoted[2] : raw.replace(/\s+#.*$/, "").trim();
    }
  }
  // Real env wins so a CI runner needs no file — but a stale exported var then SHADOWS the file
  // and the scan validates the wrong value. The summary line names the host it guarded so that
  // is visible rather than silent.
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
  const skipped = [];
  for (const name of ["SUPABASE_URL", "SUPABASE_KEY"]) {
    const value = env[name];
    if (value && value.length >= 8) {
      patterns.push({ name: `${name} literal value`, test: (text) => text.includes(value) });
    } else {
      // Absent, empty, or too short to be a real value. Collected rather than ignored: a run
      // without these is down to two generic shape patterns, which is a much weaker check than
      // the summary line used to imply.
      skipped.push(name);
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

  // Hosts no .env points at. A production project ref is not a secret, and without this the host
  // pattern only ever guards whichever stack the developer happens to be running.
  for (const host of (env.SECRET_SCAN_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    patterns.push({ name: `configured host ${host}`, test: (text) => text.includes(host) });
  }

  // Shape-based, independent of this project's env. BOTH key prefixes: a publishable key is not
  // a credential on its own, but it has no business in a bundle whose browser never calls
  // Supabase — and review found that omitting it left a pasted production key uncaught.
  patterns.push({ name: "sb_secret_ key prefix", test: (text) => /sb_secret_[A-Za-z0-9_-]{8,}/.test(text) });
  patterns.push({ name: "sb_publishable_ key prefix", test: (text) => /sb_publishable_[A-Za-z0-9_-]{8,}/.test(text) });
  // Anchored and dot-terminated, so an ordinary base64 blob (a data: URI, a hash) that happens to
  // contain the run "eyJ" does not fire. A real JWT has a dot-separated payload.
  patterns.push({ name: "JWT-shaped string", test: (text) => /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{20,}\./.test(text) });

  return { patterns, skipped };
}

/** The invariant that keeps `dist/server` — plaintext `.dev.vars` included — out of the public
 *  asset bucket. Checked rather than trusted: it is one field in a generated file, nothing else
 *  asserts it, and getting it wrong publishes the worker's source and its environment file. */
function assertAssetScope() {
  const generated = "dist/server/wrangler.json";
  if (!existsSync(generated)) {
    // Nothing to check before a build; the client-dir check below already fails that case.
    return;
  }
  let directory;
  try {
    directory = JSON.parse(readFileSync(generated, "utf8"))?.assets?.directory;
  } catch {
    console.error(`check-client-bundle: ${generated} is not readable JSON — cannot verify the asset scope.`);
    process.exit(2);
  }
  if (directory !== "../client") {
    console.error(
      `check-client-bundle: ${generated} publishes assets from "${directory}", not "../client". ` +
        `That scope includes dist/server, which holds .dev.vars in plaintext. Refusing to report clean.`,
    );
    process.exit(2);
  }
}

function main() {
  assertAssetScope();
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
  const { patterns, skipped } = buildPatterns(env);

  // A DEGRADED run is not a clean run. Without the literal checks this scan is two shape
  // patterns, and saying "clean" for that was a stdout suffix nothing asserted — the exact shape
  // of a check that describes rather than guards. Opt out explicitly if a context genuinely has
  // no env (then the weakened coverage is a choice, not an accident).
  if (skipped.length > 0 && !env.SECRET_SCAN_ALLOW_MISSING_ENV) {
    console.error(
      `check-client-bundle: no usable value for ${skipped.join(", ")}, so the literal checks were ` +
        `skipped and only ${patterns.length} generic pattern(s) would run. Export the vars, or set ` +
        `SECRET_SCAN_ALLOW_MISSING_ENV=1 to accept the weaker scan.`,
    );
    process.exit(2);
  }

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

  // Name the host the literal checks actually guarded. Without it a run against a local stack
  // reads identically to one guarding production, which is how a check ends up protecting a
  // throwaway database while everyone believes otherwise.
  const guarded = patterns
    .filter((pattern) => pattern.name.includes("host"))
    .map((pattern) => pattern.name)
    .join(", ");
  const weakened = skipped.length > 0 ? ` — WEAKENED, no literal check for ${skipped.join(", ")}` : "";
  console.log(
    `check-client-bundle: clean — ${files.length} file(s), ${scannedBytes} bytes, ` +
      `${patterns.length} pattern(s) [${guarded || "no host pattern"}], ` +
      `control matched in ${controlHits} file(s)${weakened}`,
  );
}

main();
