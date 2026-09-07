import { describe, expect, it } from "vitest";
import { INACTIVE_TITLE, resolveInviteView } from "@/lib/invite-view";

// Uniform failure, asserted at the layer that decides it. The SQL side is covered by
// tests/rls/invite-token.test.ts (every unresolved token returns NULL); this covers what the
// page then does with that NULL, which is where a well-meaning edit would break the property.
describe("caretaker page view resolution", () => {
  // The four ways a token fails to resolve. get_period_by_token collapses them all to NULL,
  // so at this layer they arrive identically — which is exactly the point being pinned.
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

  it("treats an absent capability exactly as a false one", () => {
    // The page passes `hasClaims` only when it resolved something; `undefined` must not be a
    // third behaviour.
    expect(resolveInviteView({ failed: false, periodTitle: "Wyjazd" })).toEqual(
      resolveInviteView({ failed: false, periodTitle: "Wyjazd", hasClaims: false }),
    );
  });
});
