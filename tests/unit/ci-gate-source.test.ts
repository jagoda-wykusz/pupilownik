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

/** Anchored for the same reason: `npm run test:render` contains `npm run test`, so a future
 *  assertion on the shorter name would be satisfied by this longer one. */
const RENDER_STEP = /npm run test:render(?![:\w])/;

/** The two flags that decide whether a WARNING can stop a deploy.
 *
 *  Both accept either separator, because `--flag value` and `--flag=value` are the same thing to
 *  the tools and pinning only one spelling would fail on a harmless edit. What they do NOT accept
 *  is a different value: `--max-warnings 10` is a budget, not a gate, and `(?!\d)` is what stops
 *  the pattern from matching the leading `0` of some larger number. */
const MAX_WARNINGS = /--max-warnings[= ]0(?!\d)/;
const FAILING_SEVERITY = /--minimumFailingSeverity[= ]warning\b/;

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
    expect(gate, "the render sweep is not in the publish gate").toMatch(RENDER_STEP);
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
    const render = RENDER_STEP.exec(gate)?.index ?? -1;
    const scan = gate.indexOf("npm run check:secrets");

    // A MISSING step yields -1, and -1 is less than everything — so an ordering assertion on a
    // step that is absent passes vacuously and reports nothing. Floor every index first; without
    // this, deleting a step turns its ordering check into a rubber stamp.
    for (const [name, index] of [
      ["typecheck", check],
      ["lint", lint],
      ["build", build],
      ["tests", tests],
      ["render sweep", render],
      ["secret scan", scan],
    ] as const) {
      expect(index, `${name} is absent from the publish gate, so its position proves nothing`).toBeGreaterThan(-1);
    }

    expect(check, "typecheck must run before lint — astro check regenerates .astro/").toBeLessThan(lint);
    expect(lint, "lint must run before the build").toBeLessThan(build);
    expect(build, "the build must precede the tests — client-bundle.test.ts scans dist/client").toBeLessThan(tests);
    expect(tests, "the render sweep follows the fast test projects").toBeLessThan(render);
    expect(render, "the secret scan comes last").toBeLessThan(scan);
  });

  it("runs the render sweep through its own config", () => {
    // Added when the sweep joined the chain. MEASURED FIRST, and it is why this assertion exists at
    // all: adding a step to `ci:gate` does NOT fail the assertions above — they pin the presence and
    // order of the steps they know about, not that no others exist. So a new link in the gate is
    // unguarded until someone writes it down here, which is a thing worth knowing before assuming
    // this file notices growth on its own.
    //
    // Two halves. The script has to exist, or the gate names something npm cannot run. And it has to
    // point at vitest.render.config.ts, because the default config has no Astro plugin and cannot
    // even parse the pages the sweep renders — pointing it at the wrong config fails as a LOAD
    // error, which reads like a broken test rather than a broken chain.
    const renderScript = packageJson.scripts["test:render"] ?? "";

    expect(renderScript, "scripts['test:render'] is missing, but the gate calls it").not.toBe("");
    expect(renderScript, "the render sweep must run under vitest.render.config.ts").toContain(
      "vitest.render.config.ts",
    );
  });

  it("makes a single warning stop the deploy, in both tools", () => {
    // WHY THIS IS PINNED AT ALL, and it is the same argument as the file header: a threshold that
    // is removed leaves no symptom. `eslint .` without --max-warnings 0 prints the same warnings
    // and exits 0; `astro check` without --minimumFailingSeverity warning prints the same summary
    // and exits 0. Both read as a clean run. Before `warnings-block-publication` that was the
    // actual state — 12 warnings, green gate — and a rule added at `warn` severity contributed
    // nothing to publication.
    //
    // THE FLAG CARRIES MORE THAN ITS NAME SUGGESTS, measured rather than assumed. `no-console` is
    // `error` only for `src/pages/**/*.ts`; everywhere else it is still `warn`. So a console.error
    // in a client island fails ONLY because of --max-warnings 0. Drop that flag and client code
    // silently reverts to advisory while endpoints stay strict — the opposite of what a reader
    // would guess from the eslint config alone.
    // No `?? ""` here, and the reason is a type that lies: `scripts` is `Record<string, string>`,
    // so dot access is typed `string` and TS would call the fallback unnecessary — while at RUNTIME
    // a deleted script is `undefined`. `toBeTruthy()` catches both that and an empty string, which
    // `not.toBe("")` would not: `undefined !== ""` passes.
    const lintScript = packageJson.scripts.lint;
    const checkScript = packageJson.scripts.check;

    expect(lintScript, "scripts['lint'] is missing from package.json").toBeTruthy();
    expect(checkScript, "scripts['check'] is missing from package.json").toBeTruthy();

    expect(lintScript, "`npm run lint` tolerates warnings — a rule at `warn` severity cannot block a deploy").toMatch(
      MAX_WARNINGS,
    );

    // THE FLAG IS NOT THE INVOCATION, added after review measured three strings that carry the flag
    // and still tolerate warnings. The pattern above inspects a string; eslint runs a command line.
    //
    //   `--max-warnings 0 --max-warnings 10` -> eslint takes the LAST one. Measured: exit 0.
    //   `--max-warnings 0 || true`           -> the script swallows the exit code.
    //   `eslint src/pages --max-warnings 0`  -> flag intact, scope silently narrowed, and §5's
    //                                           "drift in files no commit touched" depends on `.`.
    expect(lintScript, "a second --max-warnings overrides the first; eslint takes the last one").not.toMatch(
      /--max-warnings[\s\S]*--max-warnings/,
    );
    expect(lintScript, "the lint script swallows its own exit code, so the threshold cannot fail it").not.toMatch(
      /(\|\||;|&&\s*true)/,
    );
    expect(
      lintScript,
      "lint no longer targets the whole project — narrowing it hides drift in untouched files",
    ).toMatch(/eslint\s+\.(\s|$)/);
    expect(
      checkScript,
      "`npm run check` exits on errors only — a warning-severity diagnostic cannot block a deploy",
    ).toMatch(FAILING_SEVERITY);
  });

  it("routes both gates through those scripts by name, so one definition covers both", () => {
    // The flags live in package.json. They reach the publish gate and GitHub Actions ONLY because
    // both invoke the npm scripts instead of calling the tools directly; an inline `eslint` in the
    // workflow silently loses the threshold while package.json still looks correct.
    //
    // REWRITTEN AFTER REVIEW, because the first version guarded one spelling and was satisfiable by
    // a comment — the exact pair of holes lessons.md records. It asserted `/run:\s*npx?\s+eslint/`,
    // which requires the command on the SAME LINE as `run:`; a `run: |` block scalar walked past it,
    // and ci.yml already uses one. Its positive half was `toContain("npm run lint")` against raw
    // YAML — and YAML has comments, so swapping the real step for `pnpm eslint .` while leaving a
    // comment that mentions `npm run lint` passed all four assertions.
    //
    // Order matters in the stripper below and both steps are load-bearing. Comments come out first:
    // ci.yml:112-113 legitimately discusses `astro check` and ESLint in prose, so asserting over the
    // raw text would fail on the explanation rather than on a command. `npm run …` lines come out
    // second: those are the CORRECT invocations, and leaving them in would make the negative
    // assertions fail on the thing they are supposed to require.
    const commands = workflow
      .split("\n")
      .map((line) => line.replace(/(^|\s)#.*$/, ""))
      .filter((line) => !/npm run [\w:]+/.test(line))
      .join("\n");

    // GUARDS THE GUARD, both directions. A stripper that emptied the string would make every
    // negative below vacuously true, and one that removed nothing would make them fire on prose.
    expect(commands.length, "stripping removed the whole workflow").toBeGreaterThan(200);
    expect(
      commands,
      "the comment mentioning `astro check` survived stripping — the negatives below would fire on prose",
    ).not.toContain("regenerates .astro/");
    expect(commands, "a `run:` step survived stripping, so there is something left to inspect").toContain("run:");

    // Anchored to a real step, not to the substring appearing anywhere. `\s*$` is what keeps
    // `npm run check` from being satisfied by the `npm run check:secrets` step.
    expect(workflow, "Actions does not run lint through the npm script").toMatch(/^\s*-?\s*run:\s*npm run lint\s*$/m);
    expect(workflow, "Actions does not run the typecheck through the npm script").toMatch(
      /^\s*-?\s*run:\s*npm run check\s*$/m,
    );
    expect(gate, "lint missing from the publish gate").toContain("npm run lint");
    expect(gate, "typecheck missing from the publish gate").toMatch(CHECK_STEP);

    // Token match over what is left, so every invocation form is covered: `run: |` blocks,
    // `npx --yes eslint`, `./node_modules/.bin/eslint`, `pnpm eslint`, a bare PATH-resolved
    // `eslint`, and `astro   check` with any spacing.
    expect(commands, "the workflow invokes eslint directly somewhere, bypassing the script's threshold").not.toMatch(
      /\beslint\b/,
    );
    expect(commands, "the workflow invokes astro check directly, bypassing the script's threshold").not.toMatch(
      /\bastro\s+check\b/,
    );
  });

  it("keeps the Supabase CLI optional, so a GitHub outage cannot fail npm ci", () => {
    // WHY THE PLACEMENT IS PINNED. `supabase`'s postinstall downloads a 98 MB Go binary from
    // GitHub Releases and ends in a bare `await main()` with no catch, so a failed download exits
    // 1. Measured: as a devDependency that makes `npm ci` exit 1; as an optionalDependency it
    // exits 0 and npm drops the package. On Cloudflare Workers Builds `npm ci` runs BEFORE the
    // build command, so the devDependency form let a third party kill the deploy before `ci:gate`
    // could report anything — and the container has no Docker, so that binary is unusable there.
    //
    // Moving it back is a one-word edit that restores a silent deploy-blocking dependency, which
    // is exactly the shape this file exists to pin.
    //
    // NOT `--omit=optional` anywhere: measured, the lockfile carries 131 optional entries
    // including `@cloudflare/workerd-linux-64`, so omitting them would strip the platform
    // binaries the build itself needs.
    const manifest = JSON.parse(read("package.json")) as {
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };

    expect(
      manifest.optionalDependencies?.supabase,
      "supabase is not an optionalDependency — a failed CLI download would fail npm ci and block the deploy",
    ).toBeTruthy();
    expect(
      manifest.devDependencies?.supabase,
      "supabase is back in devDependencies, which makes its postinstall failure fatal to npm ci",
    ).toBeUndefined();

    // The lockfile is what `npm ci` actually acts on; the manifest section alone proves nothing.
    const lock = JSON.parse(read("package-lock.json")) as {
      packages: Record<string, { optional?: boolean }>;
    };
    const lockEntry = lock.packages["node_modules/supabase"];

    expect(lockEntry, "package-lock.json has no entry for supabase at all").toBeTruthy();
    expect(
      lockEntry.optional,
      "package-lock.json does not mark supabase optional — run `npm install` to regenerate it",
    ).toBe(true);

    // The other half of the trade. Optional means npm DROPS the package on failure, and Actions is
    // the only place the integration suite runs — without this check `npx supabase start` would
    // quietly fetch a copy from the registry instead of failing.
    expect(
      workflow,
      "Actions no longer verifies the CLI installed; a dropped optional dependency would be silently refetched",
    ).toMatch(/^\s*-?\s*run:\s*npx --no-install supabase --version\s*$/m);
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
