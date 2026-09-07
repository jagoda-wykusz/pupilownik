-- S-03 Phase 1: the two columns the claim needs, and the trip note the design draws.
--
-- Nothing caretaker-visible ships here. This migration only makes the storage able to
-- express two facts it cannot express today:
--
--   1. WHICH caretaker holds a slot, not merely that someone does. The reveal decided in
--      research §Decisions D1 is conditioned on the claimer, and `claimed_by_name` cannot
--      answer "did YOU claim it?" — it is unbounded text with no uniqueness, no FK and no
--      browser binding, and two caretakers typing "Ania" are indistinguishable rows. The
--      answer is a per-claim capability secret: minted by the app exactly as the invite
--      token is, digest-only in the database, raw value carried by the browser.
--   2. A period-level note for the caretaker (the design's NOTATKA on "Nowy wyjazd"), whose
--      content overlaps the sensitive instruction tier ("Klucze u sąsiadki, mieszkanie 4…")
--      and therefore rides the same reveal rule Phase 3 writes.

-- 1. The trip note.
--
-- Nullable: a trip without a note is the normal case, and every existing period predates
-- the column.
--
-- A length CHECK here, unlike `title` which has none. That asymmetry is deliberate and
-- worth stating: title's bound lives only in zod (src/lib/schemas/period.ts), which is
-- pre-existing debt this migration does NOT replicate. The note gets its constraint now
-- for the same reason care_slots_claim_complete got one in 20260906094254 — the column is
-- brand new, so no data has to be coerced, and a constraint in the database outranks a
-- requirement in a document. Both values reach `anon` through get_period_by_token's
-- payload, so neither is "internal".
alter table public.care_periods
  add column caretaker_note text,
  add constraint care_periods_note_length check (caretaker_note is null or pg_catalog.length(caretaker_note) <= 2000);

comment on column public.care_periods.caretaker_note is
  'Free-text note for the caretaker, scoped to the TRIP rather than to a pet (the design''s NOTATKA). Sensitive tier: revealed only through get_claimed_details to a holder of a matching claim secret, never by get_period_by_token. The 2000-char bound is mirrored by MAX_NOTE_LENGTH in src/lib/period-format.ts so a violation is a 400, not a constraint error.';

-- 2. The claim capability digest.
--
-- Hex SHA-256 of the caretaker's capability secret, byte-identical to what
-- digestInviteToken produces in src/lib/invite-token.ts — the same app/database agreement
-- the invite token already relies on. The raw secret is never stored, exactly as the raw
-- invite token is never stored (docs/reference/data-access.md rule 1, applied twice).
--
-- The format CHECK is defence in depth: Phase 2's claim function is the only writer, and
-- this pins what it is allowed to write. A 64-char lowercase hex string is the only shape
-- a SHA-256 hex digest takes, so anything else is a bug rather than a variant.
alter table public.care_slots
  add column claim_digest text,
  add constraint care_slots_claim_digest_format
    check (claim_digest is null or claim_digest ~ '^[0-9a-f]{64}$');

comment on column public.care_slots.claim_digest is
  'Hex SHA-256 of the claiming caretaker''s capability secret. Identifies WHICH caretaker holds this slot, which claimed_by_name cannot (unbounded, non-unique, unverified). "My slots" is a filter on this column; a follow-up claim reuses the same digest so one caretaker accumulates slots without re-entering a name.';

-- 3. Widen the claim invariant from a pair to a triple.
--
-- 20260906094254 tied claimed_by_name and claimed_at together because they describe ONE
-- fact — "this slot is taken, by this person, at this time" — and a half-written row made
-- the free-slot predicate lie. claim_digest is part of that same single fact: a slot
-- claimed by nobody-identifiable is exactly as incoherent as one claimed at no time.
--
-- Concretely, the exposure this closes is Phase 3's reveal. The sensitive tier is served to
-- whoever presents a secret whose digest matches a claimed slot. A row with
-- (claimed_by_name set, claim_digest null) would be a slot that is taken but attributable
-- to no capability — harmless for the read function, but it makes `claim_digest is null` an
-- untruthful test of "unclaimed", which is precisely the class of bug the pair constraint
-- was added to prevent one migration earlier.
--
-- A constraint cannot be altered in place, so this is a drop and a re-add rather than an
-- amendment.
--
-- This also makes the migration fail LOUDLY rather than coerce, if it is ever applied to a
-- database holding claimed slots: such a row has both name and timestamp set and no digest,
-- so it violates the new check and the migration aborts. There are no claimed slots today
-- (nothing can write one until Phase 2), which is why the constraint can be tightened now
-- at zero cost — the same window 20260906094254 used.
alter table public.care_slots drop constraint care_slots_claim_complete;

alter table public.care_slots
  add constraint care_slots_claim_complete
  check (
    (claimed_by_name is null) = (claimed_at is null)
    and (claimed_by_name is null) = (claim_digest is null)
  );

comment on constraint care_slots_claim_complete on public.care_slots is
  'A slot is either free (all three claim columns null) or taken (all three set). Makes both "is this slot free?" and "is this slot mine?" provably truthful at the storage layer.';

-- Serves the "my slots" lookup Phase 3's get_claimed_details performs: given a period and a
-- capability digest, which slots does this caretaker hold. Period-leading because the digest
-- is only ever resolved within an already-derived period — a digest is never a global key.
create index care_slots_period_claim_digest_idx on public.care_slots (period_id, claim_digest);

-- 4. The create RPC gains the note.
--
-- DROP + CREATE, not `create or replace` and not an added parameter on the live function.
-- The reasoning is 20260906165005 §3's, unchanged: an added parameter creates a SECOND
-- function (an overload) which inherits Supabase's ALTER DEFAULT PRIVILEGES execute grants
-- to anon / authenticated / service_role and leaves the old signature reachable with its
-- own grant, while `create or replace` preserves grants only when the argument list is
-- unchanged. Dropping first leaves exactly one function with exactly one known grant
-- posture.
--
-- The new parameter is trailing and DEFAULT NULL, which is what keeps every existing caller
-- valid: src/pages/api/periods.ts and the four RPC-seeding test suites all call with five
-- named arguments, and PostgREST resolves those against the single remaining function with
-- the note defaulting to null. No call site needs editing for this change.
--
-- Body is 20260906174022's verbatim except for the note on the period insert. Reproduced in
-- full rather than patched because DROP + CREATE cannot inherit a body.
drop function public.create_period_with_slots(text, date, date, text, uuid[]);

create function public.create_period_with_slots(
  p_title text,
  p_start_date date,
  p_end_date date,
  p_token_digest text,
  p_pet_ids uuid[],
  p_caretaker_note text default null
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
  -- Strip NULLs first, then judge emptiness on what is left. '{NULL}' has length 1 and
  -- would otherwise slip past the guard (20260906174022).
  select pg_catalog.array_agg(pid)
  into v_pet_ids
  from pg_catalog.unnest(p_pet_ids) as pid
  where pid is not null;

  -- "At least one pet" is enforced here and ONLY here. A petless period stays representable
  -- through a raw insert, a pre-relation row, or deleting the last linked pet; the zod schema
  -- mirrors this bound so the API answers 400 rather than surfacing this raise as a 500.
  if v_pet_ids is null or pg_catalog.array_length(v_pet_ids, 1) is null then
    raise exception 'create_period_with_slots: p_pet_ids must name at least one pet';
  end if;

  insert into public.care_periods (owner_id, title, start_date, end_date, token_digest, caretaker_note)
  values ((select auth.uid()), p_title, p_start_date, p_end_date, p_token_digest, p_caretaker_note)
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

-- 5. Re-establish the grant posture on the NEW signature.
--
-- Grants are keyed to the full argument type list, and the dropped function took its grants
-- with it. `revoke ... from public` alone does not reach anon / authenticated /
-- service_role on Supabase — those come from ALTER DEFAULT PRIVILEGES and must be named.
-- Phase 1's manual verification reads this back from has_function_privilege rather than
-- trusting these two lines (context/foundation/lessons.md: verify a posture from the
-- catalog, not from a comment).
revoke execute on function public.create_period_with_slots(text, date, date, text, uuid[], text)
  from public, anon, service_role;

grant execute on function public.create_period_with_slots(text, date, date, text, uuid[], text) to authenticated;
