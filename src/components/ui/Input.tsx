import { useId, useState } from "react";
import { cn } from "@/lib/utils";

// The design's form field: an uppercase Nunito label above a 52px rounded input.
// Password fields carry an inline "Pokaż" / "Ukryj" affordance in the accent colour
// rather than an eye icon — see context/design/Pupilownik Hi-fi.html.

interface InputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Native input type. Ignored while a revealable field is showing its value. */
  type?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  autoComplete?: string;
  error?: string;
  /** Renders the show/hide control. Only meaningful on a password field. */
  revealable?: boolean;
  /** Locks the field while a request is in flight. Defaults to false, so the eight call sites
   *  that predate it are untouched: SignInForm (2), SignUpForm (3), NewPeriodForm (3). Counted
   *  by grep at the time of writing, not copied from the plan — the plan said "four call sites
   *  … add pet", and AddPetForm renders a raw <input> and has never imported this component
   *  (impl-review phase 5, F4). */
  disabled?: boolean;
}

export function Input({
  label,
  value,
  onChange,
  type = "text",
  name,
  id,
  placeholder,
  autoComplete,
  error,
  revealable = false,
  disabled = false,
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const [revealed, setRevealed] = useState(false);

  const resolvedType = revealable && revealed ? "text" : type;

  return (
    <div>
      <label htmlFor={inputId} className="text-muted-foreground mb-1.5 ml-1 block text-xs font-bold tracking-wide">
        {label}
      </label>
      <div
        className={cn(
          "bg-card flex h-[52px] items-center gap-3 rounded-lg border-[1.5px] px-[18px]",
          "focus-within:ring-ring/50 focus-within:ring-[3px]",
          error ? "border-destructive" : "border-input",
          disabled && "opacity-60",
        )}
      >
        <input
          id={inputId}
          name={name}
          type={resolvedType}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[15px] outline-none"
        />
        {revealable && (
          <button
            type="button"
            onClick={() => {
              setRevealed((current) => !current);
            }}
            disabled={disabled}
            // The accessible name states the action, not the state: a screen-reader
            // user hears what pressing it will do.
            aria-label={revealed ? "Ukryj hasło" : "Pokaż hasło"}
            className="text-primary shrink-0 text-[13px] font-bold outline-none focus-visible:underline"
          >
            {revealed ? "Ukryj" : "Pokaż"}
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} className="text-destructive mt-1.5 ml-1 text-[13px]">
          {error}
        </p>
      )}
    </div>
  );
}
