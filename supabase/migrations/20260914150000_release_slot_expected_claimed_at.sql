-- prd.md §Open Questions #3: `release_slot` had no optimistic concurrency, and the window that
-- left open destroys a caretaker's claim silently.
--
-- THE HOLE. A released row is `claimed_by_name is null` / `claimed_at is null`, which is
-- exactly the state `claim_slots` writes into. The old guard was `claimed_at is not null` — a
-- test that the row is claimed by SOMEONE, never that it is claimed by the person the owner was
-- looking at when they decided to take the term back. So:
--
--   tab A renders the grid showing Ania
--     -> tab B releases that term
--     -> Basia claims it through the still-live invite link
--     -> tab A clicks "Zwolnij" on its stale view
--
-- `claimed_at is not null` is true again, so the update matches, and Basia's claim is gone. She
-- is told nothing: her reveal simply collapses — trip note, sensitive instructions and her
-- stored name all at once (20260909090000:16-22) — and from her side it is indistinguishable
-- from a bad link.
--
-- 20260909090000:60-66 recorded this as accepted for the MVP. Both of its grounds are restated
-- here because neither survived contact with the shipped page:
--
--   * "It needs two concurrent owner surfaces." It needs two concurrent owner VIEWS, which one
--     owner produces by leaving a second tab open. ReleaseSlotButton reloads the page on
--     success, so every OTHER open tab is stale from that moment on. No co-owner and no
--     realtime layer is required — the trigger is a browser tab.
--   * "The slot ends free either way, which is what the owner asked for." True of the slot and
--     false of the product: what the owner asked for was to free ANIA'S term. Freeing Basia's
--     is a different act against a different person, and the owner is told it succeeded.
--
-- THE FIX is the one that note already named: an optimistic-concurrency argument. The caller
-- echoes back the `claimed_at` its page rendered, and the guard compares the stored row against
-- THAT rather than against "not null". Same shape as the pet edit path S-09 grew
-- (20260914130000, `p_expected_updated_at`), down to the SQLSTATE, so the two read alike.
--
-- WHY `claimed_at` IS A FAITHFUL TOKEN, and why no new column is needed: the three claim
-- columns are one fact, written together and only together. `care_slots_claim_complete` makes
-- all-three-null and all-three-set the only legal states, `claim_slots` stamps
-- `claimed_at = now()` on every claim, and this function nulls all three. A term that has been
-- released and re-claimed since the page rendered therefore carries a different `claimed_at` by
-- construction. What it does NOT catch is a direct owner UPDATE on `care_slots`, which bypasses
-- this function entirely — the same intended-writer-not-enforced-writer posture
-- docs/reference/contract-surfaces.md already records for this surface and for
-- `update_pet_with_instructions`. Stated so it is a decision rather than an oversight.

-- DROP + CREATE, not `create or replace`: the argument list changes, and an added parameter
-- would create a SECOND function (an overload) inheriting Supabase's default execute grants to
-- anon / authenticated / service_role, while the old 2-argument signature stayed reachable with
-- its existing grant — i.e. the unguarded release would survive this migration. `create or
-- replace` preserves grants only when the argument list is unchanged. Dropping first is the
-- only shape that leaves exactly one function with exactly one known grant posture
-- (20260914130000:52-58).
drop function public.release_slot(uuid, uuid);

create function public.release_slot(
  p_period_id uuid,
  p_slot_id uuid,
  p_expected_claimed_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slot_id uuid;
  v_still_claimed boolean;
begin
  -- Still ONE statement, so the three columns can never be written apart and no read-then-write
  -- window exists. What changed is the third predicate.
  --
  -- `period_id = p_period_id` is REDUNDANT with RLS — the policy already refuses another
  -- owner's row — and is kept on purpose: it makes the route's URL and the guard agree, so a
  -- slot uuid belonging to another of the OWNER'S OWN periods cannot be released through the
  -- wrong period's endpoint.
  --
  -- `claimed_at = p_expected_claimed_at` replaces the old `claimed_at is not null` and does
  -- strictly more than it did. Equality against a non-null argument implies not-null, so the
  -- double-release case the old predicate existed for is still answered by a miss — and a
  -- re-claimed term, which the old predicate waved through, now misses too.
  --
  -- A caller passing NULL here matches nothing: `claimed_at = null` is NULL, never true. That
  -- is the right answer rather than a gap — it asks to release a term the caller believes is
  -- free — and it means the `authenticated` role cannot reach the old unguarded behaviour by
  -- omitting the argument.
  update public.care_slots
  set claimed_by_name = null,
      claimed_at = null,
      claim_digest = null
  where id = p_slot_id
    and period_id = p_period_id
    and claimed_at = p_expected_claimed_at
  returning id into v_slot_id;

  if v_slot_id is not null then
    return v_slot_id;
  end if;

  -- The miss needs splitting into two answers, and this read is what splits it. Taken AFTER the
  -- update has already decided, never before it — a `select` that checked freeness first would
  -- reintroduce exactly the read-then-write this function is shaped to avoid (the ordering
  -- claim_slots settled on at 20260907154125:192-197).
  --
  -- RLS-scoped, like everything else here, so a foreign owner's row is simply invisible and
  -- `v_still_claimed` comes back NULL — which falls through to the NULL return below and keeps
  -- the four misses indistinguishable. A stranger never learns that the slot exists.
  select s.claimed_at is not null
  into v_still_claimed
  from public.care_slots s
  where s.id = p_slot_id
    and s.period_id = p_period_id;

  -- Visible to this owner, still claimed, and not by the claim they were looking at. This is
  -- the case the whole migration exists for, and it is the ONE miss that must not answer like
  -- the others: "not found" would tell the owner the term is free when someone is standing on
  -- it, and the route's 404 sentence ("Ten termin nie jest już zajęty") would be a plain lie.
  --
  -- PT412, NOT PT409, and the reason is the same one 20260914130000:31-35 gives: PostgREST maps
  -- the last three digits of a PTxxx SQLSTATE onto the HTTP status, and a stale token is
  -- precisely Precondition Failed. The route turns it into 409 for the owner, because from
  -- their side what happened is a conflict with another writer.
  --
  -- No DETAIL payload. The two other raises in this schema carry JSON there because the caller
  -- composes a sentence naming the offending rows; here there is exactly one row, the route
  -- already knows which, and the new holder's name is NOT the owner's to be handed in an error
  -- body — they will see it on the refresh the message asks for, through the normal
  -- RLS-scoped read.
  if coalesce(v_still_claimed, false) then
    raise exception 'release_slot: the term was claimed again after this view was rendered'
      using errcode = 'PT412';
  end if;

  -- A scalar, not a composite, for the reason 20260906003122 documents at :123-126: a plpgsql
  -- function returning a composite answers a miss with a ROW OF NULLS rather than NULL, so the
  -- route's 404 branch would never fire.
  --
  -- Not yours, not there, wrong period, and already free are one answer. The owner has no
  -- legitimate use for the difference, and the route turns all four into the same 404.
  return v_slot_id;
end;
$$;

comment on function public.release_slot(uuid, uuid, timestamptz) is
  'Frees one claimed care slot, nulling claimed_by_name, claimed_at and claim_digest together. Optimistically concurrent: releases only when claimed_at still equals p_expected_claimed_at, so an owner acting on a stale view cannot wipe a claim made after that view was rendered. Raises PT412 when the term is still claimed under a different claimed_at (the route answers 409); returns NULL when the slot is not in that period, does not exist, RLS filtered it out, or it was already free (the route answers 404). Security invoker: care_slots_update_own is the authorization boundary. Called by POST /api/periods/[id]/slots/[slotId]/release.';

-- Grants, repeated because DROP took the old ones with it. `revoke ... from public` alone is NOT
-- enough on Supabase: ALTER DEFAULT PRIVILEGES grants EXECUTE to anon, authenticated and
-- service_role on every new function in `public`, separately from the PUBLIC pseudo-role, so the
-- roles have to be NAMED (20260909090000:88-97).
--
-- anon must never reach this: it is the caretaker's role, and a caretaker freeing someone else's
-- term is not a product behaviour. tests/rls/release-slot.test.ts asserts the 42501 back rather
-- than trusting this sentence (context/foundation/lessons.md).
revoke execute on function public.release_slot(uuid, uuid, timestamptz)
  from public, anon, service_role;

grant execute on function public.release_slot(uuid, uuid, timestamptz) to authenticated;
