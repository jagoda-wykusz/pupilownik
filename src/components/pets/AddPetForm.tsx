import { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { ServerError } from "@/components/auth/ServerError";
import { cn } from "@/lib/utils";
import { MAX_INSTRUCTIONS_PER_PET, SPECIES_OPTIONS, type Species } from "@/lib/pet-format";

// Add-pet React island (client:load). Local state with client-side validation for UX, but the
// server (/api/pets -> zod) is the source of truth. Submits JSON (nested instructions) and, on
// 201, navigates to the owner's pet list. Species is a segmented control; instructions are a
// dynamic add/remove list with a public/sensitive toggle.
//
// GROUND: this form is on the token palette and uses ui/Input, ui/Textarea and ui/button, the
// same primitives as EditPetForm and NewPeriodForm. It used to render raw inputs with the
// starter's hardcoded white-on-navy colours, which only worked on `bg-cosmic` — that ground is
// gone from /pets and /pets/new, so the form retired onto tokens with it.
//
// It stays a SEPARATE component from EditPetForm. The two differ where it matters: an empty
// instruction row is silently dropped here (the form seeds one blank row) and is an error
// there (a visible row must not disappear without saying so), and rows here are keyed by index
// because they are only ever appended.

interface InstructionRow {
  title: string;
  body: string;
  is_sensitive: boolean;
}

function emptyInstruction(): InstructionRow {
  return { title: "", body: "", is_sensitive: false };
}

export default function AddPetForm() {
  const [name, setName] = useState("");
  const [species, setSpecies] = useState<Species>("dog");
  const [breed, setBreed] = useState("");
  const [age, setAge] = useState("");
  const [instructions, setInstructions] = useState<InstructionRow[]>([emptyInstruction()]);
  const [errors, setErrors] = useState<{ name?: string; instructions?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function updateInstruction(index: number, patch: Partial<InstructionRow>) {
    setInstructions((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addInstruction() {
    setInstructions((prev) => [...prev, emptyInstruction()]);
  }

  function removeInstruction(index: number) {
    setInstructions((prev) => prev.filter((_, i) => i !== index));
  }

  function validate() {
    const next: typeof errors = {};
    if (!name.trim()) {
      next.name = "Imię zwierzęcia jest wymagane";
    }
    // Each filled instruction needs a title; empty rows are dropped on submit.
    if (instructions.some((row) => (row.body.trim() || row.is_sensitive) && !row.title.trim())) {
      next.instructions = "Każda instrukcja musi mieć tytuł";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);
    if (!validate()) {
      return;
    }

    const payload = {
      name: name.trim(),
      species,
      breed: breed.trim() || undefined,
      age: age.trim() || undefined,
      instructions: instructions
        .filter((row) => row.title.trim())
        .map((row, i) => ({
          title: row.title.trim(),
          body: row.body.trim() || undefined,
          is_sensitive: row.is_sensitive,
          sort_order: i,
        })),
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/pets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 201) {
        window.location.href = "/pets";
        return;
      }
      if (res.status === 400) {
        setServerError("Dane są niepoprawne — sprawdź pola i spróbuj ponownie.");
      } else if (res.status === 401) {
        window.location.href = "/auth/signin";
        return;
      } else {
        setServerError("Nie udało się zapisać zwierzęcia. Spróbuj ponownie.");
      }
    } catch {
      setServerError("Błąd połączenia. Sprawdź sieć i spróbuj ponownie.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate>
      <Input
        label="Imię"
        name="name"
        value={name}
        onChange={(value) => {
          setName(value);
          if (errors.name) {
            setErrors((prev) => ({ ...prev, name: undefined }));
          }
        }}
        placeholder="np. Burek"
        error={errors.name}
        disabled={submitting}
      />

      <div>
        <span className="text-muted-foreground mb-1.5 ml-1 block text-xs font-bold tracking-wide">Gatunek</span>
        {/* role="group" + aria-label: the buttons are a single control, and without the
            grouping a screen reader announces three unrelated toggles. */}
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Gatunek">
          {SPECIES_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={submitting}
              onClick={() => {
                setSpecies(option.value);
              }}
              aria-pressed={species === option.value}
              className={cn(
                "rounded-lg border-[1.5px] px-3 py-2 text-[15px] transition-colors disabled:opacity-60",
                species === option.value
                  ? "border-primary bg-primary text-primary-foreground font-bold"
                  : "border-border bg-card text-foreground hover:bg-accent",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Rasa"
          name="breed"
          value={breed}
          onChange={setBreed}
          placeholder="np. labrador"
          disabled={submitting}
        />
        <Input label="Wiek" name="age" value={age} onChange={setAge} placeholder="np. 4 lata" disabled={submitting} />
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-heading text-foreground text-[17px] font-bold">Instrukcje opieki</h2>
          <span className="text-muted-foreground text-[13px]">
            {instructions.length}/{MAX_INSTRUCTIONS_PER_PET}
          </span>
        </div>

        {errors.instructions && (
          <p role="alert" className="text-destructive mb-2 text-[13px]">
            {errors.instructions}
          </p>
        )}

        <ul className="space-y-4">
          {instructions.map((row, index) => (
            // Keyed by index: rows are only ever appended on a create form. EditPetForm
            // carries a stable per-row key because its rows are reordered and removed.
            <li key={index} className="border-border bg-card space-y-3 rounded-lg border-[1.5px] p-4">
              <Input
                label="Tytuł"
                value={row.title}
                onChange={(value) => {
                  updateInstruction(index, { title: value });
                  if (errors.instructions) {
                    setErrors((prev) => ({ ...prev, instructions: undefined }));
                  }
                }}
                placeholder="np. Karmienie"
                disabled={submitting}
              />
              <Textarea
                label="Treść"
                rows={2}
                value={row.body}
                onChange={(value) => {
                  updateInstruction(index, { body: value });
                }}
                placeholder="Szczegóły (opcjonalnie)"
              />
              <div className="flex items-center justify-between gap-3">
                <label className="text-foreground flex items-center gap-2 text-[14px]">
                  <input
                    type="checkbox"
                    className="accent-primary size-4"
                    checked={row.is_sensitive}
                    disabled={submitting}
                    onChange={(e) => {
                      updateInstruction(index, { is_sensitive: e.target.checked });
                    }}
                  />
                  Wrażliwa — widoczna dopiero po zajęciu terminu
                </label>
                {instructions.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={submitting}
                    aria-label={`Usuń instrukcję: ${row.title.trim() || "bez tytułu"}`}
                    onClick={() => {
                      removeInstruction(index);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>

        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full"
          disabled={submitting || instructions.length >= MAX_INSTRUCTIONS_PER_PET}
          onClick={addInstruction}
        >
          <Plus className="size-4" />
          Dodaj instrukcję
        </Button>
      </div>

      <ServerError message={serverError} />

      <Button type="submit" className="w-full" disabled={submitting} aria-busy={submitting}>
        <Save className="size-4" />
        {submitting ? "Zapisywanie..." : "Zapisz zwierzę"}
      </Button>
    </form>
  );
}
