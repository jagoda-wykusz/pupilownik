import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/Input";
import { ServerError } from "@/components/auth/ServerError";
import { PeriodCalendar, type CalendarDay } from "@/components/invite/PeriodCalendar";
import { cn } from "@/lib/utils";
import { formatDay, formatWeekday, MAX_CLAIMANT_NAME_LENGTH, TIME_OF_DAY_LABEL } from "@/lib/period-format";

// The claim island. Modelled on RegenerateLinkButton — own `pending` flag, status-branched
// ServerError, and a "refuse up front" branch — rather than on NewPeriodForm, which is a much
// larger form with its own validation layer.
//
// Phase 5 gives it the design's shape: the month grid (PeriodCalendar) picks a DAY, and the
// slot cards below it are the design's "Rano · 7:30 / WOLNE / Zapisuję się" cards for that one
// day. Two deliberate departures from the artboard, recorded rather than silent:
//
//   1. The design's card button claims ONE slot on tap and never asks for a name. We keep
//      multi-select plus a single submit, because `claim_slots` is all-or-nothing across a
//      selection and the name has to be collected once. The card button therefore TOGGLES
//      selection and the accent submit below carries the count. Scoped to ONE DAY after
//      impl-review F1 — see `selectDay` for why a selection may not outlive the day that
//      renders it.
//   2. The design draws no taken-slot card state. Ours is invented: the pill reads ZAJĘTE and
//      the card is inert. Leaving it out would mean a caretaker on a partly-taken day sees
//      only the free cards and cannot tell the rest exist.
//
// It does NOT import FormField or PasswordToggle (both superseded), and copies nothing from
// AddPetForm, which hardcodes starter colours.

// A superset of PeriodCalendar's CalendarSlot: the grid needs only the time and the taken
// flag, this island also needs the id it posts. Structural assignability is what lets the same
// `byDay` array feed both without a second projection.
export interface ClaimSlot {
  id: string;
  slot_date: string;
  time_of_day: CalendarDay["slots"][number]["time_of_day"];
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

  // Open on the first day that still has something to take, so the caretaker lands on a
  // useful day rather than on a full one they have to navigate away from.
  const [selectedDay, setSelectedDay] = useState<string | null>(() => {
    // `.at(0)` rather than `[0]`: without noUncheckedIndexedAccess an index read is typed
    // non-nullable, and an empty `byDay` is reachable — the "wszystko zajęte" branch below
    // renders after the hooks have already run.
    const opening = byDay.find((entry) => entry.slots.some((slot) => !slot.is_claimed)) ?? byDay.at(0);
    return opening?.day ?? null;
  });

  const day = byDay.find((entry) => entry.day === selectedDay) ?? null;

  // Moving to another day CLEARS the selection, so a claim is always confined to one day.
  // Without this, `selected` outlives the cards that render it: only the selected day's slots
  // are on screen, so a pick left behind on an earlier day is invisible, uncancellable, and —
  // because `claim_slots` is all-or-nothing — able to fail the whole request with a 409 naming
  // a term the caretaker cannot see (impl-review phase 5, F1). Selection stays multi-slot
  // WITHIN a day, which is what keeps the all-or-nothing guarantee worth having.
  function selectDay(next: string) {
    setSelectedDay((current) => {
      if (current !== next) {
        setSelected(new Set());
        setError(null);
      }
      return next;
    });
  }

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
    <form onSubmit={submit} className="space-y-5">
      <div className="border-border bg-card rounded-lg border-[1.5px] p-4">
        <PeriodCalendar days={byDay} selectedDay={selectedDay} onSelect={selectDay} disabled={pending} />
      </div>

      {day && (
        <div>
          <p className="font-heading text-foreground px-0.5 text-[16px] font-bold">
            {formatWeekday(day.day)}, {formatDay(day.day)}
          </p>

          <ul className="mt-2 flex flex-col gap-2.5">
            {day.slots.map((slot) => {
              const isSelected = selected.has(slot.id);
              return (
                <li key={slot.id}>
                  <button
                    type="button"
                    // A taken slot is not selectable. That is also why claim_slots refusing an
                    // already-held slot does not bite in practice — but the server still treats
                    // a retry as satisfied rather than conflicting, because a lost response is
                    // not a click.
                    //
                    // aria-disabled rather than `disabled` for the TAKEN case: `disabled` drops
                    // the button out of the tab order, so a keyboard-only caretaker would never
                    // reach it — which defeats the only reason this state exists (A36: "so a
                    // caretaker on a partly-taken day can tell the rest exist"). Real `disabled`
                    // is kept for `pending`, where the card genuinely should not be reachable.
                    // The onClick guard is what actually refuses the click (impl-review F8).
                    disabled={pending}
                    aria-disabled={slot.is_claimed}
                    aria-pressed={isSelected}
                    onClick={() => {
                      if (slot.is_claimed) {
                        return;
                      }
                      toggle(slot.id);
                    }}
                    className={cn(
                      "bg-card w-full rounded-[16px] border-[1.5px] px-3.5 py-3 text-left",
                      "focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
                      slot.is_claimed
                        ? "border-border cursor-not-allowed opacity-60"
                        : isSelected
                          ? "border-primary"
                          : "border-border hover:border-primary",
                    )}
                  >
                    <span className="mb-2 flex items-center justify-between gap-3">
                      <span className="font-heading text-foreground text-[14px] font-bold">
                        {TIME_OF_DAY_LABEL[slot.time_of_day]}
                      </span>
                      <span
                        className={cn(
                          "rounded-[14px] px-2.5 py-[3px] text-[10px] font-bold tracking-wide",
                          slot.is_claimed ? "bg-muted text-muted-foreground" : "bg-secondary text-secondary-foreground",
                        )}
                      >
                        {slot.is_claimed ? "ZAJĘTE" : isSelected ? "WYBRANE" : "WOLNE"}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground text-[12px]">
                        {slot.is_claimed ? "Ktoś już się zapisał." : "Wolny termin — możesz go wziąć."}
                      </span>
                      {!slot.is_claimed && (
                        <span
                          className={cn(
                            "font-heading flex h-[34px] shrink-0 items-center justify-center rounded-[10px] px-4 text-[12px] font-bold",
                            isSelected
                              ? "bg-primary text-primary-foreground"
                              : "border-primary text-primary border-[1.5px]",
                          )}
                        >
                          {isSelected ? "Wybrane" : "Zapisuję się"}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!hasCapability && (
        <div>
          <Input
            label="TWOJE IMIĘ"
            id="claimant-name"
            value={name}
            // ui/Input exposes no maxLength and Phase 5 adds only `disabled` to it, so the
            // bound is applied here instead. It is not decoration: `claim_slots` raises PT400
            // past 80 characters, and clamping means the caretaker never types into a refusal.
            onChange={(next) => {
              setName(next.slice(0, MAX_CLAIMANT_NAME_LENGTH));
            }}
            placeholder="Ania"
            autoComplete="given-name"
            disabled={pending}
          />
          <p className="text-muted-foreground mt-1.5 ml-1 text-[13px]">
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
