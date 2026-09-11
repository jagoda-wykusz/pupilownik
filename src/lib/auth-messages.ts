// What a failed sign-in or sign-up tells the caller — one sentence per route, for every cause.
//
// These exist as named constants rather than inline literals because the property they carry is
// SAMENESS, and sameness is not observable in two separate string literals. Both the routes and
// tests/api/auth-error-disclosure.test.ts read these, so a future edit that branches on the
// upstream error has to change this file, and the test compares whole redirect targets.
//
// WHY THE UPSTREAM MESSAGE IS SWALLOWED. `signInWithPassword` and `signUp` return GoTrue's own
// wording — "Invalid login credentials", "User already registered", and (where confirmations are
// enabled, which they are NOT in supabase/config.toml locally) "Email not confirmed" — and
// the routes used to forward it verbatim into `?error=`. That is an auth-state oracle, and on
// sign-up specifically it is a USER-ENUMERATION oracle: an attacker learns which addresses have
// accounts by submitting them. The query string also persists in browser history, where it
// outlives the session and is visible to anyone with the machine.
//
// A `Referer` claim was made here first and withdrawn on review: the browser default
// (`strict-origin-when-cross-origin`) sends origin only on cross-origin requests, and `/auth`
// makes no third-party requests at all — astro.config.mjs self-hosts the fonts precisely so
// that none are made. Browser history is the whole of it, and it is enough.
//
// THE COST, stated because it is real and was accepted deliberately: a user whose account exists
// but is unconfirmed now gets the same sentence as someone with a typo in their password, and no
// hint to check their inbox. Distinguishing that case is exactly what reopens the oracle — the
// same answer has to reach everyone. If support traffic makes this untenable, the fix is a
// confirmation-resend flow reachable from the sign-in page for everyone, not a conditional
// message.
//
// The upstream text is not lost: both routes log it server-side, matching the `code, message`
// discipline every other route in this project uses.

/** Every sign-in failure — wrong password, unknown address, unconfirmed account, missing config. */
export const SIGNIN_FAILED = "Nie udało się zalogować. Sprawdź email i hasło.";

/** Every sign-up failure — address already registered, weak password, invalid email, missing config. */
export const SIGNUP_FAILED = "Nie udało się założyć konta. Sprawdź email i hasło.";
