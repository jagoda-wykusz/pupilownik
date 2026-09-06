import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The design's pill — a small rounded label carrying one name.
//
// Geometry is taken from the "Nowy wyjazd + link" screen's KTÓRE ZWIERZĘTA control:
// 24px radius (a pill, deliberately not the shared --radius), 9px/14px padding, flex with an
// 8px inner gap, Quicksand at 14px/700. The design draws only the SELECTED state; the
// unselected and read-only variants are ours, built from the same tokens so they follow every
// theme without a second definition.
//
// S-07's roadmap outcome named a chip among the components it established, but shipped only
// what the auth screens needed — this closes that gap. It exists as a shared component because
// three screens render one (the create form's selector plus both owner screens), which is the
// point at which `context/foundation/lessons.md` says a shared surface is warranted rather
// than a class string copied around.
//
// React rather than Astro so the create form's island can use it; the two Astro pages render
// it statically, with no client directive and therefore no JavaScript shipped.

interface ChipProps {
  children: ReactNode;
  /** Accent fill and border. Meaningless for a read-only chip, which is always accented —
   *  that is the one state the design draws, and the only one that survives a --card ground. */
  selected?: boolean;
  /** Supplying this makes the chip a real toggle button. Omit it for a label. */
  onToggle?: () => void;
}

// No className passthrough and no prop spread, on purpose (phase-3 impl-review F2). A spread
// placed after className lets a caller silently override the whole geometry, and a chip whose
// shape is negotiable is not a shared component. Field-level aria belongs on the group wrapper
// that owns the error, which is where NewPeriodForm keeps it.

const BASE =
  "flex items-center gap-2 rounded-[24px] border-[1.5px] px-[14px] py-[9px] font-heading text-[14px] font-bold";

// The design draws its chips in exactly one tone, and this is it. Measured against the tokens
// in global.css: text 4.58:1 on light, 6.18:1 on dark; pill edge 5.36:1 on --card.
const ACCENT = "border-primary bg-secondary text-secondary-foreground";

// The unselected half of the toggle, and ONLY that. Deliberately not reused read-only: its edge
// measures 1.29:1 (light, #ecdfe5 on #ffffff) and 1.40:1 (dark, #443e49 on #2c2832), both under
// the 3:1 non-text threshold — and on /periods the card behind the chip is --card as well, so
// the pill stops reading as a pill at all. Phase-3 impl-review F1.
const MUTED = "border-input bg-card text-muted-foreground";

export function Chip({ children, selected = false, onToggle }: ChipProps) {
  // A label is a <span>: read-only pets are not buttons, and announcing them as such would
  // promise an interaction that does not exist. It always takes ACCENT — with no sibling to
  // contrast against, "these pets are on this trip" IS the design's selected state.
  if (!onToggle) {
    return <span className={cn(BASE, ACCENT)}>{children}</span>;
  }

  const tone = selected ? ACCENT : MUTED;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cn(
        BASE,
        tone,
        "transition-colors outline-none",
        "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        !selected && "hover:border-ring",
      )}
    >
      {children}
    </button>
  );
}
