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
  /** Accent fill and border. Meaningless for a read-only chip, which is always muted. */
  selected?: boolean;
  /** Supplying this makes the chip a real toggle button. Omit it for a label. */
  onToggle?: () => void;
  /** Only used when `onToggle` is present, so the control announces what it belongs to. */
  "aria-describedby"?: string;
}

const BASE =
  "flex items-center gap-2 rounded-[24px] border-[1.5px] px-[14px] py-[9px] font-heading text-[14px] font-bold";

export function Chip({ children, selected = false, onToggle, ...aria }: ChipProps) {
  const tone = selected
    ? "border-primary bg-secondary text-secondary-foreground"
    : "border-input bg-card text-muted-foreground";

  // A label is a <span>: read-only pets are not buttons, and announcing them as such would
  // promise an interaction that does not exist.
  if (!onToggle) {
    return <span className={cn(BASE, tone)}>{children}</span>;
  }

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
      {...aria}
    >
      {children}
    </button>
  );
}
