import { describe, expect, it } from "vitest";
import { INACTIVE_TITLE, resolveInviteView, splitRevealAnswer } from "@/lib/invite-view";

// Uniform failure, asserted at the layer that decides it. The SQL side is covered by
// tests/rls/invite-token.test.ts (every unresolved token returns NULL); this covers what the
// page then does with that NULL, which is where a well-meaning edit would break the property.
describe("caretaker page view resolution", () => {
  // The four ways a token fails to resolve. get_period_by_token collapses them all to NULL,
  // so at this layer they arrive identically — which is exactly the point being pinned.
  //
  // "revoked" still belongs on this list after S-06 Phase 2: the exception carved out there is
  // not about the token, it is about the CALLER. A revoked link stays byte-identical to an
  // unknown one for everyone who cannot prove a claim on that period, and that is every
  // visitor reaching this function without `claimRevoked` — see the last describe block.
  const UNRESOLVED = ["unknown", "tampered", "malformed", "revoked"];

  it("renders one identical inactive page for every unresolved token", () => {
    const views = UNRESOLVED.map(() => resolveInviteView({ failed: false, periodTitle: null }));

    // Byte-identical, not merely similar: same kind, same status, same title.
    for (const view of views) {
      expect(view).toEqual(views[0]);
    }
    expect(views[0]).toEqual({ kind: "inactive", status: 404, title: INACTIVE_TITLE });
  });

  it("never names the period in the inactive title", () => {
    const view = resolveInviteView({ failed: false, periodTitle: null });
    // A title carrying the period name would confirm the period exists — the exact leak the
    // uniform-failure rule exists to prevent.
    expect(view.title).not.toContain("Opieka");
  });

  it("shows the period when the token resolves", () => {
    expect(resolveInviteView({ failed: false, periodTitle: "Weekend u rodziców" })).toEqual({
      kind: "period",
      status: 200,
      title: "Opieka: Weekend u rodziców",
    });
  });

  it("keeps a load failure distinct from an inactive link, but not by title", () => {
    const failure = resolveInviteView({ failed: true, periodTitle: null });
    const inactive = resolveInviteView({ failed: false, periodTitle: null });

    // Different body and status — a broken backend is not a dead link.
    expect(failure.kind).toBe("error");
    expect(failure.status).toBe(200);
    expect(failure.kind).not.toBe(inactive.kind);
    // But the title stays the same, so the tab gives nothing away either way.
    expect(failure.title).toBe(inactive.title);
  });

  it("a resolved period always wins over a null title, never the reverse", () => {
    // Guards the branch order: if `failed` were checked after the null test, a backend error
    // would render as an inactive link.
    expect(resolveInviteView({ failed: true, periodTitle: "Wyjazd" }).kind).toBe("error");
  });
});

// The fourth state, added in S-03 Phase 4. The uniform-failure property is what this file
// exists to protect, so the cases that matter are the ones where a capability is present AND
// the token does not resolve — a post-claim branch must never become a way to tell a dead link
// from a live one.
describe("caretaker page view resolution — post-claim", () => {
  it("shows the claimed view when a capability resolves on a live trip", () => {
    expect(resolveInviteView({ failed: false, periodTitle: "Weekend u rodziców", hasClaims: true })).toEqual({
      kind: "claimed",
      status: 200,
      title: "Opieka: Weekend u rodziców",
    });
  });

  it("degrades a capability on an unresolvable token to the same inactive page", () => {
    // The cookie survives the trip being revoked, and it survives being carried to a different
    // link — Path=/invite means it rides along on every invite URL. Both must land on the one
    // uniform failure.
    const withCapability = resolveInviteView({ failed: false, periodTitle: null, hasClaims: true });
    const without = resolveInviteView({ failed: false, periodTitle: null, hasClaims: false });

    expect(withCapability).toEqual(without);
    expect(withCapability).toEqual({ kind: "inactive", status: 404, title: INACTIVE_TITLE });
  });

  it("keeps a load failure distinct from a capability, and checks it first", () => {
    // Branch order again: a broken backend cannot resolve a capability either, so `failed`
    // must win — otherwise a transport error would render as a post-claim page with no content.
    expect(resolveInviteView({ failed: true, periodTitle: "Wyjazd", hasClaims: true }).kind).toBe("error");
  });

  it("gives the claimed view the same title as the pre-claim one", () => {
    const pre = resolveInviteView({ failed: false, periodTitle: "Wyjazd", hasClaims: false });
    const post = resolveInviteView({ failed: false, periodTitle: "Wyjazd", hasClaims: true });

    // The tab, and therefore browser history, must not announce that this visitor holds slots.
    expect(post.title).toBe(pre.title);
    expect(post.status).toBe(pre.status);
    expect(post.kind).not.toBe(pre.kind);
  });

  it("does NOT treat a claim-holder on another trip as a revoked answer", () => {
    // The cookie rides along on every /invite URL (Path=/invite), so a capability earned on
    // trip A arrives on trip B's dead link too. That case has `hasClaims` shaped like the
    // revoked one but must stay uniform — which is why the revoked branch hangs on its own
    // flag rather than on `hasClaims`.
    const carriedOver = resolveInviteView({ failed: false, periodTitle: null, hasClaims: true, claimRevoked: false });

    expect(carriedOver.kind).toBe("inactive");
  });

  it("treats an absent capability exactly as a false one", () => {
    // The page passes `hasClaims` only when it resolved something; `undefined` must not be a
    // third behaviour.
    expect(resolveInviteView({ failed: false, periodTitle: "Wyjazd" })).toEqual(
      resolveInviteView({ failed: false, periodTitle: "Wyjazd", hasClaims: false }),
    );
  });
});

// The fifth state, added in S-06 Phase 2. This is the one bounded exception to uniform
// failure, so the cases that matter are the ones proving the exception cannot be reached
// without the flag the database alone sets — and that even WITH it, nothing observable
// outside the body changes.
describe("caretaker page view resolution — revoked with a proven claim", () => {
  const REVOKED = { failed: false, periodTitle: null, claimRevoked: true } as const;

  it("gives a proven claim-holder a distinct body for a revoked trip", () => {
    expect(resolveInviteView(REVOKED)).toEqual({ kind: "revoked", status: 404, title: INACTIVE_TITLE });
  });

  it("differs from the inactive page in NOTHING but the kind", () => {
    // Status and title are the two things observable without rendering the body: the status
    // shows in devtools and in any crawler, and the title is the browser tab and lands in
    // history — on a shared phone it would say more than the page does. Only `kind`, which
    // selects the body, may differ.
    const revoked = resolveInviteView(REVOKED);
    const inactive = resolveInviteView({ failed: false, periodTitle: null });

    expect(revoked.status).toBe(inactive.status);
    expect(revoked.title).toBe(inactive.title);
    expect(revoked.kind).not.toBe(inactive.kind);
  });

  it("never names the period, because the payload behind it carries no name", () => {
    expect(resolveInviteView(REVOKED).title).not.toContain("Opieka");
  });

  it("keeps a load failure ahead of it", () => {
    // Branch order: a broken backend cannot resolve a capability either, so a transport error
    // must not be reported to the caretaker as "the trip was called off".
    expect(resolveInviteView({ failed: true, periodTitle: null, claimRevoked: true }).kind).toBe("error");
  });

  it("never fires for a resolved period, whatever the flag says", () => {
    // A live trip cannot be revoked, so this combination is unreachable through the page. If a
    // future edit made it reachable, showing the called-off card over a working trip would be
    // the worse failure — so the resolved period wins.
    expect(resolveInviteView({ failed: false, periodTitle: "Wyjazd", claimRevoked: true }).kind).toBe("period");
    expect(resolveInviteView({ failed: false, periodTitle: "Wyjazd", hasClaims: true, claimRevoked: true }).kind).toBe(
      "claimed",
    );
  });

  it("treats an absent flag exactly as a false one", () => {
    expect(resolveInviteView({ failed: false, periodTitle: null })).toEqual(
      resolveInviteView({ failed: false, periodTitle: null, claimRevoked: false }),
    );
  });
});

// The split that feeds the flag above, extracted from the .astro frontmatter in response to
// S-06 Phase 2's impl-review F4: the page's whole "the called-off card cannot grow trip
// content" claim rested on two ternaries that no test touched.
describe("reveal answer split", () => {
  interface Details {
    name: string;
    caretaker_note: string | null;
  }
  const DETAILS: Details = { name: "Ania", caretaker_note: "klucze u sasiadki" };

  it("passes a content answer through untouched", () => {
    const split = splitRevealAnswer<Details>(DETAILS);

    expect(split.details).toBe(DETAILS);
    expect(split.claimRevoked).toBe(false);
  });

  it("turns the revoked marker into NO details", () => {
    // The load-bearing case. `details` is what every renderer of trip content reads, so a
    // non-null value here is what would let the called-off card grow a name or a note.
    const split = splitRevealAnswer<Details>({ revoked: true });

    expect(split.details).toBeNull();
    expect(split.claimRevoked).toBe(true);
  });

  it("treats a null answer as neither", () => {
    const split = splitRevealAnswer<Details>(null);

    expect(split.details).toBeNull();
    expect(split.claimRevoked).toBe(false);
  });

  it("suppresses content on an answer that carries BOTH, rather than trusting it", () => {
    // A door sending content alongside the marker would be a door with a bug. Suppressing is
    // the safe reading of an answer we do not understand — and asserting it here means a
    // future SQL edit that merges the two cannot quietly start rendering a revoked trip.
    const split = splitRevealAnswer<Details>({ ...DETAILS, revoked: true } as never);

    expect(split.details).toBeNull();
    expect(split.claimRevoked).toBe(true);
  });
});
