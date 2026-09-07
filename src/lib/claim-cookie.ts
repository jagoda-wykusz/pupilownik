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

// NOT a `__Host-` prefixed name, and that is a decision rather than an omission.
//
// The route trusts any well-formed 43-character value under this name, so anyone who can write
// a cookie for this host could plant a secret they know and read the sensitive tier the
// victim's claim unlocks. Cookies ignore ports, so a sibling app on another port in development
// counts; so would an XSS anywhere on the origin, or a future subdomain. None of those exist
// today — there are no subdomains, the cookie is HttpOnly and Secure, and no invite page uses
// `set:html`.
//
// `__Host-` is the standard mitigation and it would forbid `Domain` — but it also PINS
// `Path=/`, which is exactly the property being traded away below: `/invite` is what keeps a
// caretaker credential off every owner request. Between "cannot be planted from a sibling
// origin that does not exist" and "never rides along on /periods", the second is worth more
// here. Recorded as a knowingly-taken trade-off (Phase 4 impl-review F10); revisit it the day
// this app gains a subdomain.

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
// against two trips is a supported state, and `tests/rls/reveal-instructions.test.ts` pins that
// each trip then answers only its own slots.
//
// What carries across trips is the CAPABILITY, not the identity. The NAME is per-trip:
// `claim_slots` looks up the stored name with `where s.period_id = v_period.id and
// s.claim_digest = v_claim_digest`, so on a second trip it finds nothing and asks again. That
// is the correct behaviour — one identity per trip, since a caretaker may be "Ania" to one
// household and "Ania z drugiego piętra" to another — and this comment previously claimed the
// opposite (Phase 4 impl-review F5).
//
// The cost of the shared cookie is that Max-Age is rewritten by whichever trip was claimed most
// recently, so claiming an earlier trip after a later one shortens the window. Accepted: the
// shortest window this can produce is still a day past that trip's own end.
export function claimCookieOptions(endDate: string, now: Date = new Date()): ClaimCookieOptions {
  // Parsed as UTC midnight for the same reason period-format.ts does it: read in the viewer's
  // zone, a date west of Greenwich lands on the previous day.
  const expiresAt = new Date(`${endDate}T00:00:00Z`).getTime() + BUFFER_DAYS * DAY_SECONDS * 1000;
  const seconds = Math.floor((expiresAt - now.getTime()) / 1000);

  return {
    // No JS read: the page renders the revealed tier server-side, so the browser never needs
    // this value. That makes an XSS on the invite page unable to lift the capability.
    httpOnly: true,
    // localhost and 127.0.0.1 count as secure contexts, so this does not break local
    // development — but a dev server reached over a LAN IP (http://192.168.x.x:4321) is NOT
    // one, and the browser drops this cookie silently. The symptom is the same one
    // MIN_AGE_SECONDS exists to prevent and just as misleading: the claim succeeds, the reload
    // renders the pre-claim page, and it reads as "it didn't work". Testing the mobile-first
    // caretaker flow on a real phone is the obvious way to hit it (Phase 4 impl-review F7).
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
