import { beforeAll, describe, expect, it } from "vitest";
import { POST as releaseSlot } from "@/pages/api/periods/[id]/slots/[slotId]/release";
import { createAuthenticatedOwnerWithPet } from "../helpers/session";
import { createAnonClient, type OwnerWithPetContext } from "../helpers/auth";
import { digestClaimSecret, digestInviteToken, generateClaimSecret, generateInviteToken } from "@/lib/invite-token";

// S-04 Phase 3 — the handler's own branches, which tests/rls/release-slot.test.ts cannot reach.
//
// Drives the REAL handler against the local stack with a genuine owner session (auth is never
// mocked). The RLS suite already proves the function; what is left here is the route's four
// answers — 401, 400, 404 and 200 — and in particular that the three DIFFERENT ways to miss all
// land on the same 404, since the whole point of release_slot's uniform NULL is lost if the
// route separates them again.

function createFakeCookies() {
  const store = new Map<string, string>();
  return {
    get(name: string) {
      const value = store.get(name);
      return value === undefined ? undefined : { value };
    },
    set(name: string, value: string) {
      store.set(name, value);
    },
    delete(name: string) {
      store.delete(name);
    },
    has(name: string) {
      return store.has(name);
    },
  };
}

interface CallResult {
  status: number;
  body: unknown;
}

type Handler = typeof releaseSlot;

async function call(init: {
  periodId: string;
  slotId: string;
  cookieHeader?: string;
  userId?: string;
}): Promise<CallResult> {
  const path = `/api/periods/${init.periodId}/slots/${init.slotId}/release`;
  const request = new Request(new URL(`http://127.0.0.1${path}`), {
    method: "POST",
    headers: {
      ...(init.cookieHeader === undefined ? {} : { Cookie: init.cookieHeader }),
      "Content-Type": "application/json",
    },
  });

  const context = {
    request,
    cookies: createFakeCookies(),
    params: { id: init.periodId, slotId: init.slotId },
    // A missing user is what the middleware leaves behind for an unauthenticated call — and
    // this path is NOT middleware-gated (PROTECTED_ROUTES matches "/periods", not
    // "/api/periods"), so the handler's own check is the only thing standing here.
    locals: { user: init.userId === undefined ? null : { id: init.userId } },
  };

  type Args = Parameters<Handler>;
  const response = await releaseSlot(context as unknown as Args[0]);
  const body: unknown = await response.json();
  return { status: response.status, body };
}

interface SlotRow {
  id: string;
  claimed_by_name: string | null;
  claimed_at: string | null;
  claim_digest: string | null;
}

describe("POST /api/periods/[id]/slots/[slotId]/release — the owner's release route", () => {
  const anon = createAnonClient();

  let cookieHeader: string;
  let owner: OwnerWithPetContext;

  let strangerCookieHeader: string;
  let stranger: OwnerWithPetContext;

  async function seedPeriod(
    forOwner: OwnerWithPetContext,
    title: string,
    start: string,
    end: string,
  ): Promise<{ id: string; token: string }> {
    const token = generateInviteToken();
    const { data, error } = await forOwner.client.rpc("create_period_with_slots", {
      p_title: title,
      p_start_date: start,
      p_end_date: end,
      p_token_digest: await digestInviteToken(token),
      p_pet_ids: [forOwner.petId],
    });
    expect(error).toBeNull();
    if (!data) {
      throw new Error(`release route test: seeding "${title}" failed`);
    }
    return { id: data.id, token };
  }

  async function slotsOf(forOwner: OwnerWithPetContext, periodId: string): Promise<SlotRow[]> {
    const { data, error } = await forOwner.client
      .from("care_slots")
      .select("id, claimed_by_name, claimed_at, claim_digest")
      .eq("period_id", periodId)
      .order("slot_date")
      .order("time_of_day");
    expect(error).toBeNull();
    return data ?? [];
  }

  // A period with `count` of its terms genuinely claimed through the anon door, so every
  // assertion below starts from a real claim rather than a hand-written row.
  async function seedClaimed(
    forOwner: OwnerWithPetContext,
    title: string,
    start: string,
    end: string,
    count = 1,
  ): Promise<{ id: string; token: string; slotIds: string[]; digest: string }> {
    const period = await seedPeriod(forOwner, title, start, end);
    const secret = generateClaimSecret();
    const digest = await digestClaimSecret(secret);

    const free = (await slotsOf(forOwner, period.id)).filter((slot) => slot.claimed_by_name === null);
    if (free.length < count) {
      throw new Error(`release route test: wanted ${count} free slots in "${title}", found ${free.length}`);
    }
    const slotIds = free.slice(0, count).map((slot) => slot.id);

    const { error } = await anon.rpc("claim_slots", {
      p_token: period.token,
      p_slot_ids: slotIds,
      p_claim_secret: secret,
      p_name: "Ania",
    });
    expect(error).toBeNull();

    return { ...period, slotIds, digest };
  }

  beforeAll(async () => {
    const authed = await createAuthenticatedOwnerWithPet();
    cookieHeader = authed.cookieHeader;
    owner = authed.owner;

    const other = await createAuthenticatedOwnerWithPet();
    strangerCookieHeader = other.cookieHeader;
    stranger = other.owner;
  });

  it("refuses an unauthenticated call (401) and frees nothing", async () => {
    const claimed = await seedClaimed(owner, "R-bez-sesji", "2027-05-01", "2027-05-02");

    const { status } = await call({ periodId: claimed.id, slotId: claimed.slotIds[0] });

    expect(status).toBe(401);

    const slot = (await slotsOf(owner, claimed.id)).find((row) => row.id === claimed.slotIds[0]);
    expect(slot?.claimed_by_name).toBe("Ania");
  });

  it("rejects a non-uuid period id (400)", async () => {
    const { status } = await call({
      periodId: "nope",
      slotId: crypto.randomUUID(),
      cookieHeader,
      userId: owner.userId,
    });

    expect(status).toBe(400);
  });

  it("rejects a non-uuid slot id (400)", async () => {
    // The second param is validated too. Without this the slot id would reach Postgres, raise
    // 22P02, and answer 500 — telling a prober that its period id was at least well-formed.
    const { status } = await call({
      periodId: crypto.randomUUID(),
      slotId: "nope",
      cookieHeader,
      userId: owner.userId,
    });

    expect(status).toBe(400);
  });

  // The three misses. Same status, same body — that uniformity is the assertion, not an
  // incidental. release_slot answers NULL for all three, and a route that separated them would
  // hand a prober an oracle for "this slot exists but is not yours".
  describe("the misses all answer 404", () => {
    it("another owner's claimed slot — and leaves it claimed", async () => {
      const theirs = await seedClaimed(stranger, "R-cudze", "2027-05-10", "2027-05-11");

      const { status } = await call({
        periodId: theirs.id,
        slotId: theirs.slotIds[0],
        cookieHeader,
        userId: owner.userId,
      });

      expect(status).toBe(404);

      const slot = (await slotsOf(stranger, theirs.id)).find((row) => row.id === theirs.slotIds[0]);
      expect(slot?.claimed_by_name).toBe("Ania");
      expect(slot?.claim_digest).toBe(theirs.digest);
    });

    it("a slot that does not exist", async () => {
      const claimed = await seedClaimed(owner, "R-nie-ma-takiego", "2027-05-15", "2027-05-16");

      const { status } = await call({
        periodId: claimed.id,
        slotId: crypto.randomUUID(),
        cookieHeader,
        userId: owner.userId,
      });

      expect(status).toBe(404);
    });

    it("a term that is already free", async () => {
      const period = await seedPeriod(owner, "R-juz-wolne", "2027-05-20", "2027-05-21");
      const [free] = await slotsOf(owner, period.id);

      const { status } = await call({
        periodId: period.id,
        slotId: free.id,
        cookieHeader,
        userId: owner.userId,
      });

      expect(status).toBe(404);
    });

    it("a slot from another period of the SAME owner", async () => {
      // RLS permits this write — both periods are the caller's — so only release_slot's
      // `period_id = p_period_id` predicate stops it. This is the route-level proof that the
      // URL and the guard agree about which trip a slot belongs to.
      const one = await seedClaimed(owner, "R-wyjazd-jeden", "2027-06-01", "2027-06-02");
      const two = await seedClaimed(owner, "R-wyjazd-dwa", "2027-06-10", "2027-06-11");

      const { status } = await call({
        periodId: one.id,
        slotId: two.slotIds[0],
        cookieHeader,
        userId: owner.userId,
      });

      expect(status).toBe(404);

      const slot = (await slotsOf(owner, two.id)).find((row) => row.id === two.slotIds[0]);
      expect(slot?.claimed_by_name).toBe("Ania");
    });
  });

  it("frees the term and says which one (200)", async () => {
    const claimed = await seedClaimed(owner, "R-zwolnij", "2027-06-20", "2027-06-22", 2);
    const [target, keep] = claimed.slotIds;

    const { status, body } = await call({
      periodId: claimed.id,
      slotId: target,
      cookieHeader,
      userId: owner.userId,
    });

    expect(status).toBe(200);
    expect(body).toEqual({ slotId: target });

    // Read the row back as the owner rather than trusting the response: the body is the
    // route's account of what it did.
    const rows = await slotsOf(owner, claimed.id);
    const freed = rows.find((row) => row.id === target);
    expect(freed?.claimed_by_name).toBeNull();
    expect(freed?.claimed_at).toBeNull();
    expect(freed?.claim_digest).toBeNull();

    // Scoped to the one term: the caretaker's other slot is untouched.
    expect(rows.find((row) => row.id === keep)?.claimed_by_name).toBe("Ania");
  });

  it("answers 404 rather than 200 when the same term is released twice", async () => {
    // What a double-submit or a stale second tab actually produces. The second call must not
    // report success for work it did not do.
    const claimed = await seedClaimed(owner, "R-dwa-razy", "2027-07-01", "2027-07-02");
    const target = claimed.slotIds[0];
    const args = { periodId: claimed.id, slotId: target, cookieHeader, userId: owner.userId };

    expect((await call(args)).status).toBe(200);
    expect((await call(args)).status).toBe(404);
  });

  it("leaves the freed term claimable again through the invite link", async () => {
    const claimed = await seedClaimed(owner, "R-znowu-wolne", "2027-07-10", "2027-07-11");
    const target = claimed.slotIds[0];

    expect((await call({ periodId: claimed.id, slotId: target, cookieHeader, userId: owner.userId })).status).toBe(200);

    const secret = generateClaimSecret();
    const { error } = await anon.rpc("claim_slots", {
      p_token: claimed.token,
      p_slot_ids: [target],
      p_claim_secret: secret,
      p_name: "Basia",
    });

    expect(error).toBeNull();
    const slot = (await slotsOf(owner, claimed.id)).find((row) => row.id === target);
    expect(slot?.claimed_by_name).toBe("Basia");
  });

  it("lets the other owner release their OWN term (200) — so the 404s above cannot pass for the wrong reason", async () => {
    // The inverse of the IDOR case: the stranger's OWN period, released with the stranger's
    // session, must work — otherwise the 404 above would pass for the wrong reason (a broken
    // route rather than an enforced boundary).
    const theirs = await seedClaimed(stranger, "R-wlasne", "2027-07-20", "2027-07-21");

    const { status } = await call({
      periodId: theirs.id,
      slotId: theirs.slotIds[0],
      cookieHeader: strangerCookieHeader,
      userId: stranger.userId,
    });

    expect(status).toBe(200);
  });
});
