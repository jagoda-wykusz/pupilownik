import { beforeAll, describe, expect, it } from "vitest";
import { POST as revokePeriod } from "@/pages/api/periods/[id]/revoke";
import { createAuthenticatedOwnerWithPet } from "../helpers/session";
import { type OwnerWithPetContext } from "../helpers/auth";
import { digestInviteToken, generateInviteToken } from "@/lib/invite-token";

// S-06 Phase 3 — the handler's own branches, which tests/rls/revoke-period.test.ts cannot reach.
//
// Drives the REAL handler against the local stack with a genuine owner session (auth is never
// mocked). The RLS suite already proves the function; what is left here is the route's four
// answers — 401, 400, 404 and 200 — and in particular that the three DIFFERENT ways to miss all
// land on the same 404, since the whole point of revoke_period's uniform NULL is lost if the
// route separates them again.
//
// The CSRF posture is NOT asserted here and cannot be: this file constructs its own Request, so
// it says nothing about what the island sends. That property lives in
// tests/component/revoke-period-button.test.tsx, which is the only place it is observable.

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

type Handler = typeof revokePeriod;

async function call(init: { periodId: string; cookieHeader?: string; userId?: string }): Promise<CallResult> {
  const path = `/api/periods/${init.periodId}/revoke`;
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
    params: { id: init.periodId },
    // A missing user is what the middleware leaves behind for an unauthenticated call — and
    // this path is NOT middleware-gated (PROTECTED_ROUTES matches "/periods", not
    // "/api/periods"), so the handler's own check is the only thing standing here.
    locals: { user: init.userId === undefined ? null : { id: init.userId } },
  };

  type Args = Parameters<Handler>;
  const response = await revokePeriod(context as unknown as Args[0]);
  const body: unknown = await response.json();
  return { status: response.status, body };
}

describe("POST /api/periods/[id]/revoke — the owner's revoke route", () => {
  let cookieHeader: string;
  let owner: OwnerWithPetContext;

  let strangerCookieHeader: string;
  let stranger: OwnerWithPetContext;

  async function seedPeriod(forOwner: OwnerWithPetContext, title: string): Promise<{ id: string; token: string }> {
    const token = generateInviteToken();
    const { data, error } = await forOwner.client.rpc("create_period_with_slots", {
      p_title: title,
      p_start_date: "2027-08-01",
      p_end_date: "2027-08-03",
      p_token_digest: await digestInviteToken(token),
      p_pet_ids: [forOwner.petId],
    });
    expect(error).toBeNull();
    if (!data) {
      throw new Error(`revoke route test: seeding "${title}" failed`);
    }
    return { id: data.id, token };
  }

  async function revokedAtOf(forOwner: OwnerWithPetContext, periodId: string): Promise<string | null | undefined> {
    const { data, error } = await forOwner.client.from("care_periods").select("revoked_at").eq("id", periodId);
    expect(error).toBeNull();
    return (data ?? [])[0]?.revoked_at;
  }

  beforeAll(async () => {
    // The helper returns `{ cookieHeader, owner }` — the owner context is NESTED, not spread.
    const authed = await createAuthenticatedOwnerWithPet("A-Burek");
    cookieHeader = authed.cookieHeader;
    owner = authed.owner;

    const other = await createAuthenticatedOwnerWithPet("B-Mru");
    strangerCookieHeader = other.cookieHeader;
    stranger = other.owner;
  });

  it("answers 401 without a session, and never reaches the RPC", async () => {
    const period = await seedPeriod(owner, "A-bez-sesji");

    const result = await call({ periodId: period.id });

    expect(result.status).toBe(401);
    // The proof it never reached the RPC is the row, not the status: a handler that checked
    // auth after the write would answer 401 too.
    expect(await revokedAtOf(owner, period.id)).toBeNull();
  });

  it("answers 400 for a malformed period id", async () => {
    const result = await call({ periodId: "not-a-uuid", cookieHeader, userId: owner.userId });

    expect(result.status).toBe(400);
  });

  it("revokes the owner's own period and echoes its id", async () => {
    const period = await seedPeriod(owner, "A-odwolaj-route");

    const result = await call({ periodId: period.id, cookieHeader, userId: owner.userId });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ periodId: period.id });
    // Read back through the owner's own client — the response is the handler's account of what
    // it did, and a test that only read that would pass against a route that wrote nothing.
    expect(await revokedAtOf(owner, period.id)).not.toBeNull();
  });

  it("answers 404 on a second revoke and leaves the original timestamp alone", async () => {
    const period = await seedPeriod(owner, "A-dwa-razy-route");

    expect((await call({ periodId: period.id, cookieHeader, userId: owner.userId })).status).toBe(200);
    const first = await revokedAtOf(owner, period.id);

    const result = await call({ periodId: period.id, cookieHeader, userId: owner.userId });

    expect(result.status).toBe(404);
    expect(await revokedAtOf(owner, period.id)).toBe(first);
  });

  it("answers 404 for another owner's period and leaves it live", async () => {
    const theirs = await seedPeriod(stranger, "B-cudze-route");

    const result = await call({ periodId: theirs.id, cookieHeader, userId: owner.userId });

    // RLS filtered the row out. Identical to "already revoked" and to "does not exist" — the
    // owner learns nothing about whether another owner's period exists.
    expect(result.status).toBe(404);
    expect(await revokedAtOf(stranger, theirs.id)).toBeNull();
    expect(strangerCookieHeader).toBeTruthy();
  });

  it("answers 404 for a well-formed id that does not exist", async () => {
    const result = await call({ periodId: crypto.randomUUID(), cookieHeader, userId: owner.userId });

    expect(result.status).toBe(404);
  });

  it("gives all three misses the same status AND the same body", async () => {
    // The uniform-failure property at the route layer, which S-03's phase-4 review F8a caught
    // as a gap where SQL was covered and the route's mapping was not. Asserting the bodies are
    // equal, not merely that each is a 404: a handler that answered "już odwołany" for one and
    // "nie znaleziono" for another would re-separate what the function collapsed.
    const revoked = await seedPeriod(owner, "A-jednolitosc");
    expect((await call({ periodId: revoked.id, cookieHeader, userId: owner.userId })).status).toBe(200);
    const theirs = await seedPeriod(stranger, "B-jednolitosc");

    const alreadyRevoked = await call({ periodId: revoked.id, cookieHeader, userId: owner.userId });
    const notYours = await call({ periodId: theirs.id, cookieHeader, userId: owner.userId });
    const missing = await call({ periodId: crypto.randomUUID(), cookieHeader, userId: owner.userId });

    expect(alreadyRevoked.status).toBe(404);
    expect(notYours).toEqual(alreadyRevoked);
    expect(missing).toEqual(alreadyRevoked);
  });
});
