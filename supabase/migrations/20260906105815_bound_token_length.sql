-- S-02 impl-review F8: bound the token length before hashing it.
--
-- get_period_by_token is SECURITY DEFINER, granted to anon, and reachable with no
-- authentication at all. Without a length bound, a caller can post a multi-megabyte p_token
-- and make the database convert_to + sha256 all of it before the guaranteed index miss. A
-- valid token is exactly 43 characters (32 bytes, base64url, unpadded — see
-- src/lib/invite-token.ts), so anything else is pure waste.
--
-- The guard also flattens any input-size-dependent timing, and it stays inside the
-- uniform-failure contract: the answer for a wrong-length token is NULL, exactly as it is
-- for an unknown, malformed or revoked one.
--
-- CREATE OR REPLACE preserves the existing grants, so the revoke/grant pair from
-- 20260906003122 still stands.
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
    ),
    'slots', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', s.id,
            'slot_date', s.slot_date,
            'time_of_day', s.time_of_day,
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
