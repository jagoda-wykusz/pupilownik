import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIGNIN_FAILED, SIGNUP_FAILED } from "@/lib/auth-messages";

// What the two pre-auth routes do with a body that is not a form.
//
// WHY THIS EXISTS. Until 6206428 both routes read `await context.request.formData()` unwrapped,
// and `formData()` REJECTS — it does not return empty — for any body that is not multipart or
// urlencoded. Measured 2026-09-12: a JSON body, an empty body and a text/plain body each produced
// a 500, on endpoints reachable by anyone before authentication. Astro's checkOrigin did not stand
// in the way, because it skips `application/json`: a form post with no Origin was refused 403
// before the handler, while the JSON post that crashed it went through.
//
// WHY THE `unit` PROJECT. The throw happened at the first line of the handler, before
// `createClient` was called, so reproducing it needs neither Supabase nor Docker. The precedent is
// tests/unit/claim-error-mapping.test.ts, which tests a route here for the same reason.
//
// WHY THE CLIENT IS MOCKED, and this is the load-bearing part. Without a mock this file would be
// vacuous: with no env, `createClient` returns null and the handler answers the SAME generic
// redirect it answers for a bad body (src/pages/api/auth/signin.ts:16-22). Every assertion would
// pass whether or not the body was ever read. Mocking lets this file assert the property that
// actually distinguishes the two — **the auth call is never reached** — and lets the missing-field
// case pin what the `as string` casts really pass through, without asking GoTrue anything.
//
// What this file does NOT cover: GoTrue's own answers. Those are pinned against the real stack in
// tests/api/auth-error-disclosure.test.ts, which asserts that three genuinely different upstream
// failures are indistinguishable to the caller.

const signInWithPassword = vi.fn();
const signUp = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { signInWithPassword, signUp } }),
}));

const { POST: signin } = await import("@/pages/api/auth/signin");
const { POST: signup } = await import("@/pages/api/auth/signup");

/** Everything a caller can observe, mirroring tests/api/auth-error-disclosure.test.ts. Comparing
 *  whole objects rather than a substring is the point: the property is SAMENESS, and a substring
 *  check would pass if a future edit appended the reason to the redirect. */
interface Observed {
  status: number;
  location: string | null;
  headers: string[];
  cookies: string[];
  body: string;
}

function createFakeCookies() {
  const store = new Map<string, string>();
  return {
    store,
    get: (name: string) => {
      const value = store.get(name);
      return value === undefined ? undefined : { value };
    },
    set: (name: string, value: string) => void store.set(name, value),
    delete: (name: string) => void store.delete(name),
    has: (name: string) => store.has(name),
  };
}

async function call(handler: typeof signin, request: Request): Promise<Observed> {
  const url = new URL(request.url);
  const cookies = createFakeCookies();
  const context = {
    request,
    url,
    cookies,
    params: {},
    locals: { user: null },
    redirect: (target: string) => new Response(null, { status: 302, headers: { Location: target } }),
  };

  type Args = Parameters<typeof handler>;
  const response = await handler(context as unknown as Args[0]);
  return {
    status: response.status,
    location: response.headers.get("Location"),
    headers: [...response.headers.keys()].sort(),
    cookies: [...cookies.store.keys()].sort(),
    body: await response.text(),
  };
}

const SIGNIN_URL = "http://127.0.0.1/api/auth/signin";
const SIGNUP_URL = "http://127.0.0.1/api/auth/signup";

function formBody(url: string, fields: Record<string, string>): Request {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.set(name, value);
  }
  return new Request(url, { method: "POST", body: form });
}

/** The three shapes that used to throw. Named rather than inlined so each failure message says
 *  which content type broke, not just that something did. */
const NOT_A_FORM = [
  [
    "a JSON body",
    (url: string) =>
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "a@b.test", password: "x" }),
      }),
  ],
  ["an empty body", (url: string) => new Request(url, { method: "POST" })],
  [
    "a text/plain body",
    (url: string) =>
      new Request(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "email=a@b.test" }),
  ],
] as const;

beforeEach(() => {
  signInWithPassword.mockReset();
  signUp.mockReset();
  signInWithPassword.mockResolvedValue({
    error: { code: "invalid_credentials", message: "Invalid login credentials" },
  });
  signUp.mockResolvedValue({ error: { code: "user_already_exists", message: "User already registered" } });
});

describe("sign-in answers a non-form body the same way it answers a wrong password", () => {
  it.each(NOT_A_FORM)("%s never reaches the auth call", async (_label, build) => {
    const observed = await call(signin, build(SIGNIN_URL));

    // The property that distinguishes "the body was refused" from "the client was unavailable":
    // with a bad body the handler returns before it ever asks the auth server anything.
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(observed.status).toBe(302);
    expect(observed.location).toBe(`/auth/signin?error=${encodeURIComponent(SIGNIN_FAILED)}`);
  });

  it.each(NOT_A_FORM)("%s is indistinguishable from a credential failure", async (_label, build) => {
    const badBody = await call(signin, build(SIGNIN_URL));
    const wrongPassword = await call(
      signin,
      formBody(SIGNIN_URL, { email: "real@pupilownik.test", password: "wrong" }),
    );

    // Whole-object comparison: status, Location, header names, cookie names and body together.
    // A caller must not be able to tell that their request was malformed rather than wrong.
    expect(badBody).toEqual(wrongPassword);
  });
});

describe("sign-up answers a non-form body the same way it answers a registered address", () => {
  it.each(NOT_A_FORM)("%s never reaches the auth call", async (_label, build) => {
    const observed = await call(signup, build(SIGNUP_URL));

    expect(signUp).not.toHaveBeenCalled();
    expect(observed.status).toBe(302);
    expect(observed.location).toBe(`/auth/signup?error=${encodeURIComponent(SIGNUP_FAILED)}`);
  });

  it.each(NOT_A_FORM)("%s is indistinguishable from a rejected sign-up", async (_label, build) => {
    const badBody = await call(signup, build(SIGNUP_URL));
    const rejected = await call(
      signup,
      formBody(SIGNUP_URL, { email: "taken@pupilownik.test", password: "password123" }),
    );

    expect(badBody).toEqual(rejected);
  });
});

describe("a form body missing a field is passed through, not rejected early", () => {
  // This pins what the `as string` casts actually do, which is why they were left in place when
  // 6206428 wrapped the body read. `FormData.get` returns null for an absent field, the cast is
  // erased at runtime, and null reaches the auth server — which answers with an error, which lands
  // on the same redirect. Measured against the real stack in tests/api/auth-error-disclosure.test.ts;
  // asserted here at the seam, where it is deterministic.
  //
  // If someone later adds a zod gate to these routes, these two tests fail — correctly. They are
  // not defending the casts, they are recording that the current behaviour is pass-through, so a
  // change to it is a decision rather than an accident.

  it("sends a missing email onward as null", async () => {
    await call(signin, formBody(SIGNIN_URL, { password: "x" }));

    expect(signInWithPassword).toHaveBeenCalledTimes(1);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: null, password: "x" });
  });

  it("sends a missing password onward as null", async () => {
    await call(signup, formBody(SIGNUP_URL, { email: "a@b.test" }));

    expect(signUp).toHaveBeenCalledTimes(1);
    expect(signUp).toHaveBeenCalledWith({ email: "a@b.test", password: null });
  });

  it("answers a missing field with the same redirect as any other failure", async () => {
    const missingEmail = await call(signin, formBody(SIGNIN_URL, { password: "x" }));
    const wrongPassword = await call(
      signin,
      formBody(SIGNIN_URL, { email: "real@pupilownik.test", password: "wrong" }),
    );

    expect(missingEmail).toEqual(wrongPassword);
  });
});
