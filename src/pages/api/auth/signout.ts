import type { APIRoute } from "astro";
import { parseCookieHeader } from "@supabase/ssr";
import { createClient } from "@/lib/supabase";

// POST /api/auth/signout — always ends the LOCAL session, then redirects.
//
// WHY THIS IS MORE THAN `await signOut()`. Measured 2026-09-13 in
// node_modules/@supabase/auth-js/dist/main/GoTrueClient.js (v2.105.3): `_signOut()` returns EARLY
// when `admin.signOut()` errors with anything outside 404/401/403, so `_removeSession()` — the only
// path by which the @supabase/ssr adapter in src/lib/supabase.ts clears the session cookies — never
// runs. Discarding that error, as this route did until now, meant a failed sign-out left the browser
// holding a working session while answering `302 → /` exactly like a successful one. The user is
// told they signed out and is not.
//
// WHAT THIS DOES NOT DO, stated because the opposite is easy to assume. Clearing the cookies ends
// the session in THIS browser. It does not revoke anything: the access token stays cryptographically
// valid until it expires, so anyone who captured it earlier still holds a usable credential. We
// clear what we control and record what we could not do — we do not pretend the token is dead.

/** Remove every Supabase session cookie the caller actually sent.
 *
 *  Names are read from the request, never constructed: the project ref is part of the cookie name
 *  (`sb-127-auth-token` against the local stack, a different ref in production), and @supabase/ssr
 *  may split a large session across chunked names. Reading them back is the only way to catch all
 *  of them without encoding a scheme that is not ours.
 *
 *  A caller who sent no session cookie has nothing removed — the route must not start writing
 *  cookies to someone who sent none, which `tests/api/signout.test.ts` pins on the success path. */
function clearSessionCookies(context: Parameters<APIRoute>[0]): void {
  for (const { name } of parseCookieHeader(context.request.headers.get("Cookie") ?? "")) {
    if (name.startsWith("sb-")) {
      // `path: "/"` mirrors what @supabase/ssr writes; a delete whose path does not match the one
      // the cookie was set with is silently ignored by the browser.
      context.cookies.delete(name, { path: "/" });
    }
  }
}

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (!supabase) {
    // Missing runtime configuration. This branch used to skip the sign-out entirely and still
    // redirect, so a caller could not tell a completed sign-out from one that never happened
    // (recorded in test-plan.md §7 as measured and left). It now does the half it can.
    console.error("signout: supabase client unavailable (configuration)");
    clearSessionCookies(context);
    return context.redirect("/");
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    // `code` and `message` only — never the whole error, and nothing session-derived. Same
    // discipline as every other route here (see src/pages/api/periods.ts and src/pages/invite/claim.ts).
    console.error("signout failed:", error.code, error.message);
    clearSessionCookies(context);
  }

  // One exit, whatever happened. The redirect must not become an oracle for whether a session
  // existed or whether the auth server answered — `tests/api/signout.test.ts` pins that property.
  return context.redirect("/");
};
