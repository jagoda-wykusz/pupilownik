import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { claimSchema } from "@/lib/schemas/claim";
import { generateClaimSecret } from "@/lib/invite-token";
import { CAPABILITY_SHAPE, CLAIM_COOKIE, claimCookieOptions } from "@/lib/claim-cookie";
import { formatDay, TIME_OF_DAY_LABEL, type TimeOfDay } from "@/lib/period-format";

// POST /invite/claim — a caretaker takes one or more slots.
//
// Follows src/pages/api/periods.ts (JSON in/out, zod before any DB call, the RPC is the
// authorization boundary) with TWO deliberate inversions. Both look like bugs at a glance and
// are commented where they occur, not only here:
//
//   1. There is NO `context.locals.user` guard. The caretaker has no account and never will —
//      that is the product decision, not an oversight (PRD §Non-Goals).
//   2. There IS an explicit Origin check. Astro's `security.checkOrigin` defaults to true but
//      skips `application/json`, so the framework contributes nothing to a JSON route.
//
// WHY THE PATH IS /invite/claim AND NOT /api/invite/<token>/claim: the token must not appear
// in this route's own URL. Inside the /invite prefix the response inherits the middleware's
// `Referrer-Policy: no-referrer` and `Cache-Control: no-store`; outside it, the token would
// sit in the request line, in the access log of anything proxying it, and in `Referer` on the
// next outbound link. The token travels in the BODY.
//
// Never log the raw token or the raw capability secret. The error branches below log
// `error.code` and `error.message` only, for the reason S-01 impl-review F2 recorded:
// PostgREST's `details` echoes offending values.

export const POST: APIRoute = async (context) => {
  // Inversion 2. Astro will not do this for us on a JSON body, and without it any page on the
  // internet could POST here on a visitor's behalf.
  //
  // Do NOT read this check as redundant next to SameSite=Lax. Lax does stop a cross-site POST
  // carrying the cookie, so an attacker cannot ADD slots to a victim's existing capability —
  // but it does nothing about a request that mints a fresh one. The residual harm without this
  // check is therefore not "reveals nothing", it is grief-claiming: up to 93 slots, the whole
  // trip, taken under a name the attacker chooses, in a single request — and nothing in the
  // product can undo a claim (see docs/reference/data-access.md rule 4). Corrected after the
  // Phase 4 review understated it (F9).
  //
  // Coverage: a cross-origin fetch always sends Origin; so does a cross-site form POST, which
  // matters because `request.json()` ignores Content-Type and `enctype=text/plain` can forge a
  // JSON body; an opaque origin sends the string "null", which fails the equality too.
  //
  // Absent Origin is allowed: non-browser callers omit it entirely, and refusing them would
  // buy nothing that SameSite=Lax does not already provide.
  const origin = context.request.headers.get("Origin");
  if (origin !== null && origin !== context.url.origin) {
    return jsonResponse({ error: "Nieprawidłowe źródło żądania" }, 403);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Nie udało się połączyć z serwerem" }, 500);
  }

  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return jsonResponse({ error: "Nie udało się odczytać danych" }, 400);
  }

  const parsed = claimSchema.safeParse(payload);
  if (!parsed.success) {
    // Same convention as /api/periods: the island renders `error` verbatim, so prefer an issue
    // with a field path and fall back to the root-level one.
    const issue = parsed.error.issues.find((i) => i.path.length > 0) ?? parsed.error.issues[0];
    return jsonResponse({ error: issue.message }, 400);
  }

  const { token, slot_ids, name } = parsed.data;

  // The capability. An existing cookie means this browser already holds one — reuse it, and
  // `claim_slots` will attach the new slots to the same caretaker and reuse their stored name.
  // Only a first claim mints.
  //
  // The RAW secret goes to the database. It is hashed inside the function, exactly as the
  // invite token is, so nothing here derives a digest (S-03 Phase 2 impl-review F1). A
  // `digestClaimSecret` call in this file would be a mistake.
  //
  // The cookie is VALIDATED before it is trusted, not merely tested for presence. `??` alone
  // catches null and undefined but passes an empty, truncated or tampered value straight to
  // `claim_slots`, which raises PT400 on its 43-character bound — and since nothing here
  // clears the cookie, that caretaker would get a 400 on every future attempt, forever.
  // Refreshing would not help. The asymmetry made it worse: `get_claimed_details` answers NULL
  // for a wrong-length secret, so the PAGE degrades silently to the pre-claim view while the
  // ROUTE dead-ends — the symptom gives no hint of the cause. Minting a fresh one instead
  // costs a name prompt and recovers on the next request (impl-review, Phase 4).
  const existing = context.cookies.get(CLAIM_COOKIE)?.value;
  const secret = existing !== undefined && CAPABILITY_SHAPE.test(existing) ? existing : generateClaimSecret();

  const { data, error } = await supabase.rpc("claim_slots", {
    p_token: token,
    p_slot_ids: slot_ids,
    p_claim_secret: secret,
    // Omitted rather than sent as null: the parameter is `default null`, and on a follow-up
    // claim the stored name wins regardless of what is sent.
    ...(name === undefined ? {} : { p_name: name }),
  });

  if (error) {
    console.error("claim_slots failed:", error.code, error.message);

    // PostgREST maps SQLSTATE PTxxx onto the HTTP status, so the function's own refusal codes
    // arrive here as a code rather than as message text to pattern-match.
    if (error.code === "PT409") {
      return jsonResponse({ error: conflictMessage(error.details) }, 409);
    }
    if (error.code === "PT400") {
      // zod caught every shape this route can produce, so reaching here means the database
      // rejected something the schema allowed — a genuine mismatch between the two layers.
      return jsonResponse({ error: "Nie udało się zająć terminów. Odśwież stronę i spróbuj ponownie." }, 400);
    }
    // A deadlock: two caretakers claiming overlapping selections at the same instant, whose
    // row locks happened to be taken in different orders (S-03 Phase 2 impl-review F10a). The
    // transaction rolled back, so NOTHING was claimed — which makes "try again" the honest
    // answer rather than an error page. Deliberately not "fixed" by locking rows before the
    // update: that would reintroduce the read-then-write claim_slots is shaped to avoid.
    if (error.code === "40P01") {
      return jsonResponse({ error: "Ktoś zapisywał się w tej samej chwili. Spróbuj jeszcze raz." }, 409);
    }
    return jsonResponse({ error: "Nie udało się zająć terminów" }, 500);
  }

  // NULL is the uniform failure: unknown, malformed and revoked tokens are indistinguishable,
  // and this route must not be the place that tells them apart. Same 404 the page renders.
  if (data === null) {
    return jsonResponse({ error: "Ten link nie działa" }, 404);
  }

  const receipt = data as unknown as ClaimReceipt;

  // Set on every successful claim, including a retry that wrote nothing: re-issuing the same
  // value is harmless and it refreshes Max-Age against the trip that was just claimed.
  context.cookies.set(CLAIM_COOKIE, secret, claimCookieOptions(receipt.end_date));

  // The raw secret is NOT in the body. It leaves the server exactly once, into the cookie
  // above — the same discipline the invite token gets, for the same reason.
  return jsonResponse(
    {
      name: receipt.name,
      claimed: receipt.claimed_count,
      // A retry after a lost response returns 0 claimed and N already held. Without this the
      // island could not tell "you already had them" from "nothing happened" (S-03 Phase 2
      // impl-review F4).
      alreadyHeld: receipt.already_held_count,
    },
    200,
  );
};

interface ClaimReceipt {
  period_id: string;
  end_date: string;
  name: string;
  claimed_count: number;
  already_held_count: number;
  slot_ids: string[];
}

interface ConflictSlot {
  slot_date: string;
  time_of_day: TimeOfDay;
}

// The refusal names the term the caretaker lost, because "someone took a slot" sends them back
// to a grid of nine to work out which one.
//
// DETAIL is a jsonb array of {slot_date, time_of_day} — the Polish sentence is composed here
// rather than in SQL so it can use the app's own formatters. It is legitimately EMPTY when the
// requested slot belongs to another period: naming it would confirm it exists (S-03 Phase 2
// impl-review F6). That case gets the generic sentence, and it is the one shape of 409 that
// carries no term to name.
function conflictMessage(details: string | undefined): string {
  const generic = "Ten termin został właśnie zajęty. Odśwież stronę i wybierz inny.";
  if (!details) {
    return generic;
  }

  let slots: ConflictSlot[];
  try {
    slots = JSON.parse(details) as ConflictSlot[];
  } catch {
    return generic;
  }
  if (!Array.isArray(slots) || slots.length === 0) {
    return generic;
  }

  const named = slots.map((slot) => `${TIME_OF_DAY_LABEL[slot.time_of_day]} ${formatDay(slot.slot_date)}`).join(", ");
  return `Zajęte już: ${named}. Nic nie zostało zapisane — odśwież stronę i wybierz inne terminy.`;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
