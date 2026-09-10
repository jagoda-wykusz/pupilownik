import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { digestInviteToken, generateInviteToken } from "@/lib/invite-token";
import { createAnonClient, createOwnerWithPet, type OwnerWithPetContext } from "../helpers/auth";
import { getTestEnv } from "../setup";
import type { Database } from "@/db/database.types";

// S-06 Phase 1 — `revoke_period`, the owner's one-way end to a trip's invite link.
//
// Like release_slot this function is SECURITY INVOKER, so `care_periods_update_own` is the
// authorization boundary and the body is only a guard. That split is what these assertions
// cover from both sides: the policy must refuse another owner's period, and the grant layer
// must refuse anon and service_role outright.
//
// The third thing asserted here has no counterpart in release_slot: the write is WRITE-ONCE.
// `revoked_at is null` in the WHERE is the only thing making a second revoke a no-op, and it
// is also what keeps the original timestamp — "when was this trip called off" — answerable.
//
// Every "what actually landed" check reads the row back through the OWNING owner's client, and
// the effect check goes through the anon door. The function's return value is its own account
// of what it did, and a test that only read that would pass against a function that wrote
// nothing.

interface PeriodRow {
  id: string;
  title: string;
  revoked_at: string | null;
}

const PERIOD_COLUMNS = "id, title, revoked_at";

describe("revoke_period — the owner's revoke door", () => {
  let anon: SupabaseClient<Database>;
  let a: OwnerWithPetContext;
  let b: OwnerWithPetContext;

  async function seedPeriod(
    owner: OwnerWithPetContext,
    title: string,
    start: string,
    end: string,
  ): Promise<{ id: string; token: string }> {
    const token = generateInviteToken();
    const { data, error } = await owner.client.rpc("create_period_with_slots", {
      p_title: title,
      p_start_date: start,
      p_end_date: end,
      p_token_digest: await digestInviteToken(token),
      p_pet_ids: [owner.petId],
    });
    expect(error).toBeNull();
    if (!data) {
      throw new Error(`revoke-period test: seeding "${title}" failed`);
    }
    return { id: data.id, token };
  }

  async function periodOf(owner: OwnerWithPetContext, periodId: string): Promise<PeriodRow | undefined> {
    const { data, error } = await owner.client.from("care_periods").select(PERIOD_COLUMNS).eq("id", periodId);
    expect(error).toBeNull();
    return (data ?? [])[0];
  }

  async function resolves(token: string): Promise<boolean> {
    const { data, error } = await anon.rpc("get_period_by_token", { p_token: token });
    expect(error).toBeNull();
    return data !== null;
  }

  function revoke(client: SupabaseClient<Database>, periodId: string) {
    return client.rpc("revoke_period", { p_period_id: periodId });
  }

  beforeAll(async () => {
    anon = createAnonClient();
    a = await createOwnerWithPet("A-Burek");
    b = await createOwnerWithPet("B-Mru");
  });

  // ── 1. Grant posture ────────────────────────────────────────────────────────────────────
  //
  // Asserted from BOTH directions: the owner gets past the permission check, anon and
  // service_role do not. The refusals assert SQLSTATE 42501 rather than an empty result,
  // because a NULL return is also what a permitted-but-unmatched call answers — an assertion
  // on the absence of an effect would keep passing with the whole grant layer removed, which
  // is the anti-pattern context/foundation/lessons.md records.
  describe("grant posture", () => {
    it("an authenticated owner may execute it — this is the owner's door", async () => {
      // A valid-shaped but unknown id: the function returns NULL from its own body, which
      // proves execution was permitted. A 42501 here means authenticated lost EXECUTE.
      const { data, error } = await revoke(a.client, crypto.randomUUID());

      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    it("anon may NOT execute it — a caretaker cannot end anyone's trip", async () => {
      const period = await seedPeriod(a, "A-anon-nie-moze", "2027-05-05", "2027-05-06");

      const { error } = await revoke(anon, period.id);

      // The MESSAGE, not just the SQLSTATE. anon holds no UPDATE grant on care_periods either
      // (read from the catalog: has_table_privilege('anon','public.care_periods','update') is
      // false, and pg_attribute.attacl is NULL for revoked_at), so granting EXECUTE back to
      // anon moves the identical 42501 one layer inward and a code-only assertion keeps
      // passing with the function grant fully widened. Measured, not reasoned: under
      // `grant execute on function public.revoke_period(uuid) to anon` this suite went
      // 6/7 — the ONLY failure was this line, with 'permission denied for table care_periods'
      // arriving in place of the function's own refusal. Naming the function is what makes
      // this a test of the grant rather than a description of it
      // (context/foundation/lessons.md).
      expect(error?.code).toBe("42501");
      expect(error?.message).toContain("function revoke_period");

      // And the link still works: the refusal happened before the body ran.
      await expect(resolves(period.token)).resolves.toBe(true);
      expect((await periodOf(a, period.id))?.revoked_at).toBeNull();
    });

    it("service_role may NOT execute it", async () => {
      const serviceKey = process.env.SUPABASE_SERVICE_KEY;
      if (!serviceKey) {
        throw new Error("SUPABASE_SERVICE_KEY must be set in .env.test (see .env.test.example).");
      }
      const service = createClient<Database>(getTestEnv().url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { error } = await revoke(service, crypto.randomUUID());

      // Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to service_role on every new
      // function in `public`, so this passes only while the migration's explicit revoke stands.
      expect(error?.code).toBe("42501");
    });
  });

  // ── 2. The revocation itself ────────────────────────────────────────────────────────────
  describe("revoking", () => {
    it("stamps revoked_at on the owner's own period and kills the link", async () => {
      const period = await seedPeriod(a, "A-odwolaj", "2027-06-01", "2027-06-03");
      await expect(resolves(period.token)).resolves.toBe(true);

      const { data, error } = await revoke(a.client, period.id);

      expect(error).toBeNull();
      expect(data).toBe(period.id);

      // Read back from the table, not from the return value.
      expect((await periodOf(a, period.id))?.revoked_at).not.toBeNull();

      // The effect that matters to the caretaker, through the door they actually use. This is
      // what makes the test cover the FEATURE and not just the column write: the three anon
      // doors share one `revoked_at is null` predicate, so killing the read door is the
      // observable half of closing all three.
      await expect(resolves(period.token)).resolves.toBe(false);
    });

    it("answers NULL on a second revoke and preserves the ORIGINAL timestamp", async () => {
      const period = await seedPeriod(a, "A-dwa-razy", "2027-06-10", "2027-06-11");

      expect((await revoke(a.client, period.id)).data).toBe(period.id);
      const first = (await periodOf(a, period.id))?.revoked_at;
      expect(first).not.toBeNull();

      const { data, error } = await revoke(a.client, period.id);

      // `revoked_at is null` in the WHERE turns the second call into a no-op that reports
      // itself honestly, rather than an error the route would have to classify.
      expect(error).toBeNull();
      expect(data).toBeNull();

      // And the write really is once-only: without the predicate this would be a fresh now(),
      // silently moving the answer to "when was this trip called off".
      expect((await periodOf(a, period.id))?.revoked_at).toBe(first);
    });

    it("answers NULL for another owner's period and leaves their link live", async () => {
      const theirs = await seedPeriod(b, "B-cudze", "2027-07-01", "2027-07-02");

      const { data, error } = await revoke(a.client, theirs.id);

      // care_periods_update_own filtered the row out. Same NULL as "already revoked" — A
      // learns nothing about whether B's period exists.
      expect(error).toBeNull();
      expect(data).toBeNull();

      expect((await periodOf(b, theirs.id))?.revoked_at).toBeNull();
      await expect(resolves(theirs.token)).resolves.toBe(true);
    });

    it("answers NULL for a period id that does not exist", async () => {
      const { data, error } = await revoke(a.client, crypto.randomUUID());

      // Indistinguishable from "not yours", by design: the route collapses both into one 404.
      expect(error).toBeNull();
      expect(data).toBeNull();
    });
  });
});
