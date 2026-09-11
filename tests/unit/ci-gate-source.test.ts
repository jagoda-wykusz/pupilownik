import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The guard on the two quality gates themselves — `ci-quality-gates` phase 4.
//
// WHY A GATE NEEDS A GUARD AT ALL. Every other assertion in this project protects behaviour that
// breaks loudly when it regresses. These two do not: deleting ` && npm run check:secrets` from one
// line of package.json, or dropping the `pull_request` trigger from one line of a workflow, is
// invisible in review, produces no symptom, and is discovered on the day the gate was supposed to
// catch something. So the gates get read as SOURCE and asserted like any other contract.
//
// WHAT THIS CANNOT SEE, said plainly because the honest reach is narrower than the file name.
// The publish gate has two halves: the chain (`scripts["ci:gate"]`, in this repo, asserted below)
// and the Cloudflare dashboard field that names it. The dashboard is not in the repository and no
// test can read it. If someone sets the build command back to `npm run build`, every assertion
// here still passes and nothing publishes-blocks any more. That gap is real and unclosable from
// inside a checkout; naming it is the difference between a guard and a decoration.
//
// It is also a source check, not an execution check: it proves the steps are NAMED, never that
// they pass. Their passing is what the gates themselves are for.

const ROOT = path.resolve(import.meta.dirname, "../..");

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
const gate = packageJson.scripts["ci:gate"] ?? "";
const hook = read(".husky/pre-commit");
const workflow = read(".github/workflows/ci.yml");

describe("the publish gate is still the chain it claims to be", () => {
  it("was actually parsed, so the assertions below are not vacuous", () => {
    // GUARDS THE GUARD. Rename `ci:gate`, or move the workflow, and every `toContain` below would
    // be asserting against an empty string — passing while proving nothing. This is the failure
    // shape context/foundation/lessons.md records: a check that describes the thing it guards.
    expect(gate, "scripts['ci:gate'] is missing from package.json").not.toBe("");
    expect(workflow, ".github/workflows/ci.yml is missing or empty").toContain("runs-on");
  });

  it("runs every step, none of which is optional", () => {
    // Each is named individually rather than compared to a whole string: a single equality check
    // would fail on any harmless reordering of flags and teach the next person to update the
    // expected literal without reading it.
    expect(gate, "typecheck missing from the publish gate").toContain("npm run check");
    expect(gate, "lint missing from the publish gate").toContain("npm run lint");
    expect(gate, "build missing from the publish gate").toContain("npm run build");
    expect(gate, "the unit project is not in the publish gate").toContain("--project unit");
    expect(gate, "the component project is not in the publish gate").toContain("--project component");
    expect(gate, "the secret scan is not in the publish gate").toContain("npm run check:secrets");
  });

  it("keeps the order the measurements demand", () => {
    // ORDER IS THE PART THAT BREAKS SILENTLY. `astro check` regenerates .astro/, whose generated
    // types type-aware ESLint needs; and tests/unit/client-bundle.test.ts scans dist/client and
    // FAILS rather than skips when there is no build. Move the build after the tests and the gate
    // still looks complete while failing for a reason nobody will connect to this line.
    const check = gate.indexOf("npm run check ");
    const lint = gate.indexOf("npm run lint");
    const build = gate.indexOf("npm run build");
    const tests = gate.indexOf("--project unit");
    const scan = gate.indexOf("npm run check:secrets");

    expect(check, "typecheck must run before lint — astro check regenerates .astro/").toBeLessThan(lint);
    expect(lint, "lint must run before the build").toBeLessThan(build);
    expect(build, "the build must precede the tests — client-bundle.test.ts scans dist/client").toBeLessThan(tests);
    expect(tests, "the secret scan comes last").toBeLessThan(scan);
  });

  it("shares one definition of typechecking with the commit hook", () => {
    // The hook used to call `npx astro check` directly. Two literal definitions of the same check
    // drift apart silently — the hook keeps passing while the gate checks something else.
    expect(hook, "the pre-commit hook should invoke the shared npm script").toContain("npm run check");
    expect(hook, "the hook should not re-declare the typecheck as its own literal").not.toMatch(/^\s*npx astro check/m);
  });
});

describe("the CI workflow is still the full-suite signal it exists to be", () => {
  it("runs every vitest project, not a subset", () => {
    // The whole reason this workflow exists is the 22 integration files, which cannot run in the
    // Cloudflare build container — it has no Docker. A `--project` flag here would silently reduce
    // the workflow to a slower copy of the publish gate.
    expect(workflow, "the workflow should run the whole suite").toMatch(/vitest run\s*$/m);
    expect(workflow, "the workflow must not narrow the suite to selected projects").not.toContain(
      "vitest run --project",
    );
  });

  it("triggers on pushes and on pull requests", () => {
    expect(workflow, "the push trigger is missing").toMatch(/^\s{2}push:/m);
    expect(workflow, "the pull_request trigger is missing").toMatch(/^\s{2}pull_request:/m);
  });

  it("guards the production host, not just whichever stack the job happens to run", () => {
    // SUPABASE_URL in that job must be 127.0.0.1 — tests/env.ts refuses any other host, because
    // the suite creates and deletes users. So without this variable the scan's literal checks
    // guard the throwaway local stack and nothing else.
    expect(workflow, "SECRET_SCAN_HOSTS is missing — the CI scan would guard only localhost").toContain(
      "SECRET_SCAN_HOSTS",
    );
    expect(workflow, "the secret scan is not run by the workflow").toContain("npm run check:secrets");
  });
});
