-- S-03 Phase 1 impl-review F3: make the claim-digest index partial.
--
-- 20260907065515 created care_slots_period_claim_digest_idx over the whole table. Measured
-- on a freshly reset database: 198 of 198 care_slots rows carry claim_digest IS NULL, and
-- that ratio stays lopsided by design — a trip generates a slot for every day x time-of-day
-- and most of them are never claimed, so the index would be dominated by NULL entries
-- forever.
--
-- The only reader is Phase 3's get_claimed_details, which resolves "which slots does THIS
-- capability hold" and therefore always supplies a non-null digest. A digest is never looked
-- up as NULL, so excluding those rows costs nothing and the index stops carrying them.
--
-- DROP + CREATE rather than editing 20260907065515: that migration is already applied here
-- and, per the documented workflow, may already be pushed to a hosted project. Editing an
-- applied migration makes the two diverge silently.
drop index public.care_slots_period_claim_digest_idx;

create index care_slots_period_claim_digest_idx
  on public.care_slots (period_id, claim_digest)
  where claim_digest is not null;
