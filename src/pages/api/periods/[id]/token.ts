import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { periodIdSchema } from "@/lib/schemas/period";
import { digestInviteToken, generateInviteToken } from "@/lib/invite-token";

// POST /api/periods/[id]/token — mint a new invite link for a period, invalidating the
// previous one. The only recovery path in this slice for a link the owner has lost.
//
// regenerate_period_token is SECURITY INVOKER, so RLS decides whether this owner may
// touch the row; a foreign or missing period id both come back as NULL and both answer
// 404 here. The raw token is returned once and never logged.
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

  const inviteToken = generateInviteToken();
  const { data, error } = await supabase.rpc("regenerate_period_token", {
    p_period_id: parsedId.data,
    p_token_digest: await digestInviteToken(inviteToken),
  });

  if (error) {
    // Code and message, NOT the whole error.
    //
    // Corrected 2026-09-11: the old reason ("PostgREST echoes the offending value into
    // `details`") is false under RLS — measured `details: null` for every violation an
    // `authenticated` caller can cause. The practice stays because a SECURITY DEFINER function
    // owned by `postgres` does get the full row in DETAIL, and this project has four.
    console.error("regenerate_period_token failed:", error.code, error.message);
    return jsonResponse({ error: "Nie udało się wygenerować nowego linku" }, 500);
  }

  // NULL means the update matched nothing — the period does not exist, it is not this
  // owner's, or it is REVOKED (S-06 Phase 1 added `and revoked_at is null` to the
  // function's WHERE, because revocation is irreversible and a token minted for a revoked
  // period would be dead on arrival). Indistinguishable on purpose: all three are one 404
  // and this route does not re-separate them.
  if (!data) {
    return jsonResponse({ error: "Nie znaleziono wyjazdu" }, 404);
  }

  return jsonResponse({ periodId: data, inviteToken }, 200);
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
