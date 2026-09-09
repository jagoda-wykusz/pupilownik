---
date: 2026-09-08T18:56:03Z
researcher: jagoda.wykusz
git_commit: 3b616c77471b6ce31cbac4d6a758289de80153fb
branch: master
repository: pupilownik
topic: "Owner occupancy view — showing who claimed which slot (S-04 / FR-006)"
tags: [research, codebase, care-slots, claimed-by-name, rls, occupancy, s-04]
status: complete
last_updated: 2026-09-08
last_updated_by: jagoda.wykusz
---

# Research: Owner occupancy view — showing who claimed which slot

**Date**: 2026-09-08T18:56:03Z
**Researcher**: jagoda.wykusz
**Git Commit**: `3b616c77471b6ce31cbac4d6a758289de80153fb` (unpushed — 69 ahead of `origin/master`, so no GitHub permalinks in this document)
**Branch**: master
**Repository**: pupilownik

## Research Question

What does S-04 (`owner-occupancy-view`, FR-006, US-01) actually require? Scoped by the user to
the **owner's period detail screen only** (`/periods/[id]`), focusing on three risks: whether
the access model already permits it, what it means to render an anonymously-written name on an
authenticated screen, and the identity / reversibility hazards the slice inherits.

Out of scope by decision: the `/periods` list aggregate, and the caretaker-facing side
(S-05 / FR-011). The "near-instant update" NFR was also deliberately not researched.

## Summary

**There is no database work in this slice.** The owner can already read
`care_slots.claimed_by_name` — proven by an impersonated select against the live catalog, not
inferred from a comment. The column is withheld today by nothing more than the `.select()`
string a page author typed. The whole DB layer for FR-006 has been in place since S-02.

That makes S-04 almost entirely a **presentation and product-judgement slice**, and the hard
parts are not where the roadmap's "dołożenie imion i agregatu, nie nowy ekran" suggests:

1. **This is the first untrusted, anonymously-supplied string ever rendered on an
   authenticated screen in this codebase.** XSS is not the risk (Astro escapes; no `set:html`
   exists anywhere, and `src/lib/claim-cookie.ts:23` explicitly depends on that staying true).
   The real risks are layout destruction in a `grid-cols-3` cell with no wrapping, spoofing of
   the UI's own copy, and names that render blank.
2. **The owner cannot tell two caretakers apart, and the slice has to decide whether to
   pretend otherwise.** Two people can both be "Ania"; nothing in the data distinguishes them
   except `claim_digest`, which must never reach the page.
3. **S-04 is the screen where the owner discovers a griefed trip, and there is no recourse.**
   The archived S-03 plan's most important follow-up — "the owner needs a release this slot
   action" — lands squarely here, and it costs a route and a button over permissions that
   already exist.

One documentation defect found: `docs/reference/data-access.md:177-178` files this
owner-side, `authenticated` feature under the **anon** token model's rules.

## Detailed Findings

### Access model — the owner already has everything (verified from the catalog)

Per `context/foundation/lessons.md` §"Weryfikuj posturę systemu z katalogu, nie z komentarza",
this was read from `pg_policies`, `information_schema.role_table_grants`, `pg_attribute` and
`pg_constraint`, and then confirmed by executing the read as the owner.

- **Four policies on `care_slots`**, all `TO authenticated`, all row-level through
  `care_periods.owner_id`: `care_slots_select_own`, `_insert_own`, `_update_own`,
  `_delete_own`. **No policy mentions a column.**
- **Grants**: `authenticated`, `postgres`, `service_role` hold the full set.
  `anon` is absent — the S-02 revoke is real, and an anon select raises `42501`.
- **No column-level ACLs.** Every `pg_attribute.attacl` on the table is NULL, so the
  table-level grant projects onto all eight columns including `claimed_by_name`.
- **Executed as the real owner** (`set local role authenticated` +
  `request.jwt.claims`), a select of `claimed_by_name` returns names on the four claimed
  slots of a nine-slot period, and `88 | 16` rows visible/named across the whole table —
  RLS-scoped, working today.

`claimed_at` and `claimed_by_name` have **identical reachability**: same row, same policies,
same grant, no column ACL. `care_slots_claim_complete` is still live and still ties all three
claim columns all-null-or-all-set, so `claimed_at` really was an exact substitute.

**What must change, exhaustively:**

- `src/pages/periods/[id].astro:69` — widen the embed:
  `care_slots(id, slot_date, time_of_day, claimed_at)` → `…, claimed_at, claimed_by_name)`.
- `src/pages/periods/[id].astro:28-37` — add `claimed_by_name: string | null` to the local
  hand-written `interface SlotRow`, and rewrite the `:31-34` comment, which otherwise asserts
  a state that no longer holds.
- **No migration.** **No `db:gen-types` run** — `src/db/database.types.ts:148/158/168`
  already types the column on Row/Insert/Update, because nothing in the schema changes.
- Everything else is UI.

### `data-access.md:177-178` misfiles this slice

The sentence closes a paragraph titled _"The rule for future slices: a new caretaker
capability extends this function … It does not add an anon policy to a table"_ with:

> S-04's occupancy view lands under the same rule.

That rule governs **anon** access through `SECURITY DEFINER` doors. S-04's reader is the
**owner** — `authenticated`, with a complete RLS path shown above — and needs no door, no
function, and does not touch the token model at all. The sentence is true only under the
vacuous reading ("S-04 also must not add an anon policy", true of every slice), and in the
reading a planner will actually take it sends them looking for a door to extend.

It looks like it named the wrong slice: **S-05** (`caretaker-names-visibility`, FR-011) _is_ a
genuine caretaker capability and genuinely does land under the four rules.

This is `lessons.md`'s documents extension again — a present-tense assertion about where a
not-yet-built thing will live, written without reading it against the catalog. Every other
comment checked (`[id].astro:31-34`, `index.astro:45-47`, `contract-surfaces.md:28`,
`data-access.md:132-141`) **agrees** with the catalog.

### Rendering an anonymously-written name

`claimed_by_name` is written by an unauthenticated caretaker through `claim_slots`, which is
granted to `anon` — so the zod layer in `src/lib/schemas/claim.ts` is UX only and **the
function body is the entire guarantee**. That body's whole name validation is
`20260907171514_claim_secret_not_digest.sql:159-174`: btrim, reject empty, reject > 80 chars.
There is **no character class** — contrast the `token` field on the same schema
(`src/lib/schemas/claim.ts:34`), which has `/^[A-Za-z0-9_-]{43}$/` and a comment saying "the
character class matters as much as the length".

**XSS is not a live risk.** No `set:html` / `is:raw` / `dangerouslySetInnerHTML` anywhere in
`src/`; the single grep hit is the comment at `src/lib/claim-cookie.ts:23` that _justifies_
the cookie's non-`__Host-` decision on "no invite page uses `set:html`". Adding one anywhere
on the origin would retroactively invalidate that trade-off.

The risks that are real:

- **Layout.** `[id].astro:179-191` renders slots in `grid-cols-3`, which Tailwind v4 compiles
  to `repeat(3, minmax(0, 1fr))` — track floor 0, so a cell cannot grow. There is no
  `truncate`, no `break-words`, no `overflow-hidden` on the `li` or either `span`, and
  `src/styles/` sets no `overflow-wrap` default. 80 unbroken characters at 12-13px is ~560px
  in a cell about 200px wide: it paints over its two siblings and out through the card border.
  This would be the codebase's only unwrapped display of a variable-length untrusted string.
  The existing precedent to copy is `InviteLinkPanel.tsx:48` — `min-w-0 flex-1 truncate` with
  a `title=` so the full value stays reachable.
- **Blank-rendering names.** `btrim` with no second argument strips **U+0020 only** —
  verified directly: `tab:1 | nbsp:1 | zwsp:1 | space:0 | newline:1`. A name of one tab,
  NBSP, ZWSP or newline is non-empty, ≤ 80, and stored. Through the route zod's broader
  `.trim()` catches it, but the route is not the boundary. 80 × U+200B passes both layers.
  So the DB can hold a name that renders as an empty cell which still reads as claimed.
- **Spoofing.** The name would sit in the same cell, at the same 12-13px, as the literal
  `"wolne"` / `"zajęte"` at `[id].astro:190`. The only thing separating them would be the
  `class:list` tone at `:184-186` — colour and font weight. Other mimickable strings on the
  page: the occupancy line `:151`, the revocation suffix `:152`, the headings `:163/:171/:198`,
  and the note's privacy caption `:164`. A name containing U+202E reverses the text run.
- **Do not carry over `whitespace-pre-line`** from `:165`. It is correct for the owner's own
  `caretaker_note`; on a caretaker name it turns embedded newlines into 40 rendered rows.

### Identity — what the schema does and does not hold

- **Follow-up claims are safe.** `20260907171514:151-158` reads the stored name back and
  `p_name` is consulted only inside `if v_name is null`. On a follow-up the supplied name is
  discarded outright, not compared. So one capability keeps one name across claims.
- **Two capabilities, one name is fully permitted and indistinguishable.** `claimed_by_name`
  is unbounded `text`, no uniqueness, no FK, no verification. Two people following the same
  forwarded link mint separate secrets and can both type "Ania". The owner sees "Ania" on
  Monday and Wednesday and reasonably concludes it is one person. S-03's own research said so
  at `context/archive/2026-09-06-caretaker-claims-slot/research.md:249-254`: _"Two caretakers
  typing 'Ania' are indistinguishable rows."_ And `prd.md:110` leans on the occupancy view as
  the mitigation — _"właściciel widzi obsadę i może reagować"_ — so S-04 inherits this hazard
  by design.
- **One capability, two names is reachable without an owner UPDATE.** The function's comment
  at `:143-145` and `contract-surfaces.md:28` both attribute this state solely to the owner's
  direct table grant. Reading `20260907171514:151-158` shows a second path: the name lookup is
  a plain read with no `FOR UPDATE`, no advisory lock and no unique constraint, while step 5's
  row lock guards `claimed_by_name is null` **per row** — a different predicate. Two
  concurrent _first_ claims presenting the same secret with different names on disjoint slots
  both see `v_name IS NULL` and both write. Proportion: it requires deliberately reusing one
  secret across two simultaneous direct RPC calls, which the app never does; the consequence
  is display incoherence on the owner's screen, not a breach. The `order by claimed_at, id`
  added by Phase 2's review exists because someone already anticipated the state.
- **`claim_digest` is owner-readable and must never reach the page.** It is on `care_slots`,
  so `care_slots_select_own` covers it. But `20260907171514_claim_secret_not_digest.sql:14-19`
  names the disclosure to avoid _verbatim_: _"a future disclosure of it (a backup, an error
  body, **S-04's occupancy payload**) is not automatically a replayable one."_ The defensible
  shape for telling two same-named caretakers apart is a **server-side ordinal** — index the
  distinct digests within the period 1..N and emit only that. What is not defensible is
  emitting the digest, or a colour hashed from it in the browser (which requires shipping it).
  `claim_digest` currently appears in no `.astro`/`.tsx` under `src/`.

Two review blind spots left open specifically for this slice, both now answered above:
`impl-review-phase-1.md:70-71` (_"whether S-04's occupancy view will also assume one name per
capability"_) and `impl-review-phase-2.md:82-83` (_"whether S-04's occupancy view wants to
match a capability without its secret"_).

### Reversibility — the owner can already release, and has no way to

`docs/reference/data-access.md:160-172` states the claim write is irreversible, that S-06's
revocation leaves claim columns alone, and that **"a later slice owes the owner a 'release
this slot' action"**.

Verified against the migrations: an owner-side release is **a new UI + route over existing
permissions, not a schema change**.

- Grant: `grant select, insert, update, delete on table public.care_slots to authenticated`
  (`20260905234144:71`), table-wide, no column privileges.
- Policy: `care_slots_update_own` (`:121-131`) predicates on ownership of the parent period
  only — it says nothing about which columns change — paired with `care_slots_select_own`.
- Constraint: all-three-null is the free state and passes `care_slots_claim_complete`;
  `care_slots_claim_digest_format` is `claim_digest is null or …`, so null passes.
- No trigger, no rule, no column-level revoke.

So `update public.care_slots set claimed_by_name = null, claimed_at = null, claim_digest =
null where id = $1` succeeds today from the owner's ordinary session client.

Two PRD inconsistencies surfaced by this:

- FR-010's cut text (`prd.md:114-116`) reads _"na v1 wypis załatwia właściciel ręcznie"_ —
  the PRD assumed an owner-side remedy that has never existed in the UI.
- `prd.md:122` still promises an NFR about confirming _"zajęcia/**zwolnienia** slotu"_ — a
  release confirmation no requirement delivers.

The owner's actual recourse today if a forwarded link takes every slot: delete the period and
rebuild it, or hand-written SQL. Recorded at
`context/archive/2026-09-06-caretaker-claims-slot/reviews/impl-review-phase-4.md:118-120`.

### S-04 / S-05 boundary — genuinely separate

|           | S-04 (FR-006, must-have)                          | S-05 (FR-011, nice-to-have)       |
| --------- | ------------------------------------------------- | --------------------------------- |
| Audience  | owner                                             | caretaker                         |
| Auth      | `authenticated`, `auth.uid()`                     | `anon` bearer link                |
| Read path | direct table select under `care_slots_select_own` | must be a `SECURITY DEFINER` door |
| Screen    | `/periods/[id]`                                   | `/invite/[token]`                 |

No shared surface today: both caretaker doors withhold other people's names
(`get_period_by_token` returns no `claimed_by_name`; `get_claimed_details` returns only the
caretaker's own slots per `20260907193000:97-98`), and even the PT409 conflict DETAIL carries
only `{slot_date, time_of_day}`. S-05 would require widening an anon door — a schema-level
decision under rule 2 — whereas S-04 adds a column to an owner select.

**S-04 must not pre-empt S-05's open privacy question**, which `roadmap.md:193-194` records as
still unresolved and owned by the user, not the implementer: _"Czy imiona widzi każdy
posiadacz linku, czy tylko osoba, która sama zajęła slot?"_ The one thing that will carry
over is whatever opaque grouping key S-04 invents for same-named caretakers.

## Code References

- `src/pages/periods/[id].astro:28-37` — local `SlotRow` interface + the `:31-34` comment that
  is S-04's permission slip and must be rewritten
- `src/pages/periods/[id].astro:66-72` — the PostgREST read to widen
- `src/pages/periods/[id].astro:179-191` — the `grid-cols-3` slot cells with no wrapping
- `src/pages/periods/[id].astro:190` — the `"wolne"` / `"zajęte"` labels a name could mimic
- `src/pages/periods/index.astro:45-58` — the list aggregate that keeps names off that page
  (out of scope by decision)
- `src/components/periods/InviteLinkPanel.tsx:48` — the `min-w-0 flex-1 truncate` + `title=`
  precedent for a long untrusted string
- `src/lib/claim-cookie.ts:23` — the comment whose validity depends on no `set:html` existing
- `src/lib/period-format.ts:110` — `MAX_CLAIMANT_NAME_LENGTH = 80`, mirror of a function guard
- `src/lib/schemas/claim.ts:34` — the `token` field's character class, absent on `name`
- `src/db/database.types.ts:148/158/168` — `claimed_by_name` already typed
- `supabase/migrations/20260907171514_claim_secret_not_digest.sql:14-19` — names S-04's
  payload as the disclosure to avoid
- `supabase/migrations/20260907171514_claim_secret_not_digest.sql:151-174` — name resolution,
  the read-then-write window, and the whole of the name validation
- `supabase/migrations/20260905234144_care_periods_and_slots.sql:71,102-131` — owner grant and
  policies that already permit both the read and a release
- `tests/rls/care-slots.isolation.test.ts` — the owner-side guard on this table
- `tests/rls/invite-token.test.ts:150` — asserts the caretaker payload stays name-free

## Architecture Insights

- **Two access models, and this slice is squarely in the older one.** The token model
  (`SECURITY DEFINER` doors for anon) has absorbed most of the recent design attention, to the
  point where a reference document filed an owner feature under it. The owner path is the
  plain F-01 pattern and has needed no change since S-02.
- **"A page that cannot see it cannot leak it"** is a structural property this codebase has
  used deliberately — `[id].astro` selecting `claimed_at`, `index.astro` aggregating counts.
  S-04 is the sanctioned removal of that property on one page, so the plan should say what
  replaces it, and confirm the other page's posture was re-decided rather than drifted.
- **Enforcement of multi-row invariants lives in functions, not the schema**, by accepted
  precedent ("at least one pet" in `create_period_with_slots`, "one capability = one identity"
  in `claim_slots`). Both are single points of failure that the owner's own table grant can
  bypass — a known, recorded trade-off, not an oversight.

## Historical Context (from prior changes)

- `context/archive/2026-09-06-caretaker-claims-slot/plan.md:115` — _"No occupancy view for the
  owner beyond what already exists. That is S-04 / FR-006."_
- `context/archive/2026-09-06-care-period-and-invite-link/plan.md:72` — same boundary, drawn a
  slice earlier; `:9` calls the slots table _"what S-04 will read occupancy from"_
- `context/archive/2026-09-06-period-pets-relation/reviews/impl-review-phase-3.md:25-27` —
  _"Both explicit 'must not be undone' contracts hold — `claimed_by_name` never returns to
  `/periods/[id]`."_ S-04 is the sanctioned exception; expect a review to check it is
  deliberate.
- `context/archive/2026-09-06-care-period-and-invite-link/reviews/impl-review.md:66-67` — the
  paired CHECK exists because _"S-03 writes both and S-04 renders occupancy, so the first
  consumer keying on `claimed_at` would silently disagree."_
- `context/archive/2026-09-06-caretaker-claims-slot/plan.md:1147-1154` — the inherited
  follow-up: the owner release action, _"load-bearing rather than nice-to-have"_.
- `context/foundation/roadmap.md:182` — _"zakres to dołożenie imion i agregatu, nie nowy
  ekran."_
- `context/archive/2026-09-05-ui-design-system/reviews/impl-review.md:138` — the design system
  shipped no card / time-badge / callout for the domain screens, and _"nothing enforces them
  beyond those comments; if S-01/S-04 forget, they become permanent."_ `ui/Chip` did land
  later in `period-pets-relation`, so check what exists before assuming.

## Related Research

- `context/archive/2026-09-06-caretaker-claims-slot/research.md:249-254` — why
  `claimed_by_name` cannot identify anyone
- `context/archive/2026-09-06-care-period-and-invite-link/research.md` — the slots schema this
  view reads

## Open Questions

1. **Does S-04 include an owner "zwolnij slot" action?** The strongest finding in this
   research. It is a route plus a button over permissions that already exist; it is the
   inherited follow-up from S-03; and `/periods/[id]` is the screen where the owner discovers
   they need it. Shipping the view without it delivers FR-006's _widzi_ and leaves _reagować_
   with nothing behind it. **Owner: user.** If out, record it in §What We're NOT Doing _and_
   in the page copy — not silently.
2. **Must the owner be able to distinguish two caretakers who typed the same name?** If yes,
   the shape is a server-side ordinal over distinct digests; the digest itself must not leave
   the server. If no, S-04 promises "a name per slot", not "who".
3. **What replaces the "cannot see it cannot leak it" property** on `/periods/[id]` once the
   select is widened? A test, a comment, or nothing?
4. **Display policy for the untrusted string** — truncation, whitespace/bidi normalisation at
   display time (the only option for rows already stored) versus tightening `claim_slots`
   (fixes only the future), and the fallback for a name that normalises to nothing.
5. **Two PRD defects to route to v2**, not to fix here: `prd.md:122`'s NFR promising a release
   confirmation nothing delivers, and FR-010's cut text assuming a manual owner remedy that
   has no UI. Batch with the already-queued Non-Goals clarification.
6. **Correct `docs/reference/data-access.md:177-178`** — likely meant S-05. Small, and this
   slice is the natural moment.
