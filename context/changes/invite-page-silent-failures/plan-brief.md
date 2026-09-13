# The caretaker page's two silent RPC failures — Plan Brief

> Full plan: `context/changes/invite-page-silent-failures/plan.md`

## What & Why

`src/pages/invite/[token].astro` swallows the error from both of its RPC calls and logs neither.
The second one matters: when `get_claimed_details` fails, a caretaker who HAS claimed a slot is
served the pre-claim page with status 200 — their instructions vanish — and nobody on either side
of the screen learns anything. This is the swallowed-error class from M3L5, in a sharper form than
the lesson's own example, which at least emitted a `console.warn`.

## Starting Point

A full sweep for the pattern found the rest of the codebase clean: all six API routes log and
propagate, `src/lib/` and the middleware are clean, and every client island's `catch` sets a
user-visible message. The finding is confined to one file. The measurement it rests on:
`grep -rn "console\." src/pages/**/*.astro` returns **0**.

## Desired End State

Both failures reach the Workers log stream with the RPC name, the PostgREST error code and its
message — the shape the six API routes already use. Every rendered byte is identical to today, for
every visitor in every branch.

## Key Decisions Made

| Decision                 | Choice                                                      | Why (1 sentence)                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reveal failure behaviour | Silent degradation + logging                                | Uniform failure is pinned by `invite-view.test.ts`; a visible notice would touch a security property, and the observability gap is the part M3L5 is actually about.                    |
| Getting past lint        | Extend the `no-console` allowlist to `src/pages/**/*.astro` | `.astro` frontmatter runs server-side into the same Workers sink as endpoints, so the config's own argument ("a page's output is its HTTP response, not its log") applies unchanged.   |
| Test level               | Source test, shape-anchored                                 | `tests/unit/invite-source.test.ts` already pins six properties of this exact file and carries `stripFrontmatterComments()` — the defence against a guard passing on its own rationale. |
| Scope                    | Both branches, one file                                     | Same class, same file; splitting them would leave a second unlogged error for the next audit to re-find.                                                                               |
| Recurrence guard         | A `lessons.md` entry, no new test                           | A regex sweep over `.astro` files is the brittle-source-assertion shape this repo has already been bitten by.                                                                          |
| Documents                | `test-plan.md` §7 only                                      | It is the one document whose claim about the lint scope this change falsifies; `roadmap.md:68`'s "no application observability layer" stays true.                                      |

## Scope

**In scope:** two `console.error` calls in `[token].astro`; the `eslint.config.js` allowlist; two
new assertions in `tests/unit/invite-source.test.ts`; a now-false comment in
`ci-gate-source.test.ts`; `test-plan.md` §7; one `lessons.md` entry.

**Out of scope:** any change to rendered output; a 500 for a failed reveal; Sentry or any logger
library; a sweep of other `.astro` pages; an automated guard against recurrence; `src/lib/**` lint
scoping.

## Architecture / Approach

```
get_period_by_token  ──✗──►  loadError = true        ──►  + console.error(code, message)
                                (error card shown,          (behaviour unchanged)
                                 nothing logged)

get_claimed_details  ──✗──►  claimed = null          ──►  + console.error(code, message)
                                (pre-claim page, 200,       (behaviour unchanged)
                                 NOTHING logged at all)
                                                      └─►  eslint allowlist must widen first,
                                                           or `npm run lint` fails the gate
```

## Phases at a Glance

| Phase                         | What it delivers                                                          | Key risk                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Red test → logging → green | Both failures observable; assertions that redden if a log call is removed | A source assertion that passes on a comment instead of on code — the reason it must anchor to shape and use the file's existing comment strip |
| 2. Documents + lesson         | `test-plan.md` §7 made true; the recurring rule recorded                  | Correcting the claim in one place while another still says the old thing — this repo has done it twice                                        |

**Prerequisites:** local Supabase for the full suite; dev server killed before `check` / `commit`.
**Estimated effort:** ~1 session, 2 phases.

## Open Risks & Assumptions

- Widening the lint allowlist enlarges the surface where logging is permitted. The mitigation is
  that `allow` stays `["error", "warn"]`, so a stray `console.log` still fails the gate.
- The two rules that keep these log lines safe — never the token, never the whole error object —
  are **call-site discipline, enforced by nothing mechanical**. This change adds two more sites to
  that discipline. `eslint.config.js` records the measurement behind it: a `postgres`-owned SECURITY
  DEFINER function puts the failing row in `details`, and both RPCs here are such functions.
- The fix improves observability, not the caretaker's experience: on a failed reveal they still
  silently see the pre-claim page. That is the deliberate trade, not an oversight.

## Success Criteria (Summary)

- A failed RPC on the caretaker page appears in `wrangler tail` with its code and message.
- Removing either log call turns exactly one assertion red.
- No rendered byte changes; `invite-view.test.ts` and the six existing source cases stay green.
