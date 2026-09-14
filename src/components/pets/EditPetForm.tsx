import { useRef, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { ServerError } from "@/components/auth/ServerError";
import { cn } from "@/lib/utils";
import {
  MAX_INSTRUCTION_BODY_LENGTH,
  MAX_INSTRUCTION_TITLE_LENGTH,
  MAX_INSTRUCTIONS_PER_PET,
  MAX_PET_NAME_LENGTH,
  SPECIES_OPTIONS,
  type Species,
} from "@/lib/pet-format";

// The owner's edit form for one pet and its care instructions.
//
// A NEW component rather than a mode flag on AddPetForm. The two now share a ground and the
// same primitives (ui/Input, ui/Textarea, ui/button), but they still differ where it matters:
// an empty instruction row is silently dropped on the create form and is an ERROR here (see
// validate), and rows here carry a stable key because they are reordered and removed. Merging
// them would mean a mode flag per difference — not one form, but two sharing a bug surface.
//
// The bounds come from pet-format.ts rather than from the zod schema, so validating here does
// not drag zod into the browser bundle — the same reason period-format.ts holds MAX_SPAN_DAYS.

interface InstructionProp {
  id: string;
  title: string;
  body: string | null;
  is_sensitive: boolean;
}

interface Props {
  petId: string;
  name: string;
  species: Species;
  breed: string | null;
  age: string | null;
  /** The pet's `updated_at` as the page rendered it — the optimistic-concurrency token
   *  (impl-review F4). Echoed back verbatim on save and compared by the RPC against the locked
   *  row, so a form loaded before somebody else's save is refused rather than applied. Held in
   *  a prop and never in state: it describes the snapshot this form was built from, and a value
   *  that updated itself would defeat the check. After a successful save the page reloads and a
   *  fresh one arrives. */
  updatedAt: string;
  instructions: InstructionProp[];
}

/** A row in the editor. `id` is present for a row that exists in the database and absent for
 *  one the owner just added — that distinction is the whole contract with the update RPC:
 *  id present -> update that row, absent -> insert, stored row not named here -> delete.
 *
 *  `key` is separate from `id` and exists for React alone. AddPetForm keys its rows by array
 *  index, which is mostly latent on a create form where rows are only appended; on an edit
 *  form, where rows arrive populated and get removed and reordered, index keys hand one row's
 *  DOM state to its neighbour. A stable per-row key is the fix. */
interface Row {
  key: string;
  id?: string;
  title: string;
  body: string;
  is_sensitive: boolean;
}

interface Errors {
  name?: string;
  instructions?: string;
}

export default function EditPetForm({ petId, name, species, breed, age, updatedAt, instructions }: Props) {
  const [petName, setPetName] = useState(name);
  const [petSpecies, setPetSpecies] = useState<Species>(species);
  const [petBreed, setPetBreed] = useState(breed ?? "");
  const [petAge, setPetAge] = useState(age ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    instructions.map((instruction) => ({
      key: instruction.id,
      id: instruction.id,
      title: instruction.title,
      body: instruction.body ?? "",
      is_sensitive: instruction.is_sensitive,
    })),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // A counter rather than crypto.randomUUID(): this value never leaves the browser and never
  // reaches the database, so uniqueness within one mounted form is the entire requirement.
  const nextKey = useRef(0);

  function clearError(field: keyof Errors) {
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    clearError("instructions");
  }

  function addRow() {
    nextKey.current += 1;
    setRows((prev) => [...prev, { key: `new-${nextKey.current}`, title: "", body: "", is_sensitive: false }]);
    clearError("instructions");
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((row) => row.key !== key));
    clearError("instructions");
  }

  function validate(): boolean {
    const next: Errors = {};
    if (petName.trim().length === 0) {
      next.name = "Imię zwierzęcia jest wymagane";
    } else if (petName.trim().length > MAX_PET_NAME_LENGTH) {
      next.name = `Imię może mieć najwyżej ${MAX_PET_NAME_LENGTH} znaków`;
    }
    // An empty title is an ERROR here, not a silently dropped row. AddPetForm filters empty
    // rows out at submit time, which is reasonable on a create form seeded with one blank row.
    // On an edit form, dropping a row the owner can see would delete data without saying so —
    // removal has its own button, and it should be the only way a row disappears.
    if (rows.some((row) => row.title.trim().length === 0)) {
      next.instructions = "Każda instrukcja musi mieć tytuł. Usuń pustą albo ją wypełnij.";
    } else if (rows.length > MAX_INSTRUCTIONS_PER_PET) {
      next.instructions = `Zwierzę może mieć najwyżej ${MAX_INSTRUCTIONS_PER_PET} instrukcji`;
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

    setSubmitting(true);
    try {
      const res = await fetch(`/api/pets/${petId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: petName.trim(),
          species: petSpecies,
          expected_updated_at: updatedAt,
          breed: petBreed.trim() || undefined,
          age: petAge.trim() || undefined,
          // Order is meaningful: the RPC writes sort_order from array position. `id` is passed
          // through untouched for stored rows and omitted for new ones.
          instructions: rows.map((row) => ({
            ...(row.id === undefined ? {} : { id: row.id }),
            title: row.title.trim(),
            body: row.body.trim() || undefined,
            is_sensitive: row.is_sensitive,
          })),
        }),
      });

      if (res.status === 401) {
        window.location.href = "/auth/signin";
        return;
      }
      if (res.ok) {
        // A full reload rather than patching local state. Everything this save changes is
        // computed in the page's frontmatter — the heading, the species line, and the order
        // the rows come back in — so patching this form alone would leave the page around it
        // showing the pet's previous name.
        window.location.reload();
        return;
      }
      if (res.status === 400 || res.status === 409) {
        // Show what the server actually said. It knows two things the client cannot: whether a
        // live claimed trip freezes the sensitive flag, and whether this form was loaded before
        // somebody else's save landed. A generic "check the fields" hides both, and neither has
        // the same remedy.
        //
        // CORRECTED by S-09's impl-review (F9): this comment used to claim the server also
        // reports "whether an instruction id is really this pet's". It does not — an id naming
        // another of the owner's pets is silently ignored, which tests/rls/update-pet.test.ts
        // pins with `expect(error).toBeNull()`. The conclusion was right and its stated reason
        // was fiction; a reader would have gone looking for a message that never arrives.
        const body: unknown = await res.json().catch(() => null);
        // Checked, not cast: a response from an intermediary could carry a non-string `error`,
        // and handing an object to ServerError would make React throw on an invalid child.
        const message =
          typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
            ? body.error
            : "Nie udało się zapisać zmian. Sprawdź pola i spróbuj ponownie.";
        setServerError(message);
      } else if (res.status === 404) {
        // Terminal, and deliberately NOT "spróbuj ponownie": the pet is gone — deleted in
        // another tab, or this page has simply been open a while — so a retry can never now
        // succeed and would send the owner into a loop.
        setServerError("Tego zwierzęcia już nie ma. Odśwież stronę, żeby zobaczyć aktualny stan.");
      } else {
        setServerError("Nie udało się zapisać zmian. Spróbuj ponownie.");
      }
    } catch {
      setServerError("Błąd połączenia. Sprawdź sieć i spróbuj ponownie.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
      <Input
        label="Imię"
        name="name"
        value={petName}
        onChange={(value) => {
          setPetName(value);
          clearError("name");
        }}
        error={errors.name}
        disabled={submitting}
      />

      <div>
        <span className="text-muted-foreground mb-1.5 block text-[12px] font-bold tracking-[0.08em] uppercase">
          Gatunek
        </span>
        {/* role="group" + aria-label, the shape AddPetForm established and NewPeriodForm
            copied forward: the buttons are a single control, and without the grouping a
            screen reader announces three unrelated toggles. */}
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Gatunek">
          {SPECIES_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={submitting}
              onClick={() => {
                setPetSpecies(option.value);
              }}
              aria-pressed={petSpecies === option.value}
              className={cn(
                "rounded-lg border-[1.5px] px-3 py-2 text-[15px] transition-colors disabled:opacity-60",
                petSpecies === option.value
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
        <Input label="Rasa" name="breed" value={petBreed} onChange={setPetBreed} disabled={submitting} />
        <Input label="Wiek" name="age" value={petAge} onChange={setPetAge} disabled={submitting} />
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-heading text-foreground text-[17px] font-bold">Instrukcje opieki</h2>
          <span className="text-muted-foreground text-[13px]">
            {rows.length}/{MAX_INSTRUCTIONS_PER_PET}
          </span>
        </div>

        {errors.instructions && (
          <p role="alert" className="text-destructive mb-2 text-[13px]">
            {errors.instructions}
          </p>
        )}

        {rows.length === 0 && (
          <p className="text-muted-foreground border-border bg-card rounded-lg border-[1.5px] p-4 text-[15px]">
            To zwierzę nie ma jeszcze żadnych instrukcji.
          </p>
        )}

        <ul className="space-y-4">
          {rows.map((row) => (
            <li key={row.key} className="border-border bg-card space-y-3 rounded-lg border-[1.5px] p-4">
              <Input
                label="Tytuł"
                value={row.title}
                onChange={(value) => {
                  updateRow(row.key, { title: value });
                }}
                disabled={submitting}
              />
              <Textarea
                label="Treść"
                rows={2}
                value={row.body}
                onChange={(value) => {
                  updateRow(row.key, { body: value });
                }}
                disabled={submitting}
              />
              <div className="flex items-center justify-between gap-3">
                <label className="text-foreground flex items-center gap-2 text-[14px]">
                  <input
                    type="checkbox"
                    className="accent-primary size-4"
                    checked={row.is_sensitive}
                    disabled={submitting}
                    onChange={(e) => {
                      updateRow(row.key, { is_sensitive: e.target.checked });
                    }}
                  />
                  Wrażliwa — widoczna dopiero po zajęciu terminu
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  aria-label={`Usuń instrukcję: ${row.title.trim() || "bez tytułu"}`}
                  onClick={() => {
                    removeRow(row.key);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <p className="text-muted-foreground text-[12px]">
                Maks. {MAX_INSTRUCTION_TITLE_LENGTH} znaków tytułu, {MAX_INSTRUCTION_BODY_LENGTH} treści.
              </p>
            </li>
          ))}
        </ul>

        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full"
          disabled={submitting || rows.length >= MAX_INSTRUCTIONS_PER_PET}
          onClick={addRow}
        >
          <Plus className="size-4" />
          Dodaj instrukcję
        </Button>
      </div>

      <ServerError message={serverError} />

      <Button type="submit" className="w-full" disabled={submitting} aria-busy={submitting}>
        <Save className="size-4" />
        {submitting ? "Zapisywanie..." : "Zapisz zmiany"}
      </Button>
    </form>
  );
}
