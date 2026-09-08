---
date: 2026-09-06T14:51:07+0200
researcher: jagoda.wykusz
git_commit: 863288df36995ace51a48768f6a9254939913815
branch: master
repository: pupilownik (10xdev)
topic: "S-03 caretaker-claims-slot — anonymous claim, atomicity, and the sensitive-instruction reveal"
tags: [research, codebase, care-slots, invite-token, security-definer, atomicity, fr-008]
status: complete
last_updated: 2026-09-06
last_updated_by: jagoda.wykusz
last_updated_note: "Appended §6 — the fourth agent's blast-radius findings, which landed after the document was first written"
---

# Research: S-03 caretaker-claims-slot

**Date**: 2026-09-06T14:51:07+0200
**Researcher**: jagoda.wykusz
**Git Commit**: 863288df36995ace51a48768f6a9254939913815
**Branch**: master
**Repository**: pupilownik

## Research Question

What must S-03 (`caretaker-claims-slot`) build, and what does the shipped codebase already
decide for it? Scoped to five areas chosen by the owner: the period → pet → instructions
relation; the sensitive-instruction reveal without caretaker identity; the anon write path;
the atomicity proof; and the UI/design layer.

## Summary

**The roadmap lists one unknown for S-03 (atomicity). Research found that to be the
best-solved part of the slice, and surfaced two larger items that are not tracked anywhere.**

1. **There is no relation from a care period to a pet.** `public.care_periods` has no
   `pet_id` and no join table, so `care_instructions` — which hangs off `pets` — is
   unreachable from a period. FR-008 (the caretaker sees public instructions on arrival) is
   therefore **not implementable at all** until this is built. S-02's plan deferred the
   _reveal rule_ explicitly but deferred the _relation_ silently.
2. **The unit of the reveal is contested by the project's own documents.** The PRD's
   Non-Goals forbid caretaker identity and FR-010 was cut _for lack of it_; the roadmap, the
   test plan and the hi-fi design all assume a per-person reveal. This is a product decision
   a plan cannot make.
3. **Atomicity is already 95% solved by S-02's schema.** The remaining work is a function
   body and a test — and the test can only prove the _outcome_, not that the row lock was
   exercised. Say so rather than claiming proof.
4. **`get_period_by_token` cannot be extended to claim.** It is declared `STABLE`
   (verified: `provolatile = 's'`), and Postgres forbids writes in a STABLE function. S-03
   must add a second, `VOLATILE` `SECURITY DEFINER` function. This is a hard constraint, not
   a preference, and it removes "just extend the existing function" from the option space.

## Decisions (owner, 2026-09-06)

Both blocking questions from §Open Questions are settled. Recorded here so `/10x-plan`
inherits them rather than re-deriving them.

### D1 — The reveal is conditioned on the CLAIMER, not the claim event

Sensitive instructions become visible to the person who took the slot, not to every holder of
the link. This accepts the lightweight caretaker identity that `prd.md:116` deferred to v2.

What follows, mechanically:

- **A per-claim secret is required.** Minted by the app the way the invite token is
  (`src/lib/invite-token.ts` is reusable verbatim), digest-only in the database, raw value
  returned exactly once and carried by the browser.
- **Three functions, not one.** `get_period_by_token` stays `STABLE` and read-only and gains
  the PUBLIC instruction rows. The claim needs a new `VOLATILE` `SECURITY DEFINER` function.
  The sensitive read needs a third surface taking (invite token + claim secret) — it must not
  be a second parameter on `get_period_by_token`, because `data-access.md:91-92` forbids "a
  parameter that could widen the result set" on that function.
- **A first-of-its-kind cookie write.** This repo has no precedent for the app setting its own
  HttpOnly cookie; `ThemeToggle.tsx` writes `document.cookie` client-side and only
  `@supabase/ssr` writes server-side. `src/middleware.ts` already sends `Cache-Control:
no-store` for `/invite/*`, which is exactly what a cookie-varying response needs.
- **`test-plan.md:65` becomes the authoritative phrasing of Risk #4** ("sensitive fields
  appear only to a caretaker who has claimed"), and `:53` must be reworded to match. Open
  question 8 is resolved by this decision.
- **Three cases the plan must answer explicitly**: the same caretaker on a second device or in
  incognito (loses the reveal); a shared or borrowed device (retains it); and an owner
  un-claiming a slot, which must invalidate the claim secret — nothing in the schema forces
  that today.

**One reconciliation to make deliberately, not silently.** `prd.md:144` (§Non-Goals) reads
_"Brak kont i tożsamości opiekunów — opiekun zostaje przy modelu 'link + imię'; żadnych
logowań, profili ani historii."_ A per-claim capability secret is arguably **not** what that
forbids: there is no login, no profile and no history — only a bearer capability, which the
invite link already is. That is a defensible reading and it means the PRD may need a
clarification rather than an amendment. But it IS a reading, and the plan should state which
one it is taking instead of leaving a reader to discover the tension.

### D2 — The period ↔ pet relation gets its own change

It is not S-03's scope. Consequence, which the plan must not paper over: **S-03 as scoped
cannot deliver FR-008 at all**, in either half. There is no path from a period to
`care_instructions`, so neither the public-on-arrival part nor the sensitive-after-claim part
is reachable until the relation change ships. FR-008 is `must-have` priority
(`prd.md:107`), and the roadmap's own S-03 outcome text
(`roadmap.md:123`) includes both halves of the reveal.

**Sequencing decided (owner, 2026-09-06): the relation change is a hard prerequisite,
sequenced before S-03.** S-03 keeps its roadmap outcome whole and no document needs
re-wording. The alternative — S-03 first without instructions — was rejected; it would have
left FR-008 (`must-have`) undelivered across two slices and forced a roadmap re-word.

Note for `/10x-plan`: this means **S-03 is blocked** until the relation change ships, and the
relation change inherits §6's finding that the pet selector is unfinished S-02 scope rather
than new functionality.

## Detailed Findings

### 1. The missing period → pet → instructions relation

**`care_periods` today** (`supabase/migrations/20260905234144_care_periods_and_slots.sql:20-33`,
mirrored in `src/db/database.types.ts`): `id`, `owner_id → auth.users`, `title`, `start_date`,
`end_date`, `token_digest`, `revoked_at`, `created_at`. **No pet reference of any kind.**

**`care_instructions`** (`supabase/migrations/20260712204748_pets_and_instructions.sql`):

```sql
create table public.care_instructions (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets (id) on delete cascade,
  title text not null,
  body text,
  is_sensitive boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
```

Two things matter for the reveal:

- **Sensitivity is per ROW, not per field.** An instruction is wholly public or wholly
  sensitive. So the reveal is a row filter (`where is_sensitive = false`), not a field mask —
  materially simpler than it could have been.
- **Ownership is transitive** through `pets.owner_id`; all four RLS policies are
  `to authenticated` (`:78`, `:87`, `:96`, `:109`) with grants to `authenticated` only
  (`:47`). An anon caretaker can reach none of it, which is why the reveal must go through a
  `SECURITY DEFINER` function like everything else on this path.

**Cardinality: the evidence says many-to-many.**

- `context/foundation/prd.md:88` — FR-002's recorded Socratic resolution: _"encja zostaje —
  **jeden okres może obejmować kilka zwierząt** o różnych instrukcjach."_ This is the
  strongest statement and it is a decision, not a hint.
- The hi-fi design agrees twice: the owner's "Nowy wyjazd" screen has a section labelled
  **"KTÓRE ZWIERZĘTA"** listing two pets (`hf-trip-burek`, `hf-trip-mru`), and the
  caretaker's calendar header reads **"Opieka: Burek & Mru"** with a side chip _"Mru też"_ on
  the post-claim screen.
- Nothing in the PRD, roadmap or S-02's plan contradicts it.

→ **A join table** (e.g. `care_period_pets (period_id, pet_id)` with a composite PK) is the
shape the evidence supports, not a `pet_id` column on `care_periods`.

**Blast radius — every consumer of `care_periods`.** `context/foundation/lessons.md` makes
enumerating these mandatory before changing a shared surface. Adding pets to a period touches:

| Consumer                                                                                                                             | Impact                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `supabase/migrations/20260905234144_…sql`                                                                                            | the table, its 4 RLS policies, its grants                               |
| `create_period_with_slots(text,date,date,text)`                                                                                      | **signature change** — see below                                        |
| `get_period_by_token(text)`                                                                                                          | must return instructions; but it is STABLE (§3)                         |
| `regenerate_period_token(uuid,text)`                                                                                                 | unaffected                                                              |
| `src/pages/api/periods.ts`                                                                                                           | must accept and pass pet ids                                            |
| `src/lib/schemas/period.ts` (`createPeriodSchema`)                                                                                   | new field + bounds                                                      |
| `src/components/periods/NewPeriodForm.tsx`                                                                                           | new control — the design's "KTÓRE ZWIERZĘTA"                            |
| `src/pages/periods/index.astro`, `[id].astro`                                                                                        | may show which pets a period covers                                     |
| `src/pages/invite/[token].astro`                                                                                                     | the caretaker's instruction block                                       |
| `tests/rls/care-periods.isolation.test.ts`, `care-slots.isolation.test.ts`, `invite-token.test.ts`, `tests/api/periods.post.test.ts` | all four seed periods through the RPC → all break on a signature change |
| `src/db/database.types.ts`                                                                                                           | regenerate                                                              |
| `docs/reference/contract-surfaces.md`                                                                                                | `create_period_with_slots` row + any new function                       |
| `docs/reference/data-access.md`                                                                                                      | the token-model section describes the payload                           |

**The `create_period_with_slots` signature problem.** Grants are **per-signature**. Adding a
parameter creates a new function identity with fresh Supabase default privileges — which
means the `revoke … from public, anon, service_role` / `grant … to authenticated` pair must be
re-applied, or anon silently regains execute. This project has been bitten by that class of
mistake three times (recorded at `20260905234144_…sql:180-188` and `20260906003122_…sql:153-165`).
**Correction — see §6.** My first reading here was that an added parameter with a default is
the lower-risk shape. It is not: an added parameter creates a _second_ function (an overload)
which gets its own fresh default grants **and** leaves the old signature reachable with its
existing grant. §6 has the full reasoning and the opposite recommendation.

**Migration ordering.** Existing periods have no pets. A `not null` link on a join table is
fine (absence = no rows), which is another argument for the join table over a `not null`
column on `care_periods`.

### 2. The reveal without identity — the decision a plan cannot make

FR-008 and US-02 require public instructions on arrival and sensitive ones after the claim.
The question is whether "after the claim" is conditioned on the **event** or on the
**claimer** — and a caretaker has no identity, because everyone holds the same token.

**Written support for the person reading:**

- `context/foundation/prd.md:69` — US-02: _"wrażliwa część instrukcji staje się **dla niej**
  widoczna"_
- `prd.md:108` — FR-008's resolution: _"odsłaniają się dopiero **osobie, która wzięła slot**"_
- `prd.md:138` — §Access Control: _"po zajęciu slotu odsłania **mu** się…"_
- `context/foundation/roadmap.md:21` — elevated to the product differentiator: _"odsłaniają
  się dopiero **osobie, która faktycznie wzięła slot**"_
- `context/foundation/test-plan.md:65` — the pass condition: _"only **to a caretaker who has
  claimed**"_
- **The design, and this is the strongest evidence:** the post-claim artboard renders
  **"Zapisano! Masz 2 dni: 13 i 16 lipca"** — second person, _your_ days, aggregated across
  the slots this viewer holds. **That screen cannot be rendered without per-person state.** A
  Polish pronoun in prose can be explained away as narration; a UI state cannot.

**Written support for the event reading:**

- `prd.md:121` — the §NFR confidentiality clause has **three** parts, and the third names the
  boundary: _"nie jest dostępna bez ważnego linku ani przed zajęciem slotu; **nie wycieka poza
  zaproszony krąg**."_ The unit of confidentiality is the _circle_, not the individual.
- `prd.md:75`, `:107` — the AC and FR-008's body are impersonal: _"dopiero po zajęciu slotu"_.
- `test-plan.md:53` — Risk #4 states the failure as _"shown **before** a slot is claimed, or
  to someone **outside** the invite link"_ — neither of which an event reveal commits.
  **The same risk is written two ways in one file** (`:53` vs `:65`).

**And the constraint that makes this a real conflict:**

- `prd.md:144` — §Non-Goals: _"**Brak kont i tożsamości opiekunów** — opiekun zostaje przy
  modelu 'link + imię'; żadnych logowań, profili ani historii."_
- `prd.md:116` — FR-010 (caretaker releases own claim) was **cut from the MVP** precisely
  because _"bez tożsamości opiekuna trudne i ryzykowne… Kandydat do v2 (**po dodaniu lekkiej
  tożsamości opiekuna**)"_.

So a per-person reveal requires exactly the lightweight caretaker identity the PRD deferred to
v2 — while the roadmap, the test plan and the design all assume it. This is not ambiguity in
the reading; it is a contradiction between the sources.

**Mechanisms, against the four token-model rules in `docs/reference/data-access.md:80-111`:**

| #   | Mechanism                                                                  | Rule compatibility                                                                                                                                                                   | Cost                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Per-claim secret ("claim token"), digest stored on the slot, returned once | Compatible — it is rule 1 applied twice. But the extra parameter must live in a **separate** function to stay clear of _"no parameter that could widen the result set"_ (`:91-92`)   | The raw secret must live in the browser → collapses into B, or becomes a second bearer credential in the same history/proxy-log class (`:118-120`)                                                                                              |
| B   | Cookie set on claim                                                        | Alone: incompatible. If it carries only `claimed=<id>` it is client-forgeable and there is no boundary; if it carries a verified secret it _is_ A with a cookie carrier              | This repo has **zero** precedent for the app setting its own HttpOnly cookie (`ThemeToggle.tsx` writes `document.cookie` client-side; only `@supabase/ssr` writes server-side). Per-browser → lost on a second device, retained on a shared one |
| C   | Reveal to every link-holder once claimed                                   | **Compatible with all four rules, nothing bent.** The literal shape of _"extends this function"_ (`:108-111`)                                                                        | The trigger is undefined by every document (this slot? any? all?), and it contradicts `roadmap.md:21` / `test-plan.md:65`, which would need re-wording                                                                                          |
| D   | One link per caretaker (token = identity)                                  | Compatible, and per-person falls out free                                                                                                                                            | Contradicts FR-005's recorded resolution (`prd.md:96-97`: _"jeden link… najniższe tarcie"_) and needs a new table — `token_digest` is a single `not null` unique column                                                                         |
| E   | Server-side anon session (claims table + opaque cookie)                    | A + B combined                                                                                                                                                                       | Is "lekka tożsamość opiekuna" under another name                                                                                                                                                                                                |
| F   | Scoped JWT per claim                                                       | **Forbidden.** `context/archive/2026-09-06-care-period-and-invite-link/plan.md:18-21` records that _"There is no service_role client in the request path, by design"_ rules this out | —                                                                                                                                                                                                                                               |

**Abuse lens.** Under **C**, a link-holder who never claimed sees the address and access codes
— which is the failure `test-plan.md` Risk #4 tracks under one of its two phrasings. Under
**A/E**, a claimer keeps the secret after an owner un-claims them unless the un-claim also
clears the claim digest, and nothing in the schema forces that. **No mechanism survives a
screenshot**, and none narrows the link's bearer-credential exposure.

**Why `claimed_by_name` cannot help.** It is unbounded `text`, no uniqueness, no FK, no
browser binding (`20260905234144_…sql:50`), and `prd.md:110` accepts it unverified. The
database can answer _"is this slot claimed?"_ and cannot answer _"did **you** claim it?"_ Two
caretakers typing "Ania" are indistinguishable rows, and S-05/FR-011 puts names on screen
where a third party can read one and type it back.

### 3. The anon write path

**Hard constraint, verified directly against the running database:**

```
proname                  | volatility | security_definer
get_period_by_token      | stable     | t
create_period_with_slots | volatile   | f
regenerate_period_token  | volatile   | f
```

`get_period_by_token` is `STABLE`, and Postgres refuses writes in a STABLE function. **The
claim cannot be an extension of it.** S-03 adds a second `SECURITY DEFINER` function that
must be `VOLATILE` (the default — do not copy `stable` from the existing one).

`docs/reference/data-access.md:108-111` explicitly sanctions this: _"a new caretaker
capability extends this function (**or adds another one under the same four rules**). …
**S-03's slot claiming** and S-04's occupancy view both land under this rule."_

But note the rules are **read-shaped in their details**: rule 2's requirements are all about
result sets, and rule 4's uniform-failure contract ("return NULL") cannot express a claim's
success-vs-refusal. A write inevitably signals refusal, which is a small, real widening of
rule 4 that the plan should record rather than paper over.

**What the function body must validate** — it is the entire authorization boundary; there is
no RLS behind it, and anon holds no table grants at all (asserted as 42501 in
`tests/rls/invite-token.test.ts:130-143`):

1. **Bound `p_token` length before hashing** — 43 chars, as
   `20260906105815_bound_token_length.sql:30` does. An unauthenticated caller can otherwise
   make the database hash megabytes before a guaranteed index miss.
2. **Derive the period from the token; never accept a period id.** This makes "a token for
   period X cannot touch period Y" structural rather than checked.
3. **Bind the slot id to the derived period** — `and s.period_id = v_period.id`. This is the
   one genuinely new check with no precedent in the read function. A leaked slot uuid from
   another period is a _valid_ uuid; only the join stops it. `test-plan.md:66` names this as
   the IDOR anti-pattern: unguessable ≠ scoped.
4. **Re-check `revoked_at is null` in the same statement**, not only at resolve time.
5. **`and claimed_by_name is null`** — the free-slot predicate.
6. **Bound the caretaker name.** `claimed_by_name` is unbounded `text` with **no CHECK**,
   unlike `title`. An anon-callable write into an unbounded column is a storage-amplification
   hole. Needs a length bound and a trim/non-empty test — mirrored in zod for a clean 400, per
   the pattern comment in `src/lib/schemas/period.ts:8-11`.
7. **Write both claim columns together** — `care_slots_claim_complete` makes a half-write a
   constraint error, so the function must set both or every claim fails.
8. **Return a scalar or jsonb, never a plpgsql composite.** A composite answers a miss with a
   row of NULLs, not NULL — "a miss that looks like a hit". This bit S-02 already; recorded in
   its plan addenda and as a lesson in `test-plan.md:233-236`.
9. **Grants**, naming all four roles because `revoke … from public` does not reach
   anon/authenticated/service_role on Supabase:

   ```sql
   revoke execute on function public.claim_slot(<full arg type list>)
     from public, anon, authenticated, service_role;
   grant  execute on function public.claim_slot(<full arg type list>) to anon, authenticated;
   ```

   `authenticated` gets it back for the same reason the read function does: a signed-in owner
   opening their own link must work.

**A server API route is required.** `src/lib/supabase.ts` reads `SUPABASE_URL` / `SUPABASE_KEY`
from `astro:env/server`, and `astro.config.mjs` declares both
`envField.string({ context: "server", access: "secret" })`. The browser therefore has neither
URL nor key and cannot call the RPC directly. The route follows `src/pages/api/periods.ts`
with **one deliberate inversion: no `context.locals.user` guard** — the caretaker has no
account. That absence looks like a missing check and must be commented as intentional.

**CSRF — verified in Astro's source.** `security.checkOrigin` defaults to **`true`**
(`node_modules/astro/dist/core/config/schemas/base.js:52`), but
`node_modules/astro/dist/core/app/middlewares.js:1-35` only returns 403 for **form-like**
content types (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`) or a
**missing** content-type. `application/json` **skips the check entirely**. So:

- a native `<form method="post">` claim gets CSRF protection for free, and works with JS off —
  attractive for a page whose whole point is frictionless access on a phone;
- a JSON `fetch` is consistent with `api/periods.ts` but unprotected by `checkOrigin`, safe
  only because a cross-site JSON POST needs a preflight.

That is a real plan decision, not a detail.

**Route placement is a token-leak hazard.** `src/middleware.ts` applies
`Referrer-Policy: no-referrer` and `Cache-Control: no-store` on a segment boundary of
`/invite` only. A route at `/api/invite/<token>/claim` would sit **outside** that prefix, get
default headers, be cacheable, and leak the token via `Referer` — the exact hole
`data-access.md:113-120` closes for the page. Either put the route under `/invite/`, keep the
token out of its path, or set the two headers in the handler.

### 4. Atomicity — guaranteed vs. proven

**Already guaranteed.** The schema comment at `20260905234144_…sql:38-43` prescribes
`update … where id = $1 and claimed_by_name is null`. Under READ COMMITTED (Postgres's
default; nothing here changes it), the loser blocks on the row lock, then **re-evaluates its
WHERE against the new row version** after the winner commits — the predicate now fails, the
row is skipped, and the statement reports **0 rows**. The loser sees no error: a zero row
count, which the function must translate into an explicit refusal. This mirrors the harness
lesson already recorded for RLS denial (`test-plan.md:204-206`: denial is silent).

**What is load-bearing:**

- `care_slots_claim_complete` (`20260906094254_claim_columns_paired.sql:23-25`) — **yes**, but
  for the _predicate's truthfulness_, not the locking. It makes `claimed_by_name is null` a
  trustworthy test of freeness. Without it, `(claimed_at set, claimed_by_name null)` is
  representable and a second caretaker overwrites a claimed row.
- `care_slots_unique_in_period` — **adjacent, not load-bearing.** Both claims contend on the
  _same row_, so no unique violation can occur. Its job is slot identity and generation
  idempotence.

**Ways to still double-book** (Postgres semantics, not read from this repo):

1. **Read-then-write in two statements.** Being inside one plpgsql function does _not_ help —
   READ COMMITTED holds no lock between statements. A `select` for the error message must be
   `for update` _and_ the update must still carry the null predicate.
2. Dropping the null predicate, or claiming by `(period_id, slot_date, time_of_day)` without it.
3. Setting only `claimed_at` — now a constraint error, which is why that migration exists.
4. **A non-default isolation level.** Under REPEATABLE READ the loser gets SQLSTATE 40001
   instead of 0 rows — still no double-booking, but a handler checking only `row_count = 0`
   misreports it. Worth a note, not a code path.

**Proving it is the honest gap.** S-02 shipped no concurrency test by decision (_"No
concurrency test. There is nothing to claim yet."_), and its plan already set the precedent of
recording an unproven guarantee rather than claiming one (manual check 1.9). For S-03:

- **Where**: the `integration` project only — it needs a live stack.
- **How**: `Promise.all` over N `createAnonClient()` calls **inside one `it()`**. Vitest here
  runs test _files_ in parallel but tests _within_ a file serially, so splitting claimants
  across `it()` blocks produces no contention. There is no `pg` dependency, so every call is
  an HTTP round-trip through PostgREST and no test can hold an open transaction.
- **Determinism: none.** Nothing forces the two UPDATEs to overlap. **A passing test does not
  prove the row lock was exercised** — the calls may have serialized cleanly, and the same
  test would pass against a broken read-then-write implementation that happened not to
  interleave.
- **So the assertion must be an invariant, not a status count.** Partition the settled
  results (exactly one won, N−1 refused) **and** read the final state back: exactly one row
  carries a claim, its name equals the winner's, `claimed_at` is non-null. That invariant
  holds whether or not the calls contended, which is precisely why it is the right assertion —
  a non-flaky outcome check that is opportunistically a mechanism check.
- **`test-plan.md:64` already prescribes this** and names the anti-pattern by name: _"Testing
  two sequential claims and calling it concurrency."_ It also warns _"'Final status 200' ≠
  'only one winner'"_.
- A deterministic mechanism proof would need a raw `pg` connection (two sessions, one holding
  an uncommitted claim, observing the other block). That adds a devDependency and direct
  Postgres credentials, and bypasses PostgREST so it stops testing the real path. Hard to
  justify under §1's cost × signal for one statement whose behaviour is a documented Postgres
  guarantee.
- Cheap and fully deterministic, worth adding alongside: a token for period A cannot claim a
  slot in period B (Risk #5 / IDOR), and a claim in a revoked period is refused.

### 5. UI and design

**The design covers the claim flow, and it is a two-screen flow, not an in-place expansion.**

_Artboard "Kalendarz opiekuna (zapis na sloty)"_ (`context/design/Pupilownik Hi-fi.html:541-591`,
the last artboard):

- Accent header: eyebrow _"Anna prosi o pomoc"_, H1 _"Opieka: Burek & Mru"_, sub _"12–18 lipca ·
  zajmij wolne sloty"_.
- **A month grid with `‹ ›` navigation** — not the flat day list the page renders today.
  Weekday header `Pn Wt Śr Cz Pt So Nd`, square day cells, dot indicators **one per slot**
  (hollow = free, filled = taken, grey = day full), a legend, and a selected-day state.
- Below it, **slot cards for the selected day**: `Rano · 7:30` + a `WOLNE` pill + a one-line
  summary + a 34px accent button labelled **"Zapisuję się"** (first person).
- **No name input anywhere.** The claim is drawn as a one-tap action. If FR-009 requires
  typing a name, that control is not in the design and the plan is inventing it.
- **No taken-slot card state is drawn**, and no claimer name on a card.
- **No pre-claim public-instructions block is drawn on this screen at all** — so FR-008's
  first half has no design either.

_Artboard "Po zapisaniu · instrukcje"_ (three theme variants): success banner **"Zapisano! /
Masz 2 dni: 13 i 16 lipca"**, a pet card, heading _"Instrukcje opieki"_, three instruction rows
with time chips, and then — visually separated, below the list — a highlighted callout:
_"**Klucze** u sąsiadki, mieszkanie 4. / Telefon do Anny: **600 100 200**"_. That callout is
the **sensitive tier**, drawn as its own emphasized card rather than interleaved. Footer CTA
_"Napisz do Anny"_.

**Two mismatches to resolve in planning:**

- The design draws **2 dots per day**; the schema has **3** times of day. The day-cell
  indicator must be generalized or the design adapted.
- The design's month grid implies navigation state the current page has no notion of.

**What exists to build on.** `src/components/ui/` = `AuthScreen.astro`, `ScreenHeading.astro`,
`LibBadge.astro` (no call sites, off-token starter leftover), `button.tsx` (`Button` with 6
variants / 4 sizes / `asChild`), `Input.tsx` (`Input`, controlled, requires `label`, renders
its own error). Plus current-not-superseded `ServerError.tsx` and `SubmitButton.tsx`.

- **`Input` has no `disabled` prop** — a claim form must lock its name field while posting, so
  this needs adding or wrapping.
- **`global.css` has no success/positive token** — only `--destructive`. The design's
  "Zapisano!" banner has no token to render with. A decision is needed.
- **Do not import `FormField` or `PasswordToggle`** — both superseded; `AddPetForm.tsx` is
  their only remaining consumer and also hardcodes starter colours, so copy nothing from it
  visually. It does, however, contain the only existing public/sensitive UI (`is_sensitive`
  checkbox labelled _"Wrażliwe (widoczne dopiero po przejęciu opieki)"_).

**Closest precedent for the claim island**: `NewPeriodForm.tsx` — fetch, own `submitting` flag,
status-branched `ServerError`, and an early-return success view that replaces the form. Its
header comment records _why not_ `useFormStatus` (inert for a preventDefaulted fetch form).
`RegenerateLinkButton.tsx` is the minimal variant and the better model if the claim is a
per-slot button; it also demonstrates a **"refuse up front"** branch, which maps directly onto
a slot that is already taken.

**Insertion point**: `src/pages/invite/[token].astro` currently ends its period branch with an
explicit placeholder paragraph carrying the comment _"Deliberately no claim button: taking a
slot is S-03."_ The per-slot `<li>` elements are non-interactive and `slot.id` is already in
scope there, so the data an island needs is available; `byDay` is the natural serializable
prop. The page's only island today is the theme toggle.

**`src/lib/invite-view.ts` must own any new page state.** It currently decides three outcomes
(error / inactive / period) and its uniform-failure rule is pinned by
`tests/unit/invite-view.test.ts`. S-03 must not add a fourth branch that distinguishes token
failure modes, and a post-claim state belongs in that function, not in an inline `if` in the
template — that shape is exactly what the phase-3 review had to catch by reading.

## Code References

- `supabase/migrations/20260905234144_care_periods_and_slots.sql:20-33` — `care_periods`; no pet link
- `supabase/migrations/20260905234144_care_periods_and_slots.sql:38-43` — the prescribed atomic claim statement
- `supabase/migrations/20260905234144_care_periods_and_slots.sql:50-51` — `claimed_by_name` / `claimed_at`, unbounded text
- `supabase/migrations/20260905234144_care_periods_and_slots.sql:180-188` — the ALTER DEFAULT PRIVILEGES grant lesson
- `supabase/migrations/20260906003122_invite_token_access.sql:40-44` — the function is the whole authorization boundary
- `supabase/migrations/20260906003122_invite_token_access.sql:153-165` — the grant recipe to copy
- `supabase/migrations/20260906094254_claim_columns_paired.sql:23-25` — the paired-claim CHECK
- `supabase/migrations/20260906105815_bound_token_length.sql:30` — the input-length guard to mirror
- `supabase/migrations/20260712204748_pets_and_instructions.sql` — `care_instructions`, per-row `is_sensitive`, `to authenticated` policies
- `docs/reference/data-access.md:80-111` — the four token-model rules and the forward rule naming S-03
- `docs/reference/data-access.md:113-120` — the bearer-credential admission and the `/invite` headers
- `src/pages/invite/[token].astro` — the caretaker page and its claim-button placeholder
- `src/lib/invite-view.ts` — the uniform-failure decision
- `src/lib/invite-token.ts` — reusable secret minting and digesting
- `src/pages/api/periods.ts` — the route pattern, minus its `locals.user` guard
- `src/middleware.ts` — `/invite` segment match, `no-referrer` / `no-store`
- `context/foundation/test-plan.md:52,64` — Risk #3 and its prescribed test layer + anti-pattern
- `context/foundation/test-plan.md:53,65` — Risk #4, written two contradictory ways
- `context/foundation/prd.md:88` — one period may cover several pets
- `context/foundation/prd.md:116,144` — FR-010 cut for lack of caretaker identity; Non-Goals forbid it
- `context/foundation/prd.md:121` — the three-clause confidentiality NFR
- `context/design/Pupilownik Hi-fi.html:541-591` — the caretaker calendar artboard

## Architecture Insights

- **The token function's shape is now a two-function model, forced by Postgres.** STABLE for
  reads, VOLATILE for the claim. `data-access.md`'s rule 2 heading ("One SECURITY DEFINER
  function is the entire anon-reachable surface") becomes a statement of history rather than a
  cap, and the file should say so after S-03.
- **Rule 4 (uniform failure) does not survive a write unchanged.** A claim must distinguish
  won from refused, which is a signal a read never emitted. Record the widening explicitly.
- **The reveal is a row filter, not a field mask**, because `is_sensitive` is per row. That is
  the single luckiest thing about S-01's schema for this slice.
- **The name is not a key.** Every per-person mechanism must introduce something new the
  browser holds and the server verifies. There is no third option.
- **This project's recurring failure mode is a described posture that the system does not
  have** — three times for grants, once for a test that guarded nothing, once for a migration
  comment about anon grants. S-03's plan should assert from the catalog and write tests that
  fail when the property is removed.

## Historical Context (from prior changes)

- `context/archive/2026-09-06-care-period-and-invite-link/plan.md` — the token model's design
  rationale; §What We're NOT Doing defers instructions and the concurrency test to S-03;
  §Implementation Addenda records the composite-return trap and the grant gap
- `context/archive/2026-09-06-care-period-and-invite-link/reviews/impl-review.md` — F2 explains
  exactly what the paired-claim CHECK protects S-03 from
- `context/archive/2026-07-12-pet-and-instructions/plan.md` — S-01's public/sensitive split
- `context/foundation/lessons.md` — enumerate every consumer before changing a shared surface;
  directly binding on the `care_periods` change

## Open Questions

**Both blocking decisions are now RESOLVED — see §Decisions above.** They are kept here with
their original framing so a later reader can see what was weighed.

1. **RESOLVED (claimer).** Is FR-008's reveal conditioned on the claim _event_ or on the
   _claimer_?
   - _Event_ → extend the read path, no new secret, no cookie, all four token-model rules
     untouched, `prd.md:121` and §Non-Goals satisfied literally — **and** `roadmap.md:21`,
     `test-plan.md:65` and the design's "Masz 2 dni" screen must be re-worded/redrawn, because
     the shipped behaviour would contradict them.
   - _Claimer_ → accept the lightweight caretaker identity `prd.md:116` deferred to v2, in the
     minimal form of a per-claim secret in an HttpOnly cookie, plus a second function, a
     `claim_digest` column, a first-of-its-kind cookie write in this repo, an answer for the
     second-device case, and an un-claim path that invalidates the secret.

2. **RESOLVED (own change).** Does S-03 own the period → pet relation, or does it get its own
   change? It is a join
   table plus a signature change to `create_period_with_slots` plus edits to two owner screens,
   four test files and the create API — arguably a slice of its own, and it blocks FR-008
   either way. Splitting it keeps S-03 focused on the claim; bundling it avoids a period that
   still cannot show instructions.

**Smaller ones, resolvable in `/10x-plan`:**

3. Does FR-009's name input survive, given the design draws a one-tap "Zapisuję się" with no
   field?
4. Native `<form>` (CSRF-protected by `checkOrigin`, works without JS) or JSON `fetch`
   (consistent with the existing route, not origin-checked)?
5. Where does the claim route live, so the token does not leak past the `/invite` header scope?
6. Month grid with navigation, or extend the current flat day list? And 2 dots vs 3 times of day.
7. A success/positive design token — `global.css` has none.
8. **RESOLVED by D1** — `test-plan.md:65` (per-claimer) is authoritative; `:53` needs
   rewording.
9. **RESOLVED (relation first).** The period ↔ pet relation ships as its own change,
   sequenced **before** S-03 as a hard prerequisite. S-03 therefore keeps its roadmap outcome
   intact and nothing needs re-wording. Two follow-ons: `roadmap.md`'s S-03
   `- **Prerequisites:** S-02` becomes stale and should name the new change, and the relation
   work has no roadmap item at all — both are `/10x-roadmap`'s to edit, not this change's.

## 6. Follow-up: blast-radius findings (appended 2026-09-06, after first write)

The fourth agent's report landed after §1–§5 were written. It confirmed the cardinality
conclusion and the consumer list, and added eight things §1 did not have.

### It corrected one of my premises

**The PRD has no `## Data Model` section.** Its sections are Vision, User & Persona, Success
Criteria, User Stories, Functional Requirements, NFR, Business Logic, Access Control,
Non-Goals, Open Questions. So there is no data-model statement to appeal to — the absence is
a gap in the PRD, not an answer to the cardinality question. FR-002's recorded resolution
(`prd.md:88`) remains the strongest textual evidence, now joined by `prd.md:127` (Business
Logic lists "definicja **zwierząt** i instrukcji" — plural, as a peer input to the period).

### S-02 silently dropped two design elements

The design's "Nowy wyjazd" screen draws **both** a `KTÓRE ZWIERZĘTA` multi-select — and both
pet chips carry the _selected_ styling, so it is a multi-select with both picked, not a
single-choice control — **and** a period-level `NOTATKA` free-text field ("Klucze u sąsiadki,
mieszkanie 4…"). Neither exists in the schema or in `NewPeriodForm.tsx`. S-02's plan claims
that screen twice ("The screens match the design's 'Nowy wyjazd + link'") and its
§What We're NOT Doing lists eight exclusions **without either of them**.

That is precisely what `context/foundation/lessons.md` forbids: a design element dropped
without being recorded. Two consequences for S-03:

- The pet selector is not "new scope" — it is unfinished S-02 scope.
- The `NOTATKA` field is **unassigned to any slice** and overlaps the sensitive-instruction
  concept (the design fills it with exactly the kind of content `is_sensitive` rows carry).
  Someone must decide whether it is a real requirement or a design artifact.

### The signature change is sharper than §1 stated

Adding a parameter does **not** modify `create_period_with_slots` — it creates a _second_
function (an overload), and:

- the new signature gets Supabase's `ALTER DEFAULT PRIVILEGES` execute grant to `anon`,
  `authenticated` and `service_role`, so it needs its own revoke/grant pair;
- **the old overload stays reachable with its existing grant** unless dropped, and an
  ambiguous-overload error becomes possible;
- `create or replace` preserves grants **only when the argument list is unchanged** — the one
  precedent (`20260906105815_bound_token_length.sql`) says so explicitly and does not transfer.

→ The lower-risk shape is `drop function` + fresh `create function` + an explicit
`revoke … from public, anon, service_role` / `grant … to authenticated` pair in the same
migration, verified with the `has_function_privilege` sweep S-02 used. Keep
`security invoker`: RLS on the new join table is then what rejects a period naming another
owner's pet, making pet ownership a database guarantee rather than a handler check.

### The migration-ordering problem is real, and S-03 inherits it

`supabase/seed.sql` seeds one owner, one pet, two instructions and **zero periods**, so
`db:reset` gives a clean slate locally. But `care_periods` has a live insert path
(`POST /api/periods`) and the documented workflow includes `npm run db:push` to a hosted
project. S-01 could write "additive migration; no existing domain data" — **S-03 cannot.**

And with a join table, _"a period must have at least one pet"_ is **not expressible as a
column constraint**. The options are a deferred constraint trigger, or enforcing it only in
`create_period_with_slots` and accepting that a raw insert could create a petless period —
which is the posture `20260906094254_claim_columns_paired.sql` argues against in its own
comment ("a constraint in the database outranks a requirement in a document"). Worth noting
the mirror: that CHECK was added in S-02 _because_ the table was still empty. The pet link
was not, which is why S-03 inherits this.

### Smaller additions

- **`tests/rls/care-periods.isolation.test.ts` uses raw `.from("care_periods").insert({…})`**,
  not the RPC. A `not null pet_id` column breaks every one of those inserts; a join table
  breaks none. Another point for the join table.
- **A new join table needs its own isolation suite** per `test-plan.md` §6.5 — all four
  denial surfaces, not SELECT only.
- **No index supports `where pet_id = … and is_sensitive = false`.** `care_instructions_pet_id_idx`
  alone is fine at MVP row counts, but the reveal query should be written knowing that.
- **`get_period_by_token`'s `jsonb` payload is a contract three consumers read** — the page's
  local `TokenPayload`/`TokenSlot` interfaces, `tests/rls/invite-token.test.ts` (which pins the
  exact key sets), and `data-access.md`'s description of it. Changing the payload touches all
  three, and rule 2's text ("returns … no instruction rows") becomes false the moment the
  reveal ships.
- **The design's link shape is stale**: it draws `pupilownik.pl/o/burek-7f3a` — short,
  pet-named, guessable-looking — versus the shipped `/invite/<43-char base64url>`. The token
  model won; do not resurrect the design's URL.
- **`supabase/seed.sql` will want a seeded period** linked to the seeded pet, for `db:reset`
  determinism once periods carry pets.

### Grep noise the planner will hit

Repeating the consumer grep surfaces two sets of false positives. Neither needs any change,
but both look like real hits:

- **`dist/server/chunks/*.mjs`** — five compiled SSR chunks (`periods_*`, `_id__*`,
  `_token__*`, `index_*`, `token_*`). Build output, gitignored (`.gitignore:2`), regenerated
  by `npm run build`. Never edit.
- **`.claude/worktrees/distributed-snacking-dusk/context/archive/…`** — a stale git worktree
  (verified: `git worktree list` shows it at commit `1bf8e2a` on branch
  `worktree-distributed-snacking-dusk`, while master is at `863288d`). It holds an old copy of
  the F-01 archive plan. Unrelated to this slice, and stale enough to give wrong answers if
  read as current.

Scope the grep to `src tests supabase docs context/foundation` to avoid both.

### What this does not change

The cardinality conclusion (many pets per period, via a join table), the consumer list in §1,
and both open decisions in §Open Questions stand as written. The agent found no source that
contradicts many-to-many.

## Note on method

Four parallel agents covered the five areas. The most consequential claims were re-verified
directly rather than taken on report: the function volatility (`pg_proc.provolatile`), Astro's
`checkOrigin` default and its content-type carve-out (read from `node_modules`), the four
load-bearing PRD lines, the design's "Masz 2 dni" copy, and the `care_periods` /
`care_instructions` column lists. The consumer enumeration in §1 was produced by direct grep.
One agent covering §1's blast radius was still running when this document was first written.
It has since completed and its additional findings are in §6 — appended, not merged into §1,
so the provenance stays visible.
