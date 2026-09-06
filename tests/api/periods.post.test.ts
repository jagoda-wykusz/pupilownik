import { beforeAll, describe, expect, it } from "vitest";
import { POST as createPeriod } from "@/pages/api/periods";
import { POST as regenerateToken } from "@/pages/api/periods/[id]/token";
import { createAuthenticatedOwnerWithPet } from "../helpers/session";
import { createAnonClient, createOwnerWithPet, type OwnerWithPetContext } from "../helpers/auth";

// Risk #7 (server-side validation) and Risk #5 (the link-only path) meeting on the one
// route that mints a token — S-02, test-plan §6.4.
//
// Drives the REAL handlers against the local stack with a genuine owner session (auth
// is never mocked). The assertion that matters most is the last one: the raw token in
// the response body must actually open the period for an anonymous caller, and must be
// the ONLY thing in that body that could — a digest leaking into the payload would hand
// an attacker the lookup key.

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

type Handler = typeof createPeriod;

async function call(
  handler: Handler,
  path: string,
  init: { cookieHeader?: string; userId?: string; rawBody?: string; params?: Record<string, string> },
): Promise<CallResult> {
  const request = new Request(new URL(`http://127.0.0.1${path}`), {
    method: "POST",
    headers: {
      ...(init.cookieHeader === undefined ? {} : { Cookie: init.cookieHeader }),
      "Content-Type": "application/json",
    },
    ...(init.rawBody === undefined ? {} : { body: init.rawBody }),
  });

  const context = {
    request,
    cookies: createFakeCookies(),
    params: init.params ?? {},
    // A missing user is what the middleware leaves behind for an unauthenticated call.
    locals: { user: init.userId === undefined ? null : { id: init.userId } },
  };

  type Args = Parameters<Handler>;
  const response = await handler(context as unknown as Args[0]);
  const body: unknown = await response.json();
  return { status: response.status, body };
}

// A valid payload needs a pet id since S-08, and the id is only known once the owner exists,
// so this is a builder rather than a constant.
function validBody(petIds: string[]): string {
  return JSON.stringify({ title: "Wyjazd", start_date: "2026-07-13", end_date: "2026-07-15", pet_ids: petIds });
}

describe("POST /api/periods — validated atomic create + token minting", () => {
  let cookieHeader: string;
  let owner: OwnerWithPetContext;
  let petId: string;

  beforeAll(async () => {
    const authed = await createAuthenticatedOwnerWithPet();
    cookieHeader = authed.cookieHeader;
    owner = authed.owner;
    petId = owner.petId;
  });

  it("refuses an unauthenticated call (401) and writes nothing", async () => {
    const before = await owner.client.from("care_periods").select("id");
    const { status } = await call(createPeriod, "/api/periods", { rawBody: validBody([petId]) });

    expect(status).toBe(401);

    const after = await owner.client.from("care_periods").select("id");
    expect(after.data?.length).toBe(before.data?.length ?? 0);
  });

  it("rejects a malformed (non-JSON) body (400)", async () => {
    const { status } = await call(createPeriod, "/api/periods", {
      cookieHeader,
      userId: owner.userId,
      rawBody: "{not json",
    });
    expect(status).toBe(400);
  });

  it("rejects a missing title (400)", async () => {
    const { status, body } = await call(createPeriod, "/api/periods", {
      cookieHeader,
      userId: owner.userId,
      rawBody: JSON.stringify({ start_date: "2026-07-13", end_date: "2026-07-15", pet_ids: [petId] }),
    });

    expect(status).toBe(400);
    expect((body as { error?: string }).error).toBe("Validation failed");
  });

  it("rejects reversed dates (400) rather than letting the CHECK raise a 500", async () => {
    const { status } = await call(createPeriod, "/api/periods", {
      cookieHeader,
      userId: owner.userId,
      rawBody: JSON.stringify({ title: "Wyjazd", start_date: "2026-07-15", end_date: "2026-07-13", pet_ids: [petId] }),
    });
    expect(status).toBe(400);
  });

  it("rejects a span longer than 31 days (400) — the zod bound mirrors the CHECK", async () => {
    const { status } = await call(createPeriod, "/api/periods", {
      cookieHeader,
      userId: owner.userId,
      // 32 days inclusive.
      rawBody: JSON.stringify({ title: "Wyjazd", start_date: "2026-07-01", end_date: "2026-08-01", pet_ids: [petId] }),
    });
    expect(status).toBe(400);
  });

  it("accepts a span of exactly 31 days — the bound is inclusive on both sides", async () => {
    // Paired with the 32-day rejection above so the boundary is pinned from both
    // directions. The bound lives in four places (the CHECK, the zod refine, the
    // island's validate, and MAX_SPAN_DAYS); a one-day tightening in any of them would
    // otherwise pass every test.
    const { status, body } = await call(createPeriod, "/api/periods", {
      cookieHeader,
      userId: owner.userId,
      // 2026-07-01 .. 2026-07-31 inclusive = 31 days.
      rawBody: JSON.stringify({ title: "Wyjazd", start_date: "2026-07-01", end_date: "2026-07-31", pet_ids: [petId] }),
    });

    expect(status).toBe(201);
    const payload = body as { period: { id: string } };
    // 31 days x 3 times of day — the documented worst case for one transaction.
    const slots = await owner.client.from("care_slots").select("id").eq("period_id", payload.period.id);
    expect(slots.data).toHaveLength(93);
  });

  // The two cases the plan's §Testing Strategy asked for. Both are client-input errors that
  // zod cannot catch — it does not know who owns a pet — so the route maps them to 400.
  it("rejects an empty pet_ids (400) and writes nothing", async () => {
    const before = await owner.client.from("care_periods").select("id");
    const { status } = await call(createPeriod, "/api/periods", {
      cookieHeader,
      userId: owner.userId,
      rawBody: JSON.stringify({ title: "Wyjazd", start_date: "2026-07-13", end_date: "2026-07-15", pet_ids: [] }),
    });

    expect(status).toBe(400);
    const after = await owner.client.from("care_periods").select("id");
    expect(after.data?.length).toBe(before.data?.length ?? 0);
  });

  it("rejects a pet the caller does not own (400) and writes nothing", async () => {
    const stranger = await createOwnerWithPet("Obcy-Burek");
    const before = await owner.client.from("care_periods").select("id");

    const { status, body } = await call(createPeriod, "/api/periods", {
      cookieHeader,
      userId: owner.userId,
      rawBody: JSON.stringify({
        title: "Wyjazd",
        start_date: "2026-07-13",
        end_date: "2026-07-15",
        pet_ids: [stranger.petId],
      }),
    });

    // The join insert fails the RLS with-check (42501), which aborts the whole RPC — so the
    // period is rolled back with it. Answering 400 rather than 500 is deliberate: the owner
    // named a pet that is not theirs, which is bad input, not a server fault.
    expect(status).toBe(400);
    expect((body as { error?: string }).error).toContain("nie należy do Ciebie");

    const after = await owner.client.from("care_periods").select("id");
    expect(after.data?.length).toBe(before.data?.length ?? 0);
  });

  it("creates the period with its slots and returns a working link exactly once (201)", async () => {
    const { status, body } = await call(createPeriod, "/api/periods", {
      cookieHeader,
      userId: owner.userId,
      rawBody: validBody([petId]),
    });

    expect(status).toBe(201);
    const payload = body as { period: { id: string }; inviteToken: string };
    expect(payload.inviteToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The digest is the lookup key. It must not travel back to the client.
    expect(Object.keys(payload.period).sort()).toEqual(["end_date", "id", "start_date", "title"]);
    expect(JSON.stringify(body)).not.toContain("token_digest");

    // 3 days x 3 times of day.
    const slots = await owner.client.from("care_slots").select("id").eq("period_id", payload.period.id);
    expect(slots.data).toHaveLength(9);

    // The token in the response genuinely opens the period for a caller with no session.
    const anon = createAnonClient();
    const resolved = await anon.rpc("get_period_by_token", { p_token: payload.inviteToken });
    expect((resolved.data as { period: { id: string } } | null)?.period.id).toBe(payload.period.id);
  });
});

describe("POST /api/periods/[id]/token — regeneration", () => {
  let cookieHeader: string;
  let owner: OwnerWithPetContext;
  let periodId: string;
  let firstToken: string;

  beforeAll(async () => {
    const authed = await createAuthenticatedOwnerWithPet();
    cookieHeader = authed.cookieHeader;
    owner = authed.owner;

    const { body } = await call(createPeriod, "/api/periods", {
      cookieHeader,
      userId: owner.userId,
      rawBody: validBody([owner.petId]),
    });
    const payload = body as { period: { id: string }; inviteToken: string };
    periodId = payload.period.id;
    firstToken = payload.inviteToken;
  });

  it("refuses an unauthenticated call (401)", async () => {
    const { status } = await call(regenerateToken, `/api/periods/${periodId}/token`, { params: { id: periodId } });
    expect(status).toBe(401);
  });

  it("rejects a non-uuid period id (400)", async () => {
    const { status } = await call(regenerateToken, "/api/periods/nope/token", {
      cookieHeader,
      userId: owner.userId,
      params: { id: "nope" },
    });
    expect(status).toBe(400);
  });

  it("answers 404 for a period this owner does not have", async () => {
    const stranger = "00000000-0000-0000-0000-000000000000";
    const { status } = await call(regenerateToken, `/api/periods/${stranger}/token`, {
      cookieHeader,
      userId: owner.userId,
      params: { id: stranger },
    });
    // RLS filtered the row out; a foreign id and a missing one answer the same.
    expect(status).toBe(404);
  });

  it("mints a new link and kills the previous one (200)", async () => {
    const { status, body } = await call(regenerateToken, `/api/periods/${periodId}/token`, {
      cookieHeader,
      userId: owner.userId,
      params: { id: periodId },
    });

    expect(status).toBe(200);
    const payload = body as { periodId: string; inviteToken: string };
    expect(payload.periodId).toBe(periodId);
    expect(payload.inviteToken).not.toBe(firstToken);

    const anon = createAnonClient();
    await expect(anon.rpc("get_period_by_token", { p_token: firstToken })).resolves.toMatchObject({ data: null });
    const resolved = await anon.rpc("get_period_by_token", { p_token: payload.inviteToken });
    expect((resolved.data as { period: { id: string } } | null)?.period.id).toBe(periodId);
  });
});
