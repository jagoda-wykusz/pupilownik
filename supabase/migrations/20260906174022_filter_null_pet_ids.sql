-- S-08 impl-review F4: make the "at least one pet" raise answer every empty case.
--
-- The previous guard was `p_pet_ids is null or array_length(p_pet_ids, 1) is null`, which
-- catches NULL and '{}' but NOT '{NULL}' — an array holding one NULL has length 1 and slips
-- through. It was still safe: the join insert then failed the RLS with-check (verified in
-- psql: `exists (select 1 from pets where t.id = NULL)` is false), so the transaction rolled
-- back and no orphan period survived. But the caller got a policy violation instead of the
-- function's own message, which is the wrong answer to "you gave me no pets".
--
-- Filtering NULLs must happen BEFORE the count, not in the insert. `where pid is not null`
-- on the insert alone would make '{NULL}' insert zero rows and leave a period with no pets
-- at all — silently worse than the policy violation it replaced.
--
-- CREATE OR REPLACE with an unchanged argument list preserves the grants from
-- 20260906165005, so the revoke/grant pair still stands (same reasoning as
-- 20260906105815). Verified from has_function_privilege after applying.
create or replace function public.create_period_with_slots(
  p_title text,
  p_start_date date,
  p_end_date date,
  p_token_digest text,
  p_pet_ids uuid[]
)
returns public.care_periods
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_period public.care_periods;
  v_pet_ids uuid[];
begin
  -- Strip NULLs first, then judge emptiness on what is left.
  select pg_catalog.array_agg(pid)
  into v_pet_ids
  from pg_catalog.unnest(p_pet_ids) as pid
  where pid is not null;

  -- "At least one pet" is enforced here and ONLY here — see the plan's Critical
  -- Implementation Details. A petless period stays representable through a raw insert, a
  -- pre-relation row, or deleting the last linked pet; the zod schema mirrors this bound so
  -- the API answers 400 rather than surfacing this raise as a 500.
  if v_pet_ids is null or pg_catalog.array_length(v_pet_ids, 1) is null then
    raise exception 'create_period_with_slots: p_pet_ids must name at least one pet';
  end if;

  insert into public.care_periods (owner_id, title, start_date, end_date, token_digest)
  values ((select auth.uid()), p_title, p_start_date, p_end_date, p_token_digest)
  returning * into new_period;

  -- SECURITY INVOKER means the caller's RLS decides here: a pet_id the caller does not own
  -- fails the insert policy's with-check and rolls the entire transaction back, period
  -- included. That is what makes pet ownership a database guarantee rather than a handler
  -- check. DISTINCT because a duplicated id is a client slip, not a request to link twice.
  insert into public.care_period_pets (period_id, pet_id)
  select distinct new_period.id, pid
  from pg_catalog.unnest(v_pet_ids) as pid;

  -- Slot generation is unchanged: one slot per day per time-of-day for the PERIOD, not per
  -- pet, matching care_slots' unique (period_id, slot_date, time_of_day).
  insert into public.care_slots (period_id, slot_date, time_of_day)
  select
    new_period.id,
    day::date,
    tod
  from pg_catalog.generate_series(new_period.start_date, new_period.end_date, interval '1 day') as day
  cross join pg_catalog.unnest(pg_catalog.enum_range(null::public.time_of_day)) as tod;

  return new_period;
end;
$$;
