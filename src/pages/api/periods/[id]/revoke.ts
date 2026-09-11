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

  // An EXPLICIT origin check, copied from src/pages/invite/claim.ts (S-06 Phase 3 impl-review).
  //
  // Not redundant with the framework check described above, and the reason is that the framework
  // check is a DEFAULT rather than a control this file owns. Three edits remove it silently and
  // none of them touch this route: `security: { checkOrigin: false }` in astro.config.mjs, a
  // deployment path that skips Astro's internal middlewares, or a future refactor that routes
  // island calls through a shared helper adding Content-Type — that last one is the same edit
  // the island's comment warns about, and it would land here as a 200 rather than a 403.
  //
  // A comment is not a control. This is, and it costs three lines on the product's only
  // irreversible action.
  //
  // Coverage, same as claim.ts: a cross-origin fetch always sends Origin; so does a cross-site
  // form POST; an opaque origin sends the string "null", which fails the equality too. Absent
  // Origin is allowed, because non-browser callers omit it entirely and refusing them would buy
  // nothing that SameSite=Lax does not already provide — note the framework's own branch is
  // stricter here and refuses those, so this check narrows nothing that reaches it.
  //
  // The two sibling routes (`token.ts`, `release.ts`) still rely on the default alone. Adding
  // the same three lines there is a follow-up, deliberately out of this slice's scope.
  const origin = context.request.headers.get("Origin");
  if (origin !== null && origin !== context.url.origin) {
    return jsonResponse({ error: "Nieprawidłowe źródło żądania" }, 403);
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
    // Code and message, NOT the whole error. PostgREST echoes offending values into `details`,
    // and nothing on care_periods is safe to put in a log — so the discipline is the same as
    // the token and release routes even though the specific hazard differs.
    //
    // Be precise about that, because the first draft of this comment borrowed token.ts's
    // reason verbatim and it does not apply here: this function writes only `revoked_at`, so
    // the unique-violation-on-token_digest path that echoes a digest ("Key (token_digest)=(...)
    // already exists") cannot arise. Copying a rationale along with a practice is how a comment
    // starts describing a posture the code does not have (context/foundation/lessons.md).
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
