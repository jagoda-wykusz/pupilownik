import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library auto-cleans only when Vitest globals are on; this repo imports describe/it
// explicitly, so the teardown has to be wired by hand. Without it every rendered island stays in
// the document and the next test's queries match two elements.
afterEach(() => {
  cleanup();
});
