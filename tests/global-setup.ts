import { getTestEnv } from "./env";

// Wait for the local Supabase stack ONCE PER RUN, before any test file is loaded.
//
// WHY THIS IS A globalSetup AND NOT A setupFiles HOOK, because it used to be the latter and the
// phase-2 review measured what that cost. `setupFiles` runs in every worker for every test file,
// so a `beforeAll` probe there is paid 22 times — measured 2026-09-12: ~11s for a single file
// against a dead port, which at `maxWorkers: 1` under CI is roughly three minutes of red build
// while the header comment claimed eight seconds. `globalSetup` runs once in the main process, so
// the budget below is spent at most once no matter how many files run.
//
// Two consequences worth naming:
//   - The readiness budget could be raised, and was: 30s here versus 8s per file before. A slow
//     CI stack is exactly what this exists for, and a one-off 30s ceiling is cheaper than a
//     per-file 8s one.
//   - `hookTimeout` in vitest.config.ts went back to 20s. It had been raised to 30s purely to fit
//     these probes; nothing else in the integration suite needed the extra room.
//
// A failure here aborts the whole run before a single test executes, with the actionable message
// rather than a cryptic per-test error. That is the property the file exists for — and it is why
// a bare timeout is never an acceptable outcome of this function.

const READY_BUDGET_MS = 30_000;
const ATTEMPT_TIMEOUT_MS = 3000;
const RETRY_DELAY_MS = 500;

/** One bounded probe. Resolves false for every failure shape — a refused connection, our own
 *  abort, a malformed response — because the caller only needs "ready or not yet". */
async function attempt(
  url: string,
  init: RequestInit | undefined,
  accept: (res: Response) => boolean,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, ATTEMPT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return accept(res);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Retry against a DEADLINE rather than a fixed attempt count: an attempt refused instantly and
 *  one that hangs for its full timeout cost wildly different wall clock, and what has to stay
 *  bounded is the total. Note it can overshoot by up to one attempt timeout, because the deadline
 *  is checked after an attempt returns — 30s + 3s worst case. */
async function reachable(
  base: string,
  path: string,
  init?: RequestInit,
  accept: (res: Response) => boolean = (res) => res.ok,
): Promise<boolean> {
  const deadline = Date.now() + READY_BUDGET_MS;
  for (;;) {
    if (await attempt(`${base}${path}`, init, accept)) {
      return true;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(RETRY_DELAY_MS, remaining)));
  }
}

export default async function waitForLocalSupabase(): Promise<void> {
  const { url, anonKey } = getTestEnv();
  const notReady = `Run \`npm run db:start\` (and wait for it to finish) before \`npm test\`.`;

  // AUTH. `/auth/v1/health` was the probe here until the phase-2 review pointed out that it is a
  // LIVENESS check sold as a readiness one: it returns static version metadata the moment GoTrue
  // is listening, and says nothing about whether GoTrue can reach Postgres — the structurally
  // identical mistake this file already documents for PostgREST below. What the suite actually
  // needs is signUp, which goes through to the database and the `handle_new_user` trigger.
  //
  // So probe the token endpoint with credentials that cannot exist. It touches the DB and has no
  // side effects — no user is created, nothing is written:
  //   400 — GoTrue reached Postgres and answered "invalid login credentials". READY.
  //   500 — typically `database error querying schema`: listening, DB not up. NOT ready.
  // 200 is impossible for a random address, and is treated as ready anyway rather than as an
  // error, because a stack that can authenticate is by definition up.
  const authReady = (res: Response): boolean => res.status === 400 || res.status === 200;
  const probeBody = JSON.stringify({ email: `readiness-${crypto.randomUUID()}@pupilownik.test`, password: "x" });

  if (
    !(await reachable(
      url,
      "/auth/v1/token?grant_type=password",
      { method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: probeBody },
      authReady,
    ))
  ) {
    throw new Error(
      `Local Supabase auth API is not ready at ${url} — either it is not listening, or it is up but cannot reach Postgres. ${notReady}`,
    );
  }

  // DATA API. Probe a real TABLE, not the root. `/rest/v1/` answers 200 as soon as the process is
  // listening — which is strictly BEFORE it has loaded the schema cache. Straight after a
  // `db:reset` that window is wide enough to fail a whole run with
  // `PGRST205: Could not find the table 'public.pets' in the schema cache`, which reads like a
  // broken migration and is really a race with startup. Measured on 2026-09-07: 13 files and 6
  // tests failed that way while the old probe reported "ready".
  //
  // `pets` is the table to ask for — the oldest domain table (S-01), so it exists in every
  // migration state this suite can run against.
  //
  // The status codes are the whole point, and they separate cleanly:
  //   404 — PGRST205, the table is not in the schema cache yet. NOT ready.
  //   401 — the table resolved and RLS refused anon, which holds no grant on `pets`. READY.
  //   200 — resolved and readable.
  // So `res.ok` is the wrong predicate here: it would reject the 401 that means success and hang
  // until the deadline. Checked against the running stack rather than assumed.
  //
  // KNOWN LIMIT, named by the phase-2 review: a bogus or absent `SUPABASE_KEY` also produces 401
  // here, so this probe does not validate the key — only that the table resolved.
  const dataApiReady = (res: Response): boolean => res.status === 200 || res.status === 401 || res.status === 403;

  if (!(await reachable(url, "/rest/v1/pets?select=id&limit=1", { headers: { apikey: anonKey } }, dataApiReady))) {
    throw new Error(
      `Local Supabase data API (PostgREST) is not ready at ${url} — either it is not listening, or it is up but has not loaded its schema cache yet. ${notReady}`,
    );
  }
}
