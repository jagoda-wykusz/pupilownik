-- S-03 Phase 3: the reveal. Both halves of FR-008.
--
-- Until now a caretaker could see WHEN help is needed but nothing about the animals. This
-- migration adds the two tiers the PRD splits on:
--
--   * PUBLIC — the trip's pets and their non-sensitive instruction rows, visible to anyone
--     holding the link, before claiming anything. Joins the existing read door's payload.
--   * SENSITIVE — the rows flagged is_sensitive, plus the trip's caretaker_note, visible
--     only to someone who has actually claimed a slot. Gets its own function.
--
-- Why two functions rather than one with a parameter: docs/reference/data-access.md rule 2
-- forbids "a parameter that could widen the result set" on get_period_by_token. A
-- p_reveal_sensitive argument would be exactly that, and the whole tier split would then rest
-- on one boolean nobody can see from the outside. A separate function has a separate grant, a
-- separate name in the registry, and a separate test.
--
-- BOTH functions are SECURITY DEFINER and therefore run as their owner, which means RLS on
-- pets and care_instructions does NOT apply inside them. That is deliberate — anon has no
-- policy on either table and could never read them otherwise — but it makes the point worth
-- stating plainly: the `is_sensitive = false` filter below is the ONLY thing separating the
-- two tiers. There is no policy behind it. Getting that predicate wrong leaks a house key.

-- 1. The read door grows the public tier.
--
-- CREATE OR REPLACE with an unchanged signature, so the grants from 20260906003122 survive
-- untouched (this is the one case where replace is safe — see 20260906165005 §3 for why it
-- is not, the moment an argument list changes).
--
-- STABLE is preserved. This function still only reads.
--
-- The path is care_periods -> care_period_pets -> pets -> care_instructions, the relation
-- S-08 added. A period with ZERO pets is representable by decision (create_period_with_slots
-- enforces "at least one pet" and nothing else does), so `pets` coalesces to an empty array
-- rather than null — the page must have an empty list to render, not a null to crash on.
create or replace function public.get_period_by_token(p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_digest text;
  v_period public.care_periods;
  v_result jsonb;
begin
  -- 43 = length of base64url(32 bytes) with the padding stripped. Kept as a literal with
  -- this comment rather than read from somewhere: the function must not depend on another
  -- object to decide whether to do any work at all.
  if p_token is null or pg_catalog.length(p_token) <> 43 then
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

  select pg_catalog.jsonb_build_object(
    'period', pg_catalog.jsonb_build_object(
      'id', v_period.id,
      'title', v_period.title,
      'start_date', v_period.start_date,
      'end_date', v_period.end_date
      -- caretaker_note is deliberately ABSENT. It is sensitive-tier content (the design
      -- fills it with "Klucze u sąsiadki, mieszkanie 4…") and belongs to
      -- get_claimed_details below. This object is built key by key precisely so adding a
      -- column to care_periods can never widen it by accident.
    ),
    'slots', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', s.id,
            'slot_date', s.slot_date,
            'time_of_day', s.time_of_day,
            -- Free/taken only. WHO took it is S-04 (FR-006), and this payload is read by
            -- anyone holding the link. claimed_by_name and claim_digest must never appear.
            'is_claimed', s.claimed_by_name is not null
          )
          order by s.slot_date, s.time_of_day
        )
        from public.care_slots s
        where s.period_id = v_period.id
      ),
      '[]'::jsonb
    ),
    -- NEW: the trip's pets and their PUBLIC instruction rows.
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
                  -- THE tier boundary. Not a policy, not a view — this predicate.
                  and i.is_sensitive = false
              ),
              '[]'::jsonb
            )
          )
          -- Deterministic order so the page does not reshuffle between requests. Name first
          -- because that is what the caretaker reads; id breaks ties between two pets called
          -- "Burek", which one household can genuinely have.
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

comment on function public.get_period_by_token(text) is
  'The anon-reachable READ door. Resolves at most one active period from a raw invite token and returns it with its slots free/taken state and its pets with their PUBLIC (is_sensitive = false) instruction rows. Never returns caretaker_note, owner_id, token_digest, claimed_by_name or any sensitive instruction row. Returns NULL for unknown, malformed and revoked tokens alike. A period with no linked pets returns pets: [].';

-- 2. The sensitive tier.
--
-- Two credentials, both required: the invite token says WHICH trip, the capability secret
-- says the caller is a caretaker who actually took a slot on it. Holding the link alone is
-- not enough — that is the whole point of FR-008's split, and it is why this cannot be a
-- parameter on the function above.
--
-- STABLE: this reads and never writes. (claim_slots is the volatile one; the contrast is
-- deliberate and each function states which it is.)
--
-- Uniform failure applies here in full, unlike claim_slots: an unresolvable token, a wrong
-- secret and a valid secret that holds no slots in this period all return NULL. A distinct
-- answer for any of them would tell a prober which half of the pair they got right.
create function public.get_claimed_details(
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

  -- No slots for this capability: same NULL as a bad token. The caller learns nothing about
  -- whether the token was good, the secret was good, or neither.
  if v_name is null then
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
  'The sensitive tier of FR-008. Requires BOTH the invite token and a capability secret whose digest holds at least one claimed slot in that period; anything less returns NULL, so an unresolvable token, a wrong secret and a capability with no slots here are indistinguishable. Returns the caretaker''s own name and slots, the trip''s caretaker_note, and the pets with ONLY their is_sensitive instruction rows — the public rows come from get_period_by_token and the page composes the two.';

-- 3. Grants.
--
-- Same four-role recipe as every function in this schema: `revoke ... from public` alone does
-- not reach anon / authenticated / service_role on Supabase, because ALTER DEFAULT PRIVILEGES
-- grants them separately. anon is the caretaker; authenticated is a signed-in owner opening
-- their own link. service_role is refused, as everywhere else here.
--
-- get_period_by_token needs no grant statement: CREATE OR REPLACE on an unchanged signature
-- preserves the ones 20260906003122 set. tests/rls/invite-token.test.ts asserts that back
-- rather than trusting this sentence (context/foundation/lessons.md).
revoke execute on function public.get_claimed_details(text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.get_claimed_details(text, text) to anon, authenticated;
