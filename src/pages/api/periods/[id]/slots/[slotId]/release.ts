import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { periodIdSchema, releaseSlotSchema } from "@/lib/schemas/period";

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
// CSRF used to be handled upstream here, and IS NO LONGER. The old note said so plainly and
// named the trigger: Astro's origin middleware refuses a non-safe method whose request carries
// NO Content-Type, ReleaseSlotButton sent exactly that (`fetch(url, { method: "POST" })`, no
// header, no body), and **adding a Content-Type header or a request body to the island would
// silently remove this protection — at that point copy claim.ts's check in.** That is precisely
// what the optimistic-concurrency argument did: the island now sends `application/json`, which
// lands in the middleware's no-check branch. The check below is that instruction carried out,
// not a belt-and-braces addition.
//
// THE BODY, and why the token could not simply ride in the URL. A query parameter would have
// kept the no-Content-Type shape and the framework check with it — it was the cheaper option
// and it was rejected: `claimed_at` would then sit in the request line, and this route is
// OUTSIDE the /invite prefix that carries `Referrer-Policy: no-referrer` and
// `Cache-Control: no-store` (src/middleware.ts). Every proxy access log on the path would hold
// a per-caretaker claim timestamp against a slot id. Small, but it is exactly the reasoning
// src/pages/invite/claim.ts:18-24 applies to its own token, and the remedy there was the same:
// put it in the body and own the Origin check.
//
// release_slot is SECURITY INVOKER, so care_slots_update_own decides whether this owner may
// touch the row. Four different misses — not this owner's, no such slot, a slot from another
// of their own periods, and a term that was already free — all come back as NULL and all
// answer 404. Indistinguishable on purpose: the owner has no use for the difference, and a
// distinct answer for "exists but not yours" would confirm the slot exists.
//
// The FIFTH outcome is the one this route gained with the optimistic token, and it is
// deliberately NOT folded into those four: the term is still claimed, but under a different
// `claimed_at` than the page rendered — somebody claimed it again after that view was drawn.
// It answers 409, because 404's sentence ("this term is no longer taken") would be a lie about
// a term someone is standing on, and because the owner's remedy differs: refresh and look at
// who holds it now, rather than assume it is free.
export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Copied from src/pages/invite/claim.ts:54-57, for the reason stated above: this route sends
  // a JSON body, so Astro's `security.checkOrigin` contributes nothing.
  //
  // Coverage: a cross-origin fetch always sends Origin; so does a cross-site form submission,
  // which matters because `request.json()` ignores Content-Type and `enctype=text/plain` can
  // forge a JSON body; an opaque origin sends the string "null", which fails the equality too.
  // An ABSENT Origin is allowed, because non-browser callers omit it entirely and refusing them
  // would buy nothing that SameSite=Lax does not already provide.
  const origin = context.request.headers.get("Origin");
  if (origin !== null && origin !== context.url.origin) {
    return jsonResponse({ error: "Nieprawidłowe źródło żądania" }, 403);
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

  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return jsonResponse({ error: "Nie udało się odczytać żądania" }, 400);
  }

  // The optimistic-concurrency token the page rendered. Passed through opaquely: this route
  // never compares it, because the only honest comparison is the one Postgres makes against the
  // stored row — the same division of labour PUT /api/pets/[id] draws for p_expected_updated_at.
  const parsedBody = releaseSlotSchema.safeParse(payload);
  if (!parsedBody.success) {
    return jsonResponse({ error: "Validation failed" }, 400);
  }

  const { data, error } = await supabase.rpc("release_slot", {
    p_period_id: parsedPeriodId.data,
    p_slot_id: parsedSlotId.data,
    p_expected_claimed_at: parsedBody.data.expected_claimed_at,
  });

  if (error) {
    // Code and message, NOT the whole error.
    //
    // Corrected 2026-09-11: the old reason ("PostgREST echoes the offending value into
    // `details`") is false under RLS — measured `details: null` for every violation an
    // `authenticated` caller can cause. The practice stays because a SECURITY DEFINER function
    // owned by `postgres` does get the full row in DETAIL, and this project has four.
    //
    // The exception does NOT apply at THIS call site — `release_slot` is SECURITY INVOKER, so its
    // errors are RLS-suppressed like any other, and the claim_digest this table carries cannot
    // reach `error.details` today. The discipline is uniform across every route because one of
    // them, `claim_slots` in src/pages/invite/claim.ts, IS definer-owned.
    console.error("release_slot failed:", error.code, error.message);

    // PT412 — the page was rendered before somebody claimed this term again, so the release
    // would have wiped a claim the owner has never seen. Answered as 409 rather than 412, for
    // the reason PUT /api/pets/[id] answers its own PT412 the same way: from the owner's side
    // this is a conflict with another writer, and the islands already branch on 400/404/409.
    //
    // The sentence names no one. Who holds it now is a normal RLS-scoped read the refresh will
    // do; putting it in an error body would mean the route composing identity out of an
    // exception, which is the one thing claim_slots' DETAIL convention exists to avoid.
    if (error.code === "PT412") {
      return jsonResponse(
        {
          error:
            "Ten termin zajął w międzyczasie ktoś inny. Odśwież stronę, żeby zobaczyć, kto go trzyma — zwolnienie teraz skasowałoby ten zapis.",
        },
        409,
      );
    }
    // 22007 / 22008 — a datetime Postgres refuses while casting the argument, before the
    // function body runs. releaseSlotSchema rejects such a value first, so this is
    // belt-and-braces, kept for the reason api/pets.ts keeps its own unreachable pair: the zod
    // check and this mapping are one guarantee in two layers, and `care_slots.claimed_at`
    // carries no domain of its own to fall back on. Bad INPUT is not a server fault.
    if (["22007", "22008"].includes(error.code)) {
      return jsonResponse({ error: "Nieprawidłowy znacznik terminu" }, 400);
    }
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
