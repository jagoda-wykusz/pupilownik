import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ServerError } from "@/components/auth/ServerError";

// The owner's revoke control — FR-012's last piece, and the product's only irreversible
// page-level action.
//
// Modelled on ReleaseSlotButton, deliberately: that is the repo's one confirm pattern and it
// already argues its four load-bearing decisions (reload on success, no Content-Type, an
// accessible name that starts with the visible text, focus on every state swap). The scale is
// different — that island exists in a dozen copies down a list, this one is alone on the page —
// but the properties it protects are the same, and a second pattern for one control would be
// worse than a slightly over-engineered first one.
//
// Why the reload rather than a client-side state swap: everything this action changes is
// computed in [id].astro's frontmatter — the revoked marker on the header line, and
// RegenerateLinkButton's own `revoked` prop, which decides whether it offers a mint button or a
// refusal. Patching this control alone would leave the panel beside it inviting the owner to
// generate a link the database now refuses.

interface Props {
  periodId: string;
  /** True when the period already carries `revoked_at`. The control renders its own terminal
   *  state rather than making the caller branch — the same shape RegenerateLinkButton uses, so
   *  the two agree about what a revoked trip looks like. */
  revoked?: boolean;
}

export default function RevokePeriodButton({ periodId, revoked = false }: Props) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Arming SWAPS the button for two different ones, and disarming swaps them back — React
  // unmounts the focused element both times and focus falls to <body>. Moving focus is also
  // what ANNOUNCES the state change: there is no live region here, so without it the confirm
  // appears silently to a screen-reader user.
  const idleRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Skips the initial mount, so this island does not steal focus from the page as it hydrates.
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    (armed ? confirmRef : idleRef).current?.focus();
  }, [armed]);

  async function revoke() {
    setError(null);
    setPending(true);
    try {
      // No headers, no body. This is a security property, not a style choice: Astro's origin
      // middleware only checks the origin of a non-safe method that carries NO Content-Type,
      // and that check is the sole CSRF control on this endpoint. Adding either would drop the
      // request into the no-check branch. Pinned by tests/component/revoke-period-button.test.tsx.
      const res = await fetch(`/api/periods/${periodId}/revoke`, { method: "POST" });

      if (res.status === 401) {
        window.location.href = "/auth/signin";
        return;
      }
      if (res.ok) {
        window.location.reload();
        return;
      }
      // 404 is the interesting one and gets its own sentence: it means the trip is already
      // revoked — another tab, or this page has simply been open a while. Telling the owner to
      // refresh is actionable; "spróbuj ponownie" would send them into a loop against a request
      // that can never now succeed, and revocation has no second attempt to make.
      setError(
        res.status === 404
          ? "Ten wyjazd jest już odwołany. Odśwież stronę, żeby zobaczyć aktualny stan."
          : "Nie udało się odwołać wyjazdu. Spróbuj ponownie.",
      );
    } catch {
      setError("Błąd połączenia. Sprawdź sieć i spróbuj ponownie.");
    } finally {
      // Deliberately NOT disarming here. On failure the confirm stays armed so a retry is one
      // tap, and on success the reload replaces the page before this runs.
      setPending(false);
    }
  }

  if (revoked) {
    // Deliberately NOT a second card (impl-review). A revoked period already states the fact
    // twice above this point — the header line's "· link został unieważniony" and
    // RegenerateLinkButton's refusal, which explains why no new link can be minted. A third
    // muted box repeating it in a third vocabulary ("odwołany" vs "unieważniony") is what the
    // review found under the single "Link dla opiekuna" heading.
    //
    // So this keeps only what ONLY this control knows: that it cannot be undone, and what the
    // caretaker sees. One line, and it uses the page's verb.
    return (
      <p className="text-muted-foreground text-[13px]">
        Tego nie da się cofnąć. Opiekun, który zajął termin, zobaczy na stronie, że wyjazd został odwołany.
      </p>
    );
  }

  if (!armed) {
    return (
      <div className="space-y-3">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          ref={idleRef}
          onClick={() => {
            setArmed(true);
          }}
        >
          Odwołaj wyjazd
        </Button>
        <p className="text-muted-foreground text-[13px]">
          Link zostanie unieważniony na zawsze — tego nie da się cofnąć. Zajęte terminy zostają zapisane, ale
          opiekunowie stracą dostęp do wskazówek.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* THE ESCAPE COMES FIRST, and that ordering is the safety property (impl-review 2b).
          Both buttons are `w-full`, so whichever one is rendered first occupies exactly the
          rectangle the idle "Odwołaj wyjazd" button just occupied. The first draft put the
          destructive confirm there, which meant a fast double-tap at one point armed and then
          confirmed — on the product's only irreversible action, and on a phone, where that is
          not a hypothetical. Putting "Nie odwołuj" in that slot inverts it: a stray second tap
          lands on the way out.

          So the two taps differ in BOTH text and position, which is what the plan asked for and
          what ReleaseSlotButton gets for free by being a small control whose confirm changes
          width. Pinned by document order in tests/component/revoke-period-button.test.tsx —
          these are stacked in a flex column, so DOM order is visual order. */}
      <div className="flex min-w-0 flex-col gap-2">
        {/* An explicit way out, not just "tap elsewhere": the armed state has no backdrop to
            dismiss, and on a touch screen there is no hover to reveal one. */}
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          disabled={pending}
          aria-label="Nie odwołuj wyjazdu"
          onClick={() => {
            setArmed(false);
            setError(null);
          }}
        >
          Nie odwołuj
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="w-full"
          disabled={pending}
          ref={confirmRef}
          aria-busy={pending}
          // NO aria-label, deliberately — and this is the fix for impl-review 2a rather than an
          // omission. WCAG 2.5.3 requires the accessible name to CONTAIN the visible label. The
          // first draft paired the visible "Na pewno? Odwołaj na zawsze" with the label "Na
          // pewno? Potwierdź odwołanie wyjazdu", which shares only the first two words — a
          // voice-control user saying what they can see could not activate it at all.
          //
          // ReleaseSlotButton needs a label because a dozen identical confirms sit down one
          // page and "Na pewno?" alone would read the same for all of them. This control is
          // alone on its page, so the visible text IS the best accessible name: it satisfies
          // 2.5.3 by construction, and it tracks `pending` on its own — no label to fall out of
          // sync when the button starts reading "Odwoływanie...".
          onClick={revoke}
        >
          {pending ? "Odwoływanie..." : "Na pewno? Odwołaj na zawsze"}
        </Button>
      </div>
      <ServerError message={error} />
    </div>
  );
}
