import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "@/db/database.types";
import { getTestEnv } from "../../env";

/** What `auth.setup.ts` writes and this module reads back.
 *
 *  It is declared HERE, not in `auth.setup.ts`, so that nothing ever imports a spec/setup file for
 *  a type. That import worked only because `import type` is erased before Playwright loads the
 *  module; dropping the word `type` in a future edit would pull `setup(...)` into this module's
 *  graph and Playwright would refuse with "test() can only be called in a test file". Inverting the
 *  direction removes the trap rather than relying on nobody springing it (review F8). */
export interface OwnerCredentials {
  email: string;
  password: string;
  userId: string;
}

// Rebuilds an owner-scoped Supabase client for the identity `auth.setup.ts` created this run.
//
// It exists for CLEANUP, not for assertions. Specs assert through the browser; the database is
// only how they put data in place and take it away again — this project exposes no delete
// affordance for pets, so there is no honest UI route for teardown.
//
// ANON-KEYED, always. The service-role key bypasses RLS, and a fixture that seeds or cleans up
// with it is performing a different operation from the one the app performs — which is exactly
// what `docs/reference/data-access.md` and the vitest helpers refuse to do. Anything this client
// cannot do is something the owner genuinely cannot do, and that is the property worth keeping.
//
// `getTestEnv` comes from `tests/env.ts`, which loads `.env.test` on import and REFUSES any
// non-localhost `SUPABASE_URL` — the same guard the vitest suite runs under, for the same reason:
// this code creates and deletes rows.

const CREDENTIALS_FILE = path.resolve("playwright/.auth/owner-credentials.json");

export async function ownerClient(): Promise<{ client: SupabaseClient<Database>; userId: string }> {
  let raw: string;
  try {
    raw = await readFile(CREDENTIALS_FILE, "utf8");
  } catch {
    throw new Error(
      `Missing ${CREDENTIALS_FILE} — the 'setup' project writes it. Run the suite through 'npm run test:e2e' rather than invoking a spec directly.`,
    );
  }
  const credentials = JSON.parse(raw) as OwnerCredentials;

  const { url, anonKey } = getTestEnv();
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });
  if (error) {
    throw new Error(
      `ownerClient: could not sign in as ${credentials.email}: ${error.message}. If the local stack was reset since the last run, the credentials file is stale — delete playwright/.auth/ and re-run.`,
    );
  }

  // The identity guard, and it exists because the failure it catches is SILENT. The credentials
  // file survives a `supabase db reset` / `stop` + `start`, so it can name a user that no longer
  // exists — or, worse, one that exists but is a different owner than the browser session belongs
  // to. In that second case sign-in SUCCEEDS, the cleanup delete is scoped by RLS to nobody, and
  // PostgREST reports no error for a zero-row delete: the test goes green having cleaned up
  // nothing (review F10). Comparing the id turns both modes into one named failure.
  if (data.user.id !== credentials.userId) {
    throw new Error(
      `ownerClient: the credentials file names user ${credentials.userId} but signing in produced ${data.user.id} — playwright/.auth/ is stale. Delete it and re-run; if the local stack was reset, run \`npm run db:reset\` first.`,
    );
  }

  return { client, userId: credentials.userId };
}
