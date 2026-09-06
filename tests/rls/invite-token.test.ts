import { beforeAll, describe, expect, it } from "vitest";
import { digestInviteToken, generateInviteToken } from "@/lib/invite-token";
import { createAnonClient, createOwnerClient, type OwnerContext } from "../helpers/auth";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

// Risk #5 — the link-only path must grant exactly its scope and nothing more (S-02).
//
// get_period_by_token is SECURITY DEFINER and bypasses RLS by design, so the §6.5 isolation
// recipe does not reach it: there is no policy behind the function to catch a mistake in its
// body. These assertions are its only automated guard.
//
// Every call here goes through createAnonClient() — a client with no session, carrying the
// `anon` role, which is what a caretaker following a link actually is.

interface TokenPayload {
  period: { id: string; title: string; start_date: string; end_date: string };
  slots: { id: string; slot_date: string; time_of_day: string; is_claimed: boolean }[];
}

describe("invite token access model", () => {
  let anon: SupabaseClient<Database>;
  let a: OwnerContext;
  let b: OwnerContext;

  let aToken: string;
  let aPeriodId: string;
  let bToken: string;
  let bPeriodId: string;
  let revokedToken: string;

  async function seedPeriod(
    owner: OwnerContext,
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
    });
    expect(error).toBeNull();
    if (!data) {
      throw new Error(`invite-token test: seeding "${title}" failed`);
    }
    return { id: data.id, token };
  }

  async function resolve(token: string): Promise<TokenPayload | null> {
    const { data, error } = await anon.rpc("get_period_by_token", { p_token: token });
    expect(error).toBeNull();
    return data as TokenPayload | null;
  }

  beforeAll(async () => {
    anon = createAnonClient();
    a = await createOwnerClient();
    b = await createOwnerClient();

    // 3 days x 3 times of day = 9 slots.
    ({ id: aPeriodId, token: aToken } = await seedPeriod(a, "A-wyjazd", "2026-07-13", "2026-07-15"));
    ({ id: bPeriodId, token: bToken } = await seedPeriod(b, "B-wyjazd", "2026-08-01", "2026-08-03"));

    const revoked = await seedPeriod(a, "A-odwolany", "2026-09-01", "2026-09-02");
    revokedToken = revoked.token;
    const { error } = await a.client
      .from("care_periods")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", revoked.id);
    expect(error).toBeNull();
  });

  it("resolves exactly one period — the right one — for a valid token", async () => {
    const payload = await resolve(aToken);

    expect(payload?.period.id).toBe(aPeriodId);
    expect(payload?.period.title).toBe("A-wyjazd");
    expect(payload?.period.start_date).toBe("2026-07-13");
    expect(payload?.period.end_date).toBe("2026-07-15");
    expect(payload?.slots).toHaveLength(9);
    // Every slot starts free — claiming is S-03.
    expect(payload?.slots.map((slot) => slot.is_claimed)).toEqual(Array<boolean>(9).fill(false));
  });

  it("never returns another owner's period for a token", async () => {
    const payload = await resolve(bToken);

    expect(payload?.period.id).toBe(bPeriodId);
    expect(payload?.period.id).not.toBe(aPeriodId);
  });

  it("returns nothing for a revoked period", async () => {
    await expect(resolve(revokedToken)).resolves.toBeNull();
  });

  it("fails uniformly for unknown, tampered, malformed and empty tokens", async () => {
    // One character changed — the digest is a different value entirely.
    const tampered = aToken.slice(0, -1) + (aToken.endsWith("A") ? "B" : "A");

    const outcomes = await Promise.all([
      resolve(generateInviteToken()),
      resolve(tampered),
      resolve("not a token at all"),
      resolve(""),
      resolve(revokedToken),
    ]);

    // The revoked case is in the same list on purpose: a distinct answer for it would confirm
    // the period exists, which is exactly what the model must not leak.
    expect(outcomes).toEqual([null, null, null, null, null]);
  });

  it("carries no instruction rows in the payload", async () => {
    const payload = await resolve(aToken);

    expect(Object.keys(payload ?? {}).sort()).toEqual(["period", "slots"]);
    // Nor the owner identity or the digest the link is compared against.
    expect(Object.keys(payload?.period ?? {}).sort()).toEqual(["end_date", "id", "start_date", "title"]);
    expect(JSON.stringify(payload)).not.toContain("instruction");
  });

  it("is the only door — anon cannot select either table directly", async () => {
    const periods = await anon.from("care_periods").select("id");
    const slots = await anon.from("care_slots").select("id");

    // anon holds no grant on either table, so this is refused outright rather than merely
    // filtered to zero rows. Either way, no row may come back.
    expect(periods.data ?? []).toEqual([]);
    expect(slots.data ?? []).toEqual([]);
  });

  it("regeneration invalidates the old link and activates the new one", async () => {
    const nextToken = generateInviteToken();
    const { data, error } = await a.client.rpc("regenerate_period_token", {
      p_period_id: aPeriodId,
      p_token_digest: await digestInviteToken(nextToken),
    });

    expect(error).toBeNull();
    expect(data).toBe(aPeriodId);

    await expect(resolve(aToken)).resolves.toBeNull();
    const payload = await resolve(nextToken);
    expect(payload?.period.id).toBe(aPeriodId);

    aToken = nextToken;
  });

  it("regeneration cannot touch another owner's period", async () => {
    const stolen = generateInviteToken();
    const { data, error } = await a.client.rpc("regenerate_period_token", {
      p_period_id: bPeriodId,
      p_token_digest: await digestInviteToken(stolen),
    });

    // RLS filters the row out, so the update matches nothing — indistinguishable from a
    // period id that does not exist.
    expect(error).toBeNull();
    expect(data).toBeNull();
    await expect(resolve(stolen)).resolves.toBeNull();
    // B's link still works.
    const payload = await resolve(bToken);
    expect(payload?.period.id).toBe(bPeriodId);
  });
});
