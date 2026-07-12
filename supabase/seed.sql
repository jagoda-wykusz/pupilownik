-- Seed convention (F-01): keep this minimal. Domain seed rows (pets, care periods,
-- slots) are added by their owning slices, NOT here. This file seeds only one known
-- test owner so `supabase db reset` is deterministic and the owner-isolation RLS
-- check has a stable identity to log in as.
--
-- Test owner credentials (LOCAL ONLY): owner@pupilownik.test / password123
-- The on_auth_user_created trigger auto-creates the matching public.profiles row.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values (
  '00000000-0000-0000-0000-000000000000',
  '33333333-3333-3333-3333-333333333333',
  'authenticated', 'authenticated',
  'owner@pupilownik.test',
  crypt('password123', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{}'
)
on conflict (id) do nothing;

insert into auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
values (
  '33333333-3333-3333-3333-333333333333',
  '33333333-3333-3333-3333-333333333333',
  '{"sub":"33333333-3333-3333-3333-333333333333","email":"owner@pupilownik.test"}',
  'email',
  now(), now(), now()
)
on conflict (provider_id, provider) do nothing;

-- S-01: one pet + two instructions (one public, one sensitive) for the test owner, so
-- `db:reset` gives a stable pet to log in and see, and the manual two-owner RLS check
-- has cross-tenant data. Fixed UUIDs keep reset idempotent.
insert into public.pets (id, owner_id, name, species, breed, age)
values (
  '44444444-4444-4444-4444-444444444444',
  '33333333-3333-3333-3333-333333333333',
  'Burek', 'dog', 'labrador', '4 lata'
)
on conflict (id) do nothing;

insert into public.care_instructions (id, pet_id, title, body, is_sensitive, sort_order)
values
  (
    '55555555-5555-5555-5555-555555555551',
    '44444444-4444-4444-4444-444444444444',
    'Karmienie', '1 miarka suchej karmy i świeża woda — rano i wieczorem.', false, 0
  ),
  (
    '55555555-5555-5555-5555-555555555552',
    '44444444-4444-4444-4444-444444444444',
    'Klucze i kontakt', 'Klucze u sąsiadki, mieszkanie 4. Telefon: 600 100 200.', true, 1
  )
on conflict (id) do nothing;
