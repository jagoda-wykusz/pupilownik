import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RegenerateLinkButton from "@/components/periods/RegenerateLinkButton";

// The last owner island without a test, and the one where the gap mattered most.
//
// `src/pages/api/periods/[id]/token.ts` carries NO explicit Origin check — unlike
// revoke.ts, which added one. Astro's built-in checkOrigin skips application/json, so what
// actually stands between that route and a cross-site POST is the SHAPE of the request this
// island sends: no Content-Type, no body. That property is observable nowhere else — the API
// suite builds its own Request, so it can never see what the island sends
// (tests/api/revoke-period.test.ts:15-17 records the same limitation for its route).
//
// Scope is deliberately narrow: the request shape, and the refusal to mint for a revoked trip.
// Arming, focus management, error copy and double-submit are UX, not a §2 risk, and the plan
// excluded them — the two sibling islands cover that ground for their own actions.

const PERIOD_ID = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "https://pupilownik.test";

function renderButton(revoked = false) {
  return render(<RegenerateLinkButton periodId={PERIOD_ID} origin={ORIGIN} revoked={revoked} />);
}

const mintButton = () => screen.getByRole("button", { name: /Wygeneruj nowy link/ });

describe("RegenerateLinkButton", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the period's token route", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ periodId: PERIOD_ID, inviteToken: "a".repeat(43) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderButton();

    await userEvent.click(mintButton());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/periods/${PERIOD_ID}/token`);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");
  });

  it("sends NO Content-Type and no body — the route's only CSRF defence", async () => {
    // Adding either turns this into a request a cross-site form cannot forge... and a request
    // Astro's checkOrigin would then have to catch, which for application/json it does not.
    // `token.ts` has no Origin check of its own, so this shape is load-bearing, not incidental.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ periodId: PERIOD_ID, inviteToken: "a".repeat(43) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderButton();

    await userEvent.click(mintButton());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("offers no control at all once the trip is revoked, and sends nothing", () => {
    // The database refuses a revoked period too (regenerate_period_token filters on
    // `revoked_at is null` since S-06), so this is the second of two fences — but it is the one
    // that stops the owner being handed a link the panel would call "gotowy do wysłania".
    renderButton(true);

    expect(screen.queryByRole("button", { name: /Wygeneruj nowy link/ })).toBeNull();
    expect(screen.getByText(/został unieważniony/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
