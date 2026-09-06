# Care Period & Invite Link (S-02) — Plan Brief

> Full plan: `context/changes/care-period-and-invite-link/plan.md`
> Research: `context/changes/care-period-and-invite-link/research.md`

## What & Why

An owner leaving town needs several trusted people to cover the care of their pets, and today
that means asking them one by one. This slice lets the owner define a care period, have the
system generate a slot for each day and each time of day, and hand out a single link. It also
introduces the access model everything downstream depends on: a caretaker reaches the period
with no account, holding nothing but an unguessable token.

## Starting Point

Every RLS policy in the schema keys on `auth.uid()`, so an anonymous caretaker is denied
everything — correctly, and by design. `docs/reference/data-access.md` already flagged that
caretaker access would be "a different model introduced later" and, in the same breath, ruled
out the usual alternative by forbidding the service-role key in the request path. S-01
established the patterns this slice copies: migration plus deny-by-default RLS, an atomic
`SECURITY INVOKER` RPC, zod before any DB call, a JSON API route feeding a React island.

## Desired End State

The owner picks a date range at `/periods/new` and lands on the period's page showing its slots
and an invite link, warned that the link appears only once. Pasting that link into a logged-out
browser renders the period and which slots are still free. A tampered, unknown or revoked token
renders the same "link nieaktywny" page — indistinguishably.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Caretaker access mechanism | One `SECURITY DEFINER` function granted to `anon`; no anon policies on any table | The only alternatives were an RLS policy fed by a request header (fragile, wide) or a signed JWT (needs the Secret key in the request path, which the access contract forbids) | Research |
| Slot storage | One materialised row per (period, date, time-of-day), unique together | Makes S-03's claim a single `UPDATE … WHERE claimed_by IS NULL` — the race is settled by Postgres, not by us | Research |
| Times of day | Fixed three: morning / afternoon / evening | Owner decision; the roadmap had assumed two, which would have produced the wrong slot count | Roadmap |
| Token storage | SHA-256 digest only | The link is the sole barrier protecting the address and access codes; a database leak must not hand out working links | Plan |
| Lost link | A "regenerate" action | Digest-only storage means the link cannot be re-read, so without this a lost link makes the period unusable | Plan |
| Expiry | None — only explicit regeneration invalidates | A caretaker still needs the instructions on the last evening; auto-expiry fails exactly then | Plan |
| `revoked_at` | Column and function check now, UI in S-06 | One column now versus a migration plus an edit to a security function later; with no auto-expiry it is the only brake that exists | Plan |
| Max period length | 31 days (93 slots) | Caps the generation transaction and makes a mistyped year bounce off a CHECK | Plan |
| Invalid-token response | Uniform for unknown, malformed and revoked | A distinct "revoked" answer confirms the period exists | Plan |
| Token landing page | Minimal read-only page ships here | A security contract that cannot be exercised cannot be proven | Plan |

## Scope

**In scope:** `care_periods` + `care_slots` with owner-isolation RLS; atomic period-and-slot
generation; digest-only invite token with resolution and regeneration functions; owner screens
(`/periods`, `/periods/new`, `/periods/[id]`); a read-only caretaker landing page at
`/invite/[token]`; an anonymous test client and the token-model test suite.

**Out of scope:** claiming a slot and the public/sensitive instruction reveal (both S-03); the
owner's occupancy view (S-04); the "revoke period" UI (S-06); period editing or deletion;
emailing the link; any reskin of `/pets`.

## Architecture / Approach

Access is layered, and this slice adds a layer. Grants make a table reachable; the absence of a
policy denies an operation; a policy predicate authorizes the owner. For the caretaker there is
no identity to key on, so a function body authorizes instead — and it is the *only* thing that
does. Nothing else about the anon role changes: it gets no policies, so the function is the
single door rather than merely the intended one, and a test asserts exactly that.

The token itself is minted in the app with Web Crypto, its digest stored, the raw value returned
once. Postgres 17 and the Workers runtime both have SHA-256 natively, so neither side needs an
extension.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema, RLS & atomic creation | Two tables, owner isolation, slot generation in one transaction | A slot model that makes S-03's concurrency someone else's problem |
| 2. The token model | Digest storage, the anon-callable resolution function, regeneration | This function *is* the authorization boundary — no RLS backs it up |
| 3. Owner API & UI | Create, list and view periods; the one-time link | Leaking the raw token into a log or a re-read path |
| 4. Caretaker landing page | The link works from the outside | The route silently falling under a protected prefix |

**Prerequisites:** S-01 (archived). Local Supabase for the full suite — note `npm run db:start`
currently fails on unhealthy analytics/storage containers; a reduced service set works.
**Estimated effort:** ~4 sessions, one per phase.

## Open Risks & Assumptions

- The token function has no second line of defence. Its body is reviewed as security code, and
  the test asserting `anon` cannot read the tables directly is what proves the door is single.
- Digest-only storage trades recoverability for safety. Regeneration covers the lost-link case,
  but an owner who has already sent a link and then regenerates will break it for everyone —
  the UI has to say so plainly.
- With no expiry, an un-regenerated link lives forever. That raises the value of FR-012's UI in
  S-06 from nice-to-have to something worth scheduling.
- 31 days is a product judgement, not a measurement. If real periods run longer, the CHECK is a
  one-line migration — but only before anyone depends on the bound.

## Success Criteria (Summary)

- An owner can create a period, get a link, and hand it to someone who is not a user of the app.
- That person opens it with no account and sees exactly what is free — and nothing else.
- A wrong, tampered or regenerated-away token is indistinguishable from an unknown one.
