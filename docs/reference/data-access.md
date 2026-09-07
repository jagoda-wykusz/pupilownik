# Data access convention

How every table in this project is created and secured. Established by F-01
(`owner-data-rls-baseline`). Copy this pattern for each new domain table; do not
re-decide it per slice.

## The security boundary: the Publishable key

The app's Supabase client (`src/lib/supabase.ts`) is bound to the user's cookie
session and uses `SUPABASE_KEY`, which **must be the Publishable (anon) key** —
never the Secret (service_role) key. The Secret key bypasses Row-Level Security
(RLS) entirely; a single misconfigured `.env` would void every policy below. There
is no service_role client in the request path, by design.

- Local key: the `Publishable` value printed by `npm run db:start`.
- `.env`: `SUPABASE_URL`, `SUPABASE_KEY=<publishable key>`.

## Every table: owner FK + deny-by-default RLS

1. **Anchor ownership.** Owner-scoped tables carry the owner via a foreign key to
   `auth.users(id)` (directly, or transitively through another owned row). The
   owner identity lives in `public.profiles` (1:1 with `auth.users`, created on
   signup by the `handle_new_user` trigger).
2. **Enable RLS** on the table. With RLS on and no policy, all access is denied —
   this is the correct fail-closed default.
3. **Grant the table** to `authenticated` for the operations the role needs
   (`grant select, insert, update, delete on <table> to authenticated`). Grants
   only make the table _reachable_ — they do not restrict operations, and Supabase
   default privileges may already grant ALL on new `public` tables. What actually
   denies an operation is the **absence of an RLS policy** for it (deny-by-default),
   not a withheld grant. Grant the operations you'll write policies for; deny the
   rest by simply not writing a policy.
4. **Write policies** that combine `TO authenticated` with an ownership predicate.
   `TO authenticated` alone is authentication without authorization (BOLA/IDOR).
   Wrap `auth.uid()` in a subselect so the planner evaluates it once.

```sql
create policy "<table>_select_own"
  on public.<table>
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

-- UPDATE needs BOTH using and with check, or a user could reassign owner_id.
create policy "<table>_update_own"
  on public.<table>
  for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
```

Notes:

- An `UPDATE` first needs to `SELECT` the row — a table with no SELECT policy will
  silently update 0 rows. Always pair them.
- Caretaker (link-based, no-login) access is a _different_ model — see
  "The token model" below. It does not reuse these owner policies.

## `SECURITY DEFINER` functions (rare — hardening checklist)

Only when a controlled action must bypass RLS (e.g. the signup trigger). Then:

- `set search_path = ''` and fully-qualify every object (`public.x`, `auth.y`).
- `revoke execute on function public.<fn>() from public` so it is not a callable
  public API endpoint.
- Keep an `auth.uid()` check in the body if it does anything user-scoped.
- Prefer `SECURITY INVOKER` (the default) everywhere else. Never add
  `SECURITY DEFINER` just to silence a permission error.

## The token model (link-based, no-login access)

Introduced by S-02. This is the _second_ access model in the schema and the only
one that serves a caller with no `auth.users` row. Read this before adding any
caretaker capability.

Every policy above is `TO authenticated` with an `auth.uid()` predicate, so a
caretaker arriving with a link is the `anon` role and RLS denies them
everything. That is the correct fail-closed default — and the reason this needs
a **function**, not an anon policy.

**The four rules:**

1. **Digest-only storage.** The raw invite token is generated in the app
   (`src/lib/invite-token.ts`: 32 bytes, base64url), and only its hex SHA-256
   reaches the database (`care_periods.token_digest`, unique). The raw value is
   returned to the owner exactly once, on the create/regenerate response. It is
   never stored, never logged, and cannot be read back — losing it means
   regenerating, which invalidates the previous link. The caretaker's capability
   secret (S-03) works the same way and is minted by the same primitive
   (`generateClaimSecret` is a literal alias of `generateInviteToken`): the app
   returns it once into an HttpOnly cookie, only `care_slots.claim_digest` is
   stored, and `claim_slots` hashes what the caller presents rather than
   comparing the stored value. That last point is what stops a stored digest from
   being a replayable credential in its own right, and it is the property the
   first cut of `claim_slots` did not have (Phase 2 impl-review F1).
2. **`SECURITY DEFINER` functions are the entire anon-reachable surface.**
   There are **three** as of S-03 Phase 3 — a read door, a reveal door and a
   write door. Until S-03 Phase 2 there was exactly one and this heading said so;
   the rule was always about the _shape_ rather than the count. Each is a named
   function whose body is the whole authorization boundary, with no policy behind
   it, and never an anon policy on a table. All three carry
   `set search_path = ''`, fully-qualified objects, and an explicit
   `revoke execute … from public, anon, authenticated, service_role` followed by
   `grant execute … to anon, authenticated`, and all three have that posture
   asserted from both sides by a test that fails if it changes in either
   direction.
   - **The read door**: `public.get_period_by_token(p_token text)`, `STABLE`.
     Computes the digest inside the function, resolves **at most one** active
     period, and returns the period plus its slots' free/taken state and its pets
     with their **public** (`is_sensitive = false`) instruction rows — no
     sensitive rows, no `caretaker_note`, no `claimed_by_name`, no `owner_id`, no
     `token_digest`, and no parameter that could widen the result set. A period
     with no linked pets returns `pets: []`.
   - **The reveal door**: `public.get_claimed_details(p_token, p_claim_secret)`,
     `STABLE`. Requires BOTH credentials and returns NULL unless that capability
     holds at least one claimed slot in that period. Serves the sensitive
     instruction tier, the trip's `caretaker_note` and the caretaker's own slots.
     Separate from the read door rather than a parameter on it, because a
     `p_reveal_sensitive` argument is exactly the "parameter that could widen the
     result set" this rule forbids — the tier split would then rest on one boolean
     invisible from outside.
   - **The write door**: `public.claim_slots(p_token, p_slot_ids,
p_claim_secret, p_name)`, `VOLATILE` — a separate function because Postgres
     forbids a `STABLE` one from writing. It **derives** the period from the
     token and never accepts a period id, which is the only thing that makes a
     slot uuid from another period unusable, and it claims a set of slots
     all-or-nothing through a single guarded `update`. It takes the caretaker's
     RAW capability secret and hashes it inside, exactly as it does the token —
     see rule 1, which the two credentials now obey identically.
3. **No anon policy on any table, and no anon table grants.** Supabase's
   `ALTER DEFAULT PRIVILEGES` grants anon SELECT/INSERT/UPDATE/DELETE on every
   new table in `public`, so every table the three doors touch has that grant
   explicitly revoked — **five of them**, and the revokes are spread across the
   migrations that introduced each table: `care_periods` and `care_slots`
   (`20260906003122`), `pets` and `care_instructions` (`20260906094254`), and
   `care_period_pets` (`20260906165005`). Deny-by-default already returned zero
   rows, but the claim "the function is the only door" should rest on two layers,
   not one, and `tests/rls/invite-token.test.ts` and
   `tests/rls/reveal-instructions.test.ts` assert the refusal (SQLSTATE 42501) on
   all five rather than merely an empty result.
   All three functions still reach those tables because each runs as its owner:
   `get_period_by_token` and `get_claimed_details` read them, `claim_slots` reads
   and writes them. That is the point worth carrying: **RLS does not apply inside
   any of the three**, so their bodies — not any policy — are what keeps an
   owner's data and the sensitive instruction tier apart.
4. **Uniform failure — with one deliberate widening for writes.** Unknown,
   malformed and revoked tokens all return NULL, and the page renders one 404
   with one message. A distinct "this link was revoked" answer would confirm the
   period exists. The copy carries the "ask the
   owner for a new link" guidance the response deliberately withholds. A WRITE
   cannot keep this whole: a claim must distinguish "won" from "refused", which
   is a signal a read never emitted. `claim_slots` therefore returns NULL for an
   unresolvable token — the half that is the security property, since it is what
   would otherwise confirm a period exists — but _raises_ when a requested slot
   is no longer free, carrying the conflicting `{slot_date, time_of_day}` rows so
   the page can name the term. That leaks nothing beyond the period the caller
   already holds a valid token for.

**The rule for future slices:** a new caretaker capability _extends this
function_ (or adds another one under the same four rules). It does **not** add an
anon policy to a table. S-03's slot claiming did exactly that, adding
`claim_slots` and then `get_claimed_details`. S-04's occupancy view lands under the
same rule.

**The instruction tier split is two predicates, and nothing else.** Both reading
functions are `SECURITY DEFINER`, so they run as their owner and RLS on `pets`
and `care_instructions` does not apply inside them — which is the point, since
`anon` has no policy on either table and could not read them otherwise. What
separates the public tier from the sensitive one is therefore
`is_sensitive = false` in `get_period_by_token` and `is_sensitive = true` in
`get_claimed_details`. There is no second layer behind either predicate. The two
payloads **partition** the instruction set rather than overlapping: the reveal
returns only the sensitive rows, and the page composes them with the public ones
it already has. `tests/rls/reveal-instructions.test.ts` searches the whole
serialized pre-claim payload for the sensitive body text, rather than checking a
named field, because the failure to catch is "the column split is right but the
API serializes it anyway".

**Response headers.** The token travels in a URL path segment, because the server
has to resolve it before rendering — a fragment never reaches the server. That
makes the response a second escape route, so `src/middleware.ts` sends
`Referrer-Policy: no-referrer` and `Cache-Control: no-store` for `/invite/*`.
Without the first, the page's first outbound link or third-party asset would send
the full path — token included — in `Referer`. Note what this does _not_ fix: the
token is still in browser history and in the access log of anything that proxies
the request. The link is a bearer credential; treat it as one.

**Route gating.** `/invite` must stay out of `PROTECTED_ROUTES`. It is public by
requirement, and `tests/middleware/auth-gating.test.ts` asserts that, so adding
it later fails a test instead of silently bouncing every caretaker to a sign-in
page they have no account for.

## Migration workflow (local-first)

```
npm run db:migration <name>   # create supabase/migrations/<timestamp>_<name>.sql
# edit the SQL
npm run db:reset              # apply all migrations + seed from scratch (verifies clean apply)
npm run db:gen-types         # REGENERATE src/db/database.types.ts from the new schema
npm run db:push              # promote to the hosted project (separate from app deploy)
```

- `src/db/database.types.ts` is **generated, never hand-edited** — it is ignored by
  eslint and prettier. Regenerate it after _every_ migration; a stale file silently
  lies to the type checker.
- Verify before committing: `npm run db:reset` (exit 0), `npx astro check`,
  `npm run lint`, and `npx supabase db advisors --type security`.

## Verifying RLS without the app

Simulate an authenticated user in psql:

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"<user-uuid>"}';
select * from public.<table>;  -- should return only that user's rows
commit;
```
