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
    return (
      <p className="border-border bg-card text-muted-foreground rounded-lg border-[1.5px] p-5 text-[13px]">
        Ten wyjazd został odwołany — link nie działa i nie da się go przywrócić. Opiekun, który zajął termin, zobaczy na
        stronie, że wyjazd nie jest już aktualny.
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
          Link przestanie działać na zawsze — tego nie da się cofnąć. Zajęte terminy zostają zapisane, ale opiekunowie
          stracą dostęp do wskazówek.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* "Na pewno?" IS the confirm. Two taps, and the second one is a different word in a
          different place than the first, so a double-tap on "Odwołaj wyjazd" cannot end a trip
          by itself — which matters here more than anywhere else in the product, because this
          action has no undo at all. */}
      <div className="flex min-w-0 flex-col gap-2">
        <Button
          type="button"
          variant="destructive"
          className="w-full"
          disabled={pending}
          ref={confirmRef}
          aria-busy={pending}
          // The accessible name STARTS with the visible text, which WCAG 2.5.3 requires: a
          // voice-control user says what they can see ("Na pewno"), and a label that does not
          // contain it leaves them unable to activate the button at all. It tracks `pending`
          // for the same reason — aria-label overrides the visible text, so a static one would
          // keep saying "Na pewno?" while the button reads "Odwoływanie...".
          aria-label={pending ? "Odwoływanie wyjazdu" : "Na pewno? Potwierdź odwołanie wyjazdu"}
          onClick={revoke}
        >
          {pending ? "Odwoływanie..." : "Na pewno? Odwołaj na zawsze"}
        </Button>
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
      </div>
      <ServerError message={error} />
    </div>
  );
}
