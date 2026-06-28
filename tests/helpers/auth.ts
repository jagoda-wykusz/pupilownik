import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { getTestEnv } from "../setup";

export interface OwnerContext {
  client: SupabaseClient<Database>;
  userId: string;
  email: string;
  password: string;
}

const DEFAULT_PASSWORD = "password123";

// Build an authenticated, ANON-KEYED Supabase client for a fresh, distinct owner.
//
// This is the single primitive the whole RLS harness builds on. Identity is a real
// user JWT obtained through the anon client's signUp (local stack has email
// confirmation disabled). The anon key is the security boundary — never the
// service_role key, which would bypass RLS and make every assertion a tautology.
export async function createOwnerClient(): Promise<OwnerContext> {
  const { url, anonKey } = getTestEnv();
  const email = `owner-${crypto.randomUUID()}@pupilownik.test`;
  const password = DEFAULT_PASSWORD;

  const client = createClient<Database>(url, anonKey);
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) {
    throw new Error(`createOwnerClient: signUp failed for ${email}: ${error.message}`);
  }
  const userId = data.user?.id;
  if (!userId || !data.session) {
    throw new Error(
      `createOwnerClient: signUp returned no authenticated session for ${email} — is email confirmation disabled on the local stack?`,
    );
  }

  return { client, userId, email, password };
}
