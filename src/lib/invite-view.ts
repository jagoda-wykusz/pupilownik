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

/** The shape the reveal door returns for a proven claim-holder on a revoked period. Content
 *  answers never carry this key, which is what makes the split below decidable. */
export interface RevokedClaim {
  revoked: true;
}

/** Split the reveal door's answer into the two things the page needs from it.
 *
 *  This exists as a function rather than two ternaries in the .astro frontmatter for the same
 *  reason resolveInviteView does: it carries a security property, and in frontmatter a
 *  property is enforced by nothing. The property is that `details` — the value every renderer
 *  of trip content reads — is null for the revoked answer, so the called-off card cannot grow
 *  a name, a note or a day list, and a `{revoked: true}` payload can never be mistaken for a
 *  post-claim view with empty fields. S-06 Phase 2's impl-review F4 found that claim resting
 *  on an untested line.
 *
 *  Generic in the content shape: ClaimedDetails is page-shaped (it carries TokenPet), and this
 *  function does not need to know anything about it beyond "not the revoked marker".
 *
 *  Anything carrying the `revoked` key is treated as the revoked answer even if it also
 *  carries content. That is deliberate: a door that sent both would be a door with a bug, and
 *  suppressing the content is the safe reading of an answer we do not understand. */
export function splitRevealAnswer<T extends object>(
  answer: T | RevokedClaim | null,
): { details: T | null; claimRevoked: boolean } {
  if (answer === null) {
    return { details: null, claimRevoked: false };
  }
  if ("revoked" in answer) {
    return { details: null, claimRevoked: true };
  }
  return { details: answer, claimRevoked: false };
}

/** One pet as the caretaker page renders it: the two instruction tiers kept apart, never
 *  merged, because the design draws them as separate blocks and the whole slice is about the
 *  distinction. `instructions` is deliberately absent from this shape — a renderer that can
 *  still reach the raw public list has two ways to say the same thing, and the day the tiers
 *  are composed differently one of them goes stale silently. */
export type ComposedPet<P extends { instructions: unknown[] }> = Omit<P, "instructions"> & {
  publicInstructions: P["instructions"];
  sensitiveInstructions: P["instructions"];
};

/** Compose the two payloads into what the page may render, in one pure function.
 *
 *  This is the third decision of this page to leave the .astro frontmatter, and it leaves for
 *  the same reason as the other two: it carries a security property, and in frontmatter a
 *  property is enforced by nothing. The property here is the one FR-008 is made of — a visitor
 *  who has not claimed must not be handed a sensitive instruction row or the trip note. Left
 *  inline it was a Map and a `details?.caretaker_note`, and rebuilding either from the PUBLIC
 *  payload would have leaked the sensitive tier to every holder of the link while every test in
 *  the suite stayed green (test-plan.md §2 Risk #4 anti-pattern: "the column split is right but
 *  the API serializes it anyway", one layer above the API).
 *
 *  The shape of the guarantee is structural rather than conditional: when `details` is null
 *  there is nothing to read a sensitive row OUT of, so no branch can be forgotten. That is what
 *  makes the pre-claim case assertable by serializing the whole result and searching it, which
 *  is how tests/rls/reveal-instructions.test.ts asserts the same property one layer down.
 *
 *  Generic in the pet shape, like splitRevealAnswer is in its content shape: this module must
 *  keep knowing nothing about Astro or Supabase. ONE type parameter, with the instruction type
 *  derived from it as `P["instructions"]` rather than taken as a second parameter — a second
 *  one is not inferable from this argument shape, and TypeScript silently widens it to
 *  `unknown`, which surfaces as an error in the .astro template rather than here.
 *
 *  Keyed by pet id, never by index. The two payloads order pets identically today — both
 *  `order by pet.name, pet.id` — but relying on that would turn a future ordering change into a
 *  silent mismatch of care instructions to animals, which on this screen is the failure that
 *  matters.
 *
 *  The public payload is the spine: a pet the reveal names but the read door does not is
 *  dropped rather than conjured. The reveal is scoped to the same period by the database, so
 *  such a pet would mean a door disagreeing with itself — and inventing an animal from the
 *  sensitive tier is the wrong way to answer that. */
export function composeCaretakerView<P extends { id: string; instructions: unknown[] }>(input: {
  /** Pets from the read door — PUBLIC instruction rows only. */
  pets: P[];
  /** The reveal door's content answer, or null for every visitor who has not proven a claim.
   *  Its `pets` carry ONLY the sensitive rows. */
  details: { pets: P[]; caretaker_note: string | null } | null;
}): { pets: ComposedPet<P>[]; caretakerNote: string | null } {
  const sensitiveByPet = new Map((input.details?.pets ?? []).map((pet) => [pet.id, pet.instructions]));

  return {
    pets: input.pets.map((pet) => {
      const { instructions, ...rest } = pet;
      return {
        ...rest,
        publicInstructions: instructions,
        sensitiveInstructions: sensitiveByPet.get(pet.id) ?? [],
      };
    }),
    caretakerNote: input.details?.caretaker_note ?? null,
  };
}

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
