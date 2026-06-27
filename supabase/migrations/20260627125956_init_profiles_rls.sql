-- F-01: Owner-data RLS baseline.
-- Establishes the owner-identity anchor (`profiles`, 1:1 with auth.users) and the
-- deny-by-default, owner-isolation RLS pattern every future domain table copies.
-- See docs/reference/data-access.md for the convention.

-- 1. Owner-identity table. Minimal by decision: id (= auth.users.id) + created_at.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per owner (1:1 with auth.users). FK target for all owner-scoped domain tables.';

-- 2. Deny-by-default RLS. Enabling RLS with no policy denies all access (fail-closed).
alter table public.profiles enable row level security;

-- Table-level grants so the authenticated role can reach the table at all; RLS then
-- governs *which rows*. No insert/delete grant: inserts come from the signup trigger
-- (security definer), deletes cascade from auth.users.
grant select, update on table public.profiles to authenticated;

-- Owner-isolation policies: TO authenticated + ownership predicate (BOLA/IDOR-safe).
-- (select auth.uid()) is wrapped in a subselect so the planner evaluates it once.
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- 3. Auto-create a profile row on signup. SECURITY DEFINER so the insert runs
-- regardless of which code path created the auth user; search_path is emptied and
-- every object fully qualified to prevent search_path injection.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

-- The definer function must not be a callable public API endpoint.
revoke execute on function public.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
