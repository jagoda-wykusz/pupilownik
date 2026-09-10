import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { digestInviteToken, generateInviteToken } from "@/lib/invite-token";
import { createAnonClient, createOwnerWithPet, type OwnerWithPetContext } from "../helpers/auth";
import { getTestEnv } from "../setup";
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

interface TokenInstruction {
  id: string;
  title: string;
  body: string | null;
  sort_order: number;
}
interface TokenPet {
  id: string;
  name: string;
  species: string;
  instructions: TokenInstruction[];
}
interface TokenPayload {
  period: { id: string; title: string; start_date: string; end_date: string };
  slots: { id: string; slot_date: string; time_of_day: string; is_claimed: boolean }[];
  pets: TokenPet[];
}

describe("invite token access model", () => {
  let anon: SupabaseClient<Database>;
  let a: OwnerWithPetContext;
  let b: OwnerWithPetContext;

  let aToken: string;
  let aPeriodId: string;
  let bToken: string;
  let bPeriodId: string;
  let revokedToken: string;
  let revokedPeriodId: string;

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
    a = await createOwnerWithPet("A-Burek");
    b = await createOwnerWithPet("B-Mru");

    // 3 days x 3 times of day = 9 slots.
    ({ id: aPeriodId, token: aToken } = await seedPeriod(a, "A-wyjazd", "2026-07-13", "2026-07-15"));
    ({ id: bPeriodId, token: bToken } = await seedPeriod(b, "B-wyjazd", "2026-08-01", "2026-08-03"));

    const revoked = await seedPeriod(a, "A-odwolany", "2026-09-01", "2026-09-02");
    revokedToken = revoked.token;
    revokedPeriodId = revoked.id;
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

  it("carries exactly the three top-level keys, and no caretaker identity", async () => {
    const payload = await resolve(aToken);

    // `pets` joined in S-03 Phase 3. The assertion stays an EXACT key set rather than a
    // subset check: this payload is read by anyone holding the link, so a new key must be a
    // deliberate edit here, never a silent widening.
    expect(Object.keys(payload ?? {}).sort()).toEqual(["period", "pets", "slots"]);
    // Not the owner identity, not the digest the link is compared against — and not
    // caretaker_note, which is sensitive tier and belongs to get_claimed_details.
    expect(Object.keys(payload?.period ?? {}).sort()).toEqual(["end_date", "id", "start_date", "title"]);
    // The SLOT keys matter most: adding `claimed_by_name` to the function's
    // jsonb_build_object is the likeliest leak in this whole payload — a caretaker's identity
    // belongs to S-04 (FR-006), and anyone holding the link can read this. Pinning the exact
    // key set makes that a failing test rather than a silent widening.
    expect(Object.keys(payload?.slots[0] ?? {}).sort()).toEqual(["id", "is_claimed", "slot_date", "time_of_day"]);
    // Named exactly, not by substring: `is_claimed` is a legitimate key and a `not.toContain
    // ("claim")` assertion fails on it. These two are the columns that must never travel.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("claimed_by_name");
    expect(serialized).not.toContain("claim_digest");
    expect(serialized).not.toContain("caretaker_note");
    expect(serialized).not.toContain("token_digest");
    expect(serialized).not.toContain("owner_id");
  });

  it("is the only door — anon cannot select either table directly", async () => {
    const periods = await anon.from("care_periods").select("id");
    const slots = await anon.from("care_slots").select("id");
    // care_period_pets joined the schema in S-08 with the same revoke; without this line
    // removing that revoke would leave every test passing, since deny-by-default RLS
    // returns zero rows either way (context/foundation/lessons.md).
    const links = await anon.from("care_period_pets").select("period_id");

    // Assert the REFUSAL, not merely the absence of rows. `expect(data ?? []).toEqual([])`
    // alone cannot tell the two layers apart: with the grant revoked PostgREST answers 42501
    // and data is null; with it restored, RLS filters to zero rows and data is [] — and that
    // assertion passes either way. The grant layer is the one this slice deliberately added
    // on top of deny-by-default, so it needs an assertion that fails when it disappears.
    expect(periods.error?.code).toBe("42501");
    expect(slots.error?.code).toBe("42501");
    expect(links.error?.code).toBe("42501");
    expect(periods.data).toBeNull();
    expect(slots.data).toBeNull();
    expect(links.data).toBeNull();
  });

  // The READ door's own grant posture. Every other assertion in this file calls it through
  // createAnonClient(), so `anon` EXECUTE is covered behaviourally — a 42501 would break them
  // all. The other two roles were covered by nothing until S-03 Phase 3's review (F2) pointed
  // out that 20260907180022's comment claims this file "asserts that back": it asserted a
  // third of it. `authenticated` matters concretely — src/pages/invite/[token].astro runs as
  // that role whenever a signed-in owner opens their own link — and `service_role` matters
  // because Supabase's ALTER DEFAULT PRIVILEGES grants it EXECUTE on every new function in
  // `public`, so only the explicit revoke keeps it out.
  //
  // This also guards something no other assertion does: `create or replace` preserves grants
  // only while the signature is unchanged. Phase 3 replaced this function's body. If a later
  // change alters its argument list without re-issuing the revoke/grant pair, the replacement
  // inherits the default privileges instead — and service_role silently regains EXECUTE.
  it("the read door is executable by anon and authenticated, and refused to service_role", async () => {
    const asOwner = await a.client.rpc("get_period_by_token", { p_token: aToken });
    expect(asOwner.error).toBeNull();
    expect((asOwner.data as TokenPayload | null)?.period.id).toBe(aPeriodId);

    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!serviceKey) {
      throw new Error("SUPABASE_SERVICE_KEY must be set in .env.test (see .env.test.example).");
    }
    const service = createClient<Database>(getTestEnv().url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const asService = await service.rpc("get_period_by_token", { p_token: aToken });

    // The refusal, not the absence of a payload: without the revoke this would resolve the
    // period happily, and an assertion on `data` alone would pass either way.
    expect(asService.error?.code).toBe("42501");
  });

  // The two SECURITY INVOKER RPCs are owner-only. Their revoke/grant posture is the exact
  // thing this project got wrong twice before (S-01's F3 was closed as fixed while describing
  // a posture the database did not have), and nothing asserted it until now. RLS would stop
  // anon one step later anyway — this closes the door instead of trusting the lock behind it.
  it("anon cannot execute the owner-only RPCs", async () => {
    const create = await anon.rpc("create_period_with_slots", {
      p_title: "nope",
      p_start_date: "2026-07-13",
      p_end_date: "2026-07-15",
      p_token_digest: "deadbeef",
      // Must match the current signature exactly — a stale argument list would fail with a
      // "function does not exist" error and the test would pass for the wrong reason.
      p_pet_ids: [aPeriodId],
    });
    expect(create.error?.code).toBe("42501");

    const regenerate = await anon.rpc("regenerate_period_token", {
      p_period_id: aPeriodId,
      p_token_digest: "deadbeef",
    });
    expect(regenerate.error?.code).toBe("42501");
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

  it("regeneration refuses a REVOKED period and leaves its digest alone", async () => {
    // S-06 Phase 1. Revocation is irreversible by decision, so a token minted for a revoked
    // period would be dead on arrival: get_period_by_token filters on `revoked_at is null` and
    // regenerate_period_token deliberately never touches that column. Until S-06 the refusal
    // lived only in RegenerateLinkButton's `revoked` prop — the API answered 200 and handed
    // back a permanently dead link the panel calls "gotowy do wysłania". The predicate now
    // sits in the function, where calling the route directly cannot get past it.
    //
    // This is also the assertion that would notice Fix B being reintroduced (clearing
    // revoked_at on regenerate), which the phase-3 impl-review of
    // 2026-09-06-care-period-and-invite-link rejected outright.
    const before = await a.client.from("care_periods").select("token_digest").eq("id", revokedPeriodId).single();
    expect(before.error).toBeNull();

    const replacement = generateInviteToken();
    const { data, error } = await a.client.rpc("regenerate_period_token", {
      p_period_id: revokedPeriodId,
      p_token_digest: await digestInviteToken(replacement),
    });

    // The third reason for NULL, indistinguishable from "not yours" and "does not exist" —
    // token.ts answers one 404 for all three and must not re-separate them.
    expect(error).toBeNull();
    expect(data).toBeNull();

    // Nothing was written: the old digest stands, so the owner did not silently lose the
    // record of which link was revoked.
    const after = await a.client.from("care_periods").select("token_digest").eq("id", revokedPeriodId).single();
    expect(after.error).toBeNull();
    expect(after.data?.token_digest).toBe(before.data?.token_digest);

    // And the would-be replacement resolves to nothing, which is the whole reason to refuse.
    await expect(resolve(replacement)).resolves.toBeNull();
  });
});
