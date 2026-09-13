<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Fail the gate when a document points at a file that no longer exists

- **Plan**: context/changes/doc-link-checking/plan.md
- **Scope**: All 2 phases (11/11 Progress rows complete)
- **Date**: 2026-09-13
- **Verdict**: REJECTED → both criticals and six of the eight remaining findings FIXED before archive; F7 and F9 recorded
- **Findings**: 2 critical, 5 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Both reviewers converged independently on the same two critical problems, and both were reproduced
before being accepted. The checker works — 490 references, three genuine findings on its first run —
but it has a false-negative hole in exactly the class it was built for, and a false-positive risk
that can block every deploy.

## Findings

### F1 — `isTruncatedByASpace` swallows genuinely dead references

- **Severity**: CRITICAL
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: scripts/check-doc-links.mjs:96
- **Detail**: The helper treats ANY prefix-sharing sibling as proof the reference was cut at a
  space. It never checks that a space is there. Despite its name it is prefix-matching, not
  space-matching. Reproduced against this repo:

  | reference                      | exists | swallowed                              |
  | ------------------------------ | ------ | -------------------------------------- |
  | `context/changes/doc-link`     | no     | **yes** (by `doc-link-checking`)       |
  | `context/changes/supabase-cli` | no     | **yes** (by `supabase-cli-build-cost`) |
  | `src/lib/period`               | no     | **yes** (by `period-format.ts`)        |
  | `src/lib/invite`               | no     | **yes** (by `invite-token.ts`)         |

  The first two are the archive-breakage shape this whole change exists to catch: an archived
  change folder whose truncated id is a prefix of a surviving sibling becomes invisible. The second
  reviewer reproduced the same class independently with
  `context/changes/close-care-period` swallowed by `close-care-period-followup`, and found 13
  prefix-sharing pairs in the repo, including `.env` / `.env.example`.

- **Fix**: Require evidence of an actual truncation: `entry.startsWith(prefix + " ")`. That matches
  the `Pupilownik Hi-fi.html` case exactly and nothing else.
- **Decision**: FIXED

### F2 — A plan naming a file it is about to create blocks every deploy

- **Severity**: CRITICAL
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: scripts/check-doc-links.mjs (scan scope) + package.json `ci:gate`
- **Detail**: `context/changes/**` is scanned as a source. The `/10x-plan` workflow writes plans
  that name the files a change is ABOUT to create — this repo's normal authoring loop, with three
  change folders open right now. Reproduced: adding `**File**: src/lib/services/notify.ts (new)` to
  a plan makes the checker report it. Because the step is FIRST in an `&&`-chained `ci:gate`,
  nothing publishes — including changes unrelated to that document. The exclusions cannot help: a
  planned path is syntactically identical to a dead one.

  This is the reverse of the failure the change was designed around. The plan's own framing —
  "the hard part is not finding dead links, it is not crying wolf" — argued for exactly this
  caution and then missed the loudest case.

- **Fix**: Exclude `context/changes/**` as a SOURCE, the same way `context/archive/**` already is,
  keeping both as valid TARGETS. In-flight plans are aspirational by nature; the references that
  actually rot live in `context/foundation/**`, `docs/**`, `src/**` and the workflow files.
- **Decision**: FIXED

### F3 — Two of the four advertised exclusion rules are dead code

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/check-doc-links.mjs:66-69, :74-77, :171
- **Detail**: Measured by splicing each rule out and re-running. The glob rule can never fire: `*`
  is not in the capture class `[\w./\[\]-]`, so `tests/**/*.test.ts` is extracted as `tests/`,
  which exists. The npm-package-name rule can never fire for its stated purpose either: the
  lookbehind `(?<![\w/.@-])` already rejects anything preceded by `@`, verified —
  `import ... "@supabase/ssr"` yields zero matches. Its comment is therefore false as written, and
  the rule is simultaneously BROADER than the plan authorised, since it also suppresses a bare
  `supabase/ssr` with no `@`.

  The same truncation that kills the glob rule is an undocumented suppressor in its own right: any
  reference containing an out-of-class character is cut back to its longest prefix, and if that
  prefix is a real directory the finding disappears. `context/changes/<id>/plan.md` →
  `context/changes/` → clean. Nothing in the header, `IGNORED` or §7 says so.

  The summary line prints `4 exclusion rule(s)`, which is wrong in both directions: two are inert,
  and the count omits the lookbehind, the truncation effect, `isTruncatedByASpace` and
  `link-check:ignore` — seven mechanisms, one counted.

- **Fix**: Correct each `why` to say what the rule actually does, drop or re-label the unreachable
  ones, document the truncation suppressor in the header, and stop printing a count that means
  nothing.
- **Decision**: FIXED

### F4 — The test claims "first in the chain" and pins only "before the typecheck"

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/unit/ci-gate-source.test.ts:231, :256
- **Detail**: Found by both reviewers. The block is named "checks documentation links, first in the
  chain" and its comment calls the position "part of the contract, not a preference" — but the
  assertion is `expect(links).toBeLessThan(typecheck)`. Prepending any step
  (`npm run format && npm run check:links && …`) leaves every assertion green while destroying the
  property the comment argues for. This is the "comment claims more than the assertion" failure
  this very file's header sermonises about.
- **Fix**: `expect(gate.trimStart().startsWith("npm run check:links")).toBe(true)`.
- **Decision**: FIXED

### F5 — The new workflow step was inserted inside another step's comment block

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: .github/workflows/ci.yml:81-86
- **Detail**: The link-check step landed between the 17-line comment about the Supabase CLI's 98 MB
  binary and `--no-install`, and the step that comment describes. The prose now reads as
  documentation for the link checker, and the step it belongs to has none.
- **Fix**: Move the new step above that comment block.
- **Decision**: FIXED

### F6 — An uncaught read error exits 1, the code reserved for findings

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/check-doc-links.mjs:48, :107
- **Detail**: Neither `walk()` nor `readFileSync` is guarded. `EACCES`, `EBUSY` (common on Windows
  with a file open in an editor or under AV), a dangling symlink or an `EISDIR` throws uncaught, and
  Node exits 1 — indistinguishable from "dead links found", under the exit code this file's own
  convention reserves for findings.
- **Fix**: Wrap both; on failure exit 2, which is what the convention says.
- **Decision**: FIXED

### F7 — `existsSync` is case-insensitive on Windows, so local runs disagree with CI

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: scripts/check-doc-links.mjs:135
- **Detail**: Verified: `existsSync("docs/reference/Agent-Hooks.MD")` returns true here and would
  return false on the Linux runner and in the Cloudflare container. A Windows author sees `clean`,
  pushes, and the deploy is blocked by a link they cannot reproduce locally.
- **Fix**: Compare the final segment against `readdirSync(dirname)` with an exact string match.
- **Decision**: RECORDED — real, but separate work; the header and this report both name it.

### F8 — §7 documents the two undocumented extras and none of the four planned rules

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md §7 entry
- **Detail**: The plan's contract for §7 was to explain "the false-positive taxonomy, so the next
  person who wants to simplify the exclusions knows which real string each one is for". The entry's
  table covers paths-with-spaces and documents-about-dead-links — neither of which is one of the
  four planned rules. The GitHub Action ref (`supabase/setup-cli@v3`) and the migration template
  placeholder, the only unambiguously live rules, are not mentioned. The promise is inverted.
- **Fix**: Extend the taxonomy to name every live mechanism and its forcing string.
- **Decision**: FIXED

### F9 — The floor is a corpus-size proxy, not a positive control

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Safety & Quality
- **Location**: scripts/check-doc-links.mjs:45, :149
- **Detail**: `MIN_EXPECTED_REFERENCES = 200` conflates two unrelated events. A legitimate
  documentation cull, or archiving several change folders at once, walks the count toward the floor
  — and when it trips, the message asserts the pattern is broken, which would be false, and the
  only fix is editing the constant. Conversely a regex broken so that it still matches `src/` would
  keep the count far above 200 and never fire. `check-client-bundle.mjs` uses a content-based
  control instead, which fails deterministically.
- **Fix**: Add a deterministic self-test of the pattern against a fixed fixture; keep a much lower
  floor purely as "did we read any files".
- **Decision**: RECORDED — real, but separate work; the header and this report both name it.

### F10 — Small truths that are stale or over-broad

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Pattern Consistency
- **Location**: scripts/check-doc-links.mjs:22, :41, :56, :114
- **Detail**: Four minor items, grouped. The header's measured numbers (439 / 118) are already
  stale — it is 490 / 146. `SKIP_DIRS` holds the bare name `archive`, so any directory so named
  anywhere drops out of the scan, broader than the "What We're NOT Doing" clause. `t.replace(".",
"\\.")` escapes only the FIRST dot; correct for every current entry but silently wrong for a
  future two-dot one. The trailing-punctuation strip is nearly dead code — only `.` can appear in a
  match — so its comment overstates what the line does.
- **Fix**: Refresh the numbers, scope the skip to `context/archive`, use `replaceAll`, and correct
  the strip's comment.
- **Decision**: FIXED

## What was checked and found clean

- **Exit-code convention** matches `check-client-bundle.mjs`: 1 = finding, 2 = broken scan.
- **Ordering indices are floored** before comparison — the trap this file documents at :96 was
  avoided in the new block.
- **The workflow regex is line-anchored**, so a YAML comment cannot satisfy it.
- **Symlink cycles cannot blow the stack**: `withFileTypes` reports a symlinked directory as not a
  directory, so it is never recursed.
- **Runtime is negligible**: 391–470 ms over three runs, 146 files, 1.15 MB.
- **The lookbehind works as documented** — `@supabase/ssr` and `@astrojs/*` produce zero matches.
- **The three genuine findings are correctly fixed** and every path in the rewritten `AGENTS.md`
  line was verified to exist.
