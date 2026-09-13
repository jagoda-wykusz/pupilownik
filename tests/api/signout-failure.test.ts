import { createServerClient } from "@supabase/ssr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticatedOwner } from "../helpers/session";
import { getTestEnv } from "../setup";

// The FAILURE paths of POST /api/auth/signout. `tests/api/signout.test.ts` owns the success path
// and says in its own header why it cannot own these: it "exists precisely to talk to the real
// [client]", and reaching a failing sign-out needs an injected one. So the split is deliberate —
// two files, two roles — and that file stays untouched.
//
// WHY THIS MATTERS MORE THAN A MISSING LOG LINE. Measured in
// node_modules/@supabase/auth-js/dist/main/GoTrueClient.js (v2.105.3): `_signOut()` returns EARLY
// when `admin.signOut()` errors with anything outside 404/401/403, so `_removeSession()` — the only
// path by which the @supabase/ssr adapter in src/lib/supabase.ts clears the session cookies — never
// runs. A failed sign-out therefore leaves the browser holding a working session while the route
// redirects as though it succeeded. That is the failure `signout.test.ts`'s header names ("a
// sign-out that redirects while leaving the session usable is the failure that matters") and only
// ever asserted the absence of.

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

const { createClient } = await import("@/lib/supabase");
const { POST: signout } = await import("@/pages/api/auth/signout");

/** Astro's cookie object, recording both removal shapes.
 *
 *  `@supabase/ssr` removes a cookie by WRITING IT EMPTY through the adapter; a route removing one
 *  itself would more naturally call `delete`. Both are removals, and `removed` asserts the
 *  OUTCOME — the caller's cookie is gone — without pinning which mechanism produced it.
 *
 *  `removals` exists for the one detail the outcome cannot show: the OPTIONS passed to `delete`.
 *  A delete whose path does not match the one the cookie was set with is silently ignored by the
 *  browser, so `delete(name)` with no path would clear nothing in a real browser while still
 *  landing in `removed` here — green test, no-op in production. */
function createFakeCookies() {
  const store = new Map<string, string>();
  const removed: string[] = [];
  const removals: { name: string; options?: Record<string, unknown> }[] = [];
  // Astro's outgoing jar: one entry per name set OR deleted during the request, keyed by name so a
  // later delete replaces an earlier set. `headers()` walks it; the route reads it to catch names
  // a mid-request token refresh staged that the request header never carried.
  const outgoing = new Map<string, string>();
  return {
    store,
    removed,
    removals,
    get(name: string) {
      const value = store.get(name);
      return value === undefined ? undefined : { value };
    },
    set(name: string, value: string) {
      store.set(name, value);
      outgoing.set(name, `${name}=${value}; Path=/`);
      if (value === "") {
        removed.push(name);
      }
    },
    delete(name: string, options?: Record<string, unknown>) {
      store.delete(name);
      outgoing.set(name, `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
      removed.push(name);
      removals.push({ name, options });
    },
    has(name: string) {
      return store.has(name);
    },
    *headers() {
      yield* outgoing.values();
    },
  };
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

/** A client that reports a failed sign-out, the way a 500 or a transport fault does. */
function failingClient(message = "gateway exploded") {
  return {
    auth: {
      signOut: () => Promise.resolve({ error: { code: "unexpected_failure", message, status: 500 } }),
    },
  };
}

describe("the library premise this fix rests on", () => {
  it("leaves the session in place when signOut fails", async () => {
    const { cookieHeader } = await createAuthenticatedOwner();
    const { anonKey } = getTestEnv();

    // Same HOST as the real stack, closed PORT. The host matters: @supabase/ssr derives the cookie
    // NAME from the project ref in the URL, so pointing at a different host would give the client a
    // storage key that matches nothing, no session to sign out of, and a pass for the wrong reason.
    const written: { name: string; value: string }[] = [];
    const client = createServerClient("http://127.0.0.1:1", anonKey, {
      cookies: {
        getAll: () =>
          cookieHeader
            .split("; ")
            .filter(Boolean)
            .map((pair) => {
              const eq = pair.indexOf("=");
              return { name: pair.slice(0, eq), value: decodeURIComponent(pair.slice(eq + 1)) };
            }),
        setAll: (toSet) => {
          written.push(...toSet.map(({ name, value }) => ({ name, value })));
        },
      },
    });

    // The control. Without it, a client that never saw the session would produce the same "nothing
    // was cleared" result and this case would prove nothing at all.
    const { data: before } = await client.auth.getSession();
    expect(before.session, "the client must see the session, or this case proves nothing").not.toBeNull();

    const { error } = await client.auth.signOut();
    expect(error, "signOut against a closed port should have failed").not.toBeNull();

    // The premise itself. If a future supabase-js clears regardless of the error, this goes red —
    // and the route's manual clearing becomes redundant rather than load-bearing. That is exactly
    // the kind of expiry that otherwise leaves dead code under a confident comment.
    expect(
      written.filter((cookie) => cookie.value === ""),
      "supabase-js cleared the session despite the error — this fix's premise is gone",
    ).toEqual([]);
  });
});

describe("a failed sign-out still ends the local session", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("clears the caller's session cookie when signOut reports an error", async () => {
    vi.mocked(createClient).mockReturnValue(failingClient() as unknown as ReturnType<typeof createClient>);

    const { response, cookies } = await callSignout("sb-127-auth-token=abc; other=keep");

    // What the user is entitled to: the browser stops holding a usable session, whatever the auth
    // server said. Asserted as an outcome — removed by any mechanism — not as a call shape.
    expect(cookies.removed, "the session cookie survived a failed sign-out").toContain("sb-127-auth-token");
    expect(cookies.removed, "an unrelated cookie was removed").not.toContain("other");

    // The one thing the outcome cannot show. Without this, dropping the options — `delete(name)`,
    // which a browser ignores because the path does not match — leaves every case in this file
    // green while clearing nothing at all in production.
    expect(cookies.removals, "the delete must carry the path @supabase/ssr wrote with").toContainEqual({
      name: "sb-127-auth-token",
      options: { path: "/" },
    });

    // The redirect is unchanged. A failed sign-out must not become an oracle either.
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
  });

  it("clears the caller's session cookie when no Supabase client can be built", async () => {
    // The file's other silent path: createClient returns null when the env vars are absent, the
    // sign-out is skipped entirely, and the caller is redirected as though it happened.
    // test-plan.md recorded this as left-unfixed because reaching it "needs a null-returning mock" —
    // which is what this file is.
    vi.mocked(createClient).mockReturnValue(null);

    const { response, cookies } = await callSignout("sb-127-auth-token=abc");

    expect(cookies.removed, "the session cookie survived a skipped sign-out").toContain("sb-127-auth-token");
    expect(response.status).toBe(302);
  });

  it("still redirects when a cookie name cannot be serialized", async () => {
    // MEASURED 2026-09-13: `parseCookieHeader` accepts names that `cookie.serialize` — which
    // `cookies.delete` calls — rejects with a TypeError. The name comes from the caller, so
    // without the guard a header like this turns the route's guaranteed 302 into a 500 and the
    // real session cookie that follows it is never cleared.
    //
    // The name carries a SPACE, not the `sb-ą` the measurement started from: a header value
    // is a ByteString, so `new Request` rejects the non-ASCII one before the route ever sees it.
    // A space passes that gate, `cookie.parse` keeps it in the name, and `cookie.serialize`
    // refuses it — which is the reachable shape of this bug.
    vi.mocked(createClient).mockReturnValue(failingClient() as unknown as ReturnType<typeof createClient>);

    const cookies = createFakeCookies();
    const url = new URL("http://127.0.0.1/api/auth/signout");
    const context = {
      request: new Request(url, {
        method: "POST",
        headers: { Cookie: "sb-a b=1; sb-127-auth-token=abc" },
      }),
      url,
      cookies: {
        ...cookies,
        delete(name: string, options?: Record<string, unknown>) {
          // Astro's real `delete` serializes eagerly; this is where the TypeError comes from.
          if (!/^[!-:<>-~]+$/.test(name)) {
            throw new TypeError("argument name is invalid");
          }
          cookies.delete(name, options);
        },
      },
      params: {},
      locals: { user: null },
      redirect: (target: string) => new Response(null, { status: 302, headers: { Location: target } }),
    };

    type Args = Parameters<typeof signout>;
    const response = await signout(context as unknown as Args[0]);

    expect(response.status, "an unserializable cookie name must not become a 500").toBe(302);
    expect(cookies.removed, "the serializable session cookie was skipped too").toContain("sb-127-auth-token");
  });

  it("clears a session the request never carried, staged by a mid-request refresh", async () => {
    // MEASURED 2026-09-13 in @supabase/auth-js@2.105.3: `_signOut()` runs inside `_useSession()`,
    // whose `__loadSession()` calls `_callRefreshToken()` when the session sits inside
    // EXPIRY_MARGIN_MS. The refreshed session is persisted through the adapter's `setAll`, so the
    // response can already be STAGING a fresh session — under re-chunked names the request header
    // never had — by the time the sign-out fails. Clearing only the request's names would emit a
    // brand-new working session in the very response that claims the user signed out.
    vi.mocked(createClient).mockReturnValue(failingClient() as unknown as ReturnType<typeof createClient>);

    const cookies = createFakeCookies();
    cookies.set("sb-127-auth-token.0", "fresh-half-one");
    cookies.set("sb-127-auth-token.1", "fresh-half-two");

    const url = new URL("http://127.0.0.1/api/auth/signout");
    const context = {
      // The request carried the OLD, unchunked name. The two chunks above exist only in the jar.
      request: new Request(url, { method: "POST", headers: { Cookie: "sb-127-auth-token=stale" } }),
      url,
      cookies,
      params: {},
      locals: { user: null },
      redirect: (target: string) => new Response(null, { status: 302, headers: { Location: target } }),
    };

    type Args = Parameters<typeof signout>;
    const response = await signout(context as unknown as Args[0]);

    expect(response.status).toBe(302);
    expect(cookies.removed, "the request's own session cookie survived").toContain("sb-127-auth-token");
    expect(cookies.removed, "a refreshed session was left staged in the response").toEqual(
      expect.arrayContaining(["sb-127-auth-token.0", "sb-127-auth-token.1"]),
    );
    expect(
      [...cookies.headers()].filter(
        (header) => header.startsWith("sb-") && !header.includes("Expires=Thu, 01 Jan 1970"),
      ),
      "the response still sets a usable session cookie",
    ).toEqual([]);
  });

  it("writes nothing when the caller sent no session cookie", async () => {
    // Mirrors the invariant tests/api/signout.test.ts already pins on the success path: there is
    // nothing to clear, so nothing may be written. Without this, "clear everything" would satisfy
    // the cases above while making the response differ for a caller who sent no cookie at all.
    vi.mocked(createClient).mockReturnValue(failingClient() as unknown as ReturnType<typeof createClient>);

    const { cookies } = await callSignout("");

    expect(cookies.removed, "nothing to clear, so nothing should be written").toEqual([]);
  });
});
