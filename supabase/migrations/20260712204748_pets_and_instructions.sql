-- S-01: Pets & care instructions.
-- First domain tables. Owner-isolation RLS following the F-01 pattern
-- (see docs/reference/data-access.md). care_instructions is a child of pets and
-- anchors ownership transitively through pets.owner_id (no owner_id of its own).

-- Species is a fixed set (matches the design's dog/cat/other segmented control).
create type public.pet_species as enum ('dog', 'cat', 'other');

-- 1. Pets: owner-scoped domain entity. owner_id FKs auth.users so RLS keys on auth.uid().
create table public.pets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  species public.pet_species not null,
  breed text,
  age text,
  created_at timestamptz not null default now()
);

comment on table public.pets is
  'Owner-scoped pet. owner_id = auth.users.id; every access is RLS-gated on it.';

-- 2. Care instructions: child of pets. Split public/sensitive (is_sensitive) so S-03
-- can reveal sensitive rows only after a caretaker claims a slot. body is free text
-- (the structured feeding schedule is parked to v2, PRD Open Questions #1).
create table public.care_instructions (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets (id) on delete cascade,
  title text not null,
  body text,
  is_sensitive boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.care_instructions is
  'Care instruction item belonging to a pet. Ownership is transitive via pets.owner_id.';

create index care_instructions_pet_id_idx on public.care_instructions (pet_id);

-- 3. Deny-by-default RLS on both tables (fail-closed: RLS on + no policy = all denied).
alter table public.pets enable row level security;
alter table public.care_instructions enable row level security;

-- Grants make the tables reachable for authenticated; RLS policies below decide access.
grant select, insert, update, delete on table public.pets to authenticated;
grant select, insert, update, delete on table public.care_instructions to authenticated;

-- pets: owner-isolation on owner_id. All four surfaces (deny-by-default gate lives on
-- INSERT/DELETE, not just SELECT). UPDATE needs with check so owner_id can't be reassigned.
create policy "pets_select_own"
  on public.pets
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "pets_insert_own"
  on public.pets
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "pets_update_own"
  on public.pets
  for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "pets_delete_own"
  on public.pets
  for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

-- care_instructions: ownership is transitive through the parent pet. INSERT/UPDATE use
-- with check on the same predicate so a row can't be attached to someone else's pet.
create policy "care_instructions_select_own"
  on public.care_instructions
  for select
  to authenticated
  using (exists (
    select 1 from public.pets p
    where p.id = care_instructions.pet_id and (select auth.uid()) = p.owner_id
  ));

create policy "care_instructions_insert_own"
  on public.care_instructions
  for insert
  to authenticated
  with check (exists (
    select 1 from public.pets p
    where p.id = care_instructions.pet_id and (select auth.uid()) = p.owner_id
  ));

create policy "care_instructions_update_own"
  on public.care_instructions
  for update
  to authenticated
  using (exists (
    select 1 from public.pets p
    where p.id = care_instructions.pet_id and (select auth.uid()) = p.owner_id
  ))
  with check (exists (
    select 1 from public.pets p
    where p.id = care_instructions.pet_id and (select auth.uid()) = p.owner_id
  ));

create policy "care_instructions_delete_own"
  on public.care_instructions
  for delete
  to authenticated
  using (exists (
    select 1 from public.pets p
    where p.id = care_instructions.pet_id and (select auth.uid()) = p.owner_id
  ));

-- 4. Atomic create: pet + its instructions in one transaction. SECURITY INVOKER so the
-- caller's RLS still applies (no bypass) — the insert fails if owner_id != auth.uid().
-- S-01 has no edit path, so a pet saved without its instructions would be unrecoverable;
-- one transaction avoids that. search_path emptied + objects fully qualified (hardening).
create function public.create_pet_with_instructions(
  p_name text,
  p_species public.pet_species,
  p_breed text,
  p_age text,
  p_instructions jsonb
)
returns public.pets
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_pet public.pets;
begin
  insert into public.pets (owner_id, name, species, breed, age)
  values ((select auth.uid()), p_name, p_species, p_breed, p_age)
  returning * into new_pet;

  insert into public.care_instructions (pet_id, title, body, is_sensitive, sort_order)
  select
    new_pet.id,
    i ->> 'title',
    i ->> 'body',
    coalesce((i ->> 'is_sensitive')::boolean, false),
    coalesce((i ->> 'sort_order')::int, 0)
  from jsonb_array_elements(coalesce(p_instructions, '[]'::jsonb)) as i;

  return new_pet;
end;
$$;
