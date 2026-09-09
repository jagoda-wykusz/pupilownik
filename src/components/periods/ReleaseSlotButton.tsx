import { useState } from "react";
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
    // shrink-0 keeps the two buttons on one line; the parent row is flex-wrap, so when an
    // error appears this whole control drops to its own line and the message gets the full
    // width rather than squeezing the caretaker's name.
    <span className="flex shrink-0 flex-col items-end gap-1">
      <span className="flex items-center gap-1">
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
          aria-label={`Potwierdź zwolnienie terminu: ${termLabel}, ${caretakerLabel}`}
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
