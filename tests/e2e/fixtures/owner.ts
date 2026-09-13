import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "@/db/database.types";
import { getTestEnv } from "../../env";
import type { OwnerCredentials } from "../auth.setup";

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

  const { error } = await client.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });
  if (error) {
    throw new Error(`ownerClient: could not sign in as ${credentials.email}: ${error.message}`);
  }

  return { client, userId: credentials.userId };
}
