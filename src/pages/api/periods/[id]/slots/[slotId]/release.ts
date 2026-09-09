import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { periodIdSchema } from "@/lib/schemas/period";

// POST /api/periods/[id]/slots/[slotId]/release — free one claimed term.
//
// The product's first inverse for its only anonymous write, and the owner's answer to a
// forwarded link that took every slot. Mirrors api/periods/[id]/token.ts step for step, so a
// reader of one recognises the other: own auth check, own id validation, a SECURITY INVOKER
// RPC, NULL -> 404, and an error log that names code and message only.
//
// The auth check is NOT redundant. PROTECTED_ROUTES (src/middleware.ts:8) matches on
// startsWith and lists "/periods", not "/api/periods", so nothing upstream gates this path —
// route-level auth is this handler's job.
//
// CSRF, on the other hand, IS handled upstream — but by a mechanism worth naming, because it
// depends on how the caller happens to fetch. Astro's origin middleware refuses a non-safe
// method whose request carries NO Content-Type unless the origin matches, and
// ReleaseSlotButton sends exactly that: `fetch(url, { method: "POST" })`, no header, no body.
// So a cross-site POST here is refused before this handler runs. `src/pages/invite/claim.ts`
// needs its own explicit Origin check precisely because it sends application/json, which lands
// in the middleware's no-check branch; token.ts is in the same position as this route and
// likewise relies on the shape. **Adding a Content-Type header or a request body to the island
// would silently remove this protection** — at that point copy claim.ts's check in.
//
// release_slot is SECURITY INVOKER, so care_slots_update_own decides whether this owner may
// touch the row. Four different misses — not this owner's, no such slot, a slot from another
// of their own periods, and a term that was already free — all come back as NULL and all
// answer 404. Indistinguishable on purpose: the owner has no use for the difference, and a
// distinct answer for "exists but not yours" would confirm the slot exists.
export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Supabase is not configured" }, 500);
  }

  // Both path params, with the same schema. periodIdSchema is z.guid() — reused rather than
  // aliased because a slot id is the same shape from the same generator, and the note on its
  // definition (do not tighten to z.uuid()) applies identically here.
  const parsedPeriodId = periodIdSchema.safeParse(context.params.id);
  const parsedSlotId = periodIdSchema.safeParse(context.params.slotId);
  if (!parsedPeriodId.success || !parsedSlotId.success) {
    return jsonResponse({ error: "Validation failed" }, 400);
  }

  const { data, error } = await supabase.rpc("release_slot", {
    p_period_id: parsedPeriodId.data,
    p_slot_id: parsedSlotId.data,
  });

  if (error) {
    // Code and message, NOT the whole error. PostgREST echoes the offending value into
    // `details`, and on this table that value could be a claim_digest — the one thing
    // 20260907171514_claim_secret_not_digest.sql exists to keep out of reach. Same reasoning
    // as the token route, different column.
    console.error("release_slot failed:", error.code, error.message);
    return jsonResponse({ error: "Nie udało się zwolnić terminu" }, 500);
  }

  if (!data) {
    return jsonResponse({ error: "Nie znaleziono zajętego terminu" }, 404);
  }

  return jsonResponse({ slotId: data }, 200);
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
