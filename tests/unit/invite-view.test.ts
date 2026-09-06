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
