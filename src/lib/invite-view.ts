// What the caretaker page renders, decided in one pure function.
//
// Uniform failure is a security property of this slice: unknown, tampered, malformed and
// revoked tokens must be indistinguishable — same status, same title, same body. Left in the
// .astro frontmatter that rule lived in an `if` and a ternary, enforced by nothing. Here it
// is one function with one test, so "let's tell them the link was revoked" fails a test
// instead of quietly shipping.
//
// It deliberately knows nothing about Astro or Supabase: it takes the two things the page
// already has — did the call fail, and did it resolve — and returns what to show.

export type InviteView =
  | { kind: "period"; status: number; title: string }
  | { kind: "inactive"; status: number; title: string }
  | { kind: "error"; status: number; title: string };

// A load failure is NOT an inactive link. Telling a visitor to ask the owner for a
// replacement that would work no better is worse than telling them to retry — S-01
// impl-review F5, applied to the caretaker side. This is the one branch that may differ,
// and it is reachable only by a broken backend, never by varying the token.
export const INACTIVE_TITLE = "Link nieaktywny";

export function resolveInviteView(input: { failed: boolean; periodTitle: string | null }): InviteView {
  if (input.failed) {
    return { kind: "error", status: 200, title: INACTIVE_TITLE };
  }
  if (input.periodTitle === null) {
    // Every unresolved token lands here, whatever made it unresolvable.
    return { kind: "inactive", status: 404, title: INACTIVE_TITLE };
  }
  return { kind: "period", status: 200, title: `Opieka: ${input.periodTitle}` };
}
