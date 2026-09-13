---
change_id: supabase-cli-build-cost
title: Stop a GitHub Releases outage from killing the Cloudflare build
status: implementing
created: 2026-09-13
updated: 2026-09-13
archived_at: null
---

## Notes

Last open item from `ci-quality-gates`, and the framing it arrived with was too soft. It was
recorded as waste — "downloads a Go binary the container can never run". Measured 2026-09-13, it
is also a **deploy-blocking failure mode**, the same class the fonts change removed.

`node_modules/supabase/scripts/postinstall.js` ends in a bare `await main()` with no `catch`. A
failed download is an unhandled rejection. Measured with an unroutable proxy:

    POSTINSTALL_EXIT=1

A failing lifecycle script fails `npm ci`, which on Cloudflare Workers Builds happens BEFORE the
build command runs — so a GitHub Releases outage or rate-limit kills the deploy before `ci:gate`
has a chance to say anything. The binary is 98,396,160 B and the container has no Docker, so it
can never be used there.

There is no escape hatch: the script checks only `npm_config_global` and proxy variables. No
`SUPABASE_SKIP_DOWNLOAD` in version 2.98.2.

## What must keep working

The dependency is deliberate, not an oversight. Two real consumers:

1. **Six npm scripts** — `db:start`, `db:stop`, `db:reset`, `db:migration`, `db:push`,
   `db:gen-types`.
2. **GitHub Actions**, which runs `npx supabase start` — and `.github/workflows/ci.yml:65-67`
   argues for the devDependency explicitly: "The Supabase CLI is already a devDependency, so
   `npx supabase` is the version ... rather than supabase/setup-cli@v3, which would install a
   second, independently drifting copy."

Any fix that costs us the single-version property has to beat that argument, not ignore it.

## Not doing

- Not `npm ci --ignore-scripts` globally: `esbuild`, `sharp` and `workerd` also carry install
  hooks, and their network fallbacks are not understood well enough to disable blindly.

## Decision (2026-09-13, user)

**Remove the deploy blocker only; leave the download.** `supabase` moves from `devDependencies` to
`optionalDependencies`.

Measured mechanism, in an isolated npm project rather than inferred — a package whose `postinstall`
exits 1:

| placement              | `npm ci`   | package present afterwards |
| ---------------------- | ---------- | -------------------------- |
| `devDependencies`      | **exit 1** | —                          |
| `optionalDependencies` | **exit 0** | **no — npm drops it**      |

Verified for `npm ci` specifically, which is what Workers Builds runs.

**`--omit=optional` was considered and ruled out by measurement**, not by preference: the lockfile
carries 131 optional entries including `@cloudflare/workerd-linux-64`, `@esbuild/*` and `@img/sharp-*`.
Omitting optional dependencies would strip the platform binaries the build itself needs.

**The consequence that needs guarding.** On failure npm removes the package entirely rather than
leaving a broken one. On Cloudflare that is exactly right — nothing there can use the CLI. In GitHub
Actions it means `npx supabase start` would face a missing CLI, and `npx` would silently try to
fetch it instead of failing. The 22 integration files are the only tests that run there, so a silent
skip is the worst outcome available. Actions gets an explicit presence check.
