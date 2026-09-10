import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { periodIdSchema } from "@/lib/schemas/period";

// POST /api/periods/[id]/revoke — end a trip's invite link, permanently.
//
// The owner's answer to a cancelled trip or a leaked link, and the last piece of FR-012.
// Mirrors api/periods/[id]/slots/[slotId]/release.ts step for step, so a reader of one
// recognises the other: own auth check, own id validation, a SECURITY INVOKER RPC, NULL -> 404,
// and an error log that names code and message only.
//
// The auth check is NOT redundant. PROTECTED_ROUTES (src/middleware.ts:8) matches on
// startsWith and lists "/periods", not "/api/periods", so nothing upstream gates this path —
// route-level auth is this handler's job.
//
// CSRF is handled upstream, but by a mechanism worth naming because it depends on how the
// caller happens to fetch. Astro's origin middleware refuses a non-safe method whose request
// carries NO Content-Type unless the origin matches, and RevokePeriodButton sends exactly that:
// `fetch(url, { method: "POST" })`, no header, no body. So a cross-site POST here is refused
// before this handler runs. `src/pages/invite/claim.ts` needs its own explicit Origin check
// precisely because it sends application/json, which lands in the middleware's no-check branch.
// **Adding a Content-Type header or a request body to the island would silently remove this
// protection** — at that point copy claim.ts's check in.
// tests/component/revoke-period-button.test.tsx pins the request shape, because no test on this
// side of the wire can see it.
//
// revoke_period is SECURITY INVOKER, so care_periods_update_own decides whether this owner may
// touch the row. Three different misses — not this owner's, no such period, and already
// revoked — all come back as NULL and all answer 404. Indistinguishable on purpose: the owner
// has no use for the difference, and a distinct answer for "exists but not yours" would confirm
// the period exists.
//
// There is no inverse. Revocation is irreversible by product decision, enforced in SQL by
// revoke_period's `revoked_at is null` predicate and by regenerate_period_token refusing a
// revoked period (20260910120000). So this route has no DELETE counterpart and will not grow
// one.
export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Supabase is not configured" }, 500);
  }

  const parsedId = periodIdSchema.safeParse(context.params.id);
  if (!parsedId.success) {
    return jsonResponse({ error: "Validation failed" }, 400);
  }

  const { data, error } = await supabase.rpc("revoke_period", {
    p_period_id: parsedId.data,
  });

  if (error) {
    // Code and message, NOT the whole error. PostgREST echoes the offending value into
    // `details`, and on this table that value could be a token_digest — the one thing the
    // digest-only storage model exists to keep out of reach. Same reasoning as the token and
    // release routes, different column.
    console.error("revoke_period failed:", error.code, error.message);
    return jsonResponse({ error: "Nie udało się odwołać wyjazdu" }, 500);
  }

  if (!data) {
    return jsonResponse({ error: "Nie znaleziono aktywnego wyjazdu" }, 404);
  }

  return jsonResponse({ periodId: data }, 200);
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
