-- S-09 Phase 2: the owner's delete door, and the refusal that is the point of it.
--
-- WHY A GUARD IS NEEDED AT ALL — measured 2026-09-13 against the local stack, not reasoned
-- from the schema (context/foundation/lessons.md). With an active trip covering two pets and
-- one term claimed by "Ania", deleting a pet gave: the caretaker's view 2 pets -> 1; that
-- pet's 2 instruction rows (one sensitive) -> 0; and **claim, slot, trip and invite link all
-- untouched**. So the cascade does not merely remove the pet — it leaves a volunteer holding a
-- shift for an animal that is no longer on the trip, with the instructions gone, and there is
-- no mechanism in this product by which she could learn it. That is the failure this function
-- exists to prevent, and it is why the refusal lives in SQL rather than in the handler: role
-- `authenticated` holds DELETE on `pets` and `pets_delete_own` permits the owner, so a check
-- written in the route is bypassable by the same browser that renders the page.
--
-- Like update_pet_with_instructions and revoke_period, this adds NO capability — it is a
-- NAMED, guarded surface over a permission the owner already has, so a later slice cannot
-- widen the owner-side delete path by accident (docs/reference/contract-surfaces.md).
--
-- S-08 CONSIDERED `on delete restrict` ON pets AND REJECTED IT (20260906165005:148-153). The
-- rejection rested on cost: a petless period stays representable anyway, and a restrict would
-- have left the owner with no way out — nothing in the product could release the constraint,
-- because no slice owned period editing. **That premise is dead.** S-06 shipped revoke_period,
-- so an owner facing this refusal has a documented remedy: revoke the trip, then delete. The
-- guard is still not a foreign-key constraint, and deliberately so — a constraint cannot name
-- the blocking trips in its error, and naming them is what makes the refusal actionable.
--
-- THE DELETE-BLOCK PREDICATE IS NOT THE FREEZE PREDICATE. This one is `revoked_at is null` on
-- a covering period, with NO claim condition: a live trip that nobody has claimed yet is still
-- a trip whose caretaker may claim it tomorrow, and a pet vanishing between the invite and the
-- claim is the same silent hole. update_pet_with_instructions' freeze additionally requires a
-- claimed slot, because until someone claims, nothing has been disclosed to anyone. They read
-- alike and are not alike; do not unify them.
--
-- NO DATE PREDICATE. "The trip has ended" is not a concept in this product (prd.md Open
-- Question #4). The accepted cost is stated plainly: a pet covered by an unrevoked trip from
-- last year cannot be deleted until the owner revokes that trip, and the route's 409 sentence
-- has to point at that exit rather than leaving the owner stuck.
--
-- SECURITY INVOKER, so `pets_delete_own` remains the authorization boundary and this body is
-- only a guard. That also makes the blocker query below honest: it runs under the caller's
-- RLS, and care_period_pets_select_own (20260906165005:53) requires the caller to own BOTH
-- sides of the link — which is exactly why the guard cannot be blinded by a row it may not
-- read. A period covering this pet can only belong to this pet's owner: the link's insert
-- policy checks both halves too, so a foreign owner's trip can never reference this pet in the
-- first place.
create function public.delete_pet(
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
  -- The guard runs BEFORE the delete, not inside a rolled-back attempt. Either order ends in
  -- the same state — the raise aborts the whole call — but this order keeps the refusal
  -- readable: nothing has been destroyed at the point the exception is raised, so the DETAIL
  -- payload describes the world as it still is.
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
    -- PT409, not a bare raise. PostgREST maps a PTxxx SQLSTATE straight onto the HTTP status,
    -- which is what keeps a business-rule refusal out of the NULL -> 404 path — that path is a
    -- separate branch reached only when there was no error at all. DETAIL carries JSON the
    -- route parses, never prose (the shape claim_slots established at 20260907171514:251-254),
    -- and here it carries titles as well as ids because the route's sentence names the trip the
    -- owner has to revoke. Titles are the owner's own text and go to the owner alone.
    raise exception 'delete_pet: % unrevoked period(s) still cover this pet',
      pg_catalog.jsonb_array_length(v_blockers)
      using errcode = 'PT409',
            detail = v_blockers::text;
  end if;

  -- The gate. RLS decides whether this caller may delete the row; a miss (not theirs, or no
  -- such pet) leaves v_pet_id NULL and the function answers NULL, which the route turns into a
  -- 404. Both misses collapse on purpose, as every other owner-side write in this schema does.
  --
  -- Note what the ordering above means for a stranger's pet: the blocker query is RLS-scoped
  -- too, so it finds nothing, and the call falls through to this delete — which also finds
  -- nothing. A foreign pet therefore answers 404 rather than 409, and never reveals that a trip
  -- covers it.
  --
  -- A scalar return, not `returns public.pets`, for the reason 20260906003122:123-126
  -- documents: a plpgsql function returning a composite answers a miss with a ROW OF NULLS
  -- rather than NULL, so the route's 404 branch would never fire.
  delete from public.pets
  where id = p_pet_id
  returning id into v_pet_id;

  return v_pet_id;
end;
$$;

comment on function public.delete_pet(uuid) is
  'Deletes a pet and, by cascade, its care instructions. Refuses with PT409 while any period covering the pet has revoked_at is null — the remedy is to revoke that trip first; DETAIL carries a JSON array of the blocking periods as {id, title}. The predicate has NO claim condition, unlike update_pet_with_instructions'' is_sensitive freeze. Security invoker: pets_delete_own is the authorization boundary. Returns the pet id, or NULL when the pet does not exist or RLS filtered it out. Called by DELETE /api/pets/[id].';

-- Grants. `revoke ... from public` alone is NOT enough on Supabase: ALTER DEFAULT PRIVILEGES
-- grants EXECUTE to anon, authenticated and service_role on every new function in `public`,
-- separately from the PUBLIC pseudo-role, so the roles have to be NAMED (20260909090000:88-97).
--
-- anon must never reach this: it is the caretaker's role, and a caretaker deleting the owner's
-- animal is not a product behaviour. tests/rls/delete-pet.test.ts asserts the 42501 back AND
-- that the message names the function, rather than trusting this sentence — a code-only
-- assertion keeps passing with the grant fully widened, because the same SQLSTATE arrives from
-- the table layer (context/foundation/lessons.md).
revoke execute on function public.delete_pet(uuid)
  from public, anon, service_role;

grant execute on function public.delete_pet(uuid) to authenticated;
