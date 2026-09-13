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
 *  itself would more naturally call `delete`. Both are removals, and this file asserts the OUTCOME
 *  — the caller's cookie is gone — rather than pinning which mechanism produced it. */
function createFakeCookies(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  const removed: string[] = [];
  return {
    store,
    removed,
    get(name: string) {
      const value = store.get(name);
      return value === undefined ? undefined : { value };
    },
    set(name: string, value: string) {
      store.set(name, value);
      if (value === "") {
        removed.push(name);
      }
    },
    delete(name: string) {
      store.delete(name);
      removed.push(name);
    },
    has(name: string) {
      return store.has(name);
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
    const client = createServerClient(anonKey ? "http://127.0.0.1:1" : "", anonKey, {
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

  it("writes nothing when the caller sent no session cookie", async () => {
    // Mirrors the invariant tests/api/signout.test.ts already pins on the success path: there is
    // nothing to clear, so nothing may be written. Without this, "clear everything" would satisfy
    // the cases above while making the response differ for a caller who sent no cookie at all.
    vi.mocked(createClient).mockReturnValue(failingClient() as unknown as ReturnType<typeof createClient>);

    const { cookies } = await callSignout("");

    expect(cookies.removed, "nothing to clear, so nothing should be written").toEqual([]);
  });
});
