import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll } from "vitest";

// Load `.env.test` (gitignored) into process.env without adding a dotenv dependency.
// Format is the controlled KEY=VALUE shape of `.env.test.example`.
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

beforeAll(async () => {
  const { url } = getTestEnv();

  // Guard against pointing the destructive suite at a hosted project.
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(
      `SUPABASE_URL host is "${host}" — the RLS suite creates and deletes users and must run only against the LOCAL stack (127.0.0.1 / localhost).`,
    );
  }

  // Fail fast with an actionable message if the local stack is not up. A network throw
  // (nothing listening) AND a non-OK response (e.g. Kong 502 while auth is still
  // reconnecting after a reset) both mean "not ready" — otherwise signUp fails later
  // with a cryptic empty-body error instead of this guidance.
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 3000);
  let ok = false;
  try {
    const res = await fetch(`${url}/auth/v1/health`, { signal: controller.signal });
    ok = res.ok;
  } catch {
    ok = false;
  } finally {
    clearTimeout(timeout);
  }
  if (!ok) {
    throw new Error(
      `Local Supabase auth API is not ready at ${url}. Run \`npm run db:start\` (and wait for it to finish) before \`npm test\`.`,
    );
  }
});
