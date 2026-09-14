import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ServerError } from "@/components/auth/ServerError";

// The owner's delete control, at the bottom of a pet's own page.
//
// Copied from RevokePeriodButton rather than generalised with it, and the copy is deliberate:
// that island already argues the four load-bearing decisions this one needs (escape rendered
// first, focus moved on every state swap, no Content-Type on the wire, a `finally` that does
// not disarm), and a shared "destructive confirm" component would have to take a verb, a
// consequence sentence, three error sentences and a success behaviour as props — at which
// point it is a template, not a component. Two readable copies beat one parameterised one
// while there are two.
//
// WHAT DIFFERS, and it is the one thing with no precedent in this repo: on success this action
// DESTROYS ITS OWN PAGE. Every other island reloads, because everything they change is computed
// in the page's frontmatter. Reloading here would land on /pets/<id> for a pet that no longer
// exists — a 404 as the reward for a successful delete — so this one navigates to the list.
//
// The 409 is the interesting failure and the reason the whole slice exists: the pet is on a
// live trip, and deleting it would leave a caretaker holding a shift for an animal that is no
// longer on the trip, with the instructions gone and no way to find out. The server's sentence
// names the blocking trip and the remedy, so it is rendered verbatim rather than replaced with
// a generic one.

interface Props {
  petId: string;
  /** Shown in the consequence line, so the owner reads what they are about to remove rather
   *  than a pronoun. Never sent anywhere — the server takes the id from the URL. */
  petName: string;
  /** How many care instructions go with it. Part of the same sentence: the instructions
   *  cascade, and that is the part of the cost an owner is least likely to have in mind. */
  instructionCount: number;
}

export default function DeletePetButton({ petId, petName, instructionCount }: Props) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Arming SWAPS the button for two different ones, and disarming swaps them back — React
  // unmounts the focused element both times and focus falls to <body>. Moving focus is also
  // what ANNOUNCES the state change: there is no live region here, so without it the confirm
  // appears silently to a screen-reader user.
  const idleRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Skips the initial mount, so this island does not steal focus from the page as it hydrates —
  // which matters more here than on the period page: this control sits below a form, and
  // stealing focus on load would drag the owner past every field of it.
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    (armed ? confirmRef : idleRef).current?.focus();
  }, [armed]);

  async function remove() {
    setError(null);
    setPending(true);
    try {
      // No headers, no body. A security property rather than a style choice: Astro's origin
      // middleware only checks the origin of a non-safe method that carries NO Content-Type,
      // and adding either would drop this request into its no-check branch. The route carries
      // its own explicit Origin check too (belt and braces on an irreversible action), but this
      // side of the wire is the only place the request's SHAPE is observable — pinned by
      // tests/component/delete-pet-button.test.tsx.
      const res = await fetch(`/api/pets/${petId}`, { method: "DELETE" });

      if (res.status === 401) {
        window.location.href = "/auth/signin";
        return;
      }
      if (res.ok) {
        // NOT reload: the page this control sits on no longer has a pet to render, so a reload
        // would answer 404. The list is where the owner was going anyway.
        window.location.href = "/pets";
        return;
      }
      if (res.status === 409) {
        // The refusal this slice is built around. The server's sentence names the blocking trip
        // and the way out, and no sentence written here could name the trip — so it is rendered
        // as it arrives, with a defensive fallback for a body that is not the expected shape.
        const body: unknown = await res.json().catch(() => null);
        const message =
          typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
            ? body.error
            : "Nie można usunąć zwierzęcia — obejmuje je aktywny wyjazd. Aby usunąć zwierzę, najpierw odwołaj wyjazd.";
        setError(message);
        return;
      }
      // 404 is terminal and deliberately NOT "spróbuj ponownie": the pet is already gone —
      // another tab, or this page has simply been open a while — so a retry can never succeed
      // and would send the owner into a loop.
      setError(
        res.status === 404
          ? "Tego zwierzęcia już nie ma. Odśwież stronę, żeby zobaczyć aktualny stan."
          : "Nie udało się usunąć zwierzęcia. Spróbuj ponownie.",
      );
    } catch {
      setError("Błąd połączenia. Sprawdź sieć i spróbuj ponownie.");
    } finally {
      // Deliberately NOT disarming here. On failure the confirm stays armed so a retry is one
      // tap, and on success the navigation replaces the page before this matters.
      setPending(false);
    }
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
          Usuń zwierzę
        </Button>
        <p className="text-muted-foreground text-[13px]">
          {instructionCount > 0
            ? `Usuniesz „${petName}" razem z ${instructionCount} instrukcjami opieki. Tego nie da się cofnąć.`
            : `Usuniesz „${petName}". Tego nie da się cofnąć.`}{" "}
          Zwierzę objęte aktywnym wyjazdem trzeba najpierw z niego zwolnić, odwołując ten wyjazd.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* THE ESCAPE COMES FIRST, and that ordering is the safety property (RevokePeriodButton,
          impl-review 2b). Both buttons are `w-full` in a flex column, so whichever renders
          first occupies exactly the rectangle the idle "Usuń zwierzę" button just occupied. Put
          the destructive confirm there instead and a fast double-tap at one point arms and then
          confirms — on a phone, on an action with no undo. Pinned by document order in
          tests/component/delete-pet-button.test.tsx. */}
      <div className="flex min-w-0 flex-col gap-2">
        {/* An explicit way out, not just "tap elsewhere": the armed state has no backdrop to
            dismiss, and on a touch screen there is no hover to reveal one. */}
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          disabled={pending}
          aria-label="Nie usuwaj zwierzęcia"
          onClick={() => {
            setArmed(false);
            setError(null);
          }}
        >
          Nie usuwaj
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="w-full"
          disabled={pending}
          ref={confirmRef}
          aria-busy={pending}
          // NO aria-label, deliberately. WCAG 2.5.3 requires the accessible name to CONTAIN the
          // visible label, and this control is alone on its page — so the visible text IS the
          // best accessible name. It also tracks `pending` on its own, with no label to fall
          // out of sync once the button starts reading "Usuwanie...". (ReleaseSlotButton needs
          // a label precisely because a dozen identical confirms sit down one page.)
          onClick={remove}
        >
          {pending ? "Usuwanie..." : "Na pewno? Usuń bezpowrotnie"}
        </Button>
      </div>
      {/* min-w-0 on the column above so a long server sentence — one naming two trips — wraps
          inside the card instead of stretching it. */}
      <ServerError message={error} />
    </div>
  );
}
