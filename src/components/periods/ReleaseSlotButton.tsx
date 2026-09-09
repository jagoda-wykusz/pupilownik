import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ServerError } from "@/components/auth/ServerError";

// The owner's per-term release control. Modelled on RegenerateLinkButton — own `pending` flag,
// ServerError, full reload on success because this page is server-rendered.
//
// Why the reload rather than a client-side state swap, same as ClaimSlots: everything this
// action changes is computed in [id].astro's frontmatter — the taken/free grid, the caretaker
// count, and the collision ordinals, which are per-period and can shift for OTHER rows when one
// term is freed (a caretaker who drops to zero terms stops colliding, so someone else's
// "Ania (2)" becomes "Ania"). Patching this one row would leave the rest of the page lying.

interface Props {
  periodId: string;
  slotId: string;
  /**
   * The already-grouped, already-normalized label for the caretaker holding this term — used
   * only to name the button for assistive tech, since a page can carry a dozen of these and
   * "Zwolnij" alone would read identically for all of them.
   *
   * NOT the raw column, and never the digest. Astro serializes island props into the HTML, so
   * whatever arrives here is disclosed; `CaretakerLabel` has no digest field precisely so that
   * a mistake here is a type error. See src/lib/caretaker-name.ts.
   */
  caretakerLabel: string;
  /** The term itself, e.g. "Rano, 13 lipca" — the other half of the accessible name. */
  termLabel: string;
}

export default function ReleaseSlotButton({ periodId, slotId, caretakerLabel, termLabel }: Props) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Arming SWAPS the button for two different ones, and disarming swaps them back — React
  // unmounts the focused element both times and focus falls to <body>. On a page that can carry
  // one of these per claimed term, that strands a keyboard or screen-reader user who then has to
  // re-traverse the whole list to find the confirmation they just opened. Moving focus is also
  // what ANNOUNCES the state change: there is no live region here, so without it the confirm
  // appears silently.
  const idleRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Skips the initial mount. Without this every island on the page would grab focus as it
  // hydrates, and the last one to finish would win.
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    (armed ? confirmRef : idleRef).current?.focus();
  }, [armed]);

  async function release() {
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/periods/${periodId}/slots/${slotId}/release`, { method: "POST" });

      if (res.status === 401) {
        window.location.href = "/auth/signin";
        return;
      }
      if (res.ok) {
        window.location.reload();
        return;
      }
      // 404 is the interesting one and gets its own sentence: it means the term is no longer
      // claimed — someone else's release, or this page has simply been open a while. Telling
      // the owner to refresh is actionable; "spróbuj ponownie" would send them into a loop
      // against a request that can never now succeed.
      setError(
        res.status === 404
          ? "Ten termin nie jest już zajęty. Odśwież stronę, żeby zobaczyć aktualną obsadę."
          : "Nie udało się zwolnić terminu. Spróbuj ponownie.",
      );
    } catch {
      setError("Błąd połączenia. Sprawdź sieć i spróbuj ponownie.");
    } finally {
      // Deliberately NOT disarming here. On failure the confirm stays armed so a retry is one
      // tap, and on success the reload replaces the page before this runs.
      setPending(false);
    }
  }

  if (!armed) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0 px-2"
        ref={idleRef}
        aria-label={`Zwolnij termin: ${termLabel}, ${caretakerLabel}`}
        onClick={() => {
          setArmed(true);
        }}
      >
        Zwolnij
      </Button>
    );
  }

  return (
    // min-w-0, NOT shrink-0, and the distinction is the whole fix. The parent row is
    // flex-wrap, so this control drops to its own line as soon as it stops fitting beside the
    // name — but a shrink-0 item on that new line is still sized at max-content, and
    // ServerError has no width cap, so the 76-character 404 sentence laid out on one line and
    // ran ~300px off the card at 320px width. min-w-0 lets this column take the line's width
    // so the message wraps inside it. The button row below keeps its OWN shrink-0, which is
    // what stops the two buttons breaking apart.
    <span className="flex min-w-0 flex-col items-end gap-1">
      <span className="flex shrink-0 items-center gap-1">
        {/* "Na pewno?" IS the confirm. Two taps, and the second one is a different word in a
            different place than the first, so a double-tap on "Zwolnij" cannot release a term
            by itself — which matters on a phone, where these rows are close together and the
            action has no undo. */}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="shrink-0"
          disabled={pending}
          ref={confirmRef}
          aria-busy={pending}
          // The accessible name STARTS with the visible text, which WCAG 2.5.3 requires: a
          // voice-control user says what they can see ("Na pewno"), and a label that does not
          // contain it leaves them unable to activate the button at all. The rest of the name
          // is what makes a dozen otherwise-identical confirms distinguishable to a screen
          // reader. It tracks `pending` for the same reason — aria-label overrides the visible
          // text, so a static one would keep saying "Na pewno?" while the button reads
          // "Zwalnianie...".
          aria-label={
            pending
              ? `Zwalnianie terminu: ${termLabel}, ${caretakerLabel}`
              : `Na pewno? Potwierdź zwolnienie terminu: ${termLabel}, ${caretakerLabel}`
          }
          onClick={release}
        >
          {pending ? "Zwalnianie..." : "Na pewno?"}
        </Button>
        {/* An explicit way out, not just "tap elsewhere": the armed state has no backdrop to
            dismiss, and on a touch screen there is no hover to reveal one. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 px-2"
          disabled={pending}
          aria-label={`Nie zwalniaj terminu: ${termLabel}, ${caretakerLabel}`}
          onClick={() => {
            setArmed(false);
            setError(null);
          }}
        >
          Nie
        </Button>
      </span>
      <ServerError message={error} />
    </span>
  );
}
