-- S-09 impl-review F1: delete_pet's guard took no lock, and lost the race it exists to win.
--
-- MEASURED 2026-09-14 against the local stack, two psql sessions, NOT reasoned from the schema
-- (context/foundation/lessons.md — a sentence about what happens when a guard is bypassed is a
-- prediction until it is run):
--
--   A: begin;
--      insert into public.care_period_pets (period_id, pet_id) values (<trip>, <pet>);
--      select pg_sleep(4);
--      commit;
--   B, one second later:
--      select public.delete_pet(<pet>);
--
--   Result: B returned the pet id — SUCCESS, no PT409. Afterwards `pets` held 0 rows for that
--   id, `care_period_pets` held 0, and the trip was STILL LIVE with zero pets.
--
-- Why. The blocker `select` in 20260914090000 takes no lock, so a covering link that is
-- inserted but not yet committed is invisible to it. The `delete` that follows then waits on
-- the inserting transaction's FOR KEY SHARE on the `pets` row; when that commits, READ
-- COMMITTED re-checks the row, finds it neither updated nor deleted, and proceeds — and
-- `care_period_pets.pet_id ... on delete cascade` (20260906165005:20) silently removes the
-- link that was just created. The outcome is precisely the state 20260914090000's header
-- describes as the reason this function exists: a volunteer holding a shift for an animal that
-- is no longer on the trip, instructions cascaded away, nobody told. Reached THROUGH the guard
-- rather than around it, and undetectable afterwards.
--
-- The fix is one statement: take the row lock BEFORE reading the blockers. `for update`
-- conflicts with the inserter's FOR KEY SHARE, so the guard query waits rather than racing,
-- and under READ COMMITTED it then runs on a fresh snapshot that includes the new link.
--
-- MEASURED with the lock in place, same interleaving: B raised
--   ERROR:  delete_pet: 1 unrevoked period(s) still cover this pet
--   DETAIL: [{"id": "...", "title": "RaceTrip"}]
-- and the pet survived. Both halves were run; neither is inferred.
--
-- NOT COVERED BY AN AUTOMATED TEST, stated plainly rather than left for the next reader to
-- discover. Reproducing this needs two connections with one transaction held open across the
-- other's call, and the integration harness speaks supabase-js over PostgREST, which cannot
-- hold a transaction open between statements. This repo has no direct Postgres driver and this
-- is not a good enough reason to add one. The reproduction above is the test; it is written
-- here so it can be re-run by hand against any future change to this function.
--
-- WHAT THIS DOES NOT FIX. update_pet_with_instructions' freeze predicate (20260913210000:87-95)
-- is snapshot-based in the same way: a `claim_slots` committing between that `exists` and the
-- transaction's own commit lets a `true -> false` flip through, publishing a sensitive row to
-- everyone holding the link. It has no equivalent cheap lock — the claim path writes
-- `care_slots` and never touches `pets`, so there is no single row both sides contend on. Left
-- open deliberately and recorded here; the freeze is already documented as soft by decision,
-- but that sentence is about the owner's intent, not about concurrency, and the two should not
-- be read as one.
--
-- CREATE OR REPLACE with an UNCHANGED signature, so the grants from 20260914090000 survive —
-- the same move 20260910120000 made for regenerate_period_token, for the same reason. A new
-- migration rather than an edit to the applied one: a migration that has run is history.
create or replace function public.delete_pet(
  p_pet_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pet_id uuid;
  v_blockers jsonb;
begin
  -- CHANGED (impl-review F1): lock the row before reading the guard. Without this the two
  -- statements below straddle a window in which a covering trip can be created invisibly. The
  -- lock is on the row this function is about to delete anyway, so it costs nothing a caller
  -- was not already going to pay.
  --
  -- `perform`, not `select ... into`: nothing here needs the row's contents. A miss (no such
  -- pet, or RLS filtered it out) locks nothing and falls through to the same NULL answer as
  -- before — the ordering below is unchanged for every non-concurrent case.
  perform 1
  from public.pets
  where id = p_pet_id
  for update;

  select pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object('id', p.id, 'title', p.title)
           order by p.start_date, p.id
         )
  into v_blockers
  from public.care_period_pets link
  join public.care_periods p on p.id = link.period_id
  where link.pet_id = p_pet_id
    and p.revoked_at is null;

  if v_blockers is not null then
    -- PT409 with JSON in DETAIL, unchanged from 20260914090000: PostgREST maps a PTxxx SQLSTATE
    -- onto the HTTP status, which keeps a business-rule refusal out of the NULL -> 404 path, and
    -- the route names the blocking trips from this payload.
    raise exception 'delete_pet: % unrevoked period(s) still cover this pet',
      pg_catalog.jsonb_array_length(v_blockers)
      using errcode = 'PT409',
            detail = v_blockers::text;
  end if;

  -- RLS decides whether this caller may delete the row; a miss leaves v_pet_id NULL and the
  -- route turns that into a 404. A stranger's covered pet still answers 404 rather than 409,
  -- because the blocker query above is RLS-scoped too and finds nothing.
  delete from public.pets
  where id = p_pet_id
  returning id into v_pet_id;

  return v_pet_id;
end;
$$;

comment on function public.delete_pet(uuid) is
  'Deletes a pet and, by cascade, its care instructions. Locks the pet row (for update) before reading its guard, so a trip being created concurrently cannot slip past the check and be cascaded away — measured 2026-09-14, see 20260914120000. Refuses with PT409 while any period covering the pet has revoked_at is null; the remedy is to revoke that trip first, and DETAIL carries a JSON array of the blocking periods as {id, title}. The predicate has NO claim condition, unlike update_pet_with_instructions'' is_sensitive freeze. Security invoker: pets_delete_own is the authorization boundary. Returns the pet id, or NULL when the pet does not exist or RLS filtered it out. Called by DELETE /api/pets/[id].';
