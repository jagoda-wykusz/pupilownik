import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { APIRoute } from "astro";
import { POST as revokePeriod } from "@/pages/api/periods/[id]/revoke";
import { POST as releaseSlot } from "@/pages/api/periods/[id]/slots/[slotId]/release";
import { POST as mintToken } from "@/pages/api/periods/[id]/token";
import { POST as createPeriod } from "@/pages/api/periods";
import { POST as createPet } from "@/pages/api/pets";
import { CLAIM_COOKIE } from "@/lib/claim-cookie";
import { digestInviteToken, generateClaimSecret, generateInviteToken } from "@/lib/invite-token";
import { createAnonClient, type OwnerWithPetContext } from "../helpers/auth";
import { createAuthenticatedOwnerWithPet } from "../helpers/session";

// Risk #5, asserted in its own words: "the link-only path grants MORE THAN ITS SCOPE".
//
// Every other 401 test proves the adjacent claim — a request with no session is refused — by
// simply omitting `locals.user`. None of them ever puts a real invite token in the caller's
// hands. So: one live token, held by a caller with no session, presented every way a route can
// actually observe it, against every owner-only entry point.
//
// WHAT THE ROUTE GUARD IS AND IS NOT. Measured twice, because the first answer was too broad:
//
//   - Caller with NO session cookie at all (this file). Deleting `if (!context.locals.user)`
//     does not yield 201 — the request reaches the database and is refused with SQLSTATE 42501,
//     because the client is anon-keyed and anon holds no EXECUTE on revoke_period, release_slot,
//     regenerate_period_token or create_pet_with_instructions. The grant layer is a real second
//     fence here, and what these cases pin is the ANSWER: a clean 401 instead of a 500 carrying
//     a database error.
//   - Caller WITH a session cookie but no `locals.user` — the middleware-mistake shape, covered
//     in tests/api/revoke-period.test.ts:130 and tests/api/pets.post.test.ts. There the client is
//     `authenticated`, the grant layer lets it through, and the route guard is the ONLY fence.
//     Measured: removing the guard from pets.ts yields 201 and a real row.
//
// Both shapes matter and they are different threats. This file is the link-only one, which is
// what Risk #5 is about; it deliberately sends no session cookie.
//
// PLACEMENTS ARE PER-ROUTE, not a full product, because a token planted where a handler never
// looks is decoration, not a probe. Checked against the code:
//   - `cookie` works on all five — @supabase/ssr parses the Cookie header in src/lib/supabase.ts,
//     so this genuinely pins "a pupilownik_claim cookie is not mistaken for a session".
//   - `body` only where a body is read (POST /api/periods, POST /api/pets).
//   - `url` only where an id param exists to substitute (the three /periods/[id] routes). No
//     route reads query params, so the query string is carried for realism, not as the probe.
// The url placement deliberately puts a NON-uuid in `params.id`. That is the shape an attacker
// would try, and it means a 400 could in principle stand in for the 401 — it does not today,
// because every one of these routes checks auth before it validates the id, which is itself
// worth keeping true.
//
// THE TOKEN IS VERIFIED LIVE before every case (beforeEach), not once. A dead token would make
// each 401 meaningless, and two of these routes could in principle kill it mid-file.
//
// NOT covered: CSRF posture. Each case builds its own Request, so it says nothing about what the
// islands send — that lives in tests/component/, as tests/api/revoke-period.test.ts:15-17 records.

type Placement = "body" | "cookie" | "url";

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

/** Build the context an Astro route receives, with the token planted per `placement` and NO
 *  session — `locals.user` is null, exactly what the middleware leaves for an anonymous call
 *  (these /api paths are not in PROTECTED_ROUTES, so the handler's own check is all there is). */
async function callRoute(init: {
  handler: APIRoute;
  path: string;
  params: Record<string, string>;
  payload?: Record<string, unknown>;
  token: string;
  placement: Placement;
}): Promise<CallResult> {
  const path = init.placement === "url" ? `${init.path}?t=${init.token}` : init.path;
  const url = new URL(`http://127.0.0.1${path}`);

  const body =
    init.payload === undefined
      ? undefined
      : JSON.stringify(init.placement === "body" ? { ...init.payload, token: init.token } : init.payload);

  const request = new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init.placement === "cookie" ? { Cookie: `${CLAIM_COOKIE}=${init.token}` } : {}),
    },
    ...(body === undefined ? {} : { body }),
  });

  const params = init.placement === "url" ? { ...init.params, id: init.token } : init.params;

  const context = {
    request,
    url,
    cookies: createFakeCookies(),
    params,
    locals: { user: null },
  };

  type Args = Parameters<APIRoute>;
  const response = await init.handler(context as unknown as Args[0]);
  const responseBody: unknown = await response.json();
  return { status: response.status, body: responseBody };
}

describe("a valid invite token opens nothing on the owner side", () => {
  let owner: OwnerWithPetContext;
  let token: string;
  let periodId: string;
  let claimedSlotId: string;

  async function tokenResolves(): Promise<boolean> {
    const { data, error } = await createAnonClient().rpc("get_period_by_token", { p_token: token });
    expect(error).toBeNull();
    return data !== null;
  }

  beforeAll(async () => {
    const authed = await createAuthenticatedOwnerWithPet("Burek");
    owner = authed.owner;

    token = generateInviteToken();
    const { data, error } = await owner.client.rpc("create_period_with_slots", {
      p_title: "Wyjazd",
      p_start_date: "2027-09-01",
      p_end_date: "2027-09-02",
      p_token_digest: await digestInviteToken(token),
      p_pet_ids: [owner.petId],
    });
    expect(error).toBeNull();
    if (!data) {
      throw new Error("token-scope test: seeding the period failed");
    }
    periodId = data.id;

    // A claimed slot, so the release route has a real target to refuse.
    const free = await owner.client
      .from("care_slots")
      .select("id")
      .eq("period_id", periodId)
      .order("slot_date")
      .order("time_of_day")
      .limit(1);
    claimedSlotId = free.data?.[0]?.id ?? "";
    expect(claimedSlotId).not.toBe("");

    expect(
      (
        await createAnonClient().rpc("claim_slots", {
          p_token: token,
          p_slot_ids: [claimedSlotId],
          p_claim_secret: generateClaimSecret(),
          p_name: "Ania",
        })
      ).error,
    ).toBeNull();
  });

  // Per case, not once: revoke and token-mint would each invalidate this token if they ever
  // succeeded, and the cases after them would then assert 401 against a dead link — passing for
  // exactly the reason that would make them meaningless.
  beforeEach(async () => {
    expect(await tokenResolves()).toBe(true);
  });

  /** The slice of state the route under test would have changed, serialized so before and after
   *  can be compared without hardcoding a seed count — a hardcoded count turns red the day an
   *  unrelated case seeds another row. */
  async function periodRevokedAt(): Promise<string> {
    const { data, error } = await owner.client.from("care_periods").select("revoked_at").eq("id", periodId);
    expect(error).toBeNull();
    return JSON.stringify((data ?? [])[0]?.revoked_at ?? null);
  }

  async function slotClaim(): Promise<string> {
    const { data, error } = await owner.client
      .from("care_slots")
      .select("claimed_by_name, claimed_at, claim_digest")
      .eq("id", claimedSlotId)
      .single();
    expect(error).toBeNull();
    return JSON.stringify(data);
  }

  async function tokenLiveness(): Promise<string> {
    return JSON.stringify(await tokenResolves());
  }

  async function rowCount(table: "care_periods" | "pets"): Promise<string> {
    const { count, error } = await owner.client.from(table).select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    return JSON.stringify(count ?? 0);
  }

  interface Entry {
    route: string;
    placements: Placement[];
    call: (placement: Placement) => Promise<CallResult>;
    /** The state this route would have changed, as a comparable string. */
    state: () => Promise<string>;
  }

  const entries: Entry[] = [
    {
      route: "POST /api/periods/[id]/revoke",
      placements: ["cookie", "url"],
      call: (placement) =>
        callRoute({
          handler: revokePeriod,
          path: `/api/periods/${periodId}/revoke`,
          params: { id: periodId },
          token,
          placement,
        }),
      state: periodRevokedAt,
    },
    {
      route: "POST /api/periods/[id]/slots/[slotId]/release",
      placements: ["cookie", "url"],
      call: (placement) =>
        callRoute({
          handler: releaseSlot,
          path: `/api/periods/${periodId}/slots/${claimedSlotId}/release`,
          params: { id: periodId, slotId: claimedSlotId },
          token,
          placement,
        }),
      state: slotClaim,
    },
    {
      route: "POST /api/periods/[id]/token",
      placements: ["cookie", "url"],
      call: (placement) =>
        callRoute({
          handler: mintToken,
          path: `/api/periods/${periodId}/token`,
          params: { id: periodId },
          token,
          placement,
        }),
      // A fresh mint would replace the digest and kill the link the caller already holds.
      state: tokenLiveness,
    },
    {
      route: "POST /api/periods",
      placements: ["cookie", "body"],
      call: (placement) =>
        callRoute({
          handler: createPeriod,
          path: "/api/periods",
          params: {},
          payload: {
            title: "Podszyty wyjazd",
            start_date: "2027-10-01",
            end_date: "2027-10-02",
            pet_ids: [owner.petId],
          },
          token,
          placement,
        }),
      state: () => rowCount("care_periods"),
    },
    {
      route: "POST /api/pets",
      placements: ["cookie", "body"],
      call: (placement) =>
        callRoute({
          handler: createPet,
          path: "/api/pets",
          params: {},
          payload: { name: "Podszyty", species: "dog", instructions: [] },
          token,
          placement,
        }),
      state: () => rowCount("pets"),
    },
  ];

  const cases = entries.flatMap((entry) => entry.placements.map((placement) => ({ entry, placement })));

  // it.each over the (route, placement) pairs each route can actually observe. Adding a route to
  // `entries` is a manual step — this list is hand-maintained, unlike PROTECTED_ROUTES which
  // tests/middleware/auth-gating.test.ts iterates from the source. What the table gives free is
  // the placements: a newly listed route is probed every way it can see a token, without anyone
  // deciding which ways those are.
  it.each(cases)("refuses $entry.route with the token in the $placement", async ({ entry, placement }) => {
    const before = await entry.state();

    const { status } = await entry.call(placement);

    expect(status).toBe(401);
    expect(await entry.state()).toBe(before);
  });
});
