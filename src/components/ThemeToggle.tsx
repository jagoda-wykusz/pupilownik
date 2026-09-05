import { useSyncExternalStore } from "react";
import { Contrast, Moon, Sun } from "lucide-react";
import { nextTheme, THEME_COOKIE, type Theme } from "@/lib/theme";

// Cycles light → dark → contrast and persists the choice.
//
// The server already decided the theme and stamped it on <html>, so this control
// never decides what to render first — it reads the decision back. Persistence is
// a cookie rather than localStorage precisely so the SERVER can read it on the next
// request and render the right palette in the first byte (see src/lib/theme.ts).
//
// The applied theme lives in the DOM (a class on <html>), not in React state, so
// it is read through useSyncExternalStore rather than mirrored into a useState.
// That keeps a single source of truth and, because the subscription also watches
// prefers-color-scheme, the label stays correct when a visitor who has chosen
// nothing flips their OS theme with the page open.

const LABELS: Record<Theme, string> = {
  light: "jasny",
  dark: "ciemny",
  contrast: "wysoki kontrast",
};

const ICONS: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  contrast: Contrast,
};

// A year: long enough that a returning visitor keeps their choice, short enough
// that an abandoned preference eventually lapses.
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const OS_DARK_QUERY = "(prefers-color-scheme: dark)";

interface Props {
  /** What the server resolved. Empty when the visitor has never chosen — the page
   *  is then showing whatever their OS prefers, which only the client can see. */
  initialTheme: Theme | "";
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  const query = window.matchMedia(OS_DARK_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    query.removeEventListener("change", onStoreChange);
  };
}

function readAppliedTheme(): Theme {
  const { classList } = document.documentElement;
  if (classList.contains("dark")) return "dark";
  if (classList.contains("contrast")) return "contrast";
  if (classList.contains("light")) return "light";
  // No class means the prefers-color-scheme block in global.css is in charge.
  // Asking matchMedia is the only way to learn which palette is actually on
  // screen, and without it the first click could appear to do nothing.
  return window.matchMedia(OS_DARK_QUERY).matches ? "dark" : "light";
}

export default function ThemeToggle({ initialTheme }: Props) {
  const theme = useSyncExternalStore(subscribe, readAppliedTheme, () => initialTheme);

  function handleClick() {
    const target = nextTheme(theme);
    document.cookie = `${THEME_COOKIE}=${target}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
    const { classList } = document.documentElement;
    classList.remove("light", "dark", "contrast");
    classList.add(target);
    notify();
  }

  const target = nextTheme(theme);
  const Icon = ICONS[target];

  return (
    <button
      type="button"
      onClick={handleClick}
      // Names the destination, not the current state: pressing it is the action
      // being described.
      aria-label={`Przełącz na motyw ${LABELS[target]}`}
      title={`Przełącz na motyw ${LABELS[target]}`}
      className="border-input bg-card text-foreground hover:bg-accent focus-visible:ring-ring/50 inline-flex size-9 items-center justify-center rounded-lg border-[1.5px] transition-colors outline-none focus-visible:ring-[3px]"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}
