// The caretaker capability cookie: one place that knows how it is named, set and read.
//
// This is the repo's FIRST server-set cookie of its own. `ThemeToggle` writes
// `document.cookie` from the client, and `@supabase/ssr` writes the session cookies; nothing
// here had an attribute set of its own to get wrong. So the attributes are the contract, and
// they live here rather than at the two call sites, because a `Path` that drifts between the
// route and the page is a bug with no symptom — the cookie simply stops arriving.
//
// What it holds: the RAW capability secret, exactly once, for the life of the trip. Never the
// digest. Both `claim_slots` and `get_claimed_details` take the raw secret and hash it inside
// (S-03 Phase 2 impl-review F1), so nothing on the server side ever needs to transform this
// value — if you find yourself calling `digestClaimSecret` in a route, something is wrong.

export const CLAIM_COOKIE = "pupilownik_claim";

// The trip is over, but a caretaker may still want to look up what they did — and an owner
// may run late. A week past `end_date` is generous without keeping a bearer credential alive
// indefinitely on a shared phone.
const BUFFER_DAYS = 7;

// A floor, for the case that actually happens: a caretaker claiming a slot on a trip that
// ends today or ended yesterday (a last-minute favour). Without it the Max-Age would be zero
// or negative and the browser would drop the cookie immediately — the caretaker would claim
// successfully and then be shown the pre-claim page, which reads as "it didn't work".
const MIN_AGE_SECONDS = 60 * 60 * 24;

const DAY_SECONDS = 60 * 60 * 24;

export interface ClaimCookieOptions {
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

// `endDate` is the period's own end_date, which `claim_slots` returns in its receipt so the
// route needs no second round trip for it.
//
// One consequence worth stating: ONE cookie serves every trip, because it is keyed by path
// rather than by period. That is deliberate — the same browser presenting the same capability
// against two trips is a supported state (`claim_slots` scopes by period_id, and
// `get_claimed_details` does too), and it is what lets a caretaker help two households without
// re-entering their name. The cost is that Max-Age is rewritten by whichever trip was claimed
// most recently, so claiming an earlier trip after a later one shortens the window. Accepted:
// the shortest window this can produce is still a day past that trip's own end.
export function claimCookieOptions(endDate: string, now: Date = new Date()): ClaimCookieOptions {
  // Parsed as UTC midnight for the same reason period-format.ts does it: read in the viewer's
  // zone, a date west of Greenwich lands on the previous day.
  const expiresAt = new Date(`${endDate}T00:00:00Z`).getTime() + BUFFER_DAYS * DAY_SECONDS * 1000;
  const seconds = Math.floor((expiresAt - now.getTime()) / 1000);

  return {
    // No JS read: the page renders the revealed tier server-side, so the browser never needs
    // this value. That makes an XSS on the invite page unable to lift the capability.
    httpOnly: true,
    // localhost counts as a secure context, so this does not break local development.
    secure: true,
    // The load-bearing CSRF control on this cookie. A cross-site POST to /invite/claim does
    // not carry it, so such a request cannot add slots to an existing capability — it can
    // only mint a fresh one, which requires a name and reveals nothing.
    sameSite: "lax",
    // Scoped so it never rides along on an owner request. /periods and /dashboard must not
    // see a caretaker credential in their headers.
    path: "/invite",
    maxAge: Math.max(seconds, MIN_AGE_SECONDS),
  };
}
