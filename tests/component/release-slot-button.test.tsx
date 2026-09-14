import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReleaseSlotButton from "@/components/periods/ReleaseSlotButton";

// The repo's first component test, added by full-plan review F8.
//
// Why this island and not another: it is the owner's only irreversible action, it has no undo,
// and its whole safety story is a two-tap confirm that until now was covered by one manual step.
// Two of that review's own findings (the dropped focus of F4, the accessible name of F5) are
// regressions this file would have caught.
//
// What it cannot cover, stated so nobody reads more into a green run than is there: happy-dom
// computes no layout, so the overflow of F1 is invisible here. Appearance stays manual.

const PERIOD_ID = "11111111-1111-4111-8111-111111111111";
const SLOT_ID = "22222222-2222-4222-8222-222222222222";
// Shaped the way PostgREST actually serialises a timestamptz — numeric offset, microseconds —
// because that is what the page reads out of `claimed_at` and hands to this island.
const CLAIMED_AT = "2027-07-13T06:30:00.123456+00:00";

function renderButton() {
  return render(
    <ReleaseSlotButton
      periodId={PERIOD_ID}
      slotId={SLOT_ID}
      caretakerLabel="Ania"
      termLabel="Rano, 13 lipca"
      claimedAt={CLAIMED_AT}
    />,
  );
}

const idle = () => screen.getByRole("button", { name: /^Zwolnij termin/ });
const confirm = () => screen.getByRole("button", { name: /^Na pewno\?/ });
const cancel = () => screen.getByRole("button", { name: /^Nie zwalniaj/ });
// While the request is in flight the confirm's accessible name changes with its visible text,
// so it needs its own selector — and the fact that it does is itself the assertion in
// "renames itself while in flight" below.
const confirmBusy = () => screen.getByRole("button", { name: /^Zwalnianie terminu/ });

function jsonResponse(status: number): Response {
  return new Response(JSON.stringify({}), { status, headers: { "Content-Type": "application/json" } });
}

describe("ReleaseSlotButton", () => {
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

  describe("the two-tap confirm", () => {
    it("starts idle, with no way to release in one tap", () => {
      renderButton();

      expect(idle()).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Na pewno\?/ })).toBeNull();
    });

    it("arms on the first tap and moves focus to the confirm", async () => {
      const user = userEvent.setup();
      renderButton();

      await user.click(idle());

      expect(confirm()).toBeTruthy();
      expect(cancel()).toBeTruthy();
      // Arming swaps the focused button for a different one. Without an explicit focus move the
      // user lands on <body> and, on a page carrying one of these per claimed term, has to find
      // the confirmation again by traversing the whole list (review F4).
      expect(document.activeElement).toBe(confirm());
    });

    it("disarms on Nie, returns focus, and releases nothing", async () => {
      const user = userEvent.setup();
      renderButton();

      await user.click(idle());
      await user.click(cancel());

      expect(idle()).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Na pewno\?/ })).toBeNull();
      expect(document.activeElement).toBe(idle());
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("names the confirm with its visible text first, so voice control can reach it", async () => {
      const user = userEvent.setup();
      renderButton();
      await user.click(idle());

      // WCAG 2.5.3: the accessible name must contain the visible label, or a user saying what
      // they see cannot activate the control (review F5). The rest of the name is what makes a
      // dozen otherwise-identical confirms distinguishable to a screen reader.
      const name = confirm().getAttribute("aria-label") ?? "";
      expect(name.startsWith("Na pewno?")).toBe(true);
      expect(name).toContain("Rano, 13 lipca");
      expect(name).toContain("Ania");
    });
  });

  describe("the request", () => {
    it("posts to the slot's own release path", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(200));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/periods/${PERIOD_ID}/slots/${SLOT_ID}/release`);
      expect(init.method).toBe("POST");
    });

    it("sends the rendered claimed_at as the optimistic-concurrency token", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(200));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      // The token must be the value the PAGE rendered, verbatim. Re-deriving it here — a
      // `new Date().toISOString()`, a reformat, a truncation of the microseconds — would make
      // every release look current to the server and put the lost-update hole
      // (prd.md §Open Questions #3) straight back.
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      // `as string` rather than String(): RequestInit['body'] is a union including Blob and
      // FormData, and stringifying one of those would silently produce "[object Object]" and a
      // parse error instead of a failed assertion. The island sends JSON.stringify's output.
      expect(JSON.parse(init.body as string)).toEqual({ expected_claimed_at: CLAIMED_AT });
    });

    it("sends Content-Type: application/json — which is why the ROUTE owns the Origin check", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(200));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      // This assertion is INVERTED from what it used to be, and the inversion is the point.
      //
      // It previously pinned `headers` and `body` as undefined, because a bodyless POST with no
      // Content-Type is the shape Astro's origin middleware inspects — and that middleware was
      // then the only CSRF control on this endpoint (review F6). Carrying a concurrency token
      // required a body, which drops the request into the middleware's no-check branch, so the
      // route grew its own explicit Origin check in the same change
      // (src/pages/api/periods/[id]/slots/[slotId]/release.ts, and
      // tests/api/release-slot.test.ts's "origin" block asserts it end to end).
      //
      // Pinned rather than deleted so the dependency stays visible in BOTH directions: if this
      // header ever goes away again, the route's now-redundant-looking check must not be
      // "cleaned up" alongside it — the framework does not cover the JSON shape.
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
    });

    it("reloads the page on success rather than patching the row", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(200));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      // The header count and other rows' ordinals are computed server-side and can shift when
      // one term is freed, so a local patch would leave the rest of the page lying.
      await waitFor(() => {
        expect(reload).toHaveBeenCalledTimes(1);
      });
    });

    it("sends the browser to sign-in on 401", async () => {
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
  });

  describe("failure", () => {
    it("tells the owner to refresh on 404 and stays armed", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(404));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      const alert = await screen.findByRole("alert");
      // A 404 means the term is already free, so retrying can never succeed — the message has to
      // say "refresh", not "try again", or it sends the owner into a loop.
      expect(alert.textContent).toContain("Odśwież stronę");
      expect(confirm()).toBeTruthy();
      expect(reload).not.toHaveBeenCalled();
    });

    it("distinguishes 409 from 404 — the term is taken, not free", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(409));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      const alert = await screen.findByRole("alert");
      // 409 means somebody claimed this term after the page was rendered and the release was
      // REFUSED rather than allowed to wipe them. Falling back to the 404 sentence here would
      // tell the owner the term is free while a caretaker is standing on it — which is exactly
      // the state prd.md §Open Questions #3 was about.
      expect(alert.textContent).toContain("ktoś inny");
      expect(alert.textContent).not.toContain("nie jest już zajęty");
      // Still actionable, and still not "try again": the token this page holds can never now
      // succeed.
      expect(alert.textContent).toContain("Odśwież stronę");
      expect(reload).not.toHaveBeenCalled();
    });

    it("offers a retry on 500 and leaves the confirm armed for it", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(500));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Spróbuj ponownie");
      expect(confirm()).toBeTruthy();
    });

    it("survives a network throw without leaving the control stuck", async () => {
      const user = userEvent.setup();
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Błąd połączenia");
      // `pending` must be cleared by the finally block, or the retry the message invites is
      // impossible.
      expect(confirm().hasAttribute("disabled")).toBe(false);
    });

    it("clears the error when the owner backs out", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(500));
      renderButton();

      await user.click(idle());
      await user.click(confirm());
      await screen.findByRole("alert");

      await user.click(cancel());

      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("double submit", () => {
    it("disables both buttons, renames itself while in flight, and sends only one request", async () => {
      const user = userEvent.setup();
      let settle: (value: Response) => void = () => undefined;
      fetchMock.mockReturnValue(
        new Promise<Response>((resolve) => {
          settle = resolve;
        }),
      );
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      await waitFor(() => {
        expect(confirmBusy().hasAttribute("disabled")).toBe(true);
      });
      expect(cancel().hasAttribute("disabled")).toBe(true);
      // aria-label overrides the visible text, so a static one would keep announcing "Na pewno?"
      // to a screen reader while the button reads "Zwalnianie...".
      expect(confirmBusy().getAttribute("aria-busy")).toBe("true");
      expect(confirmBusy().textContent).toBe("Zwalnianie...");

      // A second tap during the flight must not produce a second request. `disabled` is the only
      // guard, and the server's own `claimed_at is not null` predicate is the backstop — but a
      // duplicate here would surface to the owner as a spurious 404 on their own action.
      await user.click(confirmBusy());
      expect(fetchMock).toHaveBeenCalledTimes(1);

      settle(jsonResponse(200));
      await waitFor(() => {
        expect(reload).toHaveBeenCalledTimes(1);
      });
    });
  });
});
