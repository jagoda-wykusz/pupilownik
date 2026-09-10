// What the caretaker page renders, decided in one pure function.
//
// Uniform failure is a security property of this slice: unknown, tampered, malformed and
// revoked tokens must be indistinguishable — same status, same title, same body. Left in the
// .astro frontmatter that rule lived in an `if` and a ternary, enforced by nothing. Here it
// is one function with one test, so "let's tell them the link was revoked" fails a test
// instead of quietly shipping.
//
// S-06 Phase 2 added ONE bounded exception, and it is bounded by the database rather than by
// this file: a visitor whose claim_digest matched a slot row in the very period that was
// revoked gets a different BODY (`kind: "revoked"`) at the same status and the same title.
// This function cannot tell that case apart on its own — it trusts `claimRevoked`, which is
// set only by the reveal door's answer from behind its digest gate. Everything reachable
// without proving a claim still collapses to one page. The rule now reads: uniform failure
// for every UNPROVEN caller.
//
// It deliberately knows nothing about Astro or Supabase: it takes the two things the page
// already has — did the call fail, and did it resolve — and returns what to show.

export type InviteView =
  | { kind: "period"; status: number; title: string }
  | { kind: "claimed"; status: number; title: string }
  | { kind: "inactive"; status: number; title: string }
  | { kind: "revoked"; status: number; title: string }
  | { kind: "error"; status: number; title: string };

// A load failure is NOT an inactive link. Telling a visitor to ask the owner for a
// replacement that would work no better is worse than telling them to retry — S-01
// impl-review F5, applied to the caretaker side. This is the one branch that may differ,
// and it is reachable only by a broken backend, never by varying the token.
export const INACTIVE_TITLE = "Link nieaktywny";

export function resolveInviteView(input: {
  failed: boolean;
  periodTitle: string | null;
  /** True when this visitor presented a capability that resolved to claimed slots on THIS
   *  trip. Phase 4. Deliberately a boolean rather than the payload: this function decides
   *  what to show, and handing it the revealed content would invite it to grow branches on
   *  the content's shape. */
  hasClaims?: boolean;
  /** True ONLY when the reveal door answered `{revoked: true}` — i.e. this visitor's
   *  claim_digest matched a slot row in this very period AND the period is revoked (S-06
   *  Phase 2). Kept separate from `hasClaims` on purpose: `hasClaims` cannot carry this,
   *  because a capability earned on a DIFFERENT trip also arrives here with a null title and
   *  must still degrade to the uniform inactive page. Only the database can tell those two
   *  apart, and it does so behind the digest gate. */
  claimRevoked?: boolean;
}): InviteView {
  if (input.failed) {
    return { kind: "error", status: 200, title: INACTIVE_TITLE };
  }
  if (input.periodTitle === null) {
    // Every unresolved token lands here, whatever made it unresolvable — with ONE narrow
    // exception, below. Note the ORDER: this whole block is tested before hasClaims on
    // purpose. A capability that no longer resolves must degrade to the same inactive page as
    // any other dead link, never to a post-claim view with nothing in it.
    //
    // The exception (S-06 Phase 2): the visitor proved a claim on THIS period and the period
    // is revoked. That is not "a capability that no longer resolves" — it is a caretaker who
    // committed their days to a trip the owner called off, and telling them so discloses
    // nothing, because claiming is how they learned the period existed in the first place.
    // `claimRevoked` is set only by the reveal door's `{revoked: true}`, which sits behind the
    // claim_digest gate; the cookie-from-another-trip case cannot reach it and still falls
    // through to the uniform failure below.
    //
    // Status and title stay IDENTICAL to the inactive page. Only the body differs: the title
    // is the browser tab and lands in history, and a differing status is observable without
    // rendering anything.
    if (input.claimRevoked === true) {
      return { kind: "revoked", status: 404, title: INACTIVE_TITLE };
    }
    return { kind: "inactive", status: 404, title: INACTIVE_TITLE };
  }
  if (input.hasClaims === true) {
    // Same status and the same title shape as `period`. The title must NOT announce that this
    // visitor holds slots: it is the browser tab, it lands in history, and on a shared phone
    // it would say more than the page does.
    return { kind: "claimed", status: 200, title: `Opieka: ${input.periodTitle}` };
  }
  return { kind: "period", status: 200, title: `Opieka: ${input.periodTitle}` };
}
