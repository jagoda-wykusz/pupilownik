-- S-02 Phase 2: the token model.
--
-- A caretaker reaches a care period with no account at all. Every policy in this schema is
-- `to authenticated` with an auth.uid() predicate, so RLS denies the anon role everything —
-- which is the correct fail-closed default, and the reason this needs a function rather than
-- an anon policy. `public.get_period_by_token` is the ONLY surface anon may touch.
--
-- The raw token is never stored. The app mints it (src/lib/invite-token.ts), stores only the
-- SHA-256 hex digest, and hands the raw value to the owner exactly once.

-- 0. Close the table door properly.
--
-- The previous migration's comment claimed there was "deliberately NO grant to anon" on
-- these tables. That was wrong, and checking it is what surfaced it: Supabase's ALTER
-- DEFAULT PRIVILEGES had already granted anon SELECT/INSERT/UPDATE/DELETE on both, exactly
-- as it does for every new table in `public`. Nothing leaked — no policy names anon, so
-- deny-by-default returned zero rows, which is the model docs/reference/data-access.md
-- describes. But a slice whose entire premise is "the function is the only door" should not
-- rest that claim on one layer while describing two.
--
-- Revoking costs nothing here: get_period_by_token is SECURITY DEFINER and runs as its
-- owner, so it reads these tables regardless of what anon holds.
revoke all on table public.care_periods from anon;
revoke all on table public.care_slots from anon;

-- 1. Digest lookup + revocation marker.
--
-- Unique: lookup is by digest, and two periods must never share one — a collision would make
-- one link open the other's period.
create unique index care_periods_token_digest_key on public.care_periods (token_digest);

-- Set by S-06's "revoke link" (FR-012); this slice only honours it. Nullable = active.
alter table public.care_periods add column revoked_at timestamptz;

comment on column public.care_periods.revoked_at is
  'When set, the invite link no longer resolves. Written by S-06; get_period_by_token honours it from S-02 on.';

-- 2. The caretaker door.
--
-- SECURITY DEFINER: the caller is anon, who has no identity for RLS to key on and no grant on
-- either table. This function body IS the entire authorization boundary for that role — there
-- is no policy behind it. Hence: exactly one period resolved by digest, no parameter that could
-- widen the result set, no instruction rows (FR-008's public/sensitive reveal is S-03's
-- guardrail), and no owner_id or token_digest in the payload.
--
-- Uniform failure is a security property, not a UX preference: unknown, malformed and revoked
-- tokens all return NULL. A distinct "this link was revoked" answer would confirm the period
-- exists. The page copy carries the "ask the owner for a new link" guidance the response
-- deliberately withholds.
create function public.get_period_by_token(p_token text)
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
  if p_token is null or p_token = '' then
    return null;
  end if;

  -- sha256() is core in Postgres 17 (supabase/config.toml) and Web Crypto gives the app the
  -- same value, so no extension is needed on either side. convert_to pins the encoding, so
  -- app and database genuinely agree byte for byte.
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
    ),
    'slots', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', s.id,
            'slot_date', s.slot_date,
            'time_of_day', s.time_of_day,
            -- Free/taken only. Who took it is S-04 (FR-006), and this payload is read by
            -- anyone holding the link.
            'is_claimed', s.claimed_by_name is not null
          )
          order by s.slot_date, s.time_of_day
        )
        from public.care_slots s
        where s.period_id = v_period.id
      ),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.get_period_by_token(text) is
  'The only anon-reachable surface in this schema. Resolves at most one active period from a raw invite token and returns it with its slots free/taken state. Returns NULL for unknown, malformed and revoked tokens alike.';

-- 3. Regeneration — the owner replaces the digest, which invalidates the previous link.
--
-- SECURITY INVOKER on purpose: the owner HAS an identity, so RLS decides whether they may
-- touch this row. Adding SECURITY DEFINER here to make a permission error go away is exactly
-- what docs/reference/data-access.md warns against.
--
-- revoked_at is deliberately left alone: un-revoking is S-06's decision, not a side effect
-- of minting a new link.
--
-- Returns the period id, not the row: a plpgsql function returning a composite answers a
-- miss with a row of NULLs, not NULL, so "nothing was regenerated" would arrive at the
-- caller as an object. A scalar keeps the miss honestly null. The caller has nothing else
-- to read from the row anyway — the raw token it hands back never came from the database.
create function public.regenerate_period_token(
  p_period_id uuid,
  p_token_digest text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_period_id uuid;
begin
  update public.care_periods
  set token_digest = p_token_digest
  where id = p_period_id
  returning id into v_period_id;

  -- Not found, or RLS filtered the row out: same answer either way, so a foreign period id
  -- is indistinguishable from a missing one.
  return v_period_id;
end;
$$;

comment on function public.regenerate_period_token(uuid, text) is
  'Replaces a period''s invite-token digest, invalidating the previous link. Returns the period id, or NULL when RLS filtered the row out or it does not exist.';

-- 4. Grants.
--
-- `revoke ... from public` alone is NOT enough on Supabase: ALTER DEFAULT PRIVILEGES grants
-- EXECUTE to anon, authenticated and service_role on every new function in `public`,
-- separately from the PUBLIC pseudo-role. The roles have to be named (see the previous
-- migration's header — this is the third time the same gap would have bitten).
--
-- get_period_by_token is the one function in this schema anon is MEANT to reach, so it is
-- granted back explicitly. authenticated gets it too: a signed-in owner opening their own
-- invite link must work.
revoke execute on function public.get_period_by_token(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_period_by_token(text) to anon, authenticated;

revoke execute on function public.regenerate_period_token(uuid, text)
  from public, anon, service_role;
grant execute on function public.regenerate_period_token(uuid, text) to authenticated;
