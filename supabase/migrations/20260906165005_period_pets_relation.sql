-- S-08: a care period covers the owner's chosen pets.
--
-- Until now nothing linked a period to a pet, so care_instructions — which hangs off pets —
-- was unreachable from a period and FR-008 (the caretaker sees public instructions on
-- arrival, sensitive ones after claiming) was not implementable at all. This migration adds
-- the missing edge.
--
-- A join table rather than a pet_id column, for two reasons: PRD FR-002's recorded
-- resolution says "jeden okres może obejmować kilka zwierząt o różnych instrukcjach", and
-- the design's "Nowy wyjazd" screen has the owner picking a SUBSET of their pets per trip.
-- A join table also means existing periods stay valid (absence = no rows) instead of needing
-- a backfill for a not-null column.

-- 1. The join table.
--
-- Composite primary key: a pet is on a trip or it isn't, so (period_id, pet_id) is the
-- natural identity and it makes linking idempotent for free.
create table public.care_period_pets (
  period_id uuid not null references public.care_periods (id) on delete cascade,
  pet_id uuid not null references public.pets (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (period_id, pet_id)
);

comment on table public.care_period_pets is
  'Which pets a care period covers. Many-to-many (PRD FR-002). Ownership is transitive and must hold on BOTH sides: the caller must own the period AND the pet.';

-- The PK's leading column serves period-leading lookups ("which pets are on this trip").
-- The reverse direction ("which trips is this pet on") and the ON DELETE CASCADE from pets
-- need their own index — Postgres does not index foreign keys automatically.
create index care_period_pets_pet_id_idx on public.care_period_pets (pet_id);

-- 2. Deny-by-default RLS.
alter table public.care_period_pets enable row level security;

grant select, insert, update, delete on table public.care_period_pets to authenticated;

-- New tables in `public` inherit anon's grants from Supabase's ALTER DEFAULT PRIVILEGES, so
-- this revoke is not redundant — it is the sixth instance of a gap this project has now
-- closed on every other table. Verified from information_schema after applying, not assumed
-- from this comment (context/foundation/lessons.md).
revoke all on table public.care_period_pets from anon;

-- The predicate is a CONJUNCTION over both parents, and that is the security boundary of
-- this whole change. Checking only the period would let owner A attach their own trip to
-- owner B's pet; B's instructions would then leak through A's invite link the moment S-03
-- ships the reveal. Checking only the pet would let A attach their pet to B's trip. Neither
-- half is sufficient, and neither failure is visible until S-03 — which is why
-- tests/rls/care-period-pets.isolation.test.ts asserts both directions.
--
-- Written inline in all four policies rather than extracted into a helper function, matching
-- how care_slots repeats its transitive predicate in the S-02 migration.
create policy "care_period_pets_select_own"
  on public.care_period_pets
  for select
  to authenticated
  using (
    exists (
      select 1 from public.care_periods p
      where p.id = care_period_pets.period_id and (select auth.uid()) = p.owner_id
    )
    and exists (
      select 1 from public.pets t
      where t.id = care_period_pets.pet_id and (select auth.uid()) = t.owner_id
    )
  );

create policy "care_period_pets_insert_own"
  on public.care_period_pets
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.care_periods p
      where p.id = care_period_pets.period_id and (select auth.uid()) = p.owner_id
    )
    and exists (
      select 1 from public.pets t
      where t.id = care_period_pets.pet_id and (select auth.uid()) = t.owner_id
    )
  );

create policy "care_period_pets_update_own"
  on public.care_period_pets
  for update
  to authenticated
  using (
    exists (
      select 1 from public.care_periods p
      where p.id = care_period_pets.period_id and (select auth.uid()) = p.owner_id
    )
    and exists (
      select 1 from public.pets t
      where t.id = care_period_pets.pet_id and (select auth.uid()) = t.owner_id
    )
  )
  with check (
    exists (
      select 1 from public.care_periods p
      where p.id = care_period_pets.period_id and (select auth.uid()) = p.owner_id
    )
    and exists (
      select 1 from public.pets t
      where t.id = care_period_pets.pet_id and (select auth.uid()) = t.owner_id
    )
  );

create policy "care_period_pets_delete_own"
  on public.care_period_pets
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.care_periods p
      where p.id = care_period_pets.period_id and (select auth.uid()) = p.owner_id
    )
    and exists (
      select 1 from public.pets t
      where t.id = care_period_pets.pet_id and (select auth.uid()) = t.owner_id
    )
  );

-- 3. The generation RPC gains the pet list.
--
-- DROP + CREATE, not an added parameter with a default. An added parameter creates a SECOND
-- function (an overload) which inherits Supabase's default execute grants to anon /
-- authenticated / service_role, and leaves the old 4-argument signature reachable with its
-- existing grant — so `create or replace` would not have helped either: it preserves grants
-- only when the argument list is unchanged (see 20260906105815's header). Dropping first is
-- the only shape that leaves exactly one function with exactly one known grant posture.
drop function public.create_period_with_slots(text, date, date, text);

create function public.create_period_with_slots(
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
begin
  -- "At least one pet" is enforced here and ONLY here — see the plan's Critical
  -- Implementation Details. A petless period stays representable through a raw insert, a
  -- pre-relation row, or deleting the last linked pet; nothing is corrupt in that state,
  -- and the alternatives (a deferred constraint trigger, or ON DELETE RESTRICT on pets)
  -- cost more than a useless-but-valid period does. The zod schema mirrors this bound so
  -- the API answers 400 rather than surfacing this raise as a 500.
  if p_pet_ids is null or pg_catalog.array_length(p_pet_ids, 1) is null then
    raise exception 'create_period_with_slots: p_pet_ids must name at least one pet';
  end if;

  insert into public.care_periods (owner_id, title, start_date, end_date, token_digest)
  values ((select auth.uid()), p_title, p_start_date, p_end_date, p_token_digest)
  returning * into new_period;

  -- SECURITY INVOKER means the caller's RLS decides here: a pet_id the caller does not own
  -- fails the insert policy's with-check and rolls the entire transaction back, period
  -- included. That is what makes pet ownership a database guarantee rather than a handler
  -- check. DISTINCT because a duplicated id in the array is a client slip, not a request to
  -- link a pet twice — the set is the meaning.
  insert into public.care_period_pets (period_id, pet_id)
  select distinct new_period.id, pid
  from pg_catalog.unnest(p_pet_ids) as pid;

  -- Slot generation is unchanged: one slot per day per time-of-day for the PERIOD, not per
  -- pet. A caretaker taking Monday morning takes the whole trip that morning, which matches
  -- care_slots' unique (period_id, slot_date, time_of_day) and the design's single slot card
  -- with one merged instruction list.
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

-- 4. Re-establish the grant posture on the NEW signature.
--
-- Grants are keyed to the full argument type list, and the dropped function took its grants
-- with it. `revoke ... from public` alone does not reach anon / authenticated /
-- service_role on Supabase — those come from ALTER DEFAULT PRIVILEGES and must be named.
-- Phase 1's manual verification reads this back from has_function_privilege rather than
-- trusting these two lines.
revoke execute on function public.create_period_with_slots(text, date, date, text, uuid[])
  from public, anon, service_role;

grant execute on function public.create_period_with_slots(text, date, date, text, uuid[]) to authenticated;
