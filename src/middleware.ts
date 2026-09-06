import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

// Exported so the auth-gating suite drives every protected prefix from this one
// list — a new route gets regression coverage without editing the test.
// "/invite" is deliberately absent: the caretaker landing page must stay reachable
// with no session at all, which is the whole point of the token model (S-02).
export const PROTECTED_ROUTES = ["/dashboard", "/pets", "/periods"];

// The caretaker's invite link carries its secret in the path, which makes the RESPONSE a
// second place the token can escape from. Two headers close that:
//
// - `Referrer-Policy: no-referrer` — without it, the first outbound link, third-party font
//   or messenger link-preview crawler on the invite page sends the full path, token
//   included, in the Referer header.
// - `Cache-Control: no-store` — keeps the rendered period out of shared caches and out of
//   the back-button cache on a borrowed device.
//
// Applied by prefix so every future route under /invite inherits it. A path segment was
// chosen over a URL fragment because the server has to resolve the token; the trade-off is
// recorded in docs/reference/data-access.md.
// Matched on a segment boundary, not a bare startsWith: "/invite" alone would also claim a
// future "/invitations", which would then silently inherit no-store.
const INVITE_PREFIX = "/invite";

function isInviteRoute(pathname: string): boolean {
  return pathname === INVITE_PREFIX || pathname.startsWith(`${INVITE_PREFIX}/`);
}

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  const response = await next();

  if (isInviteRoute(context.url.pathname)) {
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "no-store");
  }

  return response;
});
