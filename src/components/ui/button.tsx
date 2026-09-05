import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Variants follow context/design/Pupilownik Hi-fi.html. Only the values change —
// the component's API is untouched, so existing call sites keep working.
// The design's buttons are 54px tall, share --radius (16px), and set their label
// in Quicksand 700.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-heading font-bold transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        // The design draws a tinted drop-shadow under the primary button; dropped on
        // request in favour of a flat fill that shifts on hover. The hover fill comes
        // from --primary-hover, chosen per theme (global.css) — a single shared
        // formula cannot work, because in dark mode the accent and the foreground are
        // both light and any mix between them is invisible.
        default: "bg-primary text-primary-foreground hover:bg-[var(--primary-hover)] text-base",
        destructive: "bg-destructive text-white text-base hover:brightness-105 focus-visible:ring-destructive/30",
        outline: "border-[1.5px] border-input bg-card text-foreground text-[15px] hover:bg-accent",
        secondary: "bg-secondary text-secondary-foreground text-[15px] hover:brightness-[0.98]",
        ghost: "font-body font-bold text-[13px] text-primary hover:bg-accent",
        link: "font-body font-bold text-[13px] text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[54px] px-6 has-[>svg]:px-5",
        sm: "h-11 gap-1.5 px-4 has-[>svg]:px-3",
        lg: "h-[54px] px-8 has-[>svg]:px-6",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
