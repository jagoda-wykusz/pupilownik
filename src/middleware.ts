import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

// Exported so the auth-gating suite drives every protected prefix from this one
// list — a new route gets regression coverage without editing the test.
// "/invite" is deliberately absent: the caretaker landing page must stay reachable
// with no session at all, which is the whole point of the token model (S-02).
export const PROTECTED_ROUTES = ["/dashboard", "/pets", "/periods"];

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

  return next();
});
