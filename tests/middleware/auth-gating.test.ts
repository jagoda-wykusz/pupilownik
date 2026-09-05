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
