// Theme resolution — the single rule deciding which palette class lands on <html>.
//
// Three sources can specify a theme: an explicit cookie, the visitor's OS
// preference, and the light default. Only the cookie is visible to the server,
// so this module owns exactly one decision — cookie value in, class name out —
// and CSS owns the rest (see the prefers-color-scheme block in global.css).
//
// Kept free of Astro and browser globals on purpose: both the SSR layout and the
// client toggle import it, and it must be testable without either.

export const THEMES = ["light", "dark", "contrast"] as const;

export type Theme = (typeof THEMES)[number];

/** Cookie carrying the visitor's explicit choice. Exported so the layout that
 *  reads it and the toggle that writes it cannot drift apart. */
export const THEME_COOKIE = "pupilownik-theme";

function isTheme(value: string): value is Theme {
  return (THEMES as readonly string[]).includes(value);
}

/**
 * Map a raw cookie value to the class for <html>.
 *
 * Returns "" when the visitor has made no explicit choice (absent, empty, or
 * unrecognised value). That empty result is load-bearing, not a fallback: with
 * no class present, the `prefers-color-scheme` block in global.css applies and
 * the OS preference wins. Returning "light" here instead would silently override
 * a dark-mode machine for every first-time visitor.
 */
export function resolveTheme(cookieValue: string | undefined | null): Theme | "" {
  if (!cookieValue) {
    return "";
  }
  const trimmed = cookieValue.trim();
  return isTheme(trimmed) ? trimmed : "";
}

/** Next theme in the toggle's cycle: light → dark → contrast → light. An unset
 *  theme starts the cycle at dark, since the control is only reachable from a
 *  rendered page the visitor can already see. */
export function nextTheme(current: Theme | ""): Theme {
  if (current === "") {
    return "dark";
  }
  const index = THEMES.indexOf(current);
  return THEMES[(index + 1) % THEMES.length];
}
