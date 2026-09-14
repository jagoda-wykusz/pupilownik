import { useId } from "react";
import { cn } from "@/lib/utils";

// The design's multi-line field: the same uppercase Nunito label and 1.5px rounded box as
// ui/Input, but top-aligned and free to grow. Drawn on the "Nowy wyjazd" artboard as the
// NOTATKA box (14px/16px padding, 16px radius, 60px min-height, placeholder
// "Klucze u sąsiadki, mieszkanie 4…").
//
// A separate component rather than a `multiline` flag on Input: Input's box is a fixed
// h-[52px] flex row built around an optional trailing reveal button, and neither of those
// makes sense for a textarea. Its PROPS are mirrored deliberately, though — label, value,
// onChange, error, and the same generated-id/aria wiring — so the two read identically at
// call sites and a form does not need to learn a second convention.

interface TextareaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  name?: string;
  id?: string;
  placeholder?: string;
  error?: string;
  /** Visible rows before scrolling. The box still grows to fit the design's 60px floor. */
  rows?: number;
  /** Hint text under the label — used for "who will see this". */
  hint?: string;
  /** Locks the field while a request is in flight. Added by S-09's impl-review (F10): ui/Input
   *  has carried this since the period form, and EditPetForm's instruction body was the one
   *  control on that page that stayed editable mid-save — keystrokes typed into it were
   *  discarded by the reload with no sign. Defaults to false, so the call sites that predate it
   *  are untouched. */
  disabled?: boolean;
}

export function Textarea({
  label,
  value,
  onChange,
  name,
  id,
  placeholder,
  error,
  rows = 3,
  hint,
  disabled = false,
}: TextareaProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  // Both the hint and the error are referenced when both are present: a screen-reader user
  // needs "only caretakers who took a slot see this" as much as "too long", and dropping
  // one to keep the attribute simple loses real information.
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={fieldId} className="text-muted-foreground mb-1.5 ml-1 block text-xs font-bold tracking-wide">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-muted-foreground mb-1.5 ml-1 text-[13px]">
          {hint}
        </p>
      )}
      <div
        className={cn(
          "bg-card flex min-h-[60px] items-start rounded-lg border-[1.5px] px-4 py-3.5",
          "focus-within:ring-ring/50 focus-within:ring-[3px]",
          error ? "border-destructive" : "border-input",
          // Same 60% wash ui/Input uses, so a disabled field reads the same in both.
          disabled && "opacity-60",
        )}
      >
        <textarea
          id={fieldId}
          name={name}
          value={value}
          rows={rows}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 resize-y bg-transparent text-[15px] leading-[1.4] outline-none"
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-destructive mt-1.5 ml-1 text-[13px]">
          {error}
        </p>
      )}
    </div>
  );
}
