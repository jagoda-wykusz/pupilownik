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
    // The message is user-facing: the island renders `error` verbatim, so every 400 from
    // this route has to carry a sentence an owner can act on. `issues` stays for debugging.
    return jsonResponse(
      { error: parsed.error.issues[0]?.message ?? "Dane są niepoprawne", issues: parsed.error.issues },
      400,
    );
  }

  const { title, start_date, end_date, pet_ids } = parsed.data;
  const inviteToken = generateInviteToken();

  const { data, error } = await supabase.rpc("create_period_with_slots", {
    p_title: title,
    p_start_date: start_date,
    p_end_date: end_date,
    p_token_digest: await digestInviteToken(inviteToken),
    p_pet_ids: pet_ids,
  });

  if (error) {
    // Log the code and message, NOT the whole error: PostgREST's `details` echoes the
    // offending value on a unique violation ("Key (token_digest)=(<hex>) already
    // exists"), which would put a digest in the logs. The client still gets only a
    // generic message, so RLS/constraint internals never leak either way.
    // Never log inviteToken.
    console.error("create_period_with_slots failed:", error.code, error.message);

    // These four are bad INPUT, not a server fault, and answering 500 tells the owner the
    // app broke when in fact they named a pet that is not theirs. zod cannot catch them —
    // it does not know who owns a pet — so the mapping has to live here.
    //   42501 the join insert failed the RLS with-check → a pet the caller does not own
    //   23503 the pet id does not exist at all
    //   23502 a NULL slipped into the array (belt-and-braces; the RPC filters them)
    //   P0001 the RPC's own "at least one pet" raise
    if (["42501", "23503", "23502", "P0001"].includes(error.code)) {
      return jsonResponse({ error: "Wybrane zwierzę nie należy do Ciebie albo nie istnieje" }, 400);
    }
    return jsonResponse({ error: "Nie udało się utworzyć wyjazdu" }, 500);
  }

  // No null guard on `data` here, unlike token.ts: in the no-error branch supabase-js's
  // discriminated response types it as non-null, and the RPC returns `public.care_periods`
  // (never a set), so a row is guaranteed. token.ts guards because ITS function returns
  // `uuid` and answers NULL for a miss — a real runtime case, not a defensive one.

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
