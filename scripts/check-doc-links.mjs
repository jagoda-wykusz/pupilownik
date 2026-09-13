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
//   - A reference that is WRONG rather than dead — `src/lib/a.ts` cited where `src/lib/b.ts` was  link-check:ignore
//     meant. Both exist; only a human notices.
//   - A URL. Checking those would make the gate depend on the network, which is the exact failure
//     class `vendor-build-fonts` and `supabase-cli-build-cost` just removed from this build.
//   - Anything inside `context/archive/`. Those documents are immutable and describe the state at
//     their time, so a path that has since moved is not an error there. They are excluded as
//     SOURCES and remain valid TARGETS.
//
// THE EXCLUSIONS ARE THE DESIGN, and this is the part worth reading before "simplifying" them.
// Measured on 2026-09-13: 439 path references across 118 files, 8 unique dead, of which only 2 were
// genuine. At that false-positive rate a gate step gets ignored or, worse, blocks a deploy on a
// template placeholder. Every exclusion below therefore names the REAL string that forced it — if
// you delete one, you are re-admitting that string.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Directories a repo-relative path can start with. Anything else is not a path we can resolve. */
const TOP_LEVEL = ["context/", "src/", "tests/", "scripts/", "docs/", "supabase/", ".github/", ".husky/"];

/** Files worth reading. Prose carries most references; source comments in this repo carry the rest,
 *  because the house style cites file paths heavily in "why" headers. */
const SCANNED = /\.(md|ts|tsx|astro|mjs|js|yml|yaml)$/;

/** Directories never walked as SOURCES. `context/archive/` is immutable by convention; the rest
 *  are generated or vendored and would swamp the scan. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".astro", ".wrangler", ".claude", "archive"]);

/** Below this, assume the extraction pattern has stopped matching rather than that the repo stopped
 *  citing paths. Measured baseline is 439; a drop to near zero is a broken scan reporting "clean". */
const MIN_EXPECTED_REFERENCES = 200;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) ? [] : walk(path.join(dir, entry.name));
    }
    return SCANNED.test(entry.name) ? [path.join(dir, entry.name)] : [];
  });
}

const TOP_ALTERNATION = TOP_LEVEL.map((t) => t.replace(".", "\\.")).join("|");
// The lookbehind keeps `@supabase/ssr` out: `@` immediately before the match means an npm scope.
const REFERENCE = new RegExp(String.raw`(?<![\w/.@-])((?:${TOP_ALTERNATION})[\w./\[\]-]*)`, "g");

/** Each entry names the real string that forced it. Removing one re-admits that string. */
const IGNORED = [
  {
    why: "GitHub Action ref, not a path: `supabase/setup-cli@v3`",
    test: (ref, rest) => rest.startsWith("@"),
  },
  {
    why: "glob pattern, not a path: `tests/**/*.test.ts`",
    test: (ref) => ref.includes("*"),
  },
  {
    why: "template placeholder: `supabase/migrations/YYYYMMDDHHmmss_short_description.sql`",
    test: (ref) => /YYYY|MMDD|<[^>]+>|short_description/.test(ref),
  },
  {
    why: "npm package names that collide with our top-level dirs: `@supabase/ssr`, `@supabase/supabase-js`",
    test: (ref) => /^supabase\/(ssr|supabase-js|realtime-js|auth-js|postgrest-js|storage-js|functions-js)$/.test(ref),
  },
];

/** True when the extracted string is the start of a real entry — i.e. the reference continues past
 *  a space the pattern could not follow.
 *
 *  `context/design/Pupilownik Hi-fi_files/` is the case that forced this, cited from roadmap.md and
 *  three components. Handled generically rather than by naming that directory: a hardcoded
 *  exclusion would go stale the moment someone adds another path with a space, and would do it
 *  silently. Allowing spaces in the pattern itself is the alternative and it is worse — it would
 *  swallow the prose after every path. */
function isTruncatedByASpace(reference) {
  const parent = path.join(ROOT, path.dirname(reference));
  const prefix = path.basename(reference);

  if (!existsSync(parent)) {
    return false;
  }
  try {
    return readdirSync(parent).some((entry) => entry.startsWith(prefix) && entry !== prefix);
  } catch {
    return false;
  }
}

const files = walk(ROOT);
const findings = [];
let checked = 0;

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");

  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(REFERENCE)) {
      // Trailing punctuation belongs to the sentence, not the path. Backticks and quotes close a
      // code span; a period or comma ends a clause.
      const reference = match[1].replace(/[.,:;)`"']+$/, "");
      const rest = line.slice((match.index ?? 0) + match[1].length);

      if (!reference) {
        continue;
      }

      const ignored = IGNORED.find((rule) => rule.test(reference, rest));
      if (ignored) {
        continue;
      }

      // Per-line opt-out, and it exists for a reason this file ran into immediately: a document
      // ABOUT dead links has to be able to name one. Its own change folder cited `src/types.ts`  link-check:ignore
      // as an example and the first run reported it — the same shape as an assertion matching its
      // own rationale. Mark such a line and it is skipped.
      if (line.includes("link-check:ignore")) {
        continue;
      }

      checked += 1;
      if (!existsSync(path.join(ROOT, reference)) && !isTruncatedByASpace(reference)) {
        findings.push({
          file: path.relative(ROOT, file).replaceAll("\\", "/"),
          line: index + 1,
          reference,
        });
      }
    }
  }
}

// GUARDS THE GUARD. A pattern that stopped matching would report "clean" having checked nothing,
// which is the failure shape context/foundation/lessons.md records. Exit 2, not 1: this is a broken
// scan, not a finding, and the two deserve different signals.
if (checked < MIN_EXPECTED_REFERENCES) {
  console.error(
    `check-doc-links: only ${checked} reference(s) extracted from ${files.length} file(s), below the ` +
      `floor of ${MIN_EXPECTED_REFERENCES}. The extraction pattern is not reading what it thinks it ` +
      `is reading — treat this as a failure, not a pass.`,
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
      "If a file moved, say where it went — do not delete the sentence.",
  );
  process.exit(1);
}

console.log(
  `check-doc-links: clean — ${checked} reference(s) across ${files.length} file(s), ` +
    `${IGNORED.length} exclusion rule(s)`,
);
