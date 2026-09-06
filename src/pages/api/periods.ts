import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createPeriodSchema } from "@/lib/schemas/period";
import { digestInviteToken, generateInviteToken } from "@/lib/invite-token";

// POST /api/periods — create a care period with its generated slots, and mint the
// invite link. Follows /api/pets: JSON in/out, zod before any DB call, and the atomic
// create_period_with_slots RPC running under the caller's RLS (security invoker), so
// ownership is enforced by the database rather than by this handler.
//
// This is the one moment the raw token exists. It is generated here, only its digest
// reaches the database, and it is returned to the owner exactly once — it can never be
// read back, because it was never stored. It must not be logged, which is why the error
// branch logs the Supabase error alone (S-01 impl-review F2).
export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Supabase is not configured" }, 500);
  }

  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const parsed = createPeriodSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonResponse({ error: "Validation failed", issues: parsed.error.issues }, 400);
  }

  const { title, start_date, end_date } = parsed.data;
  const inviteToken = generateInviteToken();

  const { data, error } = await supabase.rpc("create_period_with_slots", {
    p_title: title,
    p_start_date: start_date,
    p_end_date: end_date,
    p_token_digest: await digestInviteToken(inviteToken),
  });

  if (error) {
    // Log the internal DB/constraint detail server-side; return a generic message so
    // RLS/constraint internals never leak to the client. Never log inviteToken.
    console.error("create_period_with_slots failed:", error);
    return jsonResponse({ error: "Nie udało się utworzyć wyjazdu" }, 500);
  }

  // token_digest is deliberately dropped: the client has the raw token, and the digest
  // is of no use to it beyond widening what a logged response body would expose.
  return jsonResponse(
    {
      period: {
        id: data.id,
        title: data.title,
        start_date: data.start_date,
        end_date: data.end_date,
      },
      inviteToken,
    },
    201,
  );
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
