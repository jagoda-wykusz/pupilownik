---
change_id: warnings-block-publication
title: Make a warning stop a deploy, and stop mis-calibrating no-console for server routes
status: planned
created: 2026-09-12
updated: 2026-09-12
archived_at: null
---

## Notes

Closes follow-up #3 of `ci-quality-gates`
(`context/archive/2026-09-11-ci-quality-gates/follow-ups/review-fixes.md`), which posed a false
choice: "clean up the warnings and add `--max-warnings 0`, or accept that warnings are advisory".

Measured 2026-09-12, and both horns are wrong. All 12 warnings are `console.error` in Astro
endpoints under `src/pages/**/*.ts` — deliberate server-side observability, some with comments
like "Never log inviteToken". There is no logging library in this project and Workers
observability is on, so `console.error` IS the log sink. "Cleaning up" would mean deleting
working observability. The rule is mis-calibrated, the code is not dirty.

`eslint.config.js` already carries the precedent, for `scripts/**/*.mjs`:
"A CLI script's output IS its interface." — `no-console: off`.

## Decisions (2026-09-12, user)

1. **Allow only `error` and `warn` in `src/pages/**/\*.ts`**, not a blanket `off`. Endpoints are
server-only under `output: "server"`; `.astro`and`.tsx`are separate config blocks, so client
code keeps the rule and gains real enforcement. A`console.log`left behind after debugging
still stops the deploy — which a blanket`off` would not.
2. **Close the astro-check half in the same change.** `astro check` exits on `error` only, so a
   rule at warning severity contributes nothing to the gate — the same shape of problem.
   Measured: `--minimumFailingSeverity warning` exits 0 today (0 errors, 0 warnings, 5 hints), so
   it costs nothing; `hint` exits 1 and would require clearing 5 `ts(6387)` deprecations in
   eslint.config.js.

## Not doing

- Not widening the console allowance to `src/lib/**`. It is imported by client islands, so the
  rule genuinely matters there.
- Not clearing the 5 `ts(6387)` hints, and therefore not raising the threshold to `hint`.
