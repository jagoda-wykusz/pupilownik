-- S-06 Phase 1: the revoke door, and irreversibility made a property of the database.
--
-- FR-012 shipped as ONE action, "odwołaj", not two. prd.md:140 already treats closing and
-- revoking as one identical effect ("po zamknięciu/odwołaniu okresu link przestaje działać"),
-- the PRD's own Socratic round accepted the counter-argument "okres mija sam, ręczne
-- zamykanie zbędne", and this schema has exactly ONE lifecycle axis to hang a state on:
-- care_periods.revoked_at. A distinct "closed" would be this codebase's first reason column,
-- and the requirement is nice-to-have. So: one column, one action, no schema change.
--
-- Like release_slot (20260909090000), this migration adds NO capability. care_periods_update_own
-- (20260905234144:88) already scopes an UPDATE on care_periods to `auth.uid() = owner_id`, and
-- Postgres RLS has no column granularity, so a policy that admits the row admits every column
-- of it — an owner could already set revoked_at, and clear it back, with a plain .update()
-- through their own session (verified against the catalog, not inferred from this comment:
-- the policy text never mentions the column, the table-level UPDATE grant carries no column
-- list, and pg_attribute.attacl is NULL for every column on the table).
--
-- What this adds is a NAMED, guarded surface over that permission, for the reason
-- 2026-09-08-owner-occupancy-view/plan.md:92-94 records: a named surface earns its own
-- registry row, its own grant and its own test, so a later slice cannot widen the owner-side
-- write path by accident.
--
-- SECURITY INVOKER, deliberately, and unlike every anon-facing function in this schema: those
-- are definer because anon has no policy to run under. Here the caller IS the owner, RLS on
-- care_periods is exactly the authorization boundary we want, and running as definer would
-- throw that boundary away and make the body the only guard. Same posture as release_slot and
-- regenerate_period_token.
--
-- WHAT REVOCATION COSTS EVERY CARETAKER AT ONCE, stated here because this function is the
-- trigger and the cost is invisible from the call site. Setting this one column closes all
-- three anon doors simultaneously — get_period_by_token, claim_slots and get_claimed_details
-- share the identical `revoked_at is null` predicate. A caretaker who already claimed loses
-- the trip, their own record of which days they took, the caretaker_note and every
-- is_sensitive instruction row, with no notification, no grace period and no undo —
-- INCLUDING mid-trip, standing at the door. Note the direct tension with S-02's reason for
-- having no auto-expiry ("a caretaker still needs the instructions on the last evening;
-- auto-expiry fails exactly then"): revocation violates that principle by design, which is
-- fine when the owner intends it and is why the control confirms before firing.
--
-- release_slot.sql:20-25 recorded the single-caretaker version of that sentence for freeing one
-- term. This is the all-at-once version. "No notification to the caretaker" is the same scope
-- decision, not an oversight: this product has zero contact columns in any of its 16
-- migrations and no stable caretaker identity to address (src/lib/caretaker-name.ts:151), and
-- prd.md:97 makes the owner's own channel the design — "jeden link do wysłania dowolnym
-- kanałem to najniższe tarcie". The owner already messages these people.
--
-- Phase 2 gives a caretaker who can PROVE they claimed (a matching claim_digest) a distinct
-- "the trip was called off" answer instead of the stranger's dead-link 404. It does not give
-- them their access back.
create function public.revoke_period(
  p_period_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_period_id uuid;
begin
  -- `revoked_at is null` is what makes a DOUBLE REVOKE honest rather than destructive: the
  -- second call matches nothing and answers NULL, exactly as release_slot's
  -- `claimed_at is not null` does for a double release. It carries a second, quieter
  -- guarantee — the ORIGINAL revocation timestamp is never overwritten, so "when did this
  -- trip get called off" stays answerable.
  --
  -- It is also where the product's write-once decision lives. Revocation is IRREVERSIBLE by
  -- decision: there is no un-revoke function and there will not be one in this slice
  -- (20260906003122:120-121 deferred that question here by name, and the answer is no). An
  -- owner who revokes by mistake plans a new trip. Note what this predicate does NOT do: it
  -- cannot stop a direct owner UPDATE from clearing the column, because RLS has no column
  -- granularity. Write-once is enforced by this named surface being the only intended writer,
  -- not by a constraint — recorded in docs/reference/contract-surfaces.md so a later slice
  -- reads it before leaning on it.
  --
  -- now() rather than a parameter: the caller has no legitimate interest in backdating a
  -- revocation, and a p_revoked_at argument would put a value on the island's props that the
  -- owner never chose.
  update public.care_periods
  set revoked_at = pg_catalog.now()
  where id = p_period_id
    and revoked_at is null
  returning id into v_period_id;

  -- A scalar, not a composite, for the reason 20260906003122:123-126 documents: a plpgsql
  -- function returning a composite answers a miss with a ROW OF NULLS rather than NULL, so the
  -- route's 404 branch would never fire.
  --
  -- Not yours, does not exist, and already revoked are ONE answer. The owner has no legitimate
  -- use for the difference, a distinct "exists but not yours" would confirm the period exists,
  -- and the route turns all three into the same 404 — the same collapse both other owner-side
  -- writes make.
  return v_period_id;
end;
$$;

comment on function public.revoke_period(uuid) is
  'Revokes a care period''s invite link by stamping revoked_at, closing all three anon doors at once. Security invoker: care_periods_update_own is the authorization boundary. Write-once by product decision — there is no un-revoke. Returns the period id, or NULL when the period does not exist, RLS filtered it out, or it was already revoked.';

-- Grants.
--
-- `revoke ... from public` alone is NOT enough on Supabase: ALTER DEFAULT PRIVILEGES grants
-- EXECUTE to anon, authenticated and service_role on every new function in `public`,
-- separately from the PUBLIC pseudo-role. The roles have to be NAMED. Same three-line recipe
-- as release_slot and regenerate_period_token, the other owner-only surfaces.
--
-- anon must never reach this: it is the caretaker's role, and a caretaker ending someone's
-- trip is not a product behaviour. tests/rls/revoke-period.test.ts asserts the 42501 back —
-- and asserts the MESSAGE names the function, because the same SQLSTATE arrives from the table
-- layer, so a code-only assertion would keep passing with this grant fully widened
-- (context/foundation/lessons.md; S-04 phase-2 review found exactly that).
revoke execute on function public.revoke_period(uuid)
  from public, anon, service_role;

grant execute on function public.revoke_period(uuid) to authenticated;

-- ── Irreversibility, enforced server-side ──────────────────────────────────────────────────
--
-- Until this slice, nothing reached the hole: with no revoke control, an owner had no way to
-- put a period into the revoked state, so "regenerate a revoked period" was unreachable in
-- practice. RegenerateLinkButton.tsx:57-64 refuses it in the UI and explains why — a new token
-- on a revoked period would return 200 and a link that resolves to nothing, since
-- get_period_by_token filters on `revoked_at is null` and this function deliberately leaves
-- that column alone. That refusal was Fix A of 2026-09-06-care-period-and-invite-link's
-- phase-3 impl-review F3; Fix B (clear revoked_at on regenerate) was explicitly REJECTED, with
-- "S-06 owns the server-side semantics" written next to it.
--
-- S-06 now owns them, and the answer is the same as Fix A's: refuse. Once the revoke control
-- ships in Phase 3 this path becomes reachable BY DESIGN rather than by accident, and a React
-- prop would be the only thing standing between a curl and a permanently dead link the panel
-- calls "gotowy do wysłania". So the predicate moves into the database, where it cannot be
-- bypassed by calling the route directly.
--
-- CREATE OR REPLACE with an UNCHANGED signature, so the grants from 20260906003122 survive —
-- the same move 20260907193000:20-22 made for get_claimed_details. tests/rls/invite-token.test.ts
-- asserts anon's 42501 back rather than trusting this sentence
-- (context/foundation/lessons.md).
--
-- No route change is needed: token.ts already answers 404 on NULL, and this adds a third reason
-- for NULL that it does not — and must not — re-separate.
--
-- revoked_at is still deliberately left ALONE by the body: un-revoking is not a side effect of
-- minting a new link, and after this slice it is not anything else either.
create or replace function public.regenerate_period_token(
  p_period_id uuid,
  p_token_digest text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_period_id uuid;
begin
  update public.care_periods
  set token_digest = p_token_digest
  where id = p_period_id
    -- CHANGED (S-06 Phase 1): a revoked period cannot be given a new link. Revocation is
    -- irreversible, so any token minted here would be dead on arrival.
    and revoked_at is null
  returning id into v_period_id;

  -- Not found, RLS filtered the row out, or the period is revoked: same answer for all three,
  -- so a foreign period id is indistinguishable from a missing one and from a revoked one.
  return v_period_id;
end;
$$;

comment on function public.regenerate_period_token(uuid, text) is
  'Replaces a period''s invite-token digest, invalidating the previous link. Refuses a revoked period, whose links are dead by decision (S-06). Returns the period id, or NULL when RLS filtered the row out, it does not exist, or it is revoked.';

-- ── The column comment, which was wrong ────────────────────────────────────────────────────
--
-- The previous comment is live in the catalog and said "Written by S-06" — future tense about
-- a writer that did not exist, while the ACTUAL writer was any authenticated owner through the
-- generic all-columns policy, the same door used to rename a trip. That is exactly the class
-- context/foundation/lessons.md records: a sentence about what exists, written before it did,
-- read later as an inventory.
comment on column public.care_periods.revoked_at is
  'When set, the invite link no longer resolves: get_period_by_token, claim_slots and get_claimed_details all share the predicate `revoked_at is null` — as of this migration all three are identical (planned, S-06 Phase 2: get_claimed_details will resolve the period WITHOUT this filter and answer a caller with a matching claim_digest differently, still without restoring any access). revoke_period is its only intended writer, and regenerate_period_token refuses a period carrying it. Write-once by product decision — enforced by revoke_period''s `revoked_at is null` predicate, NOT by a constraint: care_periods_update_own has no column granularity, so a direct owner UPDATE can still write or clear this column.';
