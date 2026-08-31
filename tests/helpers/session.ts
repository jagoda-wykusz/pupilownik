import { createServerClient } from "@supabase/ssr";
import { createOwnerClient, type OwnerContext } from "./auth";
import { getTestEnv } from "../setup";

// Session-cookie helpers for the auth-gating suite.
//
// The middleware reads the browser session cookie (`sb-<host>-auth-token`,
// base64url-encoded and potentially chunked) from the request's Cookie header.
// createOwnerClient() only yields an in-memory supabase-js session — no cookies —
// so these helpers produce the exact Cookie header the middleware expects, by
// capturing what @supabase/ssr's createServerClient emits on a real sign-in.

function cookieName(url: string): string {
  const host = new URL(url).hostname;
  return `sb-${host.split(".")[0]}-auth-token`;
}

function serializeJar(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
}

export interface AuthenticatedCookie {
  cookieHeader: string;
  userId: string;
  email: string;
}

// Sign the given credentials in through a real @supabase/ssr server client and
// return the Cookie header a browser would send afterwards — the genuine
// (possibly chunked) sb-<host>-auth-token that a server getUser() validates
// against the local stack.
async function mintCookieHeader(email: string, password: string): Promise<string> {
  const { url, anonKey } = getTestEnv();

  // In-memory cookie jar mirroring src/lib/supabase.ts's getAll/setAll. The ssr
  // client flushes the session into it via the SIGNED_IN onAuthStateChange
  // handler, which is awaited through signInWithPassword.
  const jar = new Map<string, string>();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return [...jar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          if (value) {
            jar.set(name, value);
          } else {
            jar.delete(name);
          }
        }
      },
    },
  });

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`mintCookieHeader: signIn failed for ${email}: ${error.message}`);
  }
  if (jar.size === 0) {
    throw new Error(
      "mintCookieHeader: no session cookies captured after signIn — did @supabase/ssr stop flushing on SIGNED_IN?",
    );
  }

  return serializeJar(jar);
}

// Mint a fresh owner and return the Cookie header a browser would send after
// signing them in — the genuine (possibly chunked) sb-<host>-auth-token that the
// middleware's getUser() will validate against the local stack.
export async function createAuthenticatedCookieHeader(): Promise<AuthenticatedCookie> {
  const { userId, email, password } = await createOwnerClient();
  const cookieHeader = await mintCookieHeader(email, password);
  return { cookieHeader, userId, email };
}

// Like createAuthenticatedCookieHeader, but also returns the owner's anon-keyed
// client so a test can drive an authenticated route AND verify its DB side-effect
// as the SAME owner (a follow-up query under that owner's RLS).
export async function createAuthenticatedOwner(): Promise<{ cookieHeader: string; owner: OwnerContext }> {
  const owner = await createOwnerClient();
  const cookieHeader = await mintCookieHeader(owner.email, owner.password);
  return { cookieHeader, owner };
}

// A structurally-valid session cookie whose access token will never validate
// server-side. Proves the gate rejects a present-but-invalid session (getUser
// validates the JWT; presence alone is not enough), not just a missing one.
export function createInvalidCookieHeader(): string {
  const { url } = getTestEnv();
  const name = cookieName(url);
  const bogusSession = {
    access_token: "invalid.invalid.invalid",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 9999999999,
    refresh_token: "invalid",
    user: null,
  };
  const value = `base64-${Buffer.from(JSON.stringify(bogusSession), "utf8").toString("base64url")}`;
  return `${name}=${encodeURIComponent(value)}`;
}
