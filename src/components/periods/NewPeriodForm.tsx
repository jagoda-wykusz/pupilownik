import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/Chip";
import { Textarea } from "@/components/ui/Textarea";
import { ServerError } from "@/components/auth/ServerError";
import { InviteLinkPanel } from "@/components/periods/InviteLinkPanel";
import { countDays, MAX_NOTE_LENGTH, MAX_SPAN_DAYS, MAX_TITLE_LENGTH } from "@/lib/period-format";

// Create-period island (client:load). Mirrors SignInForm's shape — local state,
// client-side validation for UX only — on the S-07 component layer, not the
// superseded FormField that AddPetForm still imports.
//
// On success the form is replaced by the invite panel rather than navigating away:
// the raw token lives only in that response, and carrying it through a redirect would
// mean putting it in the URL (history, Referer, access logs) or in browser storage.
// The design's "Nowy wyjazd + link" screen shows the link here too.

interface Created {
  periodId: string;
  title: string;
  token: string;
}

export interface PetOption {
  id: string;
  name: string;
}

interface Props {
  /** Absolute origin, so the minted link is pasteable. See InviteLinkPanel. */
  origin: string;
  /** The owner's pets, SSR-supplied. A trip must cover at least one (S-08), and the
   *  server enforces it — this control exists so the owner chooses rather than the app
   *  guessing on their behalf. */
  pets: PetOption[];
}

export default function NewPeriodForm({ origin, pets }: Props) {
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [petIds, setPetIds] = useState<string[]>(pets.length === 1 ? [pets[0].id] : []);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{
    title?: string;
    start_date?: string;
    end_date?: string;
    pet_ids?: string;
    caretaker_note?: string;
  }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  // Own state rather than SubmitButton's useFormStatus: that hook only reports for a
  // React form action or a native submit, and this form preventDefaults and fetches.
  // Without it the button is never disabled, and a double click mints two periods —
  // the first one keeping a live link its owner never saw and cannot revoke.
  const [submitting, setSubmitting] = useState(false);

  function validate() {
    const next: typeof errors = {};
    if (!title.trim()) {
      next.title = "Nazwa wyjazdu jest wymagana";
    } else if (title.trim().length > MAX_TITLE_LENGTH) {
      next.title = `Nazwa może mieć najwyżej ${MAX_TITLE_LENGTH} znaków`;
    }
    if (petIds.length === 0) {
      next.pet_ids = "Wybierz co najmniej jedno zwierzę";
    }
    if (note.trim().length > MAX_NOTE_LENGTH) {
      next.caretaker_note = `Notatka może mieć najwyżej ${MAX_NOTE_LENGTH} znaków`;
    }
    if (!startDate) {
      next.start_date = "Podaj datę rozpoczęcia";
    }
    if (!endDate) {
      next.end_date = "Podaj datę zakończenia";
    } else if (startDate && Date.parse(endDate) < Date.parse(startDate)) {
      next.end_date = "Data zakończenia nie może być wcześniejsza niż data rozpoczęcia";
    } else if (startDate && countDays(startDate, endDate) > MAX_SPAN_DAYS) {
      next.end_date = `Wyjazd może trwać najwyżej ${MAX_SPAN_DAYS} dni`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);
    if (!validate()) {
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          start_date: startDate,
          end_date: endDate,
          pet_ids: petIds,
          caretaker_note: note.trim(),
        }),
      });

      if (res.status === 401) {
        window.location.href = "/auth/signin";
        return;
      }
      if (res.status === 201) {
        const body = (await res.json()) as { period: { id: string; title: string }; inviteToken: string };
        setCreated({ periodId: body.period.id, title: body.period.title, token: body.inviteToken });
        return;
      }
      if (res.status === 400) {
        // Show what the server actually said. It knows things the client cannot — most of
        // all whether a chosen pet is really the owner's, which only RLS can answer — and a
        // generic "check the fields" hides exactly that. Every 400 from /api/periods carries
        // a user-facing Polish sentence in `error`.
        const body: unknown = await res.json().catch(() => null);
        // Checked, not cast: a 400 from an intermediary could carry a non-string `error`, and
        // handing an object to ServerError would make React throw on an invalid child.
        const message =
          typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
            ? body.error
            : "Dane są niepoprawne — sprawdź pola i spróbuj ponownie.";
        setServerError(message);
      } else {
        setServerError("Nie udało się utworzyć wyjazdu. Spróbuj ponownie.");
      }
    } catch {
      setServerError("Błąd połączenia. Sprawdź sieć i spróbuj ponownie.");
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="space-y-5">
        <p className="text-foreground text-[15px]">
          Wyjazd <strong>{created.title}</strong> został utworzony wraz z terminami do zajęcia.
        </p>

        <InviteLinkPanel token={created.token} origin={origin} />

        <Button asChild variant="outline" className="w-full">
          <a href={`/periods/${created.periodId}`}>Zobacz wyjazd →</a>
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <Input
        id="title"
        name="title"
        label="NAZWA WYJAZDU"
        value={title}
        onChange={(v) => {
          setTitle(v);
          clearError("title");
        }}
        placeholder="Weekend u rodziców"
        error={errors.title}
      />

      <div>
        <p id="pets-label" className="text-muted-foreground mb-1.5 ml-1 text-xs font-bold tracking-wide">
          KTÓRE ZWIERZĘTA
        </p>
        {/* role="group" + aria-labelledby so a screen-reader user hears WHAT is being chosen,
            not just "Burek, toggle button" — the pattern AddPetForm already uses for its
            species control. aria-describedby ties the field error to the group, the way
            ui/Input does for a single field. Row gap is the design's 10px (the chip's own
            8px inner gap is inert here: the chip has one child, since `pets` has no photo
            column). */}
        <div
          role="group"
          aria-labelledby="pets-label"
          aria-describedby={errors.pet_ids ? "pets-error" : undefined}
          className="flex flex-wrap gap-[10px]"
        >
          {pets.map((pet) => (
            <Chip
              key={pet.id}
              selected={petIds.includes(pet.id)}
              onToggle={() => {
                setPetIds((current) =>
                  current.includes(pet.id) ? current.filter((id) => id !== pet.id) : [...current, pet.id],
                );
                clearError("pet_ids");
              }}
            >
              {pet.name}
            </Chip>
          ))}
        </div>
        {errors.pet_ids && (
          // role="alert" is load-bearing: the message appears after a blocked submit, and a
          // screen-reader user needs it announced rather than merely present (ServerError
          // carries the same comment).
          <p id="pets-error" role="alert" className="text-destructive mt-1.5 ml-1 text-[13px]">
            {errors.pet_ids}
          </p>
        )}
      </div>

      {/* The design places NOTATKA directly under KTÓRE ZWIERZĘTA. The hint is not in the
          design, but the field is: an owner typing an address and a key location needs to
          know who ends up reading it, and Phase 3 makes that answer non-obvious (only a
          caretaker who actually took a slot — not every holder of the link). */}
      <Textarea
        id="caretaker_note"
        name="caretaker_note"
        label="NOTATKA"
        hint="Zobaczą ją tylko opiekunowie, którzy zajmą termin."
        value={note}
        onChange={(v) => {
          setNote(v);
          clearError("caretaker_note");
        }}
        placeholder="Klucze u sąsiadki, mieszkanie 4…"
        error={errors.caretaker_note}
      />

      <div className="grid grid-cols-2 gap-3">
        <Input
          id="start_date"
          name="start_date"
          type="date"
          label="OD"
          value={startDate}
          onChange={(v) => {
            setStartDate(v);
            clearError("start_date");
            clearError("end_date");
          }}
          error={errors.start_date}
        />
        <Input
          id="end_date"
          name="end_date"
          type="date"
          label="DO"
          value={endDate}
          onChange={(v) => {
            setEndDate(v);
            clearError("end_date");
          }}
          error={errors.end_date}
        />
      </div>

      <p className="text-muted-foreground text-[13px]">
        Dla każdego dnia powstaną trzy terminy: rano, popołudnie i wieczór. Wyjazd może trwać najwyżej {MAX_SPAN_DAYS}{" "}
        dni.
      </p>

      <ServerError message={serverError} />

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? (
          <span className="flex items-center gap-2">
            <span className="size-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
            Tworzenie...
          </span>
        ) : (
          "Utwórz wyjazd i link"
        )}
      </Button>
    </form>
  );
}
