-- S-09 Phase 1: the owner's edit path for a pet and its care instructions.
--
-- WHY THIS FUNCTION EXISTS AT ALL, stated plainly because the catalog says it adds no
-- capability. Role `authenticated` already holds UPDATE on `pets` and `care_instructions`,
-- and `pets_update_own` / `care_instructions_update_own` already permit the owner — measured
-- 2026-09-13 from information_schema.role_table_grants and pg_policies, not read from a
-- comment (context/foundation/lessons.md). An owner's plain `update public.pets ... where
-- id = <own>` answers `UPDATE 1` today. So this is a NAMED SURFACE over a permission the
-- owner already has, exactly as revoke_period is (docs/reference/contract-surfaces.md:52),
-- and it exists for the two invariants RLS cannot express:
--
--   1. A pet and its instruction set must move together. S-01 argued the same for the create
--      path (20260712204748:120-121) on the grounds that there was no edit path to recover a
--      half-written pet. That premise dies with this migration — so the reason is restated
--      rather than inherited: a partial edit is not unrecoverable any more, but it is still a
--      lie to the caretaker, who reads these rows live and cannot tell a half-applied edit
--      from a finished one.
--   2. `is_sensitive` on an EXISTING row freezes once a claimed live trip covers the pet.
--
-- WHAT THE FREEZE IS FOR. The instruction tier split is a filter over ROWS, not a mask over
-- fields (docs/reference/data-access.md:283-295): get_period_by_token serves is_sensitive =
-- false, get_claimed_details serves is_sensitive = true. Flipping the flag therefore moves a
-- row between two audiences with no intermediate state, and `true -> false` publishes the
-- address and the gate code to everyone holding the link, including visitors who never
-- claimed. Editing the TEXT is the opposite case and is deliberately always allowed: prd.md:48
-- ("Instrukcje zawsze aktualne") promises the caretaker the current feeding instructions, and
-- with no write path that promise could not be kept at all.
--
-- THE FREEZE IS SOFT, AND THAT IS A DECISION, NOT AN OVERSIGHT. Deleting a sensitive row and
-- adding it back as a public one reproduces the reveal in two deliberate steps. Accepted
-- 2026-09-13: the block defends against an accidental click and against a silent contract
-- change, not against the owner's intent — they authored the data. The two closure variants
-- (refusing to delete sensitive rows post-claim; refusing to add public rows post-claim) were
-- both considered and rejected in context/changes/pet-edit-and-delete/change.md, because each
-- takes away a legitimate mid-trip correction.
--
-- THE FREEZE PREDICATE IS NOT THE DELETE-BLOCK PREDICATE. Phase 2's delete_pet refuses while
-- any unrevoked period covers the pet, with NO claim condition. This one additionally requires
-- a claimed slot, because nothing has been disclosed to anyone until someone claims. They read
-- alike and are not alike; do not unify them.
--
-- SECURITY INVOKER, so `pets_update_own` and `care_instructions_update_own` remain the
-- authorization boundary and this body is only a guard. owner_id is never a parameter and is
-- never written — pets_update_own carries `with check` as well as `using`, so a reassignment
-- would be refused anyway, and not writing it at all makes the refusal unreachable rather than
-- merely unlikely.

create function public.update_pet_with_instructions(
  p_pet_id uuid,
  p_name text,
  p_species public.pet_species,
  p_breed text,
  p_age text,
  p_instructions jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pet_id uuid;
  v_frozen boolean;
  v_conflicts jsonb;
begin
  -- The gate. RLS decides whether this caller may touch the row; a miss (not theirs, or no
  -- such pet) leaves v_pet_id NULL and the function answers NULL, which the route turns into
  -- a 404. Both misses collapse on purpose, as every other owner-side write in this schema
  -- does: the owner has no use for the difference, and a distinct "exists but not yours"
  -- would confirm the pet exists.
  update public.pets
  set name = p_name,
      species = p_species,
      breed = p_breed,
      age = p_age
  where id = p_pet_id
  returning id into v_pet_id;

  if v_pet_id is null then
    return null;
  end if;

  -- A scalar return, not `returns public.pets`, for the reason 20260906003122:123-126
  -- documents: a plpgsql function returning a composite answers a miss with a ROW OF NULLS
  -- rather than NULL, so the route's 404 branch would never fire.

  v_frozen := exists (
    select 1
    from public.care_period_pets link
    join public.care_periods p on p.id = link.period_id
    join public.care_slots s on s.period_id = p.id
    where link.pet_id = p_pet_id
      and p.revoked_at is null
      and s.claimed_by_name is not null
  );

  if v_frozen then
    -- Compared against the STORED row, never against the incoming value. A check written on
    -- the payload alone is a no-op that reads like a guard: the caller controls both sides of
    -- it. `is distinct from` rather than `<>` because the column is `not null` today but the
    -- comparison should not silently pass on a NULL if that ever changes.
    select pg_catalog.jsonb_agg(ci.id order by ci.id)
    into v_conflicts
    from (
      select
        (elem ->> 'id')::uuid as id,
        coalesce((elem ->> 'is_sensitive')::boolean, false) as is_sensitive
      from pg_catalog.jsonb_array_elements(coalesce(p_instructions, '[]'::jsonb)) as elem
      where elem ->> 'id' is not null
    ) incoming
    join public.care_instructions ci
      on ci.id = incoming.id
     and ci.pet_id = p_pet_id
    where ci.is_sensitive is distinct from incoming.is_sensitive;

    if v_conflicts is not null then
      -- PT409, not a bare raise. PostgREST maps a PTxxx SQLSTATE straight onto the HTTP
      -- status, which is what keeps a business-rule refusal out of the NULL -> 404 path —
      -- that path is a separate branch reached only when there was no error at all. DETAIL
      -- carries a JSON array the route parses, never prose (the shape claim_slots established
      -- at 20260907171514:251-254).
      raise exception 'update_pet_with_instructions: is_sensitive is frozen on % instruction row(s) while a claimed live trip covers this pet',
        pg_catalog.jsonb_array_length(v_conflicts)
        using errcode = 'PT409',
              detail = v_conflicts::text;
    end if;
  end if;

  -- Rows the payload does not name are deletions. That is what makes the route's verb PUT
  -- honest: the body is the complete desired instruction set, not a patch.
  delete from public.care_instructions ci
  where ci.pet_id = p_pet_id
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(coalesce(p_instructions, '[]'::jsonb)) as elem
      where elem ->> 'id' is not null
        and (elem ->> 'id')::uuid = ci.id
    );

  -- `ci.pet_id = p_pet_id` on this update is REDUNDANT with RLS — care_instructions_update_own
  -- already refuses another owner's row, and its `with check` refuses re-pointing pet_id at a
  -- foreign pet (measured 2026-09-13: "new row violates row-level security policy"). It is
  -- kept deliberately, the same way release_slot keeps its period_id predicate
  -- (20260909090000:43-47): instruction ids are owner-supplied input, and this makes the
  -- route's URL and the guard agree, so a row belonging to ANOTHER OF THIS OWNER'S OWN pets
  -- cannot be adopted through the wrong pet's endpoint. RLS does not cover that case at all.
  update public.care_instructions ci
  set title = src.title,
      body = src.body,
      is_sensitive = src.is_sensitive,
      sort_order = src.sort_order
  from (
    select
      (elem ->> 'id')::uuid as id,
      elem ->> 'title' as title,
      elem ->> 'body' as body,
      coalesce((elem ->> 'is_sensitive')::boolean, false) as is_sensitive,
      (ord - 1)::int as sort_order
    from pg_catalog.jsonb_array_elements(coalesce(p_instructions, '[]'::jsonb))
      with ordinality as t(elem, ord)
    where elem ->> 'id' is not null
  ) src
  where ci.id = src.id
    and ci.pet_id = p_pet_id;

  -- sort_order comes from array position, not from a client-supplied field, so the order the
  -- owner sees in the form is the order stored. This is why the create path's `p_instructions`
  -- sort_order handling is NOT copied here: there it trusts the payload, and two writers
  -- disagreeing about who owns ordering is how a list starts reordering itself on save.
  insert into public.care_instructions (pet_id, title, body, is_sensitive, sort_order)
  select
    p_pet_id,
    elem ->> 'title',
    elem ->> 'body',
    coalesce((elem ->> 'is_sensitive')::boolean, false),
    (ord - 1)::int
  from pg_catalog.jsonb_array_elements(coalesce(p_instructions, '[]'::jsonb))
    with ordinality as t(elem, ord)
  where elem ->> 'id' is null;

  return v_pet_id;
end;
$$;

comment on function public.update_pet_with_instructions(uuid, text, public.pet_species, text, text, jsonb) is
  'Replaces a pet''s scalar fields and synchronises its care-instruction set in one transaction: rows carrying an id are updated, rows without one are inserted, and stored rows the payload does not name are deleted. sort_order is taken from array position. Security invoker: pets_update_own and care_instructions_update_own are the authorization boundary. Raises PT409 with a JSON array of instruction ids in DETAIL when the payload would flip is_sensitive on an existing row while an unrevoked period covering this pet has a claimed slot. Returns the pet id, or NULL when the pet does not exist or RLS filtered it out. Called by PUT /api/pets/[id].';

-- Grants. `revoke ... from public` alone is NOT enough on Supabase: ALTER DEFAULT PRIVILEGES
-- grants EXECUTE to anon, authenticated and service_role on every new function in `public`,
-- separately from the PUBLIC pseudo-role, so the roles have to be NAMED (20260909090000:88-97).
--
-- anon must never reach this: it is the caretaker's role, and a caretaker editing the owner's
-- instructions is not a product behaviour. tests/rls/update-pet.test.ts asserts the 42501 back
-- AND that the message names the function, rather than trusting this sentence — a code-only
-- assertion keeps passing with the grant fully widened (context/foundation/lessons.md).
revoke execute on function public.update_pet_with_instructions(uuid, text, public.pet_species, text, text, jsonb)
  from public, anon, service_role;

grant execute on function public.update_pet_with_instructions(uuid, text, public.pet_species, text, text, jsonb) to authenticated;
