-- S-04 Phase 2: the release function. The product's first inverse for its only anonymous
-- write.
--
-- An owner who watches a forwarded link take every term needs a way to free one. Nothing in
-- the schema had to change for that: `care_slots_update_own` already scopes an UPDATE on
-- care_slots to the owner of the parent period, and all-three-null is the free state that
-- `care_slots_claim_complete` accepts. So this migration adds no capability — it adds a NAMED,
-- guarded surface over one the owner already had.
--
-- Why a function at all, rather than an inline `.update()` in the route: the three claim
-- columns are ONE fact (see the `care_slots` claim-columns row in
-- docs/reference/contract-surfaces.md), and that registry already warns that a direct owner
-- UPDATE can write them. A named surface earns its own registry row, its own grant, and its
-- own test, so a later slice cannot widen the owner-side write path without noticing.
--
-- What nulling `claim_digest` costs the caretaker, stated here because the column has a
-- downstream reader: `get_claimed_details` gates the whole sensitive tier on
-- `claim_digest = <their secret's digest>` within the period. Freeing ONE of several terms is
-- harmless — the remaining rows keep the digest — but freeing a capability's LAST term revokes
-- that caretaker's reveal outright (trip note, sensitive instructions, their stored name), and
-- to them it is indistinguishable from a bad link. Intended, not a bug: the owner is taking the
-- term back, and "no notification to the caretaker" is a scope decision, not an oversight.
--
-- SECURITY INVOKER, deliberately, and unlike every anon-facing function in this schema: those
-- are definer because anon has no policy to run under. Here the caller IS the owner, RLS on
-- care_slots is exactly the authorization boundary we want, and running as definer would
-- throw that boundary away and make the body the only guard. Same posture as
-- regenerate_period_token (20260906003122 §3).
create function public.release_slot(
  p_period_id uuid,
  p_slot_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slot_id uuid;
begin
  -- One statement, so the three columns can never be written apart and no read-then-write
  -- window exists.
  --
  -- `period_id = p_period_id` is REDUNDANT with RLS — the policy already refuses another
  -- owner's row — and is kept on purpose: it makes the route's URL and the guard agree, so a
  -- slot uuid belonging to another of the OWNER'S OWN periods cannot be released through the
  -- wrong period's endpoint.
  --
  -- `claimed_at is not null` is what makes a DOUBLE RELEASE honest rather than destructive:
  -- the second call matches nothing and answers NULL.
  --
  -- It is NOT optimistic concurrency, and this function deliberately has none. Say the
  -- remaining window plainly, because the plan this migration implements got it wrong: a
  -- released row is `claimed_by_name is null`, which is exactly the state claim_slots writes
  -- into, so a freed term CAN be re-taken by a different caretaker. Owner's tab A renders
  -- showing Ania -> tab B releases -> Basia claims through the still-live link -> tab A
  -- clicks release on stale UI and silently wipes Basia's newer claim; `claimed_at is not
  -- null` is true again, so nothing stops it.
  --
  -- Accepted for the MVP rather than guarded: it needs two concurrent owner surfaces with a
  -- caretaker claim landing between them, the slot ends free either way (which is what the
  -- owner asked for), and the fix — an optimistic `p_claimed_at` argument — would put a
  -- second value on the release island's props for a race one owner with one tab cannot hit.
  -- Recorded in prd.md §Open Questions; revisit if the product ever grows co-owners or
  -- realtime.
  update public.care_slots
  set claimed_by_name = null,
      claimed_at = null,
      claim_digest = null
  where id = p_slot_id
    and period_id = p_period_id
    and claimed_at is not null
  returning id into v_slot_id;

  -- A scalar, not a composite, for the reason 20260906003122 documents at :123-126: a plpgsql
  -- function returning a composite answers a miss with a ROW OF NULLS rather than NULL, so the
  -- route's 404 branch would never fire.
  --
  -- Not yours, not there, and already free are one answer. The owner has no legitimate use for
  -- the difference, and the route turns all three into the same 404.
  return v_slot_id;
end;
$$;

comment on function public.release_slot(uuid, uuid) is
  'Frees one claimed care slot, nulling claimed_by_name, claimed_at and claim_digest together. Security invoker: care_slots_update_own is the authorization boundary. Returns the slot id, or NULL when the slot is not in that period, does not exist, RLS filtered it out, or it was already free.';

-- Grants.
--
-- `revoke ... from public` alone is NOT enough on Supabase: ALTER DEFAULT PRIVILEGES grants
-- EXECUTE to anon, authenticated and service_role on every new function in `public`,
-- separately from the PUBLIC pseudo-role. The roles have to be NAMED. Same three-line recipe
-- as regenerate_period_token, the other owner-only surface.
--
-- anon must never reach this: it is the caretaker's role, and a caretaker freeing someone
-- else's term is not a product behaviour. tests/rls/release-slot.test.ts asserts the 42501
-- back rather than trusting this sentence (context/foundation/lessons.md).
revoke execute on function public.release_slot(uuid, uuid)
  from public, anon, service_role;

grant execute on function public.release_slot(uuid, uuid) to authenticated;
