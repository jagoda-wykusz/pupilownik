import { beforeAll, describe, expect, it } from "vitest";
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
// Every existing 401 test proves the adjacent claim — a request with no session is refused —
// by simply omitting `locals.user`. None of them ever puts a real invite token in the caller's
// hands. So: one live token, held by a caller with no session, presented every way the
// transport allows, against every owner-only entry point. All of them answer 401 and write
// nothing.
//
// WHAT THE ROUTE GUARD IS AND IS NOT, measured rather than assumed — the first version of this
// header got it wrong and the mutation run corrected it. Deleting `if (!context.locals.user)`
// from a route does NOT turn these into 200/201: the request reaches the database and is
// refused there with SQLSTATE 42501, because a caller with no session gets an anon-keyed client
// and anon holds no EXECUTE on revoke_period, release_slot, regenerate_period_token or
// create_pet_with_instructions. So the grant layer is a real second fence, not a formality, and
// the route check is defence in depth over it.
//
// What these cases therefore pin is the ANSWER, and that is worth pinning on its own: without
// the guard the caller gets a 500 carrying a database failure instead of a clean 401. The state
// assertions below stay because they are what would matter if a future owner route wrote
// through a path anon CAN reach — they are not what discriminates today, and this comment says
// so rather than letting a reader infer more.
//
// THE TOKEN IS VERIFIED LIVE inside this file (see beforeAll) before a single case runs.
// Without that, every row here could pass for the wrong reason — a dead token proves nothing
// about scope.
//
// Each payload below is otherwise VALID, so a 400 cannot masquerade as protection: every one of
// these requests is well-formed enough that only authorization stands between it and a write.
//
// What this file deliberately does NOT cover: CSRF posture. Each case builds its own Request,
// so it says nothing about what the islands send — that lives in tests/component/, as
// tests/api/revoke-period.test.ts:15-17 already records.

type Placement = "body" | "cookie" | "url";

const PLACEMENTS: Placement[] = ["body", "cookie", "url"];

function createFakeCookies(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
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
  handler: (context: unknown) => Promise<Response>;
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

  // The token in the URL also reaches a param, not just the query string: substituting it for
  // an id is the shape an attacker would actually try on a route that takes one.
  const params =
    init.placement === "url" ? { ...init.params, ...("id" in init.params ? { id: init.token } : {}) } : init.params;

  const context = {
    request,
    url,
    cookies: createFakeCookies(init.placement === "cookie" ? { [CLAIM_COOKIE]: init.token } : {}),
    params,
    locals: { user: null },
  };

  const response = await init.handler(context);
  const responseBody: unknown = await response.json();
  return { status: response.status, body: responseBody };
}

describe("a valid invite token opens nothing on the owner side", () => {
  let owner: OwnerWithPetContext;
  let token: string;
  let periodId: string;
  let claimedSlotId: string;
  let claimDigest: string | null;

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

    const anon = createAnonClient();
    expect(
      (
        await anon.rpc("claim_slots", {
          p_token: token,
          p_slot_ids: [claimedSlotId],
          p_claim_secret: generateClaimSecret(),
          p_name: "Ania",
        })
      ).error,
    ).toBeNull();

    // GUARDS THE WHOLE FILE: the token must actually open the caretaker door right now. A dead
    // token would make every 401 below meaningless — it would prove nothing about scope.
    const resolved = await anon.rpc("get_period_by_token", { p_token: token });
    expect(resolved.error).toBeNull();
    expect(resolved.data).not.toBeNull();

    claimDigest = (await claimColumnsOf(claimedSlotId)).claim_digest;
    expect(claimDigest).not.toBeNull();
  });

  async function claimColumnsOf(
    slotId: string,
  ): Promise<{ claimed_by_name: string | null; claim_digest: string | null }> {
    const { data, error } = await owner.client
      .from("care_slots")
      .select("claimed_by_name, claim_digest")
      .eq("id", slotId)
      .single();
    expect(error).toBeNull();
    if (!data) {
      throw new Error(`token-scope test: slot ${slotId} not readable`);
    }
    return data;
  }

  async function revokedAt(): Promise<string | null | undefined> {
    const { data, error } = await owner.client.from("care_periods").select("revoked_at").eq("id", periodId);
    expect(error).toBeNull();
    return (data ?? [])[0]?.revoked_at;
  }

  async function countOf(table: "care_periods" | "pets"): Promise<number> {
    const { count, error } = await owner.client.from(table).select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    return count ?? 0;
  }

  interface Entry {
    route: string;
    call: (placement: Placement) => Promise<CallResult>;
    /** Prove the refusal was a refusal: the state this route would have changed is untouched. */
    assertUntouched: () => Promise<void>;
  }

  const entries: Entry[] = [
    {
      route: "POST /api/periods/[id]/revoke",
      call: (placement) =>
        callRoute({
          handler: revokePeriod as unknown as (c: unknown) => Promise<Response>,
          path: `/api/periods/${periodId}/revoke`,
          params: { id: periodId },
          token,
          placement,
        }),
      assertUntouched: async () => {
        expect(await revokedAt()).toBeNull();
      },
    },
    {
      route: "POST /api/periods/[id]/slots/[slotId]/release",
      call: (placement) =>
        callRoute({
          handler: releaseSlot as unknown as (c: unknown) => Promise<Response>,
          path: `/api/periods/${periodId}/slots/${claimedSlotId}/release`,
          params: { id: periodId, slotId: claimedSlotId },
          token,
          placement,
        }),
      assertUntouched: async () => {
        const columns = await claimColumnsOf(claimedSlotId);
        expect(columns.claimed_by_name).toBe("Ania");
        expect(columns.claim_digest).toBe(claimDigest);
      },
    },
    {
      route: "POST /api/periods/[id]/token",
      call: (placement) =>
        callRoute({
          handler: mintToken as unknown as (c: unknown) => Promise<Response>,
          path: `/api/periods/${periodId}/token`,
          params: { id: periodId },
          token,
          placement,
        }),
      assertUntouched: async () => {
        // The link the caller already holds still resolves — no fresh token was minted, which
        // would have invalidated this one.
        const resolved = await createAnonClient().rpc("get_period_by_token", { p_token: token });
        expect(resolved.error).toBeNull();
        expect(resolved.data).not.toBeNull();
      },
    },
    {
      route: "POST /api/periods",
      call: (placement) =>
        callRoute({
          handler: createPeriod as unknown as (c: unknown) => Promise<Response>,
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
      assertUntouched: async () => {
        expect(await countOf("care_periods")).toBe(1);
      },
    },
    {
      route: "POST /api/pets",
      call: (placement) =>
        callRoute({
          handler: createPet as unknown as (c: unknown) => Promise<Response>,
          path: "/api/pets",
          params: {},
          payload: { name: "Podszyty", species: "dog", instructions: [] },
          token,
          placement,
        }),
      assertUntouched: async () => {
        expect(await countOf("pets")).toBe(1);
      },
    },
  ];

  const cases = entries.flatMap((entry) => PLACEMENTS.map((placement) => ({ entry, placement })));

  // it.each over the product, so a newly added owner route falls under the same guard the day
  // it joins `entries` — rather than relying on someone remembering to write its 401 test.
  it.each(cases)("refuses $entry.route with the token in the $placement", async ({ entry, placement }) => {
    const { status } = await entry.call(placement);
    expect(status).toBe(401);
    await entry.assertUntouched();
  });
});
