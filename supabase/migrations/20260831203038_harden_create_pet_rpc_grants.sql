-- Harden execute grants on create_pet_with_instructions to match the F-01 posture
-- (init_profiles_rls.sql revokes execute from public on its function). The function
-- is SECURITY INVOKER so RLS already blocks anon callers, but least-privilege means
-- only `authenticated` should hold the execute grant, not the default PUBLIC.
revoke execute on function public.create_pet_with_instructions(text, public.pet_species, text, text, jsonb) from public;

grant execute on function public.create_pet_with_instructions(text, public.pet_species, text, text, jsonb) to authenticated;
