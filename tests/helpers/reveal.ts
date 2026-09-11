// Shapes and fixtures shared by the tests that exercise the two caretaker read doors.
//
// `get_period_by_token` and `get_claimed_details` return jsonb, so every caller has to assert a
// shape the type system cannot give it. Two files were carrying byte-identical copies of these
// declarations and of the instruction fixtures — tests/rls/reveal-instructions.test.ts and
// tests/rls/release-reveal.test.ts — which means a change to the door's payload had two places
// to be noticed and could be half-updated silently.
//
// The fixture strings live here for the same reason: they are ASSERTED against, not just
// inserted, so two definitions of "the sensitive body" is two definitions of what a leak looks
// like.

/** One `care_instructions` row as either door serializes it. */
export interface Instruction {
  id: string;
  title: string;
  body: string | null;
  sort_order: number;
}

/** A pet as either door serializes it. Which TIER `instructions` carries depends on the door:
 *  public rows from `get_period_by_token`, sensitive rows from `get_claimed_details`. That the
 *  two payloads share one shape is exactly why the tier has to be asserted by content. */
export interface Pet {
  id: string;
  name: string;
  species: string;
  instructions: Instruction[];
}

/** The read door's answer — the link alone. */
export interface TokenPayload {
  period: { id: string; title: string; start_date: string; end_date: string };
  slots: { id: string; slot_date: string; time_of_day: string; is_claimed: boolean }[];
  pets: Pet[];
}

/** The reveal door's CONTENT answer — link plus a capability that holds a claimed slot here. */
export interface ClaimedDetails {
  name: string;
  caretaker_note: string | null;
  slots: { id: string; slot_date: string; time_of_day: string }[];
  pets: Pet[];
}

/** S-06 Phase 2: what a PROVEN claim-holder gets once the period is revoked. One bit, no
 *  content — deliberately not assignable to ClaimedDetails. */
export interface RevokedAnswer {
  revoked: true;
}

export const SECRET_BODY = "Klucze u sąsiadki, mieszkanie 4. Kod do klatki 1234#";
export const SECRET_TITLE = "Dostęp do mieszkania";
export const PUBLIC_TITLE = "Karmienie";
export const PUBLIC_BODY = "Rano i wieczorem, pół szklanki suchej karmy.";
export const NOTE = "Burek boi się burzy — wtedy najlepiej zostać z nim w pokoju.";
