import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/button";
import { ServerError } from "@/components/auth/ServerError";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { InviteLinkPanel } from "@/components/periods/InviteLinkPanel";
import { countDays, MAX_SPAN_DAYS } from "@/lib/period-format";

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

interface Props {
  /** Absolute origin, so the minted link is pasteable. See InviteLinkPanel. */
  origin: string;
}

export default function NewPeriodForm({ origin }: Props) {
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [errors, setErrors] = useState<{ title?: string; start_date?: string; end_date?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  function validate() {
    const next: typeof errors = {};
    if (!title.trim()) {
      next.title = "Nazwa wyjazdu jest wymagana";
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

    try {
      const res = await fetch("/api/periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), start_date: startDate, end_date: endDate }),
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
        setServerError("Dane są niepoprawne — sprawdź pola i spróbuj ponownie.");
      } else {
        setServerError("Nie udało się utworzyć wyjazdu. Spróbuj ponownie.");
      }
    } catch {
      setServerError("Błąd połączenia. Sprawdź sieć i spróbuj ponownie.");
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

      <SubmitButton pendingText="Tworzenie...">Utwórz wyjazd i link</SubmitButton>
    </form>
  );
}
