import { createServerClient } from "@supabase/ssr";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as signout } from "@/pages/api/auth/signout";
import { createAuthenticatedOwner } from "../helpers/session";
import { getTestEnv } from "../setup";

// First coverage for POST /api/auth/signout, which had none — zero references anywhere in tests/
// until `testing-input-validation` phase 2.
//
// WHAT IS WORTH ASSERTING HERE, and it is not "the route returns 302". A sign-out that redirects
// while leaving the session usable is the failure that matters, and it is invisible from the
// status code. So this file asserts the property a caller depends on: the cookie the browser was
// holding STOPS AUTHENTICATING. That was measured before it was written — a session cookie carries
// a JWT that could in principle stay valid until it expires, so "signed out" and "the cookie is
// dead" are different claims, and only the measurement settles which one is true here.
//
// Measured 2026-09-12 against the local stack: getUser() with the caller's cookie returns the user
// before the call and `Auth session missing!` after it.
//
// `whoAmI` below uses getUser() and that choice is load-bearing: it makes a ROUND TRIP, so it sees
// the server-side revocation. Swapping it for a local-verification call such as getClaims() would
// invert this file silently, because the access token stays cryptographically valid until expiry.
//
// NOT ASSERTED HERE, deliberately: src/pages/api/auth/signout.ts:6-8 skips the sign-out entirely
// when createClient returns null and still redirects to `/`, so a caller cannot tell a completed
// sign-out from one that never happened. Reaching that branch needs a null-returning client, which
// would mean mocking @/lib/supabase — and this file exists precisely to talk to the real one. The
// behaviour is recorded in test-plan.md §7 instead, as something measured and left, not endorsed.

function createFakeCookies() {
  const store = new Map<string, string>();
  return {
    store,
    get(name: string) {
      const value = store.get(name);
      return value === undefined ? undefined : { value };
    },
    set(name: string, value: string) {
      store.set(name, value);
    },
    delete(name: string) {
      store.delete(name);
    },
    has(name: string) {
      return store.has(name);
    },
  };
}

/** Ask the auth server who the given Cookie header belongs to. Deliberately built from the same
 *  @supabase/ssr entry point the route uses, so a difference here is a difference the app would
 *  also see. */
async function whoAmI(cookieHeader: string): Promise<{ userId: string | null; error: string | null }> {
  const { url, anonKey } = getTestEnv();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () =>
        cookieHeader
          .split("; ")
          .filter(Boolean)
          .map((pair) => {
            const eq = pair.indexOf("=");
            return { name: pair.slice(0, eq), value: decodeURIComponent(pair.slice(eq + 1)) };
          }),
      setAll: () => {
        // The probe must not mutate anything; it only reads.
      },
    },
  });

  const { data, error } = await client.auth.getUser();
  return { userId: data.user?.id ?? null, error: error?.message ?? null };
}

async function callSignout(cookieHeader: string) {
  const cookies = createFakeCookies();
  const url = new URL("http://127.0.0.1/api/auth/signout");
  const context = {
    request: new Request(url, { method: "POST", headers: { Cookie: cookieHeader } }),
    url,
    cookies,
    params: {},
    locals: { user: null },
    redirect: (target: string) => new Response(null, { status: 302, headers: { Location: target } }),
  };

  type Args = Parameters<typeof signout>;
  const response = await signout(context as unknown as Args[0]);
  return { response, cookies };
}

describe("signing out ends the session, not just the page", () => {
  let owner: Awaited<ReturnType<typeof createAuthenticatedOwner>>;

  beforeAll(async () => {
    owner = await createAuthenticatedOwner();
  });

  it("leaves the caller's cookie unable to authenticate", async () => {
    // The positive control comes first and is not decoration: without it, a cookie that never
    // worked would produce the same "after" result and this test would pass having proven nothing.
    const before = await whoAmI(owner.cookieHeader);
    expect(before.userId, "the minted cookie should authenticate before sign-out").toBe(owner.owner.userId);

    await callSignout(owner.cookieHeader);

    const after = await whoAmI(owner.cookieHeader);
    expect(after.userId, "the same cookie still authenticates after sign-out").toBeNull();
  });

  it("clears the session cookie rather than leaving it in place", async () => {
    const fresh = await createAuthenticatedOwner();
    const { response, cookies } = await callSignout(fresh.cookieHeader);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");

    // @supabase/ssr removes a cookie by writing it with an empty value through the adapter in
    // src/lib/supabase.ts:18-22. Asserting the NAMES were touched and the values are empty says
    // the removal happened; asserting a Set-Cookie substring would pin the serializer instead.
    const written = [...cookies.store.entries()];
    expect(written.length, "sign-out wrote no cookies at all").toBeGreaterThan(0);
    for (const [name, value] of written) {
      expect(name).toMatch(/^sb-/);
      expect(value, `${name} was written with a value instead of being cleared`).toBe("");
    }
  });

  it("answers a caller who has no session with the same redirect, and says what does differ", async () => {
    // The route has no auth gate by design, so the REDIRECT must not become an oracle for whether a
    // session existed. Note honestly what this half can and cannot catch: `signout.ts` has exactly
    // one exit today, so nothing in the current code can violate it — it is a guard against a
    // future second exit (a 404 for "no session", say), not a statement about today.
    //
    // The second half is the part that pins something measured. The response is NOT identical in
    // every respect, and pretending otherwise would be the more comfortable lie: with a session the
    // adapter clears one `sb-` cookie, without one it writes nothing. Measured 2026-09-12:
    // ["sb-127-auth-token"] versus []. That difference is inherent — you cannot clear a cookie the
    // caller never sent — and a caller learns from it only that the cookie they themselves supplied
    // was valid, which they could discover by using it. Asserted so that a change to it is a
    // decision rather than a drift.
    const withSession = await callSignout((await createAuthenticatedOwner()).cookieHeader);
    const withoutSession = await callSignout("");

    expect(withoutSession.response.status).toBe(withSession.response.status);
    expect(withoutSession.response.headers.get("Location")).toBe(withSession.response.headers.get("Location"));

    expect([...withSession.cookies.store.keys()].length, "a live session should have been cleared").toBeGreaterThan(0);
    expect([...withoutSession.cookies.store.keys()], "nothing to clear, so nothing should be written").toEqual([]);
  });
});
