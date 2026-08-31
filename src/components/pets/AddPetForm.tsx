import { useState } from "react";
import { PawPrint, Tag, Cake, Plus, Trash2, Save, ShieldAlert } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Add-pet React island (client:load). Mirrors SignInForm's approach: local state
// with client-side validation for UX, but the server (/api/pets → zod) is the
// source of truth. Submits JSON (nested instructions) and, on 201, navigates to
// the owner's pet list. Species is a segmented control; instructions are a
// dynamic add/remove list with a public/sensitive toggle.

type Species = "dog" | "cat" | "other";

const SPECIES: { value: Species; label: string }[] = [
  { value: "dog", label: "Pies" },
  { value: "cat", label: "Kot" },
  { value: "other", label: "Inne" },
];

interface InstructionRow {
  title: string;
  body: string;
  is_sensitive: boolean;
}

const textareaBase =
  "w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-400 transition-colors";

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
      <FormField
        id="name"
        label="Imię"
        value={name}
        onChange={(v) => {
          setName(v);
          if (errors.name) {
            setErrors((prev) => ({ ...prev, name: undefined }));
          }
        }}
        placeholder="np. Burek"
        error={errors.name}
        icon={<PawPrint className="size-4" />}
      />

      <div>
        <span className="mb-1 block text-sm text-blue-100/80">Gatunek</span>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Gatunek">
          {SPECIES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => {
                setSpecies(s.value);
              }}
              aria-pressed={species === s.value}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm transition-colors",
                species === s.value
                  ? "border-purple-400 bg-purple-600 text-white"
                  : "border-white/20 bg-white/10 text-blue-100/80 hover:bg-white/20",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField
          id="breed"
          label="Rasa"
          value={breed}
          onChange={setBreed}
          placeholder="np. labrador"
          icon={<Tag className="size-4" />}
        />
        <FormField
          id="age"
          label="Wiek"
          value={age}
          onChange={setAge}
          placeholder="np. 4 lata"
          icon={<Cake className="size-4" />}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-blue-100/80">Instrukcje opieki</span>
          <button
            type="button"
            onClick={addInstruction}
            className="flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-xs text-blue-100/80 transition-colors hover:bg-white/20"
          >
            <Plus className="size-3" />
            Dodaj
          </button>
        </div>

        {errors.instructions ? <p className="text-xs text-red-300">{errors.instructions}</p> : null}

        {instructions.map((row, index) => (
          <div key={index} className="space-y-2 rounded-lg border border-white/15 bg-white/5 p-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={row.title}
                onChange={(e) => {
                  updateInstruction(index, { title: e.target.value });
                  if (errors.instructions) {
                    setErrors((prev) => ({ ...prev, instructions: undefined }));
                  }
                }}
                placeholder="Tytuł, np. Karmienie"
                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
              />
              {instructions.length > 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    removeInstruction(index);
                  }}
                  aria-label="Usuń instrukcję"
                  className="shrink-0 rounded-lg border border-white/20 p-2 text-red-300 transition-colors hover:bg-red-900/30"
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </div>
            <textarea
              value={row.body}
              onChange={(e) => {
                updateInstruction(index, { body: e.target.value });
              }}
              placeholder="Szczegóły (opcjonalnie)"
              rows={2}
              className={textareaBase}
            />
            <label className="flex items-center gap-2 text-sm text-blue-100/70">
              <input
                type="checkbox"
                checked={row.is_sensitive}
                onChange={(e) => {
                  updateInstruction(index, { is_sensitive: e.target.checked });
                }}
                className="size-4 accent-purple-500"
              />
              <ShieldAlert className="size-4 text-amber-300" />
              Wrażliwe (widoczne dopiero po przejęciu opieki)
            </label>
          </div>
        ))}
      </div>

      <ServerError message={serverError} />

      <Button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
      >
        {submitting ? (
          <span className="flex items-center gap-2">
            <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Zapisywanie...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <Save className="size-4" />
            Zapisz zwierzę
          </span>
        )}
      </Button>
    </form>
  );
}
