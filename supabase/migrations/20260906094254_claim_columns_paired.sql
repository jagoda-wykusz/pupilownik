-- S-02 impl-review F2: tie the two claim columns together.
--
-- `care_slots.claimed_by_name` and `claimed_at` describe ONE fact — "this slot is taken,
-- by this person, at this time" — but were independently nullable, so
-- (claimed_at set, claimed_by_name null) was a representable row.
--
-- Nothing disagrees today: all three readers key on claimed_by_name (get_period_by_token's
-- `is_claimed`, /periods/[id]'s per-slot label, and /periods' taken aggregate), and
-- claimed_at is written and read by nobody in this slice. The exposure is forward:
--
--   * S-03 writes both columns and S-04 renders occupancy. The first consumer that keys on
--     claimed_at — the natural choice for "when was this taken" — silently disagrees with
--     all three existing readers.
--   * Worse, the atomic claim this schema was designed for (`update ... where id = $1 and
--     claimed_by_name is null`, prescribed in the care_slots comment) would let a SECOND
--     caretaker overwrite a row that already carries a claimed_at. The unique constraint
--     cannot catch that: it is the same row.
--
-- Added now rather than in S-03's first migration because the table holds no claims yet, so
-- this costs no data migration, and because a constraint in the database outranks a
-- requirement in a document — a lesson this slice already learned once, when a migration
-- comment described an execute-grant posture the database did not actually have.
alter table public.care_slots
  add constraint care_slots_claim_complete
  check ((claimed_by_name is null) = (claimed_at is null));

comment on constraint care_slots_claim_complete on public.care_slots is
  'A slot is either free (both claim columns null) or taken (both set). Makes S-03''s claim provably all-or-nothing at the storage layer.';


-- S-02 impl-review F5: finish closing the anon table-grant gap.
--
-- The previous migration revoked anon's ALTER DEFAULT PRIVILEGES grants on care_periods and
-- care_slots, calling that gap "the third time the same gap would have bitten" — but it only
-- closed its OWN two tables. profiles, pets and care_instructions still carried anon's
-- default SELECT/INSERT/UPDATE/DELETE, so the repo held two postures for one rule.
--
-- Not exploitable: no table has a policy naming anon, so deny-by-default already returned
-- zero rows. The exposure is the next anon-facing feature that adds a permissive policy to
-- one of these tables and inherits a live grant it never granted.
--
-- Safe to revoke: nothing anon-facing reads these tables. The only app reads are
-- src/pages/pets/index.astro (gated by PROTECTED_ROUTES, so authenticated) and the profiles
-- reads behind auth. handle_new_user runs as the table owner on INSERT to auth.users, so the
-- signup trigger needs no grant at all — the suite signs up a fresh user per test and would
-- fail loudly otherwise.
revoke all on table public.profiles from anon;
revoke all on table public.pets from anon;
revoke all on table public.care_instructions from anon;
