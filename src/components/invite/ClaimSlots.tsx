import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServerError } from "@/components/auth/ServerError";
import {
  formatDay,
  formatWeekday,
  MAX_CLAIMANT_NAME_LENGTH,
  TIME_OF_DAY_LABEL,
  type TimeOfDay,
} from "@/lib/period-format";

// The claim island. Modelled on RegenerateLinkButton — own `pending` flag, status-branched
// ServerError, and a "refuse up front" branch — rather than on NewPeriodForm, which is a much
// larger form with its own validation layer.
//
// Deliberately unstyled beyond the tokens the page already uses. The design's month grid,
// success banner and sensitive-data callout are Phase 5; this exists so the flow WORKS on the
// flat day list that Phase 3 left behind, which is the plan's stated cut line.
//
// It does NOT import FormField or PasswordToggle (both superseded), and copies nothing from
// AddPetForm, which hardcodes starter colours.

export interface ClaimSlot {
  id: string;
  slot_date: string;
  time_of_day: TimeOfDay;
  is_claimed: boolean;
}

export interface ClaimDay {
  day: string;
  slots: ClaimSlot[];
}

interface Props {
  /** The serializable day structure the page already builds for its read-only list. */
  byDay: ClaimDay[];
  /** The invite token. It travels in the request BODY, never in the claim route's URL. */
  token: string;
  /** True when this browser already holds slots on this trip: the capability cookie resolved.
   *  The name is then stored server-side and must not be asked for again — `claim_slots`
   *  ignores it anyway and reuses what it has. */
  hasCapability: boolean;
}

export default function ClaimSlots({ byDay, token, hasCapability }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const free = byDay.flatMap((entry) => entry.slots).filter((slot) => !slot.is_claimed);

  function toggle(slotId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(slotId)) {
        next.delete(slotId);
      } else {
        next.add(slotId);
      }
      return next;
    });
  }

  async function submit(event: SubmitEvent | { preventDefault: () => void }) {
    event.preventDefault();
    setError(null);

    // Refuse up front, the way RegenerateLinkButton refuses a revoked period: a request that
    // cannot succeed should not be sent. The server validates both of these again — this is
    // for the caretaker, not for the database.
    if (selected.size === 0) {
      setError("Zaznacz co najmniej jeden termin.");
      return;
    }
    if (!hasCapability && name.trim() === "") {
      setError("Podaj swoje imię, żeby właściciel wiedział, kto przyjdzie.");
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/invite/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          slot_ids: [...selected],
          // Omitted entirely on a follow-up claim: the stored name wins server-side, and
          // sending an empty string would fail the schema's min(1).
          ...(hasCapability ? {} : { name: name.trim() }),
        }),
      });

      if (res.ok) {
        // A full reload rather than a client-side state swap. The revealed tier is rendered
        // SERVER-side from the HttpOnly cookie the response just set — this island cannot read
        // that cookie and must not be handed the sensitive rows to render. Reloading is what
        // makes the reveal happen.
        window.location.reload();
        return;
      }

      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      // 409 and 400 both carry a sentence written for the caretaker — the 409 names the term
      // that was taken. Anything else gets a generic line rather than the server's wording.
      if (res.status === 409 || res.status === 400) {
        setError(body?.error ?? "Nie udało się zapisać. Odśwież stronę i spróbuj ponownie.");
        return;
      }
      if (res.status === 404) {
        setError("Ten link przestał działać. Poproś właściciela o nowy.");
        return;
      }
      setError("Nie udało się zapisać. Spróbuj ponownie za chwilę.");
    } catch {
      setError("Błąd połączenia. Sprawdź sieć i spróbuj ponownie.");
    } finally {
      setPending(false);
    }
  }

  if (free.length === 0) {
    return (
      <p className="border-border bg-card text-muted-foreground rounded-lg border-[1.5px] p-5 text-[13px]">
        Wszystkie terminy tego wyjazdu są już zajęte.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <ul className="space-y-3">
        {byDay.map((entry) => (
          <li key={entry.day} className="border-border bg-card rounded-lg border-[1.5px] p-4">
            <p className="text-foreground text-[15px] font-bold">
              {formatDay(entry.day)}
              <span className="text-muted-foreground ml-2 text-[13px] font-normal">{formatWeekday(entry.day)}</span>
            </p>
            <ul className="mt-3 grid grid-cols-3 gap-2">
              {entry.slots.map((slot) => {
                const isSelected = selected.has(slot.id);
                return (
                  <li key={slot.id}>
                    <button
                      type="button"
                      // A taken slot is not selectable. That is also why claim_slots refusing
                      // an already-held slot does not bite in practice — but the server still
                      // treats a retry as satisfied rather than conflicting, because a lost
                      // response is not a click.
                      disabled={slot.is_claimed || pending}
                      aria-pressed={isSelected}
                      onClick={() => {
                        toggle(slot.id);
                      }}
                      className={[
                        "w-full rounded-lg border-[1.5px] px-3 py-2 text-center text-[13px]",
                        slot.is_claimed
                          ? "border-input text-muted-foreground cursor-not-allowed opacity-60"
                          : isSelected
                            ? "border-primary bg-secondary text-secondary-foreground font-bold"
                            : "border-input text-muted-foreground hover:border-primary",
                      ].join(" ")}
                    >
                      <span className="block">{TIME_OF_DAY_LABEL[slot.time_of_day]}</span>
                      <span className="block text-[12px]">
                        {slot.is_claimed ? "zajęte" : isSelected ? "biorę" : "wolne"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      {!hasCapability && (
        <div>
          <label htmlFor="claimant-name" className="text-foreground block text-[14px] font-semibold">
            Twoje imię
          </label>
          <input
            id="claimant-name"
            type="text"
            value={name}
            maxLength={MAX_CLAIMANT_NAME_LENGTH}
            disabled={pending}
            onChange={(event) => {
              setName(event.target.value);
            }}
            className="border-input bg-background text-foreground mt-1 w-full rounded-lg border-[1.5px] px-3 py-2 text-[15px]"
            placeholder="Ania"
          />
          <p className="text-muted-foreground mt-1 text-[13px]">
            Pytamy tylko raz — przy kolejnych terminach nie trzeba go podawać ponownie.
          </p>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={pending || selected.size === 0}>
        <Check className="size-4" />
        {pending ? "Zapisywanie..." : `Zapisuję się (${selected.size})`}
      </Button>

      <ServerError message={error} />
    </form>
  );
}
