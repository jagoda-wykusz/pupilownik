import { describe, expect, it } from "vitest";
import { PROTECTED_ROUTES } from "@/middleware";
import { runMiddleware } from "../helpers/middleware";
import { createAuthenticatedCookieHeader, corruptCookieHeader } from "../helpers/session";

// Risk #2 — protected-route gating in src/middleware.ts.
//
// Drives the REAL onRequest against the local Supabase stack (getUser() is never
// mocked — that is the named anti-pattern). Proves the gate:
//   - closes on every protected prefix for an unauthenticated request (no owner
//     data leaks: next() never runs),
//   - opens for a genuine captured session,
//   - stays closed for a present-but-invalid session (a token ≠ authorization).
describe("auth gating (middleware)", () => {
  // Driven from the real PROTECTED_ROUTES so a newly gated prefix is covered the
  // moment it is added, instead of silently relying on manual checks.
  it.each(PROTECTED_ROUTES)(
    "no session cookie on %s → redirects to signin and never reaches the route",
    async (route) => {
      const { response, nextCalled, locals } = await runMiddleware({ pathname: route });

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/auth/signin");
      // next() never ran → the route handler never executed → no owner data served.
      expect(nextCalled).toBe(false);
      expect(locals.user).toBeFalsy();
    },
  );

  it("valid session cookie → passes through with the right user resolved", async () => {
    const { cookieHeader, userId } = await createAuthenticatedCookieHeader();

    const { response, nextCalled, locals } = await runMiddleware({
      pathname: "/dashboard",
      cookieHeader,
    });

    expect(nextCalled).toBe(true);
    expect(response.status).toBe(200);
    expect((locals.user as { id?: string } | null)?.id).toBe(userId);
  });

  // The caretaker path is PUBLIC by requirement, not by accident (S-02, FR-005). A future
  // edit adding "/invite" — or a broader prefix that swallows it — to PROTECTED_ROUTES would
  // break the product silently: the owner's link would bounce every caretaker to a sign-in
  // page they have no account for. Nothing else catches that.
  it("/invite/<token> is NOT gated — no session reaches the route untouched", async () => {
    const { response, nextCalled } = await runMiddleware({ pathname: "/invite/whatever" });

    expect(nextCalled).toBe(true);
    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
  });

  // The token travels in the path, so the response must not become a second way to leak it.
  it("/invite/<token> responses carry no-referrer and no-store", async () => {
    const { response } = await runMiddleware({ pathname: "/invite/whatever" });

    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("those headers are scoped and not sprayed across the app", async () => {
    const { response } = await runMiddleware({ pathname: "/auth/signin" });

    // A signed-out page: no session to protect, so neither header applies. Referrer-Policy in
    // particular stays exclusive to /invite, whose PATH carries a bearer token.
    expect(response.headers.get("Referrer-Policy")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBeNull();
  });

  // Added by S-09's impl-review (F5). /pets/<id> renders every care instruction the owner has,
  // including the is_sensitive ones this product treats as an address and a gate code, and
  // serialises them into an island's props — with no Cache-Control at all until this landed.
  // Driven from the real PROTECTED_ROUTES so a newly gated prefix inherits the header instead
  // of needing someone to remember it.
  it.each(PROTECTED_ROUTES)("%s carries no-store for a signed-in reader", async (route) => {
    const { cookieHeader } = await createAuthenticatedCookieHeader();

    const { response, nextCalled } = await runMiddleware({ pathname: route, cookieHeader });

    // nextCalled guards the guard: without a session the middleware redirects BEFORE next(),
    // and a 302 would carry the header too while proving nothing about the rendered page.
    expect(nextCalled).toBe(true);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBeNull();
  });

  // "/" is not a page — it resolves to the trip list. An unauthenticated visitor takes the
  // second hop to the sign-in panel, which is what the PROTECTED_ROUTES case above pins.
  it("/ redirects to the trip list without rendering a landing page", async () => {
    const { response, nextCalled } = await runMiddleware({ pathname: "/" });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/periods");
    expect(nextCalled).toBe(false);
  });

  it("present-but-invalid session cookie → still redirects to signin", async () => {
    const { cookieHeader } = await createAuthenticatedCookieHeader();

    const { response, nextCalled, locals } = await runMiddleware({
      pathname: "/dashboard",
      cookieHeader: corruptCookieHeader(cookieHeader),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/auth/signin");
    expect(nextCalled).toBe(false);
    expect(locals.user).toBeFalsy();
  });
});
