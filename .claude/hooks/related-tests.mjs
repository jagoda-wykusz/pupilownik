#!/usr/bin/env node
// PostToolUse hook: run only the tests related to the file the agent just edited,
// and only when that file sits in a risk area from context/foundation/test-plan.md.
//
// Risk areas (test-plan.md §2):
//   #1 owner-isolation / RLS      -> src/db/**, supabase/migrations/**
//   #2 auth gating                -> src/middleware.ts, src/pages/api/auth/**
//   #7 untrusted input (zod)      -> src/pages/api/**, src/lib/schemas/**, src/lib/**
// Everything else (components, layouts, styles, config) is deliberately not a
// per-edit trigger: low signal, and the suite needs the local Supabase stack.
//
// Exit codes: 0 = passed, skipped, or stack unavailable; 2 = tests failed
// (blocking, so the agent sees the failure output in its next turn).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const RISK_AREAS = [
  /^src\/middleware\.ts$/,
  /^src\/db\//,
  /^src\/pages\/api\//,
  /^src\/lib\//,
  /^tests\//,
];

// Migrations are a Risk #1 area but are invisible to Vitest's static import graph —
// verifying them needs a db reset, which is far too heavy for a per-edit hook.
const MIGRATION_AREA = /^supabase\/migrations\//;

function readEvent() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Read a single key out of .env.test without pulling in a dotenv dependency. */
function readTestEnv(cwd, key) {
  const envPath = path.join(cwd, ".env.test");
  if (!existsSync(envPath)) {
    return undefined;
  }
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    if (trimmed.slice(0, eq).trim() === key) {
      return trimmed.slice(eq + 1).trim();
    }
  }
  return undefined;
}

/**
 * The suite runs against the local Supabase stack. When Docker/Supabase is down,
 * every test fails for a reason that has nothing to do with the edit — so skip
 * instead of flooding the agent with a false blocking error.
 */
async function stackReachable(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 2000);
  try {
    const res = await fetch(`${url}/auth/v1/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const event = readEvent();
const filePath = event?.tool_input?.file_path;
if (!filePath) {
  process.exit(0);
}

const cwd = process.cwd();
const absolute = path.resolve(cwd, filePath);
const relative = path.relative(cwd, absolute).split(path.sep).join("/");

if (relative.startsWith("..") || path.isAbsolute(relative) || !existsSync(absolute)) {
  process.exit(0);
}

if (MIGRATION_AREA.test(relative)) {
  process.stdout.write(
    `${relative} is a Risk #1 (RLS) area, but migrations need a db reset to verify. ` +
      `Run \`npm run db:reset && npm test\` when the migration work is done.\n`,
  );
  process.exit(0);
}

if (!RISK_AREAS.some((area) => area.test(relative))) {
  process.exit(0);
}

const vitestBin = path.join(cwd, "node_modules", "vitest", "vitest.mjs");
if (!existsSync(vitestBin)) {
  process.exit(0);
}

const url = readTestEnv(cwd, "SUPABASE_URL");
if (!url) {
  process.stdout.write("Skipped related tests: no .env.test (copy .env.test.example).\n");
  process.exit(0);
}
if (!(await stackReachable(url))) {
  process.stdout.write(
    `Skipped related tests for ${relative}: local Supabase is not reachable at ${url}. ` +
      `Run \`npm run db:start\` to re-enable the per-edit test gate.\n`,
  );
  process.exit(0);
}

// `related` walks the static import graph and runs only the tests that depend on
// this file. `--run` disables watch mode (a watching hook would never exit).
// AI_AGENT=1 switches Vitest 4.1+ to failure-only output: less noise, fewer tokens.
const result = spawnSync(process.execPath, [vitestBin, "related", relative, "--run", "--passWithNoTests"], {
  cwd,
  encoding: "utf8",
  env: { ...process.env, AI_AGENT: "1" },
});

if (result.status !== 0) {
  const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  process.stderr.write(`Tests related to ${relative} failed:\n${detail}\n`);
  process.exit(2);
}

process.exit(0);
