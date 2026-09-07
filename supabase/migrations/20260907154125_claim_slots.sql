-- S-03 Phase 2: the claim.
--
-- The write half of the caretaker path, and the first anon-reachable WRITE in this schema.
-- Everything about its shape follows from three facts:
--
--   1. `get_period_by_token` is STABLE, so Postgres forbids it from writing. The claim
--      cannot be an extension of the read door; it has to be its own VOLATILE function.
--   2. `anon` holds no grant on any table (20260906003122 §0), so this body is the ENTIRE
--      authorization boundary — there is no RLS policy behind it to catch a mistake here.
--   3. The all-or-nothing guarantee (PRD §NFR) is a property of ONE statement. A `select`
--      that checks freeness before the `update` reintroduces read-then-write: READ COMMITTED
--      holds no lock between statements, and being inside one plpgsql function does not
--      change that. The row count of a single guarded `update` IS the mechanism.

-- 1. The claim function.
--
-- VOLATILE is spelled out rather than left to the default. It is the default, but the
-- neighbouring function in this schema is STABLE and the whole point of this one is that it
-- is not — an accidental copy of that line would fail at CREATE time here, and stating it
-- keeps the contrast readable.
--
-- The period is DERIVED from the token, never accepted as a parameter. That is what makes a
-- leaked slot uuid useless: a uuid from another period is a perfectly valid uuid, and only
-- `period_id = v_period.id` in the update's WHERE stops it from being claimed.
--
-- Returns jsonb, never a plpgsql composite: a composite answers a miss with a row of NULLs
-- rather than NULL, which already bit S-02 (see regenerate_period_token's comment).
--
-- Failure signalling, and how it relates to rule 4 in docs/reference/data-access.md:
--
--   * An unresolvable token — wrong length, unknown, or revoked — returns NULL, exactly as
--     the read function does. Uniform failure survives intact for the token itself.
--   * A refusal (a slot was taken in the meantime) RAISES. This is the small, deliberate
--     widening rule 4 could not survive: a write must distinguish "won" from "refused", a
--     signal a read never emitted. It leaks nothing beyond the period the caller already
--     holds a valid token for.
--
-- The SQLSTATEs are PostgREST's `PTxxx` convention, which maps the last three digits onto
-- the HTTP status. So the refusal arrives at Phase 4's route as a 409 and a bad argument as
-- a 400, without the handler pattern-matching on message text. The conflicting slots ride in
-- DETAIL as a jsonb array of {slot_date, time_of_day}, so the Polish sentence that names the
-- term is composed in TypeScript with the app's existing formatters rather than in SQL.
create function public.claim_slots(
  p_token text,
  p_slot_ids uuid[],
  p_claim_digest text,
  p_name text default null
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_digest text;
  v_period public.care_periods;
  v_slot_ids uuid[];
  v_new_ids uuid[];
  v_requested integer;
  v_claimed integer;
  v_name text;
  v_conflicts jsonb;
begin
  -- Step 1: bound the token BEFORE hashing it, mirroring 20260906105815:30. This function is
  -- reachable with no authentication at all, so a multi-megabyte p_token would otherwise buy
  -- an anon caller a convert_to + sha256 over all of it before a guaranteed index miss. 43 =
  -- length of base64url(32 bytes) unpadded — see src/lib/invite-token.ts.
  if p_token is null or pg_catalog.length(p_token) <> 43 then
    return null;
  end if;

  -- Step 2: bound the remaining inputs before touching a table. An anon-callable write must
  -- not accept an unbounded array.
  --
  -- NULLs are stripped first and duplicates collapsed, both for the same reason: the row
  -- count of the update is compared against this array's length, so a NULL or a repeated id
  -- would inflate the expectation and refuse a claim that actually succeeded. '{NULL}' has
  -- length 1 and would otherwise slip past the emptiness guard (the trap 20260906174022 fixed
  -- in create_period_with_slots).
  select pg_catalog.array_agg(distinct sid)
  into v_slot_ids
  from pg_catalog.unnest(p_slot_ids) as sid
  where sid is not null;

  v_requested := pg_catalog.array_length(v_slot_ids, 1);

  if v_requested is null then
    raise exception 'claim_slots: p_slot_ids must name at least one slot'
      using errcode = 'PT400';
  end if;

  -- 93 = MAX_SPAN_DAYS (31) x 3 times of day, the largest number of slots a single period
  -- can contain. Claiming more than every slot in the longest possible trip is not a request
  -- this function needs to serve. Kept as a literal with this comment for the same reason the
  -- 43 above is: the guard must not depend on reading another object to decide whether to do
  -- any work at all.
  if v_requested > 93 then
    raise exception 'claim_slots: p_slot_ids names % slots; a period holds at most 93', v_requested
      using errcode = 'PT400';
  end if;

  -- The same shape care_slots_claim_digest_format pins on the column. Checking it here as
  -- well means a malformed digest is a clean 400 rather than a constraint violation surfacing
  -- as a 500 — and it is checked before any table access, unlike the constraint.
  if p_claim_digest is null or p_claim_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'claim_slots: p_claim_digest must be a 64-character lowercase hex digest'
      using errcode = 'PT400';
  end if;

  -- Step 3: derive the period from the token. Byte-identical hashing to
  -- get_period_by_token's, so one link resolves the same period through either door.
  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');

  select * into v_period
  from public.care_periods p
  where p.token_digest = v_digest
    and p.revoked_at is null;

  if not found then
    return null;
  end if;

  -- Step 4: decide whose claim this is.
  --
  -- This is the ONLY place "one capability = one identity" is enforced. The schema cannot
  -- hold it: care_slots_claim_complete ties the three claim columns per ROW, but nothing ties
  -- them across rows, so the same claim_digest can carry "Ania" on one slot and "Basia" on
  -- another (verified in psql — S-03 Phase 1 impl-review F1). That is a multi-row invariant
  -- and no CHECK can express it. Same posture as "at least one pet", which lives only inside
  -- create_period_with_slots.
  --
  -- Consequence: on a follow-up claim the stored name WINS and p_name is ignored outright,
  -- rather than being compared or preferred. Phase 3's get_claimed_details returns a single
  -- `name` per capability and Phase 4's follow-up claim reads the stored name back; both rest
  -- on this line. Residual risk accepted knowingly: the OWNER holds table grants on
  -- care_slots, so a direct UPDATE can still create the incoherent state — in their own trip.
  select s.claimed_by_name
  into v_name
  from public.care_slots s
  where s.period_id = v_period.id
    and s.claim_digest = p_claim_digest
  limit 1;

  if v_name is null then
    v_name := pg_catalog.btrim(coalesce(p_name, ''));

    if v_name = '' then
      raise exception 'claim_slots: p_name is required on a first claim'
        using errcode = 'PT400';
    end if;

    -- claimed_by_name is unbounded text with no CHECK, and this function is the only writer
    -- anon can reach. This bound is therefore the single thing standing between an anonymous
    -- caller and storage amplification.
    if pg_catalog.length(v_name) > 80 then
      raise exception 'claim_slots: p_name is longer than 80 characters'
        using errcode = 'PT400';
    end if;
  end if;

  -- Step 5: the claim. One statement, three guards, and the returned ids are the answer.
  --
  --   period_id  — the scope check; the only thing stopping a slot uuid from another period.
  --                Also carries revocation, since v_period was derived with revoked_at is null.
  --   claimed_by_name is null — the freeness test, made truthful by care_slots_claim_complete.
  --                A concurrent claimer either commits first and this row is skipped, or
  --                blocks on the row lock and re-evaluates the predicate against the
  --                committed value. Either way exactly one of them writes it.
  --
  -- The prescribed shape from 20260905234144:38-43, widened to a set.
  with claimed as (
    update public.care_slots s
    set claimed_by_name = v_name,
        claimed_at = pg_catalog.now(),
        claim_digest = p_claim_digest
    where s.id = any(v_slot_ids)
      and s.period_id = v_period.id
      and s.claimed_by_name is null
    returning s.id
  )
  select pg_catalog.array_agg(claimed.id)
  into v_new_ids
  from claimed;

  v_claimed := coalesce(pg_catalog.array_length(v_new_ids, 1), 0);

  -- Step 6: all or nothing. A mismatch raises, and the raise rolls the update back — which is
  -- what makes a partial selection leave EVERY requested slot unclaimed rather than the free
  -- subset of it.
  --
  -- Naming the conflicting slots is a read taken AFTER the decision to raise, inside the
  -- transaction that is already doomed. Doing it before the update would be the read-then-
  -- write this whole function is shaped to avoid. Rows the caller already holds are listed
  -- too: they were not free either, and a caretaker re-submitting a slot they own deserves a
  -- non-empty explanation. Requested ids belonging to another period are silently absent —
  -- reporting them would confirm they exist.
  if v_claimed <> v_requested then
    select pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object('slot_date', s.slot_date, 'time_of_day', s.time_of_day)
             order by s.slot_date, s.time_of_day
           )
    into v_conflicts
    from public.care_slots s
    where s.id = any(v_slot_ids)
      and s.period_id = v_period.id
      and s.id <> all(coalesce(v_new_ids, '{}'::uuid[]));

    raise exception 'claim_slots: % of % requested slots are no longer free', v_requested - v_claimed, v_requested
      using errcode = 'PT409',
            detail = coalesce(v_conflicts, '[]'::jsonb)::text;
  end if;

  -- Step 7: the receipt. Every value here is already reachable through get_period_by_token
  -- with the same token, so the payload widens nothing: end_date rides along only so Phase
  -- 4's route can compute the capability cookie's Max-Age without a second round trip.
  return pg_catalog.jsonb_build_object(
    'period_id', v_period.id,
    'end_date', v_period.end_date,
    'name', v_name,
    'claimed_count', v_claimed,
    'slot_ids', pg_catalog.to_jsonb(v_new_ids)
  );
end;
$$;

comment on function public.claim_slots(text, uuid[], text, text) is
  'Claims a set of slots for one caretaker capability, all-or-nothing. Derives the period from the invite token — never accepts a period id. Returns NULL for an unresolvable token (uniform failure, as the read door does) and raises PT409 with the conflicting {slot_date, time_of_day} rows in DETAIL when any requested slot is no longer free, rolling the whole claim back. The ONLY enforcement of "one capability = one identity": a digest that already holds slots in the period reuses its stored name and p_name is ignored.';

-- 2. Grants.
--
-- `revoke ... from public` alone is NOT enough on Supabase: ALTER DEFAULT PRIVILEGES grants
-- EXECUTE to anon, authenticated and service_role on every new function in `public`,
-- separately from the PUBLIC pseudo-role, so all four roles are named. This is the fourth
-- migration to say so (context/foundation/lessons.md: read a posture from the catalog, not
-- from a comment — tests/rls/claim-slots.test.ts asserts it back).
--
-- anon is granted deliberately: a caretaker following a link has no account, and this is the
-- second door in the model docs/reference/data-access.md rule 2 describes. authenticated too,
-- for the same reason get_period_by_token has it — a signed-in owner opening their own link
-- must work.
revoke execute on function public.claim_slots(text, uuid[], text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_slots(text, uuid[], text, text) to anon, authenticated;
