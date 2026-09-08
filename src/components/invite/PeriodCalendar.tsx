import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatDay, formatWeekday, TIMES_OF_DAY, type TimeOfDay } from "@/lib/period-format";

// The caretaker's month grid, from the "Kalendarz opiekuna" artboard
// (context/design/Pupilownik Hi-fi.html:541-591). It replaces the flat day list Phase 4
// shipped as the deliberate cut line.
//
// THREE dots per day, not the design's two. The artboard predates the third time of day;
// the schema has `morning | afternoon | evening` and a day cell showing two of three would
// misreport occupancy on the one screen where occupancy is the whole point.
//
// Presentational and fully controlled: it owns which MONTH is on screen and nothing else.
// Which day is selected lives in ClaimSlots, next to the slot selection it drives.
//
// Dates are handled as "YYYY-MM-DD" strings and parsed at UTC midnight, the rule
// period-format.ts sets out — a date west of Greenwich read in local time renders as the
// previous day, which here would shift the whole grid.

export interface CalendarSlot {
  time_of_day: TimeOfDay;
  is_claimed: boolean;
}

export interface CalendarDay {
  /** "YYYY-MM-DD". */
  day: string;
  slots: CalendarSlot[];
}

interface Props {
  /** The period's days, ascending. Days outside this set render as inert numbers. */
  days: CalendarDay[];
  selectedDay: string | null;
  onSelect: (day: string) => void;
  /** Locks every cell while a claim is in flight. */
  disabled?: boolean;
}

const WEEKDAY_HEADINGS = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];

function toKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function formatMonth(isoMonth: string): string {
  const label = new Intl.DateTimeFormat("pl-PL", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoMonth}-01T00:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Monday-first, matching the design's Pn…Nd header. getUTCDay() is Sunday-first, so Sunday
// (0) has to become 6 rather than fall at the start of the week.
function mondayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

/** Every cell of the displayed month's grid, padded out to whole weeks. */
function buildGrid(isoMonth: string): string[] {
  const first = new Date(`${isoMonth}-01T00:00:00Z`);
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - mondayIndex(first));

  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  const end = new Date(last);
  end.setUTCDate(end.getUTCDate() + (6 - mondayIndex(last)));

  const cells: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    cells.push(toKey(cursor));
  }
  return cells;
}

// Named export, not default: the repo's split is default for island ENTRYPOINTS (NewPeriodForm,
// AddPetForm, ClaimSlots) and named for shared children (Chip, Input, ServerError, Button).
// This carries no client: directive and is only ever rendered by ClaimSlots.
export function PeriodCalendar({ days, selectedDay, onSelect, disabled = false }: Props) {
  const byDay = useMemo(() => new Map(days.map((entry) => [entry.day, entry])), [days]);

  // MAX_SPAN_DAYS is 31, so a period spans at most THREE months — 2027-01-30 through
  // 2027-03-01 is 31 days across January, February and March. (The plan said two; that is
  // wrong, and the count is only ever derived from the data here, never assumed.) The control
  // is inert on most periods all the same: when there is nowhere to go it is not rendered at
  // all, because an always-visible pair of dead arrows is exactly the "broken control" this
  // phase's verification asks about.
  const months = useMemo(() => [...new Set(days.map((entry) => monthKey(entry.day)))].sort(), [days]);

  // Initial month only: after mount the arrows own it, so a caretaker who paged to August
  // does not get yanked back to July by selecting a day. `months` is declared above, so the
  // initializer can read it — the lazy form keeps it off every subsequent render.
  const [monthIndex, setMonthIndex] = useState(() => {
    const found = selectedDay === null ? -1 : months.indexOf(monthKey(selectedDay));
    return found === -1 ? 0 : found;
  });

  if (months.length === 0) {
    return null;
  }

  const month = months[Math.min(monthIndex, months.length - 1)];
  const cells = buildGrid(month);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="font-heading text-foreground text-[16px] font-bold">{formatMonth(month)}</p>
        {months.length > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled || monthIndex === 0}
              aria-label="Poprzedni miesiąc"
              onClick={() => {
                setMonthIndex((current) => Math.max(0, current - 1));
              }}
              className="text-primary focus-visible:ring-ring/50 size-9 rounded-lg text-[16px] font-bold outline-none focus-visible:ring-[3px] disabled:opacity-30"
            >
              ‹
            </button>
            <button
              type="button"
              disabled={disabled || monthIndex >= months.length - 1}
              aria-label="Następny miesiąc"
              onClick={() => {
                setMonthIndex((current) => Math.min(months.length - 1, current + 1));
              }}
              className="text-primary focus-visible:ring-ring/50 size-9 rounded-lg text-[16px] font-bold outline-none focus-visible:ring-[3px] disabled:opacity-30"
            >
              ›
            </button>
          </div>
        )}
      </div>

      <div className="mb-1.5 grid grid-cols-7 gap-[5px]" aria-hidden="true">
        {WEEKDAY_HEADINGS.map((heading) => (
          <p key={heading} className="text-muted-foreground text-center text-[10px] font-bold">
            {heading}
          </p>
        ))}
      </div>

      {/* The weekday header above is aria-hidden, and the month sits in a plain <p>, so
          without these two the grid announces bare numbers — and on a period spanning two or
          three months, two different cells both read as "1: …" (impl-review phase 5, F7). */}
      <div className="grid grid-cols-7 gap-[5px]" role="group" aria-label={`Terminy — ${formatMonth(month)}`}>
        {cells.map((cell) => {
          const entry = byDay.get(cell);
          const dayNumber = Number(cell.slice(8, 10));

          // Outside the period the design draws a plain, low-contrast number and no cell.
          if (!entry) {
            return (
              <p
                key={cell}
                className="text-muted-foreground/50 flex aspect-square items-center justify-center text-[12px]"
              >
                {dayNumber}
              </p>
            );
          }

          const isSelected = cell === selectedDay;
          const isFull = entry.slots.every((slot) => slot.is_claimed);

          return (
            <button
              key={cell}
              type="button"
              disabled={disabled}
              aria-pressed={isSelected}
              aria-label={`${formatWeekday(cell)}, ${formatDay(cell)} — ${isFull ? "dzień pełny" : "są wolne terminy"}`}
              onClick={() => {
                onSelect(cell);
              }}
              className={cn(
                "flex aspect-square flex-col items-center justify-center gap-[3px] rounded-[11px]",
                "focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
                isSelected ? "bg-primary" : isFull ? "bg-muted" : "border-border hover:border-primary border-[1.5px]",
              )}
            >
              <span
                className={cn(
                  "text-[12px] font-bold",
                  isSelected ? "text-primary-foreground" : isFull ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {dayNumber}
              </span>
              <span className="flex gap-[2px]">
                {TIMES_OF_DAY.map((time) => {
                  const slot = entry.slots.find((candidate) => candidate.time_of_day === time);
                  // A day may legitimately be missing a slot row. Render a gap rather than a
                  // dot, which would read as "free".
                  if (!slot) {
                    return <span key={time} className="size-[5px]" />;
                  }
                  return (
                    <span
                      key={time}
                      className={cn(
                        "size-[5px] rounded-full border-[1.2px]",
                        isSelected
                          ? slot.is_claimed
                            ? "border-primary-foreground bg-primary-foreground"
                            : "border-primary-foreground"
                          : isFull
                            ? "border-muted-foreground bg-muted-foreground"
                            : slot.is_claimed
                              ? "border-primary bg-primary"
                              : "border-primary",
                      )}
                    />
                  );
                })}
              </span>
            </button>
          );
        })}
      </div>

      <ul className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[11px] font-semibold">
        <li className="flex items-center gap-1.5">
          <span className="border-primary size-[7px] rounded-full border-[1.2px]" />
          wolny
        </li>
        <li className="flex items-center gap-1.5">
          <span className="bg-primary size-[7px] rounded-full" />
          zajęty
        </li>
        <li className="flex items-center gap-1.5">
          <span className="bg-muted-foreground size-[7px] rounded-full" />
          dzień pełny
        </li>
      </ul>
    </div>
  );
}
