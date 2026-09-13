<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Restore the freshness ledger to its schema and pin the shape

- **Plan**: context/changes/ledger-line-drift/plan.md
- **Scope**: Phase 1 of 1 (6/6 Progress rows complete)
- **Date**: 2026-09-13
- **Verdict**: NEEDS ATTENTION → the warning and four of five observations FIXED before archive; F6 recorded
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

The deletion was safe and the guard works. One reviewer recovered the 1167-character line from git and
checked all eleven clauses against the current document individually — every one is substantively
recoverable, often from something richer than the clause (§3 carries a 38-line note where the clause
had half a sentence). The other verified the regex by execution, confirmed neither `it` can pass
vacuously, and rated the gate's false-positive risk low.

The warning is about prose, not code: a comment states a failure mode that does not exist, in a repo
whose recorded lesson is precisely about prose that misdescribes the line it justifies.

## Findings

### F1 — A comment states a failure mode that does not exist

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/unit/test-plan-shape.test.ts:54-55
- **Detail**: The comment says that unescaped, the parentheses "would be a capture group and the
  pattern would match a bullet that does not contain them at all." Measured, and **neither my claim
  nor the reviewer's correction was right**:

  | pattern       | vs the real line    | vs a different bullet |
  | ------------- | ------------------- | --------------------- |
  | escaped       | matches             | no                    |
  | **unescaped** | **no match at all** | no                    |

  An unescaped `(§1–§5)` is a group that still requires its literal contents, so it demands
  `§1–§5` WITHOUT parentheses — which the document does not contain. `exec` returns undefined, the
  `?? ""` yields an empty string, and the shape assertion fails. So the escaping is a precondition
  for the test working at all, and getting it wrong is LOUD rather than silent. That is better news
  than either version of the comment, and it is the version worth writing down.

  This matters more here than elsewhere: `lessons.md` records "Asercja podciągiem trafia we własne
  uzasadnienie" — prose that outlives and misdescribes the line it justifies. A reader trusting this
  comment learns a false fact about JavaScript regular expressions.

- **Fix**: State the measured truth: the prefixes are literals, escaping is unconditional so a future
  prefix containing `.`, `+` or `?` cannot silently become a wildcard, and a missed escape fails the
  test rather than weakening it.
- **Decision**: FIXED

### F2 — Both patterns search the whole document, not §8

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Safety & Quality
- **Location**: tests/unit/test-plan-shape.test.ts:57, :62
- **Detail**: Found independently by both reviewers. The header describes this as a §8 guard, but the
  presence check and the shape `exec` both scan the entire file and take the first match anywhere.
  Two concrete consequences: a stray `- Stack versions last verified: …` line elsewhere would satisfy
  the presence floor even if §8 were gutted; and if any section ever illustrates the forbidden shape
  — `- Strategy (§1–§5) last reviewed: 2026-09-13 (§7 gained X) ← what not to do` — sitting before
  line 916 it would be the match, turning the suite red over its own rationale. One step from the
  recorded lesson.
- **Fix**: Slice the §8 block (heading to the next `## `) and run both patterns against that slice.
- **Decision**: FIXED

### F3 — `LEDGER_BULLETS` is an allow-list, and a fourth bullet is invisible to it

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Safety & Quality
- **Location**: tests/unit/test-plan-shape.test.ts:32-36
- **Detail**: The schema defines §8 as exactly three bullets, so a fourth is itself drift — and the
  guard cannot see it. Worse, now that the three named bullets are defended, a fourth is the obvious
  place for the next changelog to accrete: `- Risk map last reviewed: 2026-10-01 (§2 gained risk #6;
…)` passes green.
- **Fix**: Closed by the same §8 slice as F2 — assert the block holds exactly three bullets.
- **Decision**: FIXED

### F4 — The added paragraph is five lines where the plan said one sentence

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md §8
- **Detail**: The plan's contract was "one short sentence… saying what this section is and is not".
  What shipped is a five-line, three-sentence narrative of what happened to the section. It reads as
  a rule rather than an apology, so criterion 1.6 holds — but the reviewer named the irony precisely:
  this is changelog prose, in §8, immediately below the line it was cut from, and the new test cannot
  see it because it only reads the three bullets.
- **Fix**: Cut it to the rule and drop the incident narrative, which §7 and this report already hold.
- **Decision**: FIXED

### F5 — "ignored ELEVEN times" conflates clauses with commits

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Pattern Consistency
- **Location**: tests/unit/test-plan-shape.test.ts:8-9
- **Detail**: Eleven is the exact CLAUSE count. The reviewer counted the commits that actually
  appended to the line at nine — some added two clauses. The §8 prose is careful and says only
  "eleven semicolon-separated clauses"; the test header is the one that converts clauses into events.
- **Fix**: Say "eleven clauses" and drop the event count, which nothing depends on.
- **Decision**: FIXED

### F6 — The plan's claim that every clause duplicated content is overstated

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Plan Adherence
- **Location**: context/changes/ledger-line-drift/plan.md, change.md
- **Detail**: All eleven clauses are substantively recoverable, and the four spot-checks the plan
  named were each verified true. But two SUB-clauses are genuinely gone and appear nowhere in §2, §3,
  §5 or §7: "which the island-prop change added to `ci:gate` without updating the inventory", and
  "five stale `context/changes/` links were repointed at their archive paths". Both are process
  trivia — who edited what, when — rather than domain facts or decisions, so the deletion stands. The
  overstatement is the finding: "every one duplicates content elsewhere" was true at clause level and
  not at sub-clause level, and a claim about a deletion is exactly the kind that should be exact.
- **Fix**: Record the two lost sub-clauses here. The plan and change.md are historical record and
  stay as written.
- **Decision**: RECORDED — the two lost sub-clauses are named above; the plan and change.md stay as written, being historical record.

## What was checked and found clean

- **The deletion**: all eleven clauses recovered from `a19653b^` and checked individually against the
  current document. Nothing of substance lost.
- **The schema**: the restored line matches `test-plan-schema.md:323` character for character, en
  dash included, and the added paragraph violates none of the schema's "Forbidden content" rules.
- **All four "not doing" boundaries held**: no relocation, nothing touched outside §8 and the new
  test, the schema unchanged, and the test asserts date SHAPE rather than any literal date.
- **Neither `it` can pass vacuously** — constructed and run: an absent bullet yields `""` and the
  shape assertion fails.
- **Encoding round-trips**: the file is UTF-8 without BOM, LF-only via `.gitattributes`, and the en
  dash and `§` are not regex metacharacters. Even under CRLF the extraction would be safe.
- **No cross-bullet leakage**: each bullet's pattern tested against the other two — all false.
- **Gate false-positive risk is low**: the only edits that fail are edits that genuinely violate the
  schema.
- **The factual claims in §8** are exact — 1167 characters and eleven clauses both verified against
  `a19653b^`.
