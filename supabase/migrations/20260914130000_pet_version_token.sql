-- S-09 impl-review F4: the edit path was last-write-wins over the whole instruction set.
--
-- THE HOLE, and it follows from a decision the plan made on purpose. PUT is the honest verb
-- because "a stored row the payload does not name is deleted" (20260913210000:131-138) — the
-- body is the complete desired state. But the body is seeded from whatever the page rendered,
-- and nothing carried a version. So: tab A loads three instructions, tab B adds a fourth, tab A
-- then saves ANY field at all — even just the pet's name — and B's row is deleted, with a 200
-- and no mention of it anywhere. The owner is told the save succeeded, which it did; what they
-- are not told is what it removed.
--
-- Worth stating why this was not visible before. The delete path got a two-tap confirm for a
-- SMALLER loss (one pet the owner is deliberately removing), while this path could destroy a
-- row the owner had never seen, silently, as a side effect of editing something else. The
-- asymmetry is what made it a finding rather than an accepted cost.
--
-- THE FIX: an optimistic-concurrency token. `pets.updated_at` is stamped by every write that
-- goes through update_pet_with_instructions, the caller echoes back the value it rendered, and
-- a mismatch refuses the whole call instead of applying it.
--
-- WHY `pets.updated_at` IS A FAITHFUL TOKEN FOR THE INSTRUCTION SET TOO, which is not obvious:
-- the RPC always updates the `pets` row, on every call, including a call that changes only
-- instructions. So any edit made through the intended writer bumps the token, and a second
-- editor's stale view is caught even when the two touched entirely different instruction rows.
-- What it does NOT catch is a direct PostgREST write to `care_instructions`, which bypasses this
-- function — the same "intended writer, not enforced writer" posture
-- docs/reference/contract-surfaces.md already records for release_slot and for this function's
-- own table grants. Stated here so it is a decision rather than an oversight.
--
-- PT412, NOT PT409. This function already raises PT409 for the is_sensitive freeze, and the
-- route turns that into one specific Polish sentence about the frozen flag. A second condition
-- sharing the code would either be described wrongly to the owner or force the route to sniff
-- DETAIL to tell them apart. PostgREST maps the last three digits of a PTxxx SQLSTATE onto the
-- HTTP status, so PT412 is Precondition Failed — which is exactly what a stale token is.
-- The route maps it to 409 for the owner, because "conflict" is what happened from their side.
alter table public.pets
  add column updated_at timestamptz not null default pg_catalog.now();

comment on column public.pets.updated_at is
  'Optimistic-concurrency token for the pet AND its care-instruction set, stamped by update_pet_with_instructions on every call (including one that changes only instructions, because the function always writes the parent row). PUT /api/pets/[id] echoes the value the page rendered and the function raises PT412 when it no longer matches, so a second editor''s save cannot silently delete a row the first one added. Not a general "last modified": a direct PostgREST write to pets or care_instructions bypasses the function and leaves this column untouched — the same intended-writer posture recorded for the table grants.';

-- DROP + CREATE, not `create or replace`: the argument list changes, and an added parameter
-- would create a SECOND function (an overload) that inherits Supabase's default execute grants
-- to anon / authenticated / service_role while the old 6-argument signature stayed reachable
-- with its existing grant. `create or replace` preserves grants only when the argument list is
-- unchanged. Dropping first is the only shape that leaves exactly one function with exactly one
-- known grant posture — the reasoning 20260906165005:124-131 spells out, and the reason the
-- revoke/grant pair is repeated at the bottom of this file.
drop function public.update_pet_with_instructions(uuid, text, public.pet_species, text, text, jsonb);

create function public.update_pet_with_instructions(
  p_pet_id uuid,
  p_name text,
  p_species public.pet_species,
  p_breed text,
  p_age text,
  p_instructions jsonb,
  p_expected_updated_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pet_id uuid;
  v_stored_updated_at timestamptz;
  v_frozen boolean;
  v_conflicts jsonb;
begin
  -- The gate, and now also the lock. `for update` is what makes the version check meaningful:
  -- without it two concurrent saves can both read the same token, both find it current, and
  -- both apply — which is the very interleaving this column exists to refuse. It is the same
  -- correction impl-review F1 made to delete_pet (20260914120000), and the same reason.
  --
  -- RLS decides whether this caller may see the row at all: a miss (not theirs, or no such pet)
  -- leaves v_stored_updated_at NULL and the function answers NULL, which the route turns into a
  -- 404. That ordering is deliberate — a stranger must get 404 here, never a version error,
  -- which would confirm the pet exists.
  select p.updated_at
  into v_stored_updated_at
  from public.pets p
  where p.id = p_pet_id
  for update;

  if v_stored_updated_at is null then
    return null;
  end if;

  -- The version check, BEFORE the freeze and before any write. A stale caller's payload
  -- describes a world that no longer exists, so nothing in it can be trusted — including its
  -- is_sensitive flags, which is why this cannot be ordered after the freeze.
  --
  -- `is distinct from` rather than `<>`: a caller that omits the token sends NULL, and NULL <>
  -- anything is NULL, which is not true, which would silently SKIP the check. The route makes
  -- the field required, but a guard that fails open when its input is absent is not a guard.
  if p_expected_updated_at is distinct from v_stored_updated_at then
    raise exception 'update_pet_with_instructions: the pet changed since this form was loaded'
      using errcode = 'PT412';
  end if;

  update public.pets
  set name = p_name,
      species = p_species,
      breed = p_breed,
      age = p_age,
      -- Stamped on every call, which is what makes the token cover the instruction set as well
      -- as the parent row.
      updated_at = pg_catalog.now()
  where id = p_pet_id
  returning id into v_pet_id;

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
    -- Compared against the STORED row, never against the incoming value. A check written on the
    -- payload alone is a no-op that reads like a guard: the caller controls both sides of it.
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
      -- PT409, unchanged. Note the deliberate split from the PT412 above: two different refusals
      -- with two different remedies must not share a status the route has to disambiguate.
      raise exception 'update_pet_with_instructions: is_sensitive is frozen on % instruction row(s) while a claimed live trip covers this pet',
        pg_catalog.jsonb_array_length(v_conflicts)
        using errcode = 'PT409',
              detail = v_conflicts::text;
    end if;
  end if;

  -- Rows the payload does not name are deletions. That is what makes the route's verb PUT
  -- honest — and, until the token above, what made a stale save destructive.
  delete from public.care_instructions ci
  where ci.pet_id = p_pet_id
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(coalesce(p_instructions, '[]'::jsonb)) as elem
      where elem ->> 'id' is not null
        and (elem ->> 'id')::uuid = ci.id
    );

  -- `ci.pet_id = p_pet_id` is REDUNDANT with RLS and kept deliberately, the same way release_slot
  -- keeps its period_id predicate (20260909090000:43-47): instruction ids are owner-supplied
  -- input, and this makes the route's URL and the guard agree, so a row belonging to ANOTHER OF
  -- THIS OWNER'S OWN pets cannot be adopted through the wrong pet's endpoint. RLS does not cover
  -- that case at all.
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
  -- owner sees in the form is the order stored.
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

comment on function public.update_pet_with_instructions(uuid, text, public.pet_species, text, text, jsonb, timestamptz) is
  'Replaces a pet''s scalar fields and synchronises its care-instruction set in one transaction: rows carrying an id are updated, rows without one are inserted, and stored rows the payload does not name are deleted. sort_order is taken from array position. Locks the pet row and refuses with PT412 when p_expected_updated_at no longer matches pets.updated_at — so a second editor working from a stale form cannot silently delete a row the first one added. Stamps pets.updated_at on every call, which is what makes that token cover the instruction set too. Raises PT409 with a JSON array of instruction ids in DETAIL when the payload would flip is_sensitive on an existing row while an unrevoked period covering this pet has a claimed slot. Security invoker: pets_update_own and care_instructions_update_own are the authorization boundary. Returns the pet id, or NULL when the pet does not exist or RLS filtered it out. Called by PUT /api/pets/[id].';

-- Grants, repeated because DROP took the old ones with it. `revoke ... from public` alone is NOT
-- enough on Supabase: ALTER DEFAULT PRIVILEGES grants EXECUTE to anon, authenticated and
-- service_role on every new function in `public`, separately from the PUBLIC pseudo-role, so the
-- roles have to be NAMED (20260909090000:88-97). tests/rls/update-pet.test.ts asserts the 42501
-- back AND that the message names the function, rather than trusting this sentence.
revoke execute on function public.update_pet_with_instructions(uuid, text, public.pet_species, text, text, jsonb, timestamptz)
  from public, anon, service_role;

grant execute on function public.update_pet_with_instructions(uuid, text, public.pet_species, text, text, jsonb, timestamptz) to authenticated;
