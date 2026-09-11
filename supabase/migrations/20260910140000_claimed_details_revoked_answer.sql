-- S-06 Phase 2: the caretaker's answer.
--
-- Until now a caretaker who had claimed slots on a trip the owner then revoked saw the exact
-- same "Link nieaktywny" 404 as a stranger with a typo in the URL. They lost the trip, their
-- own record of which days they took, the caretaker_note and every sensitive instruction, and
-- the page told them to "poproś właściciela o nowy link" — which RegenerateLinkButton refuses
-- to mint for a revoked period, and which S-06 Phase 1 now refuses in SQL too. A dead end by
-- accident became a dead end by design the moment the owner got a revoke button.
--
-- This migration gives a caller who can PROVE they claimed on THIS period one bit more than a
-- stranger gets: the trip was called off. It does not give them their access back.
--
-- ── WHY THIS IS SAFE, in the terms docs/reference/data-access.md rule 4 uses ────────────────
--
-- Rule 4 is uniform failure: unknown, tampered, malformed and revoked tokens all return NULL,
-- because a distinct "this link was revoked" answer would confirm the period exists. That
-- property is preserved here for every caller who cannot prove a claim. The widening is gated
-- on a claim_digest matching a care_slots row IN THIS PERIOD — and that digest is the sha256
-- of a 43-char secret this function never returns and the database only ever stores hashed
-- (20260907171514_claim_secret_not_digest.sql). It is unforgeable, and holding one is provable
-- only by having claimed while the link was live (the mint-and-claim block in src/pages/invite/claim.ts).
--
-- So the one bit is disclosed only to someone who already had it: they knew the period existed,
-- because they claimed a slot in it. This is a STRICTLY WEAKER widening than S-03's accepted
-- one — see the WRITE widening under rule 4 in docs/reference/data-access.md — which let
-- claim_slots raise with the conflicting {slot_date, time_of_day} rows rather than answer NULL.
-- (Cited by name, not by line range: this slice rewrote rule 4 and shifted its own citation,
-- which impl-review F8 caught.)
--
-- ── WHAT GATES THE ANSWER, AND IN WHAT ORDER ────────────────────────────────────────────────
--
-- 1. Bound both inputs at 43 chars.
-- 2. Hash the token AND the claim secret — both unconditionally.     (equalisation, below)
-- 3. Look the period up by digest WITHOUT the revoked filter, recording whether it was found.
-- 4. Probe care_slots for a row matching the claim digest in that period, recording the same.
-- 5. `if not v_period_found` -> NULL. An unknown or tampered token dies here.
-- 6. `if not v_claim_found`  -> NULL. This is impl-review F6's ROW gate, semantically
--    UNTOUCHED. It is what keeps a non-holder — wrong secret, no slots here, or a capability
--    earned on another trip — indistinguishable from a stranger.
-- 7. ONLY NOW branch on revoked_at.                                  (new in S-06)
--
-- The load-bearing property is that step 7 sits after step 6, not that the gates are adjacent
-- to their lookups. Move the revoked check ahead of step 6 and it becomes a disclosure to
-- anyone presenting any secret; drop it back into step 3's predicate and the answer re-hides
-- from the holder. tests/rls/reveal-instructions.test.ts asserts BOTH directions, so a
-- reordering fails rather than quietly shipping (context/foundation/lessons.md). Measured: with
-- the branch hoisted above the gate, the non-holder case fails with
-- `expected { revoked: true } to deeply equal null`.
--
-- ── WORK EQUALISATION (S-06 Phase 2 impl-review F2) ─────────────────────────────────────────
--
-- Uniform failure is about what the caller can OBSERVE, and the first cut of this function
-- made the answers identical in content while making them differ in work. Dropping the revoked
-- filter means a revoked token now RESOLVES, so the function used to carry on past the first
-- gate — a second sha256 and a second index probe — where an unknown token had already
-- returned. Both cases are reached by an attacker who holds a forwarded link and wants to know
-- whether it was revoked or simply mistyped, and anon holds EXECUTE here, so the probe is one
-- direct RPC call with no SSR noise to hide in.
--
-- So both hashes and both lookups now run for every caller who clears the length checks, and
-- only then do the gates decide. Be precise about what this buys: it removes the asymmetry
-- THIS SLICE INTRODUCED. It does not make the function constant-time — a digest that matches
-- an existing period still reads a heap tuple that a non-existent one does not, which was
-- equally true before S-06. The claim in the docs is "identical in content, and no worse in
-- work than before this slice", not "constant-time".
--
-- CREATE OR REPLACE with an unchanged signature, so the grants from 20260907180022 survive —
-- the same move 20260907193000:20-22 made. The tests assert all three roles back rather than
-- trusting this sentence.
--
-- The revoked payload is deliberately MINIMAL: `{"revoked": true}` and nothing else. No title,
-- no dates, no pets, no caretaker_note, no slots. Revocation is still total; this is a status,
-- not a restoration. Note what that means for the page: it cannot name the trip in the
-- called-off card, because the payload does not carry the name — by design, since the card is
-- reachable with only a cookie and the title lands in browser history.
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
  -- `found` is clobbered by the next SELECT INTO, and both lookups now run before either
  -- gate decides, so each one's outcome has to be captured as it happens. See the
  -- equalisation note in the header.
  v_period_found boolean;
  v_claim_found boolean;
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

  -- Hashed unconditionally, BEFORE the period is looked up, as part of the work-equalisation
  -- described in the header. It used to sit after the first gate, where a token that resolved
  -- to nothing skipped it.
  v_claim_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_claim_secret, 'UTF8')), 'hex');

  -- CHANGED (S-06 Phase 2): `and p.revoked_at is null` is GONE from this lookup. It is the
  -- only predicate removed, and the revoked branch below is what replaces it. The other two
  -- anon doors — get_period_by_token and claim_slots — keep theirs, so a revoked period still
  -- resolves to nothing for the read door and still refuses claims.
  select * into v_period
  from public.care_periods p
  where p.token_digest = v_digest;

  v_period_found := found;

  -- The authorization decision, in one statement: does this capability hold at least one
  -- slot in THIS period? Scoped by period_id as well as digest, so a capability earned on
  -- one trip cannot open another — the same reason claim_slots carries period_id in its
  -- update. Served by care_slots_period_claim_digest_idx.
  --
  -- `order by` matches claim_slots' name lookup (Phase 2 impl-review F10b): in the incoherent
  -- state the schema permits — one digest carrying two names, reachable only through a direct
  -- owner UPDATE — both functions must at least agree on which name they mean.
  --
  -- `coalesce(v_period.id, ...)` is the equalisation, not a lookup meant to succeed: on a
  -- missed period lookup v_period is all-NULLs (verified: `found=f`, `id is null`), and the
  -- all-zero uuid is not a value `gen_random_uuid()` produces, so this probe misses for every
  -- period this application creates. Its only purpose is to make the miss cost the same index
  -- probe as a hit would.
  --
  -- Corrected (full-plan review): an earlier version of this comment said the zero uuid "is not
  -- a generatable primary key", which is false — `care_periods` grants INSERT to authenticated
  -- with no column list and `care_periods_insert_own` checks only `owner_id`, so an owner can
  -- plant a row with that id. It changes nothing: the `v_period_found` gate below returns first,
  -- so a planted row is unreachable from here. The point is that the sentence asserted what the
  -- catalog permits without reading it, in the file whose header argues for reading it.
  --
  -- Unqualified on purpose, despite `search_path = ''`: COALESCE is a SQL construct, not a
  -- function, so `pg_catalog.coalesce` does not resolve — it raises 42883 at RUNTIME, which
  -- `supabase db reset` happily applies because a plpgsql body is not validated at creation.
  -- The payload below has always written `coalesce(..., '[]'::jsonb)` the same way.
  select s.claimed_by_name
  into v_name
  from public.care_slots s
  where s.period_id = coalesce(v_period.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and s.claim_digest = v_claim_digest
  order by s.claimed_at, s.id
  limit 1;

  v_claim_found := found;

  -- The gates, both of them, AFTER both lookups. Order between them is irrelevant — each
  -- returns the same NULL — but it is kept as period-then-claim so the code still reads in
  -- the sequence the header describes.
  if not v_period_found then
    return null;
  end if;

  -- The gate is `not found`, so it turns on whether a ROW matched rather than on whether that
  -- row's name column happened to be non-null (impl-review F6). Semantically UNCHANGED by
  -- S-06, and load bearing for it: this is the line that keeps the revoked answer below from
  -- reaching anyone who cannot prove a claim.
  --
  -- No slots for this capability: same NULL as a bad token. The caller learns nothing about
  -- whether the token was good, the secret was good, or neither.
  if not v_claim_found then
    return null;
  end if;

  -- NEW (S-06 Phase 2), and deliberately AFTER the gate above. The caller has now proved a
  -- claim on this period, so telling them the trip was called off discloses nothing they did
  -- not already know. Returned instead of the payload, not alongside it: revocation is total.
  if v_period.revoked_at is not null then
    return pg_catalog.jsonb_build_object('revoked', true);
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
  'The sensitive tier of FR-008. Requires BOTH the invite token and a capability secret whose digest matches at least one claimed slot row in that period; anything less returns NULL, so an unresolvable token, a wrong secret and a capability with no slots here are indistinguishable. When the period is REVOKED, a caller who clears that same gate gets `{"revoked": true}` and nothing else (S-06 Phase 2) — one bit, no payload, disclosed only to someone who proved a claim and therefore already knew the period existed; every unproven caller still gets the uniform NULL. Otherwise returns the caretaker''s own name and slots, the trip''s caretaker_note, and the pets with ONLY their is_sensitive instruction rows — the public rows come from get_period_by_token and the page composes the two.';

-- ── The column comment, again ──────────────────────────────────────────────────────────────
--
-- 20260910120000 (S-06 Phase 1) set this comment and hedged the Phase 2 behaviour as
-- "planned … will resolve". Phase 2 is this migration, so that hedge is now false in the other
-- direction — and the comment's claim that all three functions share an identical predicate
-- became false the moment the filter above was dropped. Refreshed here rather than by editing
-- the earlier migration, which is the same supersede-by-new-statement move Phase 1 made when
-- it replaced 20260906003122's "Written by S-06".
--
-- Phase 1's F0 was exactly this class of error, caught in review; leaving this one would be the
-- same error with the tenses swapped.
comment on column public.care_periods.revoked_at is
  'When set, the invite link no longer resolves. get_period_by_token and claim_slots share the predicate `revoked_at is null`, so a revoked period is invisible to the read door and refuses claims. get_claimed_details does NOT: since S-06 Phase 2 it resolves the period without that filter and, for a caller whose claim_digest matches a slot row in that period, answers `{"revoked": true}` — one bit, no payload, and no restoration of access; every unproven caller still gets the uniform NULL. revoke_period is this column''s only intended writer, and regenerate_period_token refuses a period carrying it. Write-once by product decision — enforced by revoke_period''s `revoked_at is null` predicate, NOT by a constraint: care_periods_update_own has no column granularity, so a direct owner UPDATE can still write or clear this column.';
