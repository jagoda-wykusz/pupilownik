import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RevokePeriodButton from "@/components/periods/RevokePeriodButton";

// S-06 Phase 3. Modelled on release-slot-button.test.tsx, which the S-04 full-plan review added
// for the same reasons — except every one of them is stronger here.
//
// That island frees one term and another caretaker can take it back. This one ends a trip for
// everybody on it, cannot be undone by any path in the product, and is the ONLY caller of the
// only endpoint whose CSRF protection is the shape of the request rather than a check in the
// handler. So the two-tap confirm, the accessible name and the absent Content-Type are all
// pinned here rather than left to a manual step.
//
// What it cannot cover, stated so nobody reads more into a green run than is there: happy-dom
// computes no layout, so nothing here sees the 320px overflow. Appearance stays manual.

const PERIOD_ID = "11111111-1111-4111-8111-111111111111";

function renderButton(revoked = false) {
  return render(<RevokePeriodButton periodId={PERIOD_ID} revoked={revoked} />);
}

const idle = () => screen.getByRole("button", { name: /^Odwołaj wyjazd$/ });
const confirm = () => screen.getByRole("button", { name: /^Na pewno\?/ });
const cancel = () => screen.getByRole("button", { name: /^Nie odwołuj/ });
// While the request is in flight the confirm's accessible name changes with its visible text,
// so it needs its own selector — and the fact that it does is itself the assertion in
// "renames itself while in flight".
const confirmBusy = () => screen.getByRole("button", { name: /^Odwoływanie/ });

function jsonResponse(status: number): Response {
  return new Response(JSON.stringify({}), { status, headers: { "Content-Type": "application/json" } });
}

describe("RevokePeriodButton", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let reload: ReturnType<typeof vi.fn>;
  let assignedHref: string | null;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // window.location is not writable in happy-dom, so replace the whole descriptor. `reload`
    // and `href` are the island's two navigation side effects and both must be observable.
    reload = vi.fn();
    assignedHref = null;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        reload,
        get href() {
          return "http://localhost/periods/x";
        },
        set href(value: string) {
          assignedHref = value;
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("the terminal state", () => {
    it("offers no control at all once the trip is revoked", () => {
      renderButton(true);

      // Not a disabled button — no button. There is no un-revoke, so a control that could be
      // focused and pressed would be promising an action the product does not have.
      expect(screen.queryAllByRole("button")).toHaveLength(0);
      // Only what this control alone knows — the irreversibility. The fact that the link is
      // dead is stated by the page's header line and by RegenerateLinkButton's refusal above
      // it, so repeating it here was the third statement of one fact (impl-review).
      expect(screen.getByText(/nie da się cofnąć/)).toBeTruthy();
    });
  });

  describe("the confirm", () => {
    it("does not revoke on the first tap", async () => {
      const user = userEvent.setup();
      renderButton();

      await user.click(idle());

      // The whole point of two taps: a double-tap on one control cannot end a trip. The confirm
      // is a different word in a different place, so the second press has to be deliberate.
      expect(fetchMock).not.toHaveBeenCalled();
      expect(confirm()).toBeTruthy();
    });

    it("arms on the first tap and moves focus to the confirm", async () => {
      const user = userEvent.setup();
      renderButton();

      await user.click(idle());

      // Arming swaps the focused button for a different one. Without an explicit focus move the
      // user lands on <body>, and here that also means the state change is announced by nothing
      // at all — there is no live region.
      expect(document.activeElement).toBe(confirm());
    });

    it("disarms on Nie odwołuj, returns focus, and revokes nothing", async () => {
      const user = userEvent.setup();
      renderButton();

      await user.click(idle());
      await user.click(cancel());

      expect(idle()).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Na pewno\?/ })).toBeNull();
      expect(document.activeElement).toBe(idle());
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("gives the confirm an accessible name that CONTAINS its whole visible text", async () => {
      const user = userEvent.setup();
      renderButton();
      await user.click(idle());

      // WCAG 2.5.3 "label in name": the accessible name must contain the visible label, or a
      // voice-control user saying what they can see cannot activate the control.
      //
      // Asserted against the button's OWN text rather than a hard-coded prefix, which is what
      // makes this bite (impl-review 2a). The first version asserted only
      // `name.startsWith("Na pewno?")` — and passed while the visible text read "Na pewno?
      // Odwołaj na zawsze" and the label read "Na pewno? Potwierdź odwołanie wyjazdu", which
      // share nothing after those two words. Reading the text from the DOM means the two can
      // never drift apart again without failing here.
      const button = confirm();
      const visible = button.textContent.trim();
      const accessibleName = button.getAttribute("aria-label") ?? visible;

      expect(visible).not.toBe("");
      expect(accessibleName).toContain(visible);
    });

    it("puts the escape where the idle button was, so a stray second tap cannot revoke", async () => {
      const user = userEvent.setup();
      renderButton();

      await user.click(idle());

      // Both armed buttons are `w-full` in a flex column, so document order IS visual order:
      // whichever comes first occupies the rectangle the idle button just occupied. The escape
      // has to be that one (impl-review 2b) — otherwise a fast double-tap at a single point
      // arms and then confirms, on the only action in this product with no undo.
      const buttons = screen.getAllByRole("button");
      const cancelIndex = buttons.indexOf(cancel());
      const confirmIndex = buttons.indexOf(confirm());

      expect(cancelIndex).toBeGreaterThanOrEqual(0);
      expect(cancelIndex).toBeLessThan(confirmIndex);
    });

    it("renames itself while in flight, so the name never contradicts the text", async () => {
      const user = userEvent.setup();
      let release: (value: Response) => void = () => undefined;
      fetchMock.mockReturnValue(
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
      );
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      // aria-label overrides the visible text, so a static one would keep saying "Na pewno?"
      // while the button reads "Odwoływanie...".
      await waitFor(() => {
        expect(confirmBusy()).toBeTruthy();
      });
      expect(confirmBusy().getAttribute("aria-busy")).toBe("true");

      release(jsonResponse(200));
    });
  });

  describe("the request", () => {
    it("posts to the period's own revoke path", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(200));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/periods/${PERIOD_ID}/revoke`);
      expect(init.method).toBe("POST");
    });

    it("sends NO Content-Type and no body — this is what makes the route CSRF-safe", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(200));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      // Not incidental, and the reason it is pinned here rather than in the route test: Astro's
      // origin middleware refuses a non-safe method carrying no Content-Type unless the origin
      // matches, and that is the ONLY CSRF control on this endpoint. Adding a header or a body
      // would silently drop the request into the middleware's no-check branch, and no test on
      // the server side could notice — tests/api/revoke-period.test.ts builds its own Request.
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.headers).toBeUndefined();
      expect(init.body).toBeUndefined();
    });

    it("reloads the page on success rather than patching the control", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(200));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      // The revoked marker on the header line and RegenerateLinkButton's own `revoked` prop are
      // both computed in the page's frontmatter. Patching this control alone would leave the
      // panel beside it offering to mint a link the database now refuses.
      await waitFor(() => {
        expect(reload).toHaveBeenCalledTimes(1);
      });
    });

    it("sends the owner to sign-in on 401", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(401));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      await waitFor(() => {
        expect(assignedHref).toBe("/auth/signin");
      });
      expect(reload).not.toHaveBeenCalled();
    });

    it("treats 404 as terminal, not retryable", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(404));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      // 404 means the trip is already revoked — another tab, or a stale page. Revocation has no
      // second attempt to make, so "spróbuj ponownie" here would be a loop against a request
      // that can never succeed.
      await waitFor(() => {
        expect(screen.getByText(/już odwołany/)).toBeTruthy();
      });
      expect(screen.queryByText(/Spróbuj ponownie/)).toBeNull();
      expect(reload).not.toHaveBeenCalled();
    });

    it("keeps the confirm armed after a failure, so a retry is one tap", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(500));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      await waitFor(() => {
        expect(screen.getByText(/Nie udało się odwołać/)).toBeTruthy();
      });
      // Deliberately not disarmed in `finally`: the owner meant to do this, and making them
      // re-arm after a transport failure is friction with no safety benefit.
      expect(confirm()).toBeTruthy();
    });

    it("reports a connection failure without ending anything", async () => {
      const user = userEvent.setup();
      fetchMock.mockRejectedValue(new Error("offline"));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      await waitFor(() => {
        expect(screen.getByText(/Błąd połączenia/)).toBeTruthy();
      });
      expect(reload).not.toHaveBeenCalled();
      expect(assignedHref).toBeNull();
    });
  });
});
