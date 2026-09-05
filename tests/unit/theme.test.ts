import { describe, expect, it } from "vitest";
import { nextTheme, resolveTheme, THEMES } from "@/lib/theme";

// Theme resolution is the only branching logic in the design-system slice, and the
// only place a regression could hide silently: every wrong answer still renders a
// page, just the wrong one. Runs in the `unit` project, so it needs no Supabase.
describe("resolveTheme", () => {
  it.each(THEMES)("maps the recognised value %s to its own class", (theme) => {
    expect(resolveTheme(theme)).toBe(theme);
  });

  // The empty string is not a fallback to light — it means "stamp no class", which
  // is what lets the prefers-color-scheme block in global.css take over. If this
  // ever returned "light", every first-time visitor on a dark-mode machine would
  // be forced into the light palette.
  it.each([
    ["absent", undefined],
    ["null", null],
    ["empty", ""],
    ["unknown", "sepia"],
    ["an injection attempt", "dark; --background: red"],
  ])("returns no class for %s, deferring to the OS preference", (_label, value) => {
    expect(resolveTheme(value)).toBe("");
  });

  it("tolerates surrounding whitespace", () => {
    expect(resolveTheme("  dark  ")).toBe("dark");
  });
});

describe("nextTheme", () => {
  it("cycles light to dark to contrast and back", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("contrast");
    expect(nextTheme("contrast")).toBe("light");
  });

  it("starts the cycle at dark when nothing is chosen yet", () => {
    expect(nextTheme("")).toBe("dark");
  });
});
