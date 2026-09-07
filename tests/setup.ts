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
  // reconnecting after a reset) both mean "not ready" — otherwise signUp / from() fail
  // later with a cryptic error instead of this guidance. Probe BOTH backends the suite
  // uses: auth (signUp) and PostgREST (from("profiles")) can come up independently.
  const { anonKey } = getTestEnv();
  // `accept` decides what counts as ready. It defaults to res.ok, but the data-API probe below
  // needs something else: it asks for a table anon may not read, so a healthy answer is 401.
  const reachable = async (
    path: string,
    init?: RequestInit,
    accept: (res: Response) => boolean = (res) => res.ok,
  ): Promise<boolean> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 3000);
    try {
      const res = await fetch(`${url}${path}`, { ...init, signal: controller.signal });
      return accept(res);
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };

  const notReady = `Run \`npm run db:start\` (and wait for it to finish) before \`npm test\`.`;
  if (!(await reachable("/auth/v1/health"))) {
    throw new Error(`Local Supabase auth API is not ready at ${url}. ${notReady}`);
  }
  // Probe a real TABLE, not the root. `/rest/v1/` answers 200 as soon as the process is
  // listening — which is strictly BEFORE it has loaded the schema cache. Straight after a
  // `db:reset` that window is wide enough to fail a whole run with
  // `PGRST205: Could not find the table 'public.pets' in the schema cache`, which reads like a
  // broken migration and is really a race with startup. Measured on 2026-09-07: 13 files and 6
  // tests failed that way while this very probe reported "ready".
  //
  // `pets` is the table to ask for — the oldest domain table (S-01), so it exists in every
  // migration state this suite can run against.
  //
  // The status codes are the whole point, and they separate cleanly:
  //   404 — PGRST205, the table is not in the schema cache yet. NOT ready.
  //   401 — the table resolved and RLS refused anon, which holds no grant on `pets`. READY.
  //   200 — resolved and readable.
  // So `res.ok` is the wrong predicate here: it would reject the 401 that means success and
  // hang until the timeout. Checked against the running stack rather than assumed.
  const dataApiReady = (res: Response): boolean => res.status === 200 || res.status === 401 || res.status === 403;

  if (!(await reachable("/rest/v1/pets?select=id&limit=1", { headers: { apikey: anonKey } }, dataApiReady))) {
    throw new Error(
      `Local Supabase data API (PostgREST) is not ready at ${url} — either it is not listening, or it is up but has not loaded its schema cache yet. ${notReady}`,
    );
  }
});
