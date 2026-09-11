import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as signIn } from "@/pages/api/auth/signin";
import { POST as signUp } from "@/pages/api/auth/signup";
import { SIGNIN_FAILED, SIGNUP_FAILED } from "@/lib/auth-messages";
import { createOwnerClient, type OwnerContext } from "../helpers/auth";

// Risk #6, the half that was actually live: these two routes used to forward GoTrue's own
// wording into `?error=`, where it lands in the URL, in browser history, and in `Referer` —
// `/auth` gets no `Referrer-Policy: no-referrer`, that header is scoped to `/invite`.
//
// The property is SAMENESS, so every assertion compares WHOLE redirect targets rather than
// checking a substring. Three genuinely different upstream failures per route: they must be
// indistinguishable to the caller and distinguishable only in the server log.
//
// BE PRECISE ABOUT THE ORACLE, because the research summary overstated it and the local config
// makes that visible. GoTrue already answers "Invalid login credentials" for BOTH a wrong
// password and an unknown address, so sign-in was never the enumeration oracle by itself. The
// live one is sign-up's "User already registered". A second would be "Email not confirmed" —
// not reproducible here, because `supabase/config.toml` sets `enable_confirmations = false`,
// and unknown in the hosted project. The fix covers all of them regardless of which are
// currently reachable, which is the point of swallowing rather than enumerating.

interface Redirect {
  status: number;
  location: string | null;
}

function createFakeCookies() {
  const store = new Map<string, string>();
  return {
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

async function call(handler: typeof signIn, path: string, email: string, password: string): Promise<Redirect> {
  const url = new URL(`http://127.0.0.1${path}`);
  const form = new FormData();
  form.set("email", email);
  form.set("password", password);

  const context = {
    request: new Request(url, { method: "POST", body: form }),
    url,
    cookies: createFakeCookies(),
    params: {},
    locals: { user: null },
    // Astro supplies this; the shim mirrors what it does so the assertion reads the real target.
    redirect: (target: string) => new Response(null, { status: 302, headers: { Location: target } }),
  };

  type Args = Parameters<typeof handler>;
  const response = await handler(context as unknown as Args[0]);
  return { status: response.status, location: response.headers.get("Location") };
}

/** Wording GoTrue emits that must never reach a caller. Asserted as absence from the redirect. */
const UPSTREAM_WORDING = ["Invalid login credentials", "User already registered", "Email not confirmed", "Password"];

describe("the auth routes disclose nothing about why they failed", () => {
  let owner: OwnerContext;

  beforeAll(async () => {
    // A real, registered account, so "wrong password for an existing user" is a genuine cause
    // rather than a second unknown address.
    owner = await createOwnerClient();
  });

  describe("sign-in", () => {
    it("answers three different upstream failures with one identical redirect", async () => {
      const wrongPassword = await call(signIn, "/api/auth/signin", owner.email, "definitely-not-it");
      const unknownAddress = await call(
        signIn,
        "/api/auth/signin",
        `ghost-${crypto.randomUUID()}@pupilownik.test`,
        "password123",
      );
      const malformedEmail = await call(signIn, "/api/auth/signin", "not-an-email", "password123");

      // Whole-target comparison: a substring check would pass if a future edit appended the
      // upstream reason to the same sentence.
      expect(wrongPassword.location).toBe(`/auth/signin?error=${encodeURIComponent(SIGNIN_FAILED)}`);
      expect(unknownAddress).toEqual(wrongPassword);
      expect(malformedEmail).toEqual(wrongPassword);
    });

    it("carries none of GoTrue's wording in the redirect", async () => {
      const { location } = await call(signIn, "/api/auth/signin", owner.email, "definitely-not-it");
      const decoded = decodeURIComponent(location ?? "");

      for (const wording of UPSTREAM_WORDING) {
        expect(decoded).not.toContain(wording);
      }
    });

    it("still signs a real account in", async () => {
      // The positive control. Without it every assertion above would keep passing against a
      // route that refused everyone.
      const { status, location } = await call(signIn, "/api/auth/signin", owner.email, owner.password);

      expect(status).toBe(302);
      expect(location).toBe("/");
    });
  });

  describe("sign-up", () => {
    it("answers three different upstream failures with one identical redirect", async () => {
      // The first of these is the genuine enumeration oracle this change closes: GoTrue says
      // "User already registered" for an address that has an account.
      const alreadyRegistered = await call(signUp, "/api/auth/signup", owner.email, "password123");
      const shortPassword = await call(signUp, "/api/auth/signup", `fresh-${crypto.randomUUID()}@pupilownik.test`, "x");
      const malformedEmail = await call(signUp, "/api/auth/signup", "not-an-email", "password123");

      expect(alreadyRegistered.location).toBe(`/auth/signup?error=${encodeURIComponent(SIGNUP_FAILED)}`);
      expect(shortPassword).toEqual(alreadyRegistered);
      expect(malformedEmail).toEqual(alreadyRegistered);
    });

    it("carries none of GoTrue's wording in the redirect", async () => {
      const { location } = await call(signUp, "/api/auth/signup", owner.email, "password123");
      const decoded = decodeURIComponent(location ?? "");

      for (const wording of UPSTREAM_WORDING) {
        expect(decoded).not.toContain(wording);
      }
    });
  });

  // A SOURCE check, and it is here rather than in a runtime assertion because the branch it
  // guards is unreachable while the stack is configured: `createClient` returns null only when
  // the env vars are absent, which cannot be arranged from inside a test that needs the stack.
  // The property is nonetheless worth pinning — it was a live disclosure on a PRE-AUTH endpoint,
  // and it is the one place an anonymous caller learned a fact about the server.
  describe("the pre-auth surface says nothing about server configuration", () => {
    const PRE_AUTH = ["src/pages/api/auth/signin.ts", "src/pages/api/auth/signup.ts", "src/pages/invite/claim.ts"];

    it.each(PRE_AUTH)("%s never sends a configuration fact to the caller", (file) => {
      const source = readFileSync(path.resolve(import.meta.dirname, "../..", file), "utf8");
      const template = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

      // The exact string these routes used to redirect with. Logging it server-side is fine —
      // what must not happen is putting it in a response or a redirect target.
      expect(template).not.toMatch(/redirect\([^)]*not configured/i);
      expect(template).not.toMatch(/jsonResponse\(\s*\{\s*error:\s*["'][^"']*not configured/i);
    });
  });
});
