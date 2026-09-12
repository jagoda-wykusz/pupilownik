---
date: 2026-09-12T12:51:40+02:00
researcher: jagoda.wykusz
git_commit: 34d43a7
branch: master
repository: pupilownik
topic: "What do the API handlers actually trust, and what happens when a caller abuses it?"
tags: [research, codebase, input-validation, zod, api-routes, rls, risk-7]
status: complete
last_updated: 2026-09-12
last_updated_by: jagoda.wykusz
---

# Research: what the API handlers actually trust

**Date**: 2026-09-12T12:51:40+02:00
**Researcher**: jagoda.wykusz
**Git Commit**: `34d43a7`
**Branch**: master
**Repository**: pupilownik

## Research Question

Rollout phase 2b, Risk #7: "An API handler trusts client input (missing or weak zod), accepting
malformed or forbidden data." For each route — what does it read, what does it check, what reaches
the database unchecked, and what does a caller actually observe when they send something bad?
Explicitly NOT: re-asserting the zod schemas' own shape, which §2 names as the anti-pattern.

## Summary

**The premise of this phase is largely false, and that is the most useful finding.** Seven of the
nine routes validate correctly, and the classic "weak zod" defect — a handler that parses and then
reads around the parsed result — **does not exist anywhere in this codebase**. Every parse site
uses `parsed.data` and nothing else, including the one two-parameter route that is the natural
place to forget one.

What is real is narrower and sharper than "handlers trust input":

1. **The two pre-auth auth routes answer 500 to any body that is not form-encoded.** Measured
   against a running server, not inferred: `/api/auth/signin` and `/api/auth/signup` return **500**
   for a JSON body, an empty body, and a `text/plain` body. `await context.request.formData()`
   (`signin.ts:9`, `signup.ts:10`) is not wrapped, and `formData()` rejects with a `TypeError` for
   any other content type. Every other route in the repo wraps its body read and answers 400.
2. **Astro's origin check does not protect the path that crashes.** Also measured: without an
   `Origin` header, a form-encoded POST to `/api/auth/signin` is refused **403** before the handler
   — but a JSON-bodied POST reaches the handler and produces the 500. Astro's `checkOrigin` skips
   `application/json` by design, so the one content type that breaks these routes is the one the
   framework waves through.
3. **The database has no length bound anywhere.** Every string column in the schema is unbounded
   `text`; there is not one `varchar(n)`. `SQLSTATE 22001` is unreachable. So for `pets.name`,
   `care_periods.title`, `care_slots.claimed_by_name` and `care_instructions.title/body`, the zod
   `.max()` is not a first line of defence — it is the **only** line. And `pets` has **no oversized
   test at all**, at any layer.
4. **`pets.ts` maps no database error codes.** `periods.ts:79-99` maps `42501`/`23503`/`P0001`/
   `23502` onto clean 400s; `pets.ts:50` has no mapping, so an RLS refusal or a CHECK violation
   answers **500**. That is the exact miscategorisation `periods.ts:81-83` was written to fix, still
   live one route over.
5. **`/api/auth/signout` has no test of any kind** — zero references in `tests/`.

## Detailed Findings

### 1. What each route trusts (all nine read in full)

| Route                                        | Body read                           | Validated with                                         | Reads outside the parse?                                     |
| -------------------------------------------- | ----------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| `api/auth/signin.ts`                         | `formData()`, **unwrapped** (`:9`)  | **nothing** — `form.get("email") as string` (`:10-11`) | n/a (nothing is parsed)                                      |
| `api/auth/signup.ts`                         | `formData()`, **unwrapped** (`:10`) | **nothing** (`:11-12`)                                 | n/a                                                          |
| `api/auth/signout.ts`                        | none                                | n/a — reads no client value                            | no                                                           |
| `api/periods.ts`                             | `json()` in try/catch (`:26-30`)    | `createPeriodSchema` (`:32`)                           | **no** — `parsed.data` only (`:46`)                          |
| `api/periods/[id]/revoke.ts`                 | none                                | `periodIdSchema` on `params.id` (`:72`)                | **no** (`:78`)                                               |
| `api/periods/[id]/token.ts`                  | none                                | `periodIdSchema` (`:22`)                               | **no** (`:29`)                                               |
| `api/periods/[id]/slots/[slotId]/release.ts` | none                                | `periodIdSchema` on **both** params (`:44-45`)         | **no** (`:51-52`)                                            |
| `api/pets.ts`                                | `json()` in try/catch (`:22-25`)    | `createPetSchema` (`:27`)                              | **no** (`:32`)                                               |
| `invite/claim.ts`                            | `json()` in try/catch (`:65-69`)    | `claimSchema` (`:71`)                                  | the **cookie** (`:97`), guarded by an explicit regex instead |

`as string` on a `FormData.get()` result is a compile-time assertion over a `string \| File \| null`
union and is erased at runtime. That is the whole of the auth routes' input handling.

### 2. Measured behaviour, against a running server

Probed through `astro dev` with a matching `Origin` header, 2026-09-12. These are observations, not
readings:

| Request                                                   | Observed                                 |
| --------------------------------------------------------- | ---------------------------------------- |
| `POST /api/auth/signin`, `Content-Type: application/json` | **500**                                  |
| `POST /api/auth/signin`, empty body                       | **500**                                  |
| `POST /api/auth/signin`, `Content-Type: text/plain`       | **500**                                  |
| `POST /api/auth/signin`, proper form body                 | 302 (generic failure redirect)           |
| `POST /api/auth/signin`, form body **missing `email`**    | 302 — handled, not crashed               |
| `POST /api/auth/signup`, `Content-Type: application/json` | **500**                                  |
| `POST /api/periods/not-a-uuid/revoke`, no session         | 401 — the auth check precedes validation |
| `POST /api/pets`, JSON, no session                        | 401                                      |

And without an `Origin` header at all: the JSON body still reaches the handler (**500**), while the
form body is refused **403** by the framework. The protection and the defect are on opposite paths.

Separately, at the module level (direct handler invocation, no server): all three non-form bodies
throw `TypeError: Content-Type was not one of "multipart/form-data" or
"application/x-www-form-urlencoded"` out of the handler. The throw happens at `signin.ts:9`, before
`createClient` is called — so it needs neither Supabase nor the network to reproduce, which makes it
a **unit**-project test, not an integration one.

### 3. Existing coverage — what is already pinned

A full census of all ~40 files under `tests/`. The gaps that survive it:

| Route          | Malformed body     | Missing field      | Wrong type             | Oversized                 | Not-JSON body     | Side effect asserted |
| -------------- | ------------------ | ------------------ | ---------------------- | ------------------------- | ----------------- | -------------------- |
| `auth/signin`  | NONE               | NONE               | NONE                   | NONE                      | NONE              | NONE                 |
| `auth/signup`  | NONE               | NONE               | NONE                   | NONE                      | NONE              | NONE                 |
| `auth/signout` | NONE               | NONE               | NONE                   | NONE                      | NONE              | NONE                 |
| `periods`      | schema only        | `periods.post:107` | schema only            | `periods.post:129` (span) | `periods.post:98` | yes                  |
| `revoke`       | n/a (no body)      | n/a                | `revoke-period:180`    | n/a                       | n/a               | yes                  |
| `token`        | n/a                | n/a                | `periods.post:249`     | n/a                       | n/a               | **NONE**             |
| `release`      | n/a                | n/a                | `release-slot:171,182` | n/a                       | n/a               | yes                  |
| `pets`         | NONE               | `pets.post:112`    | `pets.post:133`        | **NONE**                  | `pets.post:143`   | yes                  |
| `invite/claim` | `invite-claim:511` | `:510`, `:409`     | `:508`, `:250`         | `:525`                    | `:507`            | yes                  |

`invite/claim.ts` is the best-covered route in the repo and needs nothing. `tests/unit/period-schema.test.ts`
covers the period schema thoroughly **at the schema**, never through a handler — and its own header
argues it is a contract test rather than a shape mirror, which is the distinction §2 cares about.

### 4. The database as second line — FROM SQL, NOT YET VERIFIED AGAINST THE CATALOGUE

Docker was down for this pass, so everything in this section is read from `supabase/migrations/`
(19 files) and must be re-measured. This repo has already been burned once by a migration comment
describing a posture the database did not have (`context/foundation/lessons.md`, 2nd entry).

- **No `varchar(n)` exists.** Every text column is unbounded, so `22001` cannot occur and zod is the
  only length bound in the system. The two hand-written exceptions are `care_periods_note_length`
  (≤2000) and `care_slots_claim_digest_format` (64 hex).
- **Value-range CHECKs exist in three places only**: `care_periods_dates_ordered`,
  `care_periods_max_span`, and the `care_slots_claim_complete` triple.
- **Every write goes through an RPC** — no route performs a direct table insert — so error shapes are
  function-mediated. `claim_slots` is the only definer-owned writer anon can reach, and its 80-char
  name bound is, in its own comment's words, "the single thing standing between an anonymous caller
  and storage amplification".
- **A forbidden-but-well-formed id is usually silent**: RLS `using` filters it, the RPC returns NULL,
  the caller gets 200 + `data: null`, and the route turns it into 404. The one exception is a foreign
  `pet_id` in period creation, where an RLS `with check` raises `42501` — which `periods.ts` maps to
  400 and `pets.ts` would answer 500 for.

**The single most important thing to verify when Docker is up**: does a non-uuid reaching Postgres
raise `22P02` at parse time, or match nothing? Every id-taking route currently guards with `z.guid()`,
so the answer decides whether that guard is load-bearing or decorative — and therefore whether a test
that removes it proves anything.

## Code References

- `src/pages/api/auth/signin.ts:9-11` — unwrapped `formData()`, then two `as string` casts
- `src/pages/api/auth/signup.ts:10-12` — the same, on the one pre-auth route that writes a row
- `src/pages/api/pets.ts:50` — DB error handling with no code mapping, so `42501`/`23514` → 500
- `src/pages/api/periods.ts:79-99` — the mapping `pets.ts` lacks, with its rationale
- `src/pages/api/periods/[id]/slots/[slotId]/release.ts:44-45` — both params validated; the trap case handled
- `src/lib/schemas/period.ts:99-106` — `z.guid()` not `z.uuid()`, and why; shape check, not authorization
- `src/lib/schemas/pet.ts:10,17,19,20,21` — the `.max()` bounds nothing tests
- `src/lib/claim-cookie.ts:31` — `CAPABILITY_SHAPE`, the one non-zod input guard
- `supabase/migrations/20260907171514_claim_secret_not_digest.sql:159-174` — the 80-char name bound and its comment
- `tests/api/invite-claim.test.ts:506-531` — the densest existing validation coverage
- `tests/unit/period-schema.test.ts` — schema-level coverage; nothing equivalent exists for pets

## Architecture Insights

- **The trust boundary is consistent and well-drawn everywhere except the auth pair.** Seven routes
  follow the same shape: read body in a try/catch → `safeParse` → use `parsed.data` → map DB error
  codes → return a Polish sentence. The auth routes predate that pattern and were never brought into
  it; `context/archive/2026-07-12-testing-auth-gating/research.md:194` flagged exactly this and
  deferred it to "the Risk-7 research pass" — which is this one.
- **"Validated" means shape, not permission, on three routes.** `periodIdSchema` is a GUID regex;
  authorization is entirely RLS. That is correct architecture, but a reader who sees `safeParse` and
  infers an ownership check would be wrong — and any test written on that assumption would pass for
  the wrong reason.
- **Bounds live in zod because the database has none.** That inverts the usual "defence in depth"
  reading: here the zod layer is not redundant with the database, it is load-bearing on its own.
- **CSRF posture is deliberate and asymmetric.** `claim.ts:54` and `revoke.ts:62` carry explicit
  origin checks; `pets.ts` and `periods.ts` do not, relying on `SameSite=Lax`, because Astro's check
  skips JSON bodies. Recorded as a knowing trade-off in
  `context/archive/2026-09-09-close-care-period/plan.md:72-75`.

## Historical Context (from prior changes)

- `context/archive/2026-07-12-testing-auth-gating/research.md:194` — "The auth handlers currently
  read `form.get(...) as string` with **no zod validation** — flag for the Risk-7 research pass."
  Still true, verbatim, fourteen months later.
- `context/archive/2026-07-12-testing-auth-gating/plan.md:33` — Risk #7 explicitly excluded from 2a.
- `context/foundation/test-plan.md:473-481` — the Polish-messages debt on `/api/pets` and
  `/api/periods/[id]/token`, deferred with a reason: copying the passthrough alone would leak
  English zod text for `species`.
- `context/foundation/test-plan.md:587-591` — `pets.ts` echoing `parsed.error.issues` is measured safe
  under zod v4 and flagged for re-evaluation on any zod major upgrade.
- `context/archive/2026-07-12-pet-and-instructions/plan.md:303` — the `.max()` caps were added during
  review and never given a test. That is the gap this change can close cheaply.

## Related Research

- `context/archive/2026-07-12-testing-auth-gating/research.md` — the pass that deferred this one
- `context/archive/2026-09-11-testing-secret-leak/plan.md:43` — the decision not to change `pets.ts`'s
  issue echoing

## Open Questions

1. **Does a non-uuid reaching Postgres raise `22P02`, or match nothing?** Decides whether the
   `z.guid()` guards on three routes are load-bearing. Needs Docker.
2. **What SQLSTATE does a malformed `date` argument produce** — `22007`/`22008` as the SQL suggests,
   or `22P02`? Nothing in the repo states it.
3. **Is `error.details` really suppressed under RLS but populated for definer functions?**
   `periods.ts:64-77` asserts this as measured; two other files repeat it. Worth re-measuring before
   any test depends on it.
4. **Should the 500 on the auth routes be fixed, or only pinned?** Fixing it is a ~6-line change
   (wrap `formData()`, return the same generic redirect). Pinning it without fixing documents a
   defect as intended behaviour. This is a decision for the plan, not for research.
5. **Does `z.guid()` accept the same set as Postgres's `uuid_in`?** Postgres also accepts braces and
   the hyphenless 32-hex form; if zod rejects those, the handler answers 400 where the database would
   have answered 404 — a divergence a test could easily mis-attribute.
