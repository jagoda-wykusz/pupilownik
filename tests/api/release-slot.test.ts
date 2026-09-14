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

// The route's own origin. Every call below sends a matching Origin by default, because a
// browser always sends one and the handler refuses a mismatch — the cross-site case has its own
// test and overrides it.
const ROUTE_ORIGIN = "http://127.0.0.1";

// A well-formed token that matches no stored row. The right default for every case whose
// expected answer is a miss: those rows are either invisible or already free, so no real token
// exists to send, and hard-coding one keeps the misses from accidentally depending on a read.
const STALE_CLAIMED_AT = "2000-01-01T00:00:00+00:00";

async function call(init: {
  periodId: string;
  slotId: string;
  cookieHeader?: string;
  userId?: string;
  /** The optimistic-concurrency token. Defaults to one that matches nothing. */
  expectedClaimedAt?: string | null;
  /** Replaces the whole serialized body — for the malformed-input cases. */
  rawBody?: string;
  /** Overrides the Origin header; `null` omits it entirely. */
  origin?: string | null;
}): Promise<CallResult> {
  const path = `/api/periods/${init.periodId}/slots/${init.slotId}/release`;
  const url = new URL(`${ROUTE_ORIGIN}${path}`);
  const origin = init.origin === undefined ? ROUTE_ORIGIN : init.origin;
  const request = new Request(url, {
    method: "POST",
    headers: {
      ...(init.cookieHeader === undefined ? {} : { Cookie: init.cookieHeader }),
      ...(origin === null ? {} : { Origin: origin }),
      "Content-Type": "application/json",
    },
    body:
      init.rawBody ??
      JSON.stringify({
        expected_claimed_at: init.expectedClaimedAt === undefined ? STALE_CLAIMED_AT : init.expectedClaimedAt,
      }),
  });

  const context = {
    request,
    // The handler reads `context.url.origin` for its CSRF check, so the fake context has to
    // carry one. Astro populates this; without it the route throws instead of answering.
    url,
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

  // The token a rendered page would hold for one claimed term, read back from the table.
  async function claimedAtOf(forOwner: OwnerWithPetContext, periodId: string, slotId: string): Promise<string> {
    const row = (await slotsOf(forOwner, periodId)).find((slot) => slot.id === slotId);
    if (row?.claimed_at == null) {
      throw new Error("release route test: wanted a claimed slot, found no claimed_at");
    }
    return row.claimed_at;
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
    it("gives all four misses the same status AND the same body", async () => {
      // The four cases above each assert a status. A status alone is not the property: if the
      // bodies differ, a prober learns which KIND of miss they hit — "not yours" versus "already
      // free" tells them the slot exists and is someone's. release_slot answers one uniform NULL
      // precisely so the route cannot leak that distinction, and this is the only assertion that
      // would notice the route inventing it again. Mirrors tests/api/revoke-period.test.ts.
      const theirs = await seedClaimed(stranger, "R-jednolitosc-cudze", "2027-07-01", "2027-07-02");
      const mine = await seedClaimed(owner, "R-jednolitosc-moje", "2027-07-05", "2027-07-06");
      const other = await seedClaimed(owner, "R-jednolitosc-inny", "2027-07-10", "2027-07-11");
      const freePeriod = await seedPeriod(owner, "R-jednolitosc-wolne", "2027-07-15", "2027-07-16");
      const [stillFree] = await slotsOf(owner, freePeriod.id);

      const notYours = await call({
        periodId: theirs.id,
        slotId: theirs.slotIds[0],
        cookieHeader,
        userId: owner.userId,
      });
      const missing = await call({
        periodId: mine.id,
        slotId: crypto.randomUUID(),
        cookieHeader,
        userId: owner.userId,
      });
      const alreadyFree = await call({
        periodId: freePeriod.id,
        slotId: stillFree.id,
        cookieHeader,
        userId: owner.userId,
      });
      const wrongPeriod = await call({
        periodId: mine.id,
        slotId: other.slotIds[0],
        cookieHeader,
        userId: owner.userId,
      });

      expect(notYours.status).toBe(404);
      expect(missing).toEqual(notYours);
      expect(alreadyFree).toEqual(notYours);
      expect(wrongPeriod).toEqual(notYours);
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
      expectedClaimedAt: await claimedAtOf(owner, claimed.id, target),
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
    // The token is captured ONCE and replayed, which is what a double-submit or a stale second
    // tab actually sends. The second call finds the term free — not re-claimed — so it is a 404
    // and not the 409 the optimistic guard raises.
    const args = {
      periodId: claimed.id,
      slotId: target,
      cookieHeader,
      userId: owner.userId,
      expectedClaimedAt: await claimedAtOf(owner, claimed.id, target),
    };

    expect((await call(args)).status).toBe(200);
    expect((await call(args)).status).toBe(404);
  });

  it("leaves the freed term claimable again through the invite link", async () => {
    const claimed = await seedClaimed(owner, "R-znowu-wolne", "2027-07-10", "2027-07-11");
    const target = claimed.slotIds[0];

    expect(
      (
        await call({
          periodId: claimed.id,
          slotId: target,
          cookieHeader,
          userId: owner.userId,
          expectedClaimedAt: await claimedAtOf(owner, claimed.id, target),
        })
      ).status,
    ).toBe(200);

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
      expectedClaimedAt: await claimedAtOf(stranger, theirs.id, theirs.slotIds[0]),
    });

    expect(status).toBe(200);
  });

  // The CSRF cover this route used to get for free. Astro's origin middleware only inspects a
  // non-safe request carrying NO Content-Type, and this route now reads a JSON body — so the
  // framework contributes nothing and the handler's own check is the only thing standing here.
  describe("origin", () => {
    it("refuses a cross-site POST (403) and frees nothing", async () => {
      const claimed = await seedClaimed(owner, "R-obce-zrodlo", "2027-08-01", "2027-08-02");
      const target = claimed.slotIds[0];

      const { status } = await call({
        periodId: claimed.id,
        slotId: target,
        cookieHeader,
        userId: owner.userId,
        expectedClaimedAt: await claimedAtOf(owner, claimed.id, target),
        origin: "https://evil.example",
      });

      expect(status).toBe(403);

      // The refusal must come BEFORE the write, not as a status painted over one. A valid
      // session and a CORRECT token are supplied deliberately, so this call would otherwise
      // have succeeded — without them the assertion below would pass on its own.
      const slot = (await slotsOf(owner, claimed.id)).find((row) => row.id === target);
      expect(slot?.claimed_by_name).toBe("Ania");
    });

    it("refuses an opaque origin (403)", async () => {
      // A sandboxed iframe sends the literal string "null", which has to fail the equality like
      // any other mismatch rather than being read as "no Origin header at all".
      const claimed = await seedClaimed(owner, "R-origin-null", "2027-08-05", "2027-08-06");

      const { status } = await call({
        periodId: claimed.id,
        slotId: claimed.slotIds[0],
        cookieHeader,
        userId: owner.userId,
        origin: "null",
      });

      expect(status).toBe(403);
    });

    it("allows an ABSENT origin — non-browser callers omit it entirely", async () => {
      const claimed = await seedClaimed(owner, "R-origin-brak", "2027-08-10", "2027-08-11");
      const target = claimed.slotIds[0];

      const { status } = await call({
        periodId: claimed.id,
        slotId: target,
        cookieHeader,
        userId: owner.userId,
        expectedClaimedAt: await claimedAtOf(owner, claimed.id, target),
        origin: null,
      });

      expect(status).toBe(200);
    });
  });

  // The body is input this route did not take before, so it gets the same server-side treatment
  // every other handler's payload does: rejected by zod before any DB call.
  describe("the body", () => {
    it.each([
      ["nie-json", "{"],
      ["nie-obiekt", '"zwolnij"'],
      ["pusty-obiekt", "{}"],
      ["null", '{"expected_claimed_at":null}'],
      ["liczba", '{"expected_claimed_at":1757851200}'],
      ["sama-data", '{"expected_claimed_at":"2027-08-15"}'],
      ["spacja-zamiast-T", '{"expected_claimed_at":"2027-08-15 10:00:00+00"}'],
    ])("rejects %s (400) and frees nothing", async (label, rawBody) => {
      const claimed = await seedClaimed(owner, `R-body-${label}`, "2027-09-01", "2027-09-02");
      const target = claimed.slotIds[0];

      const { status } = await call({
        periodId: claimed.id,
        slotId: target,
        cookieHeader,
        userId: owner.userId,
        rawBody,
      });

      expect(status).toBe(400);

      const slot = (await slotsOf(owner, claimed.id)).find((row) => row.id === target);
      expect(slot?.claimed_by_name).toBe("Ania");
    });

    it("accepts the exact shape PostgREST serialises a timestamptz into", async () => {
      // The format check has to match reality rather than a tidy ISO string: this field carries
      // a value straight out of `select claimed_at`, microseconds and numeric offset included.
      // zod's DEFAULT datetime check demands a "Z" suffix and would reject every real release —
      // this is the assertion that would catch `offset: true` being dropped from the schema.
      const claimed = await seedClaimed(owner, "R-format-postgrest", "2027-09-10", "2027-09-11");
      const target = claimed.slotIds[0];
      const token = await claimedAtOf(owner, claimed.id, target);

      expect(token).toMatch(/[+-]\d{2}:\d{2}$/u);

      const { status } = await call({
        periodId: claimed.id,
        slotId: target,
        cookieHeader,
        userId: owner.userId,
        expectedClaimedAt: token,
      });

      expect(status).toBe(200);
    });
  });

  // prd.md §Open Questions #3. The route's fifth outcome, and the reason this change exists: a
  // release aimed at a claim that is no longer the one standing there.
  describe("a term that changed hands after the page was rendered", () => {
    async function seedReclaimed(title: string, start: string, end: string) {
      const claimed = await seedClaimed(owner, title, start, end);
      const target = claimed.slotIds[0];
      const staleToken = await claimedAtOf(owner, claimed.id, target);

      // Ania's term is released legitimately, then Basia takes it through the still-live link.
      // That second claim is what makes the token an already-open owner tab is holding stale.
      expect(
        (
          await call({
            periodId: claimed.id,
            slotId: target,
            cookieHeader,
            userId: owner.userId,
            expectedClaimedAt: staleToken,
          })
        ).status,
      ).toBe(200);

      const secret = generateClaimSecret();
      const digest = await digestClaimSecret(secret);
      const { error } = await anon.rpc("claim_slots", {
        p_token: claimed.token,
        p_slot_ids: [target],
        p_claim_secret: secret,
        p_name: "Basia",
      });
      expect(error).toBeNull();

      return { ...claimed, target, staleToken, basiaDigest: digest };
    }

    it("answers 409, NOT 404 — the term IS taken, and saying otherwise would be false", async () => {
      const { id, target, staleToken } = await seedReclaimed("R-wyscig", "2027-10-01", "2027-10-02");

      const { status, body } = await call({
        periodId: id,
        slotId: target,
        cookieHeader,
        userId: owner.userId,
        expectedClaimedAt: staleToken,
      });

      expect(status).toBe(409);
      // The sentence has to send the owner to a refresh. A 404's "nie jest już zajęty" would
      // describe a free term while Basia is standing on it.
      expect(body).toMatchObject({ error: expect.stringContaining("Odśwież stronę") as unknown });
    });

    it("keeps Basia's claim, and never names her in the error body", async () => {
      const { id, target, staleToken, basiaDigest } = await seedReclaimed("R-wyscig-nic", "2027-10-05", "2027-10-06");

      const { body } = await call({
        periodId: id,
        slotId: target,
        cookieHeader,
        userId: owner.userId,
        expectedClaimedAt: staleToken,
      });

      // Read the row back rather than trusting the status: a 409 returned AFTER a write would be
      // the exact bug this change closes, dressed up as the fix for it.
      const slot = (await slotsOf(owner, id)).find((row) => row.id === target);
      expect(slot?.claimed_by_name).toBe("Basia");
      expect(slot?.claim_digest).toBe(basiaDigest);

      // Identity reaches the owner through the RLS-scoped read the refresh performs, never out
      // of an exception. The digest especially must never travel in an error body.
      expect(JSON.stringify(body)).not.toContain("Basia");
      expect(JSON.stringify(body)).not.toContain(basiaDigest);
    });

    it("releases normally once the owner refreshes and sends the current token", async () => {
      // Without this the two cases above would also pass against a route that refused every
      // release outright.
      const { id, target } = await seedReclaimed("R-wyscig-odswiez", "2027-10-10", "2027-10-11");

      const { status } = await call({
        periodId: id,
        slotId: target,
        cookieHeader,
        userId: owner.userId,
        expectedClaimedAt: await claimedAtOf(owner, id, target),
      });

      expect(status).toBe(200);
    });
  });
});
