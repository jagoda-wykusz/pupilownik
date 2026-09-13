// Fails the publish gate when a document points at a file that no longer exists.
//
// WHY THIS EXISTS. Archiving a change moves `context/changes/<id>/` to `context/archive/<date>-<id>/`
// and silently breaks every reference to it. Five such links were found by hand in test-plan.md on
// 2026-09-13, and the mechanism recurs on every future archive. Nothing else in `ci:gate` reads
// prose, so a document can rot indefinitely while every test stays green.
//
// WHAT IT CANNOT CATCH, stated plainly because the honest reach is narrower than the name:
//
//   - A LINE NUMBER that has moved. `foo.ts:42` is checked as `foo.ts` and nothing more. Decided
//     deliberately: a moved line is the common case and cannot be detected, while verifying line
//     counts would fire on every substantial edit to a cited file for the rarest kind of staleness.
//   - A reference that is WRONG rather than dead — one real file cited where another was meant.
//     Both exist; only a human notices.
//   - A URL. Checking those would make the gate depend on the network, which is the exact failure
//     class `vendor-build-fonts` and `supabase-cli-build-cost` just removed from this build.
//   - A reference differing only in CASE. `existsSync` is case-insensitive on Windows and
//     case-sensitive on the Linux runner, so a local run can report clean where CI would not.
//     Known and unfixed; recorded in this change's impl-review.
//
// WHAT SUPPRESSES A MATCH — FIVE mechanisms, not the two in `IGNORED`. An earlier version of this
// header advertised four "exclusion rules" and counted only the array. Two of those four could
// never fire, and three real suppressors went undocumented. The full list:
//
//   1. THE LOOKBEHIND `(?<![\w/.@-])` rejects anything preceded by `@`, and that is what actually
//      keeps npm scopes (`@supabase/ssr`, `@astrojs/cloudflare`) out. Measured: zero matches.
//   2. TRUNCATION AT AN OUT-OF-CLASS CHARACTER. The capture class holds no `*`, `<`, `>` or space,
//      so `tests/**/*.test.ts` is extracted as `tests/` and `context/changes/<id>/plan.md` as
//      `context/changes/` — both exist, so both pass. This is why the old "glob" rule was dead
//      code: truncation had already handled it. It is a real suppressor and it is silent.
//   3. `isCutAtASpace` below — the deliberate half of truncation.
//   4. The `IGNORED` rules — two of them, both measured live.
//   5. The per-line `link-check:ignore` marker.
//
// SOURCES vs TARGETS. Two directories are excluded as SOURCES and remain valid TARGETS:
//   - `context/archive/` — immutable, and legitimately describes the state at its time.
//   - `context/changes/` — in-flight plans NAME THE FILES THEY ARE ABOUT TO CREATE. That is the
//     normal authoring loop here, and with this step first in an `&&`-chained `ci:gate` it would
//     block every deploy, including changes unrelated to the document. Reproduced in review; the
//     plan argued "the hard part is not crying wolf" and then missed the loudest case.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Directories a repo-relative path can start with. Anything else is not a path we can resolve. */
const TOP_LEVEL = ["context/", "src/", "tests/", "scripts/", "docs/", "supabase/", ".github/", ".husky/"];

/** Files worth reading. Prose carries most references; source comments in this repo carry the rest,
 *  because the house style cites file paths heavily in "why" headers. */
const SCANNED = /\.(md|ts|tsx|astro|mjs|js|yml|yaml)$/;

/** Skipped by NAME at any depth: generated, vendored, or harness state. */
const SKIP_ANY_DEPTH = new Set(["node_modules", ".git", "dist", ".astro", ".wrangler", ".claude"]);

/** Skipped by exact repo-relative PATH, so a future `src/components/archive/` is still read. An  link-check:ignore
 *  earlier version held the bare name `archive`, which was broader than intended and silent about
 *  it. See "SOURCES vs TARGETS" above for why each of these is here. */
const SKIP_EXACT = new Set(["context/archive", "context/changes"]);

/** A "did we read anything at all" floor, and nothing more ambitious.
 *
 *  It is NOT a positive control: a pattern broken so that it still matched `src/` would keep the
 *  count high and never trip this, and a large documentation cull could trip it while the pattern
 *  is fine. Recorded as an observation in this change's impl-review rather than solved here. Set
 *  well below the measured population so an ordinary edit cannot reach it. */
const MIN_EXPECTED_REFERENCES = 100;

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    // Exit 2, not 1: a directory we cannot read is a broken scan, not a finding, and this file's
    // convention keeps those two signals apart. Without this an EACCES surfaces as exit 1 and reads
    // exactly like a dead link.
    console.error(`check-doc-links: cannot read directory ${path.relative(ROOT, dir)} — ${error.message}`);
    process.exit(2);
  }

  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const relative = path.relative(ROOT, full).replaceAll("\\", "/");
      return SKIP_ANY_DEPTH.has(entry.name) || SKIP_EXACT.has(relative) ? [] : walk(full);
    }
    return SCANNED.test(entry.name) ? [full] : [];
  });
}

// `replaceAll`, not `replace`: the string form of `replace` substitutes only the FIRST match, which
// is correct for every entry above and silently wrong for any future two-dot one.
const TOP_ALTERNATION = TOP_LEVEL.map((top) => top.replaceAll(".", "\\.")).join("|");
const REFERENCE = new RegExp(String.raw`(?<![\w/.@-])((?:${TOP_ALTERNATION})[\w./\[\]-]*)`, "g");

/** Two rules, both measured live by splicing each out and re-running. The pair that used to sit
 *  here — a glob check and a list of npm package names — could never fire: `*` is not in the
 *  capture class, and the lookbehind already rejects `@`-prefixed scopes. */
const IGNORED = [
  {
    why: "GitHub Action ref, not a path: `supabase/setup-cli@v3` — 7 findings without this rule",
    test: (reference, rest) => rest.startsWith("@"),
  },
  {
    why: "migration template placeholder: `supabase/migrations/YYYYMMDDHHmmss_short_description.sql` — 2 findings without this rule",
    test: (reference) => /YYYY|MMDD|short_description/.test(reference),
  },
];

/** True when the extracted string is a real entry's prefix UP TO A SPACE — i.e. the reference
 *  continues past a space the pattern could not follow.
 *
 *  `context/design/Pupilownik Hi-fi.html`, cited from five files, is the case that forced this.
 *
 *  THE TRAILING SPACE IN THE COMPARISON IS THE WHOLE CORRECTNESS OF THIS FUNCTION. An earlier
 *  version tested `entry.startsWith(prefix)` with no space — prefix-matching rather than
 *  space-matching, despite the name — and it silently swallowed genuinely dead references whenever
 *  a longer sibling shared their name. Measured before the fix: `context/changes/doc-link` was  link-check:ignore
 *  swallowed by `doc-link-checking`, `src/lib/period` by `period-format.ts`. The first is precisely  link-check:ignore
 *  the archive-breakage class this script exists to catch, so the guard was blind exactly where it
 *  was needed. Found in review; do not relax it back. */
function isCutAtASpace(reference) {
  const parent = path.join(ROOT, path.dirname(reference));
  const prefix = path.basename(reference);

  if (!existsSync(parent)) {
    return false;
  }
  try {
    return readdirSync(parent).some((entry) => entry.startsWith(`${prefix} `));
  } catch {
    return false;
  }
}

const files = walk(ROOT);
const findings = [];
let checked = 0;

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    // Same reasoning as the walk: EBUSY (a file open in an editor, or under AV on Windows) and
    // EISDIR are broken-scan conditions, and Node would otherwise exit 1 with a stack trace.
    console.error(`check-doc-links: cannot read ${path.relative(ROOT, file)} — ${error.message}`);
    process.exit(2);
  }

  for (const [index, line] of text.split("\n").entries()) {
    // Per-line opt-out, and it exists for a reason this file ran into immediately: a document ABOUT
    // dead links has to be able to name one. This header does it twice. Note the marker covers the
    // WHOLE line, including any unrelated reference on it.
    if (line.includes("link-check:ignore")) {
      continue;
    }

    for (const match of line.matchAll(REFERENCE)) {
      // Only `.` can actually occur here — the capture class excludes the rest of this set — so the
      // strip is narrower than it looks. Kept because a trailing sentence period is real.
      const reference = match[1].replace(/[.,:;)`"']+$/, "");
      const rest = line.slice((match.index ?? 0) + match[1].length);

      if (!reference || IGNORED.some((rule) => rule.test(reference, rest))) {
        continue;
      }

      checked += 1;
      if (!existsSync(path.join(ROOT, reference)) && !isCutAtASpace(reference)) {
        findings.push({
          file: path.relative(ROOT, file).replaceAll("\\", "/"),
          line: index + 1,
          reference,
        });
      }
    }
  }
}

if (checked < MIN_EXPECTED_REFERENCES) {
  console.error(
    `check-doc-links: only ${checked} reference(s) extracted from ${files.length} file(s), below the ` +
      `floor of ${MIN_EXPECTED_REFERENCES}. Either the extraction pattern stopped matching or the ` +
      `scan read almost nothing — treat this as a failure, not a pass.`,
  );
  process.exit(2);
}

if (findings.length > 0) {
  console.error(`check-doc-links: ${findings.length} reference(s) point at files that do not exist:`);
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line} — ${finding.reference}`);
  }
  console.error(
    "\nIf a change was archived, its folder is now context/archive/<date>-<id>/. " +
      "If a file moved, say where it went — do not delete the sentence. " +
      "If the line is ABOUT a dead link, mark it with link-check:ignore.",
  );
  process.exit(1);
}

console.log(`check-doc-links: clean — ${checked} reference(s) across ${files.length} file(s)`);
