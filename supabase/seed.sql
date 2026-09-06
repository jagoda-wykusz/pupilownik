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
  raw_app_meta_data, raw_user_meta_data,
  -- GoTrue scans these token columns into non-nullable Go strings; a hand-seeded
  -- row must set them to '' (not NULL) or sign-in fails with
  -- "Database error querying schema". signUp-created users get these defaults for free.
  confirmation_token, recovery_token,
  email_change, email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '33333333-3333-3333-3333-333333333333',
  'authenticated', 'authenticated',
  'owner@pupilownik.test',
  crypt('password123', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  '', '', '', '', '', '', '', ''
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

-- S-08: one care period for the test owner, linked to Burek, with its generated slots.
-- Raw inserts rather than create_period_with_slots: that RPC is SECURITY INVOKER, and this
-- file runs as `postgres`, so auth.uid() would be NULL and owner_id would not be set.
-- Fixed UUIDs keep reset idempotent. token_digest is a fixed dummy hex — the raw invite
-- token is never stored and is not recoverable, so a seeded period has no working link;
-- regenerate one from the UI if you need to open /invite for the seeded trip.
insert into public.care_periods (id, owner_id, title, start_date, end_date, token_digest)
values (
  '66666666-6666-6666-6666-666666666666',
  '33333333-3333-3333-3333-333333333333',
  'Weekend u rodziców', '2026-07-13', '2026-07-15',
  'seedseedseedseedseedseedseedseedseedseedseedseedseedseedseedseed'
)
on conflict (id) do nothing;

insert into public.care_period_pets (period_id, pet_id)
values (
  '66666666-6666-6666-6666-666666666666',
  '44444444-4444-4444-4444-444444444444'
)
on conflict (period_id, pet_id) do nothing;

-- 3 days x 3 times of day = 9 slots, all free.
insert into public.care_slots (period_id, slot_date, time_of_day)
select
  '66666666-6666-6666-6666-666666666666',
  day::date,
  tod
from generate_series(date '2026-07-13', date '2026-07-15', interval '1 day') as day
cross join unnest(enum_range(null::public.time_of_day)) as tod
on conflict (period_id, slot_date, time_of_day) do nothing;
