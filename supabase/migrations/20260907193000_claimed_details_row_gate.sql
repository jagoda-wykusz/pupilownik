-- S-03 Phase 3 impl-review F6: gate the reveal on a ROW, not on a column value.
--
-- 20260907180022 answered "does this capability hold a slot in this period?" with
--
--     select s.claimed_by_name into v_name ... limit 1;
--     if v_name is null then return null; end if;
--
-- which tests whether a non-null VALUE came back, not whether a ROW did. Those are the same
-- question today only because care_slots_claim_complete guarantees
-- (claimed_by_name is null) = (claim_digest is null), so any row matched by digest carries a
-- name. The door was therefore correct by way of a constraint declared in a different
-- migration — and contract-surfaces.md records in bold that the owner still holds UPDATE on
-- care_slots under care_slots_update_own, so the layer it leans on has a documented way to be
-- broken from outside this function.
--
-- `if not found` costs nothing and makes the authorization decision self-contained: the
-- question becomes "did the digest match a row in this period", which is what the sentence in
-- the function's own comment always claimed it was asking. v_name stays, but only as payload.
--
-- CREATE OR REPLACE with an unchanged signature, so the grants from 20260907180022 survive;
-- tests/rls/reveal-instructions.test.ts asserts all three roles back rather than trusting
-- this sentence (context/foundation/lessons.md).
create or replace function public.get_claimed_details(
  p_token text,
  p_claim_secret text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_digest text;
  v_claim_digest text;
  v_period public.care_periods;
  v_name text;
  v_result jsonb;
begin
  -- Both inputs are bounded before anything is hashed, for the reason 20260906105815 gives:
  -- this function is granted to anon and reachable with no authentication, so an unbounded
  -- argument would buy a caller a convert_to + sha256 over megabytes before a guaranteed
  -- miss. 43 for both because the capability secret is minted by the same primitive as the
  -- token (generateClaimSecret is a literal alias of generateInviteToken).
  if p_token is null or pg_catalog.length(p_token) <> 43 then
    return null;
  end if;

  if p_claim_secret is null or pg_catalog.length(p_claim_secret) <> 43 then
    return null;
  end if;

  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');

  select * into v_period
  from public.care_periods p
  where p.token_digest = v_digest
    and p.revoked_at is null;

  if not found then
    return null;
  end if;

  v_claim_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_claim_secret, 'UTF8')), 'hex');

  -- The authorization decision, in one statement: does this capability hold at least one
  -- slot in THIS period? Scoped by period_id as well as digest, so a capability earned on
  -- one trip cannot open another — the same reason claim_slots carries period_id in its
  -- update. Served by care_slots_period_claim_digest_idx.
  --
  -- `order by` matches claim_slots' name lookup (Phase 2 impl-review F10b): in the incoherent
  -- state the schema permits — one digest carrying two names, reachable only through a direct
  -- owner UPDATE — both functions must at least agree on which name they mean.
  select s.claimed_by_name
  into v_name
  from public.care_slots s
  where s.period_id = v_period.id
    and s.claim_digest = v_claim_digest
  order by s.claimed_at, s.id
  limit 1;

  -- CHANGED (impl-review F6): the gate is `not found`, so it turns on whether a ROW matched
  -- rather than on whether that row's name column happened to be non-null. Same answer today,
  -- but it no longer borrows its correctness from care_slots_claim_complete.
  --
  -- No slots for this capability: same NULL as a bad token. The caller learns nothing about
  -- whether the token was good, the secret was good, or neither.
  if not found then
    return null;
  end if;

  select pg_catalog.jsonb_build_object(
    'name', v_name,
    -- The trip note. Sensitive tier by decision (change.md, inherited item 1): its content
    -- overlaps is_sensitive instruction rows, so it rides the same reveal rule.
    'caretaker_note', v_period.caretaker_note,
    -- The caretaker's OWN slots — what "Masz 2 dni: 13 i 16 lipca" is built from. Other
    -- caretakers' claims are NOT here; occupancy by name is S-04 (FR-006).
    'slots', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', s.id,
            'slot_date', s.slot_date,
            'time_of_day', s.time_of_day
          )
          order by s.slot_date, s.time_of_day
        )
        from public.care_slots s
        where s.period_id = v_period.id
          and s.claim_digest = v_claim_digest
      ),
      '[]'::jsonb
    ),
    -- ONLY the sensitive rows. The public ones already reached the page through
    -- get_period_by_token, and the design draws the sensitive block as a visually separated
    -- callout rather than as entries mixed into the same list — so the page composes the two
    -- payloads instead of this one repeating what the other already said.
    --
    -- A pet with no sensitive rows still appears, with instructions: []. Dropping it would
    -- make the two payloads disagree about which pets are on the trip.
    'pets', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', pet.id,
            'name', pet.name,
            'species', pet.species,
            'instructions', coalesce(
              (
                select pg_catalog.jsonb_agg(
                  pg_catalog.jsonb_build_object(
                    'id', i.id,
                    'title', i.title,
                    'body', i.body,
                    'sort_order', i.sort_order
                  )
                  order by i.sort_order, i.id
                )
                from public.care_instructions i
                where i.pet_id = pet.id
                  and i.is_sensitive = true
              ),
              '[]'::jsonb
            )
          )
          -- Same ordering as the read door, so the two lists line up on the page.
          order by pet.name, pet.id
        )
        from public.care_period_pets link
        join public.pets pet on pet.id = link.pet_id
        where link.period_id = v_period.id
      ),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.get_claimed_details(text, text) is
  'The sensitive tier of FR-008. Requires BOTH the invite token and a capability secret whose digest matches at least one claimed slot row in that period; anything less returns NULL, so an unresolvable token, a wrong secret and a capability with no slots here are indistinguishable. Returns the caretaker''s own name and slots, the trip''s caretaker_note, and the pets with ONLY their is_sensitive instruction rows — the public rows come from get_period_by_token and the page composes the two.';
