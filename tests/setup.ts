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

  // WHY THESE PROBES RETRY (added 2026-09-11, `ci-quality-gates` phase 2). A single attempt was
  // enough on a developer machine, where `npm run db:start` has already returned before anyone
  // runs the suite. It is NOT enough on a CI runner, where `supabase start` returns and the
  // suite begins while PostgREST is still loading its schema cache — the exact race the data-API
  // comment below records from 2026-09-07, which failed 13 files while the probe reported ready.
  //
  // THE COST, MEASURED rather than guessed — the first draft of this comment claimed a refused
  // connection would short-circuit the budget, and the measurement said otherwise: an instant
  // rejection just makes the loop retry sooner, so a stack-down run spends the WHOLE budget.
  // Measured 2026-09-11 against a dead port: the run fails in ~8s where it used to fail in well
  // under 1s. Only the first probe pays it, because the auth probe throws before the data-API
  // probe runs. That is the price, and it buys the case below.
  //
  // AND THE THING IT BUYS, also measured: against a fake stack that answers 503/404 for its first
  // four seconds and healthy afterwards, these probes now PASS. With READY_BUDGET_MS set to 0 —
  // i.e. the previous single-attempt behaviour — the same fake stack fails at the auth probe. The
  // retry is load-bearing, not decoration.
  //
  // The guidance message is unchanged: a stack-down run must still end in `npm run db:start`,
  // never in a bare vitest timeout, which would make a missing stack harder to diagnose rather
  // than easier. That is why hookTimeout in vitest.config.ts was raised to sit above the budget.
  const READY_BUDGET_MS = 8000;
  const ATTEMPT_TIMEOUT_MS = 3000;
  const RETRY_DELAY_MS = 500;

  // `accept` decides what counts as ready. It defaults to res.ok, but the data-API probe below
  // needs something else: it asks for a table anon may not read, so a healthy answer is 401.
  const reachable = async (
    path: string,
    init?: RequestInit,
    accept: (res: Response) => boolean = (res) => res.ok,
  ): Promise<boolean> => {
    const attempt = async (): Promise<boolean> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, ATTEMPT_TIMEOUT_MS);
      try {
        const res = await fetch(`${url}${path}`, { ...init, signal: controller.signal });
        return accept(res);
      } catch {
        return false;
      } finally {
        clearTimeout(timeout);
      }
    };

    // Deadline rather than a fixed attempt count: an attempt that hangs for its full timeout and
    // one that is refused instantly cost wildly different amounts of wall clock, and the thing
    // that must stay bounded is the TOTAL — `hookTimeout` in vitest.config.ts is what kills the
    // run, and it does not care how many attempts fit inside.
    const deadline = Date.now() + READY_BUDGET_MS;
    for (;;) {
      if (await attempt()) {
        return true;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(RETRY_DELAY_MS, remaining)));
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
