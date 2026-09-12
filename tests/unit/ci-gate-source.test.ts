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
const vitestConfig = read("vitest.config.ts");

/** `npm run check` as its OWN step, not the prefix of `npm run check:secrets`. */
const CHECK_STEP = /npm run check(?![:\w])/;

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
    // ANCHORED, and this is not pedantry: `toContain("npm run check")` is satisfied by the
    // substring inside `npm run check:secrets`, so the plain form passed against a chain with no
    // typecheck at all. Found by the full-plan review, mutation-confirmed, and it is exactly the
    // failure this file exists to prevent — in this file.
    expect(gate, "typecheck missing from the publish gate").toMatch(CHECK_STEP);
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
    const check = CHECK_STEP.exec(gate)?.index ?? -1;
    const lint = gate.indexOf("npm run lint");
    const build = gate.indexOf("npm run build");
    const tests = gate.indexOf("--project unit");
    const scan = gate.indexOf("npm run check:secrets");

    // A MISSING step yields -1, and -1 is less than everything — so an ordering assertion on a
    // step that is absent passes vacuously and reports nothing. Floor every index first; without
    // this, deleting a step turns its ordering check into a rubber stamp.
    for (const [name, index] of [
      ["typecheck", check],
      ["lint", lint],
      ["build", build],
      ["tests", tests],
      ["secret scan", scan],
    ] as const) {
      expect(index, `${name} is absent from the publish gate, so its position proves nothing`).toBeGreaterThan(-1);
    }

    expect(check, "typecheck must run before lint — astro check regenerates .astro/").toBeLessThan(lint);
    expect(lint, "lint must run before the build").toBeLessThan(build);
    expect(build, "the build must precede the tests — client-bundle.test.ts scans dist/client").toBeLessThan(tests);
    expect(tests, "the secret scan comes last").toBeLessThan(scan);
  });

  it("names vitest projects that actually exist", () => {
    // MEASURED, not assumed: `vitest run --project nope` exits 0 and simply runs nothing. So
    // renaming a project in vitest.config.ts while the gate still asks for the old name would
    // silently stop running those tests, with the gate green. Asserting the flag string alone —
    // which this file did — cannot see that, because the flag would still be there.
    const projects = [...gate.matchAll(/--project\s+([\w-]+)/g)].map((match) => match[1]);
    expect(projects.length, "the gate names no vitest projects at all").toBeGreaterThan(1);
    for (const project of projects) {
      expect(vitestConfig, `the gate runs --project ${project}, which vitest.config.ts does not define`).toContain(
        `name: "${project}"`,
      );
    }
  });

  it("shares one definition of typechecking with the commit hook", () => {
    // The hook used to call `npx astro check` directly. Two literal definitions of the same check
    // drift apart silently — the hook keeps passing while the gate checks something else.
    expect(hook, "the pre-commit hook should invoke the shared npm script").toContain("npm run check");
    expect(hook, "the hook should not re-declare the typecheck as its own literal").not.toMatch(/^\s*npx astro check/m);
  });
});

describe("the three config lines whose removal is invisible", () => {
  // Added by the full-plan review. Each of these passes EVERY test locally when deleted and
  // breaks CI — the first two silently, which is the worse kind. They were argued for in comments
  // and pinned by nothing, which is the same gap this file was written to close one level up.

  it("keeps the integration project in its own scheduling group", () => {
    // Without it, vitest refuses to start whenever projects resolve to different `maxWorkers` in
    // one group: `CI=1 npx vitest run` aborts with zero tests run. Locally invisible, because
    // locally every project resolves to the same default.
    // The KEY, not the word: every one of these lines is explained by a comment directly above it
    // that necessarily names it, so a substring assertion is satisfied by the prose after the
    // config is deleted. That is the same hole this file was just fixed for one level up, and it
    // reappeared inside the fix — caught by running the mutation instead of trusting the green.
    expect(vitestConfig, "sequence.groupOrder is gone — `CI=1 npx vitest run` will abort before any test runs").toMatch(
      /groupOrder:\s*\d/,
    );
  });

  it("still waits for the stack once per run rather than once per file", () => {
    // Delete this and every test still passes whenever the stack happens to be up. The cost
    // reappears a month later as a red CI run with PGRST205, which reads like a broken migration.
    expect(vitestConfig, "globalSetup is gone — the readiness probes would move back to per-file cost").toMatch(
      /globalSetup:\s*\[/,
    );
  });

  it("still serialises the integration project under CI", () => {
    // 22 files against one Postgres on a 2-vCPU runner. The conditional is the whole point: an
    // unconditional cap would slow every local run, and an absent one oversubscribes the runner.
    expect(vitestConfig, "the CI-conditional worker cap is gone").toMatch(/maxWorkers:\s*process\.env\.CI/);
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
