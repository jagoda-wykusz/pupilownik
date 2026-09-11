import { readFileSync } from "node:fs";
import path from "node:path";

// Test-environment loading and the one safety guard that must hold in EVERY process that touches
// the stack. Split out of tests/setup.ts on 2026-09-12 (`ci-quality-gates` phase 2 review) so that
// `tests/global-setup.ts` — which runs in the main process, outside any test context, and must not
// pull in a module that registers `beforeAll` — can reuse it.
//
// Everything here runs at IMPORT time, deliberately: both the setup file (once per worker) and the
// global setup (once per run) get the env and the host check by importing this module at all.

/** Load `.env.test` (gitignored) into process.env without adding a dotenv dependency.
 *  Format is the controlled KEY=VALUE shape of `.env.test.example`. */
function loadTestEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env.test");
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    throw new Error(
      `Missing .env.test — copy .env.test.example to .env.test and fill in the values from \`npm run db:start\`.`,
    );
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    // Real environment wins over the file, so CI/overrides stay authoritative.
    process.env[key] ??= value;
  }
}

export function getTestEnv(): { url: string; anonKey: string } {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_KEY;
  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY must be set in .env.test (see .env.test.example).");
  }
  return { url, anonKey };
}

loadTestEnv();

// Guard against pointing the destructive suite at a hosted project. Enforced per process rather
// than once per run on purpose: it costs nothing, and it is the one check whose failure mode is
// deleting real users rather than a red test.
{
  const { url } = getTestEnv();
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(
      `SUPABASE_URL host is "${host}" — the RLS suite creates and deletes users and must run only against the LOCAL stack (127.0.0.1 / localhost).`,
    );
  }
}
