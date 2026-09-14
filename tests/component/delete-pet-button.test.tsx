import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeletePetButton from "@/components/pets/DeletePetButton";

// S-09 Phase 2. Modelled on revoke-period-button.test.tsx, because the island is modelled on
// RevokePeriodButton — the two-tap confirm, the escape-first DOM order, the focus moves and the
// bodiless request are the same properties and are pinned the same way.
//
// Two things are NEW here and are the reason this file exists rather than a copied one:
//
//   1. Success NAVIGATES, it does not reload. This is the first action in the repo that
//      destroys its own page, and a reload would land on /pets/<id> for a pet that is gone — a
//      404 as the reward for a successful delete.
//   2. There is a 409, and it is the point of the whole slice. The server's sentence names the
//      blocking trip, so the island must render what it receives rather than substituting a
//      generic one — an assertion no server-side test can make.
//
// What it cannot cover, stated so nobody reads more into a green run than is there: happy-dom
// computes no layout, so nothing here sees how a two-trip sentence wraps at 400px. Appearance
// stays manual.

const PET_ID = "22222222-2222-4222-8222-222222222222";

function renderButton(instructionCount = 2) {
  return render(<DeletePetButton petId={PET_ID} petName="Burek" instructionCount={instructionCount} />);
}

const idle = () => screen.getByRole("button", { name: /^Usuń zwierzę$/ });
const confirm = () => screen.getByRole("button", { name: /^Na pewno\?/ });
const cancel = () => screen.getByRole("button", { name: /^Nie usuwaj/ });
// While the request is in flight the confirm's accessible name changes with its visible text,
// so it needs its own selector — and the fact that it does is itself the assertion in
// "renames itself while in flight".
const confirmBusy = () => screen.getByRole("button", { name: /^Usuwanie/ });

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("DeletePetButton", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let reload: ReturnType<typeof vi.fn>;
  let assignedHref: string | null;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // window.location is not writable in happy-dom, so replace the whole descriptor. `reload`
    // and `href` are the island's two possible navigation side effects and both must be
    // observable — here specifically so a regression to `reload()` on success is visible.
    reload = vi.fn();
    assignedHref = null;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        reload,
        get href() {
          return `http://localhost/pets/${PET_ID}`;
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

  describe("the consequence line", () => {
    it("names the pet and its instruction count before anything is armed", () => {
      renderButton(3);

      // The instructions cascade, and that is the part of the cost an owner is least likely to
      // have in mind — the list is on the same page, but above the fold they are looking at.
      expect(screen.getByText(/Burek/)).toBeTruthy();
      expect(screen.getByText(/3 instrukcjami/)).toBeTruthy();
    });

    it("drops the instruction clause when there are none", () => {
      renderButton(0);

      // "razem z 0 instrukcjami" is the kind of sentence that reads as a bug.
      expect(screen.queryByText(/instrukcjami/)).toBeNull();
      expect(screen.getByText(/Burek/)).toBeTruthy();
    });
  });

  describe("the confirm", () => {
    it("does not delete on the first tap", async () => {
      const user = userEvent.setup();
      renderButton();

      await user.click(idle());

      // The whole point of two taps: a double-tap on one control cannot destroy a pet. The
      // confirm is a different word in a different place, so the second press is deliberate.
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

    it("disarms on Nie usuwaj, returns focus, and deletes nothing", async () => {
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
      // voice-control user saying what they can see cannot activate the control. Read from the
      // DOM rather than hard-coded, so the two can never drift apart without failing here.
      const button = confirm();
      const visible = button.textContent.trim();
      const accessibleName = button.getAttribute("aria-label") ?? visible;

      expect(visible).not.toBe("");
      expect(accessibleName).toContain(visible);
    });

    it("puts the escape where the idle button was, so a stray second tap cannot delete", async () => {
      const user = userEvent.setup();
      renderButton();

      await user.click(idle());

      // Both armed buttons are `w-full` in a flex column, so document order IS visual order:
      // whichever comes first occupies the rectangle the idle button just occupied. The escape
      // has to be that one — otherwise a fast double-tap at a single point arms and then
      // confirms, on an action with no undo.
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

      await waitFor(() => {
        expect(confirmBusy()).toBeTruthy();
      });
      expect(confirmBusy().getAttribute("aria-busy")).toBe("true");

      release(jsonResponse(200, { petId: PET_ID }));
    });
  });

  describe("the request", () => {
    it("sends DELETE to the pet's own path", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(200, { petId: PET_ID }));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/pets/${PET_ID}`);
      expect(init.method).toBe("DELETE");
    });

    it("sends NO Content-Type and no body — this is what keeps the route inside Astro's origin check", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(200, { petId: PET_ID }));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      // Astro's origin middleware refuses a non-safe method carrying no Content-Type unless the
      // origin matches. The route ALSO carries an explicit check, so this is belt and braces
      // rather than the only control — but it is still only observable here, because
      // tests/api/pets.delete.test.ts builds its own Request and never passes through the
      // framework. Adding a header or a body would silently drop the request into the no-check
      // branch and no server-side test would notice.
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.headers).toBeUndefined();
      expect(init.body).toBeUndefined();
    });

    it("NAVIGATES to /pets on success rather than reloading a page that no longer exists", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(200, { petId: PET_ID }));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      // The one thing with no precedent in this repo: every other island reloads, because
      // everything it changes is computed in the page's frontmatter. Here the page's subject is
      // gone, so a reload would answer 404 — a not-found screen as the reward for a successful
      // delete. Both halves are asserted: where it went, and that it did not reload.
      await waitFor(() => {
        expect(assignedHref).toBe("/pets");
      });
      expect(reload).not.toHaveBeenCalled();
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

    it("renders the server's 409 sentence verbatim, because only the server knows the trip", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(
        jsonResponse(409, {
          error:
            "Nie można usunąć zwierzęcia — obejmuje je aktywny wyjazd: „Majówka”. Aby usunąć zwierzę, najpierw odwołaj wyjazd.",
        }),
      );
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      // The refusal this slice is built around. No sentence written in the island could name
      // the trip, so substituting a generic one would throw away the only actionable part.
      await waitFor(() => {
        expect(screen.getByText(/Majówka/)).toBeTruthy();
      });
      expect(screen.queryByText(/Spróbuj ponownie/)).toBeNull();
      expect(assignedHref).toBeNull();
    });

    it("falls back to a usable sentence when a 409 body is not the expected shape", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(409, { nope: 1 }));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      // An error handler that throws inside itself leaves the owner with a silent dead button.
      await waitFor(() => {
        expect(screen.getByText(/aktywny wyjazd/)).toBeTruthy();
      });
    });

    it("treats 404 as terminal, not retryable", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(404));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      // 404 means the pet is already gone — another tab, or a stale page. A retry can never now
      // succeed, so "spróbuj ponownie" would be a loop.
      await waitFor(() => {
        expect(screen.getByText(/już nie ma/)).toBeTruthy();
      });
      expect(screen.queryByText(/Spróbuj ponownie/)).toBeNull();
      expect(assignedHref).toBeNull();
    });

    it("keeps the confirm armed after a failure, so a retry is one tap", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(500));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      await waitFor(() => {
        expect(screen.getByText(/Nie udało się usunąć/)).toBeTruthy();
      });
      // Deliberately not disarmed in `finally`: the owner meant to do this, and making them
      // re-arm after a transport failure is friction with no safety benefit.
      expect(confirm()).toBeTruthy();
    });

    it("reports a connection failure without destroying anything", async () => {
      const user = userEvent.setup();
      fetchMock.mockRejectedValue(new Error("offline"));
      renderButton();

      await user.click(idle());
      await user.click(confirm());

      await waitFor(() => {
        expect(screen.getByText(/Błąd połączenia/)).toBeTruthy();
      });
      expect(assignedHref).toBeNull();
      expect(reload).not.toHaveBeenCalled();
    });
  });
});
