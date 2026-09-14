import { beforeAll, describe, expect, it } from "vitest";
import { DELETE } from "@/pages/api/pets/[id]";
import { digestInviteToken, generateInviteToken } from "@/lib/invite-token";
import { createAuthenticatedOwner } from "../helpers/session";
import type { OwnerContext } from "../helpers/auth";

// S-09 Phase 2 — DELETE /api/pets/[id], the second non-POST/GET verb in this codebase.
//
// Drives the REAL handler against the local Supabase stack with a genuine owner session (auth
// is never mocked). Every negative case is paired with a probe proving the pet is STILL THERE —
// a status code on its own cannot tell a refusal apart from a delete that happened and then
// reported failure, and on this route that difference is the entire point of the slice.

const ORIGIN = "http://127.0.0.1";

// Minimal AstroCookies stand-in: the handler's Supabase client reads cookies from the
// request's Cookie header, not from here — this only absorbs setAll writes a token refresh
// may emit.
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

interface CallOptions {
  cookieHeader?: string | null;
  userId?: string | null;
  petId: string;
  /** Omitted entirely by default — an absent Origin is allowed on purpose. */
  origin?: string | null;
}

interface CallResult {
  status: number;
  body: unknown;
}

async function callDelete(options: CallOptions): Promise<CallResult> {
  const url = new URL(`${ORIGIN}/api/pets/${options.petId}`);
  // NO Content-Type and NO body, which is what the island sends. The shape matters: it is what
  // keeps the request inside Astro's origin-checked branch. This harness builds its own
  // Request, so it cannot observe that framework check — the island's own test pins the shape,
  // and the assertions below cover the handler's explicit check.
  const request = new Request(url, {
    method: "DELETE",
    headers: {
      ...(options.cookieHeader ? { Cookie: options.cookieHeader } : {}),
      ...(options.origin ? { Origin: options.origin } : {}),
    },
  });

  const context = {
    request,
    // `url` is load-bearing: the handler compares the request's Origin against
    // context.url.origin, so a harness that omitted it would make the CSRF branch unreachable
    // and these tests would silently cover nothing.
    url,
    params: { id: options.petId },
    cookies: createFakeCookies(),
    locals: { user: options.userId === null ? null : { id: options.userId } },
  };

  type DeleteArgs = Parameters<typeof DELETE>;
  const response = await DELETE(context as unknown as DeleteArgs[0]);
  const body: unknown = await response.json();
  return { status: response.status, body };
}

function errorOf(body: unknown): string | undefined {
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : undefined;
}

describe("DELETE /api/pets/[id] — the owner's remove route", () => {
  let cookieHeader: string;
  let owner: OwnerContext;

  async function seedPet(name: string): Promise<string> {
    const pet = await owner.client
      .from("pets")
      .insert({ owner_id: owner.userId, name, species: "dog" })
      .select("id")
      .single();
    expect(pet.error).toBeNull();
    if (!pet.data) {
      throw new Error("pets.delete test: seeding a pet failed");
    }
    return pet.data.id;
  }

  // `startDate` is a parameter because the RPC's DETAIL is ordered by it: a test that wants to
  // assert WHICH trips the sentence names has to make that order deterministic. Three periods
  // sharing one date tie-break on a random uuid, which is stable per row and arbitrary across
  // runs — the first version of the multi-trip test below asserted a title and failed on the
  // ordering, not on the behaviour.
  async function coverWithPeriod(petId: string, title: string, startDate = "2026-10-01"): Promise<string> {
    const { data, error } = await owner.client.rpc("create_period_with_slots", {
      p_title: title,
      p_start_date: startDate,
      p_end_date: startDate,
      p_token_digest: await digestInviteToken(generateInviteToken()),
      p_pet_ids: [petId],
    });
    expect(error).toBeNull();
    if (!data) {
      throw new Error("pets.delete test: seeding a covering period failed");
    }
    return data.id;
  }

  async function petExists(id: string): Promise<boolean> {
    const { data } = await owner.client.from("pets").select("id").eq("id", id);
    return (data ?? []).length === 1;
  }

  beforeAll(async () => {
    const authed = await createAuthenticatedOwner();
    cookieHeader = authed.cookieHeader;
    owner = authed.owner;
  });

  // ── Auth ────────────────────────────────────────────────────────────────────────────────
  //
  // Two cases, because they fail differently and only the second is sharp. PROTECTED_ROUTES
  // matches "/pets" with startsWith, and "/api/pets/x" does not start with "/pets" — so nothing
  // upstream gates this path and the handler's own guard is the entire fence.
  it("refuses with no session at all", async () => {
    const petId = await seedPet("NoSession");
    const { status } = await callDelete({ cookieHeader: null, userId: null, petId });
    expect(status).toBe(401);
    expect(await petExists(petId)).toBe(true);
  });

  it("refuses a valid session cookie when locals.user is null — the handler guard is the only fence", async () => {
    const petId = await seedPet("NoLocals");
    const { status } = await callDelete({ cookieHeader, userId: null, petId });
    expect(status).toBe(401);
    expect(await petExists(petId)).toBe(true);
  });

  // ── CSRF ────────────────────────────────────────────────────────────────────────────────
  //
  // A bodiless DELETE would already be covered by Astro's origin middleware. The explicit check
  // stays because that default is not a control this file owns, and this is an irreversible
  // action — these assertions are the only place the explicit check is observable.
  it("refuses a cross-origin request", async () => {
    const petId = await seedPet("CrossOrigin");
    const { status, body } = await callDelete({
      cookieHeader,
      userId: owner.userId,
      petId,
      origin: "https://evil.example",
    });
    expect(status).toBe(403);
    expect(errorOf(body)).toBe("Nieprawidłowe źródło żądania");
    expect(await petExists(petId)).toBe(true);
  });

  it("refuses an opaque origin, which arrives as the string 'null'", async () => {
    const petId = await seedPet("OpaqueOrigin");
    const { status } = await callDelete({ cookieHeader, userId: owner.userId, petId, origin: "null" });
    expect(status).toBe(403);
    expect(await petExists(petId)).toBe(true);
  });

  it("accepts a same-origin request", async () => {
    const petId = await seedPet("SameOrigin");
    const { status, body } = await callDelete({ cookieHeader, userId: owner.userId, petId, origin: ORIGIN });
    expect(status).toBe(200);
    expect(body).toEqual({ petId });
    expect(await petExists(petId)).toBe(false);
  });

  // ── Validation and misses ───────────────────────────────────────────────────────────────
  it("refuses a malformed pet id before touching the database", async () => {
    const { status, body } = await callDelete({ cookieHeader, userId: owner.userId, petId: "not-a-uuid" });
    expect(status).toBe(400);
    expect(errorOf(body)).toBe("Validation failed");
  });

  it("answers 404 for a pet that does not exist", async () => {
    const { status, body } = await callDelete({ cookieHeader, userId: owner.userId, petId: crypto.randomUUID() });
    expect(status).toBe(404);
    expect(errorOf(body)).toBe("Nie znaleziono zwierzęcia");
  });

  // ── The happy path ──────────────────────────────────────────────────────────────────────
  it("deletes an uncovered pet and cascades its instructions", async () => {
    const petId = await seedPet("Happy");
    const instruction = await owner.client
      .from("care_instructions")
      .insert({ pet_id: petId, title: "Karmienie", is_sensitive: false, sort_order: 0 })
      .select("id")
      .single();
    expect(instruction.error).toBeNull();

    const { status, body } = await callDelete({ cookieHeader, userId: owner.userId, petId });

    expect(status).toBe(200);
    expect(body).toEqual({ petId });
    expect(await petExists(petId)).toBe(false);
    const { data: rows } = await owner.client.from("care_instructions").select("id").eq("pet_id", petId);
    expect(rows ?? []).toEqual([]);
  });

  // ── The refusal, as the route reports it ────────────────────────────────────────────────
  it("answers 409 NAMING the blocking trip, and the pet survives", async () => {
    const petId = await seedPet("Blocked");
    await coverWithPeriod(petId, "Majówka");

    const { status, body } = await callDelete({ cookieHeader, userId: owner.userId, petId });

    expect(status).toBe(409);
    const message = errorOf(body) ?? "";
    // Naming the trip is the point: "you cannot delete this" without saying which trip blocks
    // it leaves the owner with no next step. The title comes from the PT409 DETAIL payload.
    expect(message).toContain("Majówka");
    expect(message).toContain("odwołaj wyjazd");
    // Terminal, so no "spróbuj ponownie" — a retry cannot succeed until the owner acts.
    expect(message).not.toContain("Spróbuj ponownie");

    expect(await petExists(petId)).toBe(true);
  });

  it("names two blocking trips and counts the rest", async () => {
    const petId = await seedPet("ManyBlocked");
    await coverWithPeriod(petId, "Wyjazd A", "2026-10-01");
    await coverWithPeriod(petId, "Wyjazd B", "2026-10-05");
    await coverWithPeriod(petId, "Wyjazd C", "2026-10-09");

    const { status, body } = await callDelete({ cookieHeader, userId: owner.userId, petId });

    expect(status).toBe(409);
    const message = errorOf(body) ?? "";
    // Two named, the remainder counted: a pet on six trips would otherwise produce a sentence
    // nobody reads. WHICH two follows the RPC's `order by start_date, id` — the soonest first,
    // which is the one the owner has to deal with first.
    expect(message).toContain("Wyjazd A");
    expect(message).toContain("Wyjazd B");
    expect(message).not.toContain("Wyjazd C");
    expect(message).toContain("1 inny");
    expect(await petExists(petId)).toBe(true);
  });

  it("lets the owner delete once the blocking trip is revoked", async () => {
    const petId = await seedPet("Remedy");
    const periodId = await coverWithPeriod(petId, "Do odwołania");

    const blocked = await callDelete({ cookieHeader, userId: owner.userId, petId });
    expect(blocked.status).toBe(409);

    const { error } = await owner.client.rpc("revoke_period", { p_period_id: periodId });
    expect(error).toBeNull();

    const { status } = await callDelete({ cookieHeader, userId: owner.userId, petId });
    expect(status).toBe(200);
    expect(await petExists(petId)).toBe(false);
  });
});
