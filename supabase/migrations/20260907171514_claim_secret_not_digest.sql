-- S-03 Phase 2 impl-review F1: take the capability SECRET, not its digest.
--
-- 20260907154125 shipped `claim_slots(p_token, p_slot_ids, p_claim_digest, p_name)`, which
-- compared the caller's argument verbatim against the stored `care_slots.claim_digest`. Three
-- lines earlier the same body took the RAW invite token and hashed it inside. That asymmetry
-- is the defect:
--
--   * For the token, the stored value cannot be replayed. Reading `care_periods.token_digest`
--     gets you nothing, because the function hashes what you present and compares.
--   * For the capability, the stored value WAS the proof of identity. Anyone who could read
--     `care_slots.claim_digest` could present it and act as that caretaker.
--
-- Who could read it: `authenticated` holds SELECT on `care_slots` under `care_slots_select_own`
-- (read from information_schema.role_table_grants and pg_policy, not from a comment). That is
-- the owner, inside their own trip, where they already hold UPDATE on the same rows — so there
-- was no privilege escalation today, and this is a hardening fix rather than an incident. What
-- it removes is the standing property that a column in this schema is a live bearer credential,
-- so that a future disclosure of it (a backup, an error body, S-04's occupancy payload) is not
-- automatically a replayable one.
--
-- Two further reasons this lands now rather than later:
--
--   1. Phase 3's `get_claimed_details(p_token text, p_claim_secret text)` is already specified
--      to take the RAW secret and hash it inside. Leaving this one digest-in would give the two
--      capability surfaces opposite conventions, and Phase 4's route would have to hash for one
--      and pass raw to the other.
--   2. Entropy stops being client-controlled. With the digest as the argument, a caller chose
--      the stored value outright and nothing stopped `repeat('0', 64)`. Now the function
--      derives it, so the 256 bits come from whoever minted the secret.
--
-- Nothing consumes claim_slots yet — Phase 4 is unwritten and the only caller is
-- tests/rls/claim-slots.test.ts — so the change costs one migration and one test edit.
--
-- DROP + CREATE, not `create or replace`: Postgres refuses to change the NAME of an input
-- parameter in place ("cannot change name of input parameter"), and the argument TYPE list is
-- unchanged, so replace could not have carried this even if the name were incidental. Dropping
-- takes the grants with it, hence §2 — the same recipe as 20260906165005 §3-4 and
-- 20260907065515 §4-5. Body is 20260907154125's verbatim except for the three marked changes,
-- reproduced in full because DROP + CREATE cannot inherit a body.
drop function public.claim_slots(text, uuid[], text, text);

create function public.claim_slots(
  p_token text,
  p_slot_ids uuid[],
  p_claim_secret text,
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
  v_claim_digest text;
  v_period public.care_periods;
  v_slot_ids uuid[];
  v_new_ids uuid[];
  v_requested integer;
  v_claimed integer;
  v_already integer;
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

  -- CHANGED (F1): the secret is bounded exactly as the token is, and for the same two reasons
  -- — no unbounded hashing for an unauthenticated caller, and no input-size-dependent timing.
  -- 43 is not a coincidence: generateClaimSecret in src/lib/invite-token.ts is a literal alias
  -- of generateInviteToken, so the two credentials have byte-identical shape by construction.
  if p_claim_secret is null or pg_catalog.length(p_claim_secret) <> 43 then
    raise exception 'claim_slots: p_claim_secret must be a 43-character capability secret'
      using errcode = 'PT400';
  end if;

  -- Step 3: derive the period from the token, and the capability from the secret. Both use the
  -- same expression, which is also what src/lib/invite-token.ts computes in the app and what
  -- get_period_by_token computes for the token — one link and one capability resolve the same
  -- way through every door.
  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');

  -- CHANGED (F1): derived here rather than accepted as an argument. sha256 always yields 64
  -- lowercase hex chars, so care_slots_claim_digest_format is now satisfied by construction and
  -- the explicit format guard the previous version needed is gone with the argument it checked.
  v_claim_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_claim_secret, 'UTF8')), 'hex');

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
  --
  -- CHANGED (Phase 2 impl-review F10b): `order by` added. In that incoherent state the name
  -- propagated to every newly claimed slot was whichever row the plan happened to return
  -- first. Oldest claim wins is at least deterministic, so a repair is reproducible.
  select s.claimed_by_name
  into v_name
  from public.care_slots s
  where s.period_id = v_period.id
    and s.claim_digest = v_claim_digest
  order by s.claimed_at, s.id
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
        claim_digest = v_claim_digest
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
  -- write this whole function is shaped to avoid. Requested ids belonging to another period
  -- are silently absent — reporting them would confirm they exist — so DETAIL can legitimately
  -- be an empty array and Phase 4's route must handle that (impl-review F6).
  --
  -- CHANGED (impl-review F4): a shortfall is no longer a refusal on its own. Slots this SAME
  -- capability already holds count as satisfied, which makes the RPC safely retryable. The
  -- first version refused them, and 20260907154125's addendum A10 defended that with "Phase
  -- 4's UI makes taken slots unselectable" — an answer to the wrong question. The case that
  -- bites is a RETRY, not a selection: the POST succeeds, the response is lost on a flaky
  -- connection, the client resends the identical set, and the caretaker is told the slot they
  -- just successfully claimed is taken. The claim landed; the user was told it did not.
  --
  -- The count sits HERE, after the update and inside the shortfall branch, on purpose. The
  -- freeness decision stays entirely in the update's WHERE — this read cannot influence what
  -- was written, only how the shortfall is explained — and the all-free path pays nothing for
  -- it. Rows matched here were claimed in an earlier, already-committed transaction by this
  -- same capability, so nothing about them can be racing.
  if v_claimed <> v_requested then
    select pg_catalog.count(*)
    into v_already
    from public.care_slots s
    where s.id = any(v_slot_ids)
      and s.period_id = v_period.id
      and s.claim_digest = v_claim_digest
      and s.id <> all(coalesce(v_new_ids, '{}'::uuid[]));
  else
    v_already := 0;
  end if;

  if v_claimed + v_already <> v_requested then
    select pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object('slot_date', s.slot_date, 'time_of_day', s.time_of_day)
             order by s.slot_date, s.time_of_day
           )
    into v_conflicts
    from public.care_slots s
    where s.id = any(v_slot_ids)
      and s.period_id = v_period.id
      and s.id <> all(coalesce(v_new_ids, '{}'::uuid[]))
      -- Own rows are excluded so a mixed request — some already mine, some genuinely taken —
      -- names only the slots the caretaker cannot have.
      and s.claim_digest is distinct from v_claim_digest;

    raise exception 'claim_slots: % of % requested slots are no longer free',
      v_requested - v_claimed - v_already, v_requested
      using errcode = 'PT409',
            detail = coalesce(v_conflicts, '[]'::jsonb)::text;
  end if;

  -- Step 7: the receipt. Every value here is already reachable through get_period_by_token
  -- with the same token, so the payload widens nothing: end_date rides along only so Phase
  -- 4's route can compute the capability cookie's Max-Age without a second round trip. The
  -- digest is deliberately NOT returned — the caller already holds the secret it came from,
  -- and echoing the stored value back is the shape this migration exists to remove.
  --
  -- `already_held_count` exists so a retry is legible rather than merely tolerated: the second
  -- identical POST returns success with claimed_count = 0, and without this field the route
  -- could not tell "you already had them all" from "nothing happened".
  return pg_catalog.jsonb_build_object(
    'period_id', v_period.id,
    'end_date', v_period.end_date,
    'name', v_name,
    'claimed_count', v_claimed,
    'already_held_count', v_already,
    'slot_ids', pg_catalog.to_jsonb(v_new_ids)
  );
end;
$$;

comment on function public.claim_slots(text, uuid[], text, text) is
  'Claims a set of slots for one caretaker capability, all-or-nothing. Takes the RAW capability secret and hashes it inside, exactly as it does the invite token, so the stored claim_digest is never itself a credential. Derives the period from the token — never accepts a period id. Returns NULL for an unresolvable token (uniform failure, as the read door does) and raises PT409 with the conflicting {slot_date, time_of_day} rows in DETAIL when any requested slot is no longer free, rolling the whole claim back; that DETAIL is legitimately empty when the requested slot belongs to another period. Retry-safe: slots this same capability already holds count as satisfied rather than conflicting, and are reported as already_held_count. The ONLY enforcement of "one capability = one identity": a secret whose digest already holds slots in the period reuses its stored name and p_name is ignored.';

-- 2. Re-establish the grant posture on the NEW signature.
--
-- The dropped function took its grants with it, and `revoke ... from public` alone does not
-- reach anon / authenticated / service_role on Supabase — those come from ALTER DEFAULT
-- PRIVILEGES and must be named. Identical to 20260907154125's pair; reproduced because grants
-- are keyed to the function, not to its argument types.
--
-- tests/rls/claim-slots.test.ts asserts this back from both sides rather than trusting these
-- two lines (context/foundation/lessons.md: verify a posture from the catalog or from a test
-- that FAILS when it disappears, not from a comment).
revoke execute on function public.claim_slots(text, uuid[], text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_slots(text, uuid[], text, text) to anon, authenticated;
