-- S-02: Care periods & generated slots.
-- Owner-isolation RLS following the F-01 pattern (see docs/reference/data-access.md).
-- care_slots is a child of care_periods and anchors ownership transitively through
-- care_periods.owner_id, exactly as care_instructions does through pets.owner_id.

-- Fixed set of three, decided for v1 (roadmap S-02, settled 2026-09-06). Not configurable:
-- an enum keeps slot identity stable, which is what lets S-03 claim a slot by
-- (period, date, time_of_day) without a lookup table.
create type public.time_of_day as enum ('morning', 'afternoon', 'evening');

-- 1. Care periods: owner-scoped. owner_id FKs auth.users so RLS keys on auth.uid().
--
-- start_date/end_date are `date`, not timestamptz, on purpose: a slot is "the morning of
-- 13 July" in the owner's calendar sense, not an instant. Storing an instant would drag
-- timezone conversion into every read and make slot identity ambiguous across DST.
--
-- token_digest is NOT NULL from this first migration so there is never a window in which a
-- period exists without one. Its value is a SHA-256 hex digest; the raw invite token is
-- never stored (S-02 Phase 2 owns minting and resolution).
create table public.care_periods (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  start_date date not null,
  end_date date not null,
  token_digest text not null,
  created_at timestamptz not null default now(),
  constraint care_periods_dates_ordered check (end_date >= start_date),
  -- 31 days inclusive => at most 93 generated slots in one transaction. The bound is what
  -- stops a mistyped year from generating five figures of rows; the zod schema mirrors it
  -- so a violation surfaces as a clean 400 rather than a constraint error.
  constraint care_periods_max_span check (end_date - start_date <= 30)
);

comment on table public.care_periods is
  'Owner-scoped care period. owner_id = auth.users.id; every owner access is RLS-gated on it. Caretaker access goes through the token model instead (see docs/reference/data-access.md).';

-- 2. Care slots: one row per (period, date, time-of-day).
--
-- Materialised rather than computed on read so S-03 can claim atomically:
-- `update ... where id = $1 and claimed_by_name is null` is a single row-locked statement,
-- and the loser of a race updates 0 rows. The unique constraint is what makes generation
-- idempotent and double-booking impossible at the storage layer.
create table public.care_slots (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.care_periods (id) on delete cascade,
  slot_date date not null,
  time_of_day public.time_of_day not null,
  -- Filled by S-03 when a caretaker takes the slot. Null = free.
  claimed_by_name text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint care_slots_unique_in_period unique (period_id, slot_date, time_of_day)
);

comment on table public.care_slots is
  'One slot per day per time-of-day within a care period. Ownership is transitive via care_periods.owner_id. claimed_by_name null = free.';

-- Postgres does not index foreign keys automatically; both the period read and the
-- ON DELETE CASCADE need this.
create index care_slots_period_id_idx on public.care_slots (period_id);

-- 3. Deny-by-default RLS on both tables (fail-closed: RLS on + no policy = all denied).
alter table public.care_periods enable row level security;
alter table public.care_slots enable row level security;

-- Grants make the tables reachable for authenticated; RLS policies below decide access.
-- Note there is deliberately NO grant to anon: the caretaker never touches these tables
-- directly, only the token function added in the next migration.
grant select, insert, update, delete on table public.care_periods to authenticated;
grant select, insert, update, delete on table public.care_slots to authenticated;

-- care_periods: owner-isolation on owner_id. All four surfaces — the deny-by-default gate
-- lives on INSERT/DELETE too, not just SELECT. UPDATE needs with check so owner_id can't
-- be reassigned to someone else.
create policy "care_periods_select_own"
  on public.care_periods
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "care_periods_insert_own"
  on public.care_periods
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "care_periods_update_own"
  on public.care_periods
  for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "care_periods_delete_own"
  on public.care_periods
  for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

-- care_slots: ownership is transitive through the parent period. INSERT/UPDATE use with
-- check on the same predicate so a slot can't be attached to someone else's period.
create policy "care_slots_select_own"
  on public.care_slots
  for select
  to authenticated
  using (exists (
    select 1 from public.care_periods p
    where p.id = care_slots.period_id and (select auth.uid()) = p.owner_id
  ));

create policy "care_slots_insert_own"
  on public.care_slots
  for insert
  to authenticated
  with check (exists (
    select 1 from public.care_periods p
    where p.id = care_slots.period_id and (select auth.uid()) = p.owner_id
  ));

create policy "care_slots_update_own"
  on public.care_slots
  for update
  to authenticated
  using (exists (
    select 1 from public.care_periods p
    where p.id = care_slots.period_id and (select auth.uid()) = p.owner_id
  ))
  with check (exists (
    select 1 from public.care_periods p
    where p.id = care_slots.period_id and (select auth.uid()) = p.owner_id
  ));

create policy "care_slots_delete_own"
  on public.care_slots
  for delete
  to authenticated
  using (exists (
    select 1 from public.care_periods p
    where p.id = care_slots.period_id and (select auth.uid()) = p.owner_id
  ));

-- 4. Atomic create: period + every generated slot in one transaction. SECURITY INVOKER so
-- the caller's RLS still applies (no bypass) — the insert fails if owner_id != auth.uid().
-- There is no edit path, so a period saved without its slots would be unusable and
-- unrecoverable; one transaction avoids that (same reasoning as create_pet_with_instructions).
-- search_path emptied + objects fully qualified (hardening checklist).
create function public.create_period_with_slots(
  p_title text,
  p_start_date date,
  p_end_date date,
  p_token_digest text
)
returns public.care_periods
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_period public.care_periods;
begin
  insert into public.care_periods (owner_id, title, start_date, end_date, token_digest)
  values ((select auth.uid()), p_title, p_start_date, p_end_date, p_token_digest)
  returning * into new_period;

  -- Cartesian product of every day in the range and every time of day. enum_range keeps
  -- this in step with the enum: adding a fourth time of day would need no change here.
  insert into public.care_slots (period_id, slot_date, time_of_day)
  select
    new_period.id,
    day::date,
    tod
  from generate_series(new_period.start_date, new_period.end_date, interval '1 day') as day
  cross join unnest(enum_range(null::public.time_of_day)) as tod;

  return new_period;
end;
$$;

-- The function must not be a callable public API endpoint.
--
-- `revoke ... from public` alone is NOT enough on Supabase: ALTER DEFAULT PRIVILEGES grants
-- EXECUTE to anon, authenticated and service_role on every new function in `public`,
-- separately from the PUBLIC pseudo-role. Revoking only PUBLIC leaves those three in place —
-- verified with has_function_privilege('anon', ...) returning true. The roles must be named.
--
-- S-01's hardening migration (20260831203038) has the same gap and is corrected below; its
-- impl-review finding F3 described this posture without achieving it.
revoke execute on function public.create_period_with_slots(text, date, date, text)
  from public, anon, service_role;

grant execute on function public.create_period_with_slots(text, date, date, text) to authenticated;

-- Same correction for the S-01 RPC, so both functions share one posture rather than two.
-- Behaviour is unchanged: the function is SECURITY INVOKER, so anon was already stopped by
-- RLS one step later — this closes the door instead of relying on the lock behind it.
revoke execute on function public.create_pet_with_instructions(text, public.pet_species, text, text, jsonb)
  from public, anon, service_role;

grant execute on function public.create_pet_with_instructions(text, public.pet_species, text, text, jsonb) to authenticated;

-- Third instance of the same gap, in F-01's trigger function. It is SECURITY DEFINER and
-- anon still held execute, despite that migration's `revoke ... from public`. Not
-- exploitable — Postgres refuses to call a function returning `trigger` directly, so the
-- body never runs — but it is the worst posture of the three and the one a reader is most
-- likely to copy. A trigger fires as the table owner regardless of grants, so nothing needs
-- execute on it at all.
revoke execute on function public.handle_new_user() from public, anon, authenticated, service_role;
