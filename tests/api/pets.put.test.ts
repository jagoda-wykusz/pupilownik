import { beforeAll, describe, expect, it } from "vitest";
import { PUT } from "@/pages/api/pets/[id]";
import { digestInviteToken, generateClaimSecret, generateInviteToken } from "@/lib/invite-token";
import { createAnonClient } from "../helpers/auth";
import { createAuthenticatedOwner } from "../helpers/session";
import type { OwnerContext } from "../helpers/auth";

// S-09 Phase 1 — PUT /api/pets/[id], the first non-POST/GET verb in this codebase.
//
// Drives the REAL handler against the local Supabase stack with a genuine owner session (auth
// is never mocked). Every negative case is paired with a probe proving the database was NOT
// touched — a status code on its own cannot tell a refusal apart from a write that happened
// and then reported failure.

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
  rawBody: string;
  /** Omitted entirely by default — an absent Origin is allowed on purpose. */
  origin?: string | null;
}

interface CallResult {
  status: number;
  body: unknown;
}

async function callPut(options: CallOptions): Promise<CallResult> {
  const url = new URL(`${ORIGIN}/api/pets/${options.petId}`);
  const request = new Request(url, {
    method: "PUT",
    headers: {
      ...(options.cookieHeader ? { Cookie: options.cookieHeader } : {}),
      ...(options.origin ? { Origin: options.origin } : {}),
      "Content-Type": "application/json",
    },
    body: options.rawBody,
  });

  const context = {
    request,
    // `url` matters here in a way it does not for the POST route: the handler compares the
    // request's Origin against context.url.origin, so a harness that omitted it would make the
    // CSRF branch unreachable and the test would silently cover nothing.
    url,
    params: { id: options.petId },
    cookies: createFakeCookies(),
    locals: { user: options.userId === null ? null : { id: options.userId } },
  };

  type PutArgs = Parameters<typeof PUT>;
  const response = await PUT(context as unknown as PutArgs[0]);
  const body: unknown = await response.json();
  return { status: response.status, body };
}

function errorOf(body: unknown): string | undefined {
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : undefined;
}

describe("PUT /api/pets/[id] — the owner's edit route", () => {
  let cookieHeader: string;
  let owner: OwnerContext;
  let petId: string;
  let instructionId: string;

  async function seedPet(name: string): Promise<{ petId: string; instructionId: string }> {
    const pet = await owner.client
      .from("pets")
      .insert({ owner_id: owner.userId, name, species: "dog" })
      .select("id")
      .single();
    expect(pet.error).toBeNull();
    if (!pet.data) {
      throw new Error("pets.put test: seeding a pet failed");
    }
    const instruction = await owner.client
      .from("care_instructions")
      .insert({ pet_id: pet.data.id, title: "Karmienie", is_sensitive: false, sort_order: 0 })
      .select("id")
      .single();
    expect(instruction.error).toBeNull();
    if (!instruction.data) {
      throw new Error("pets.put test: seeding an instruction failed");
    }
    return { petId: pet.data.id, instructionId: instruction.data.id };
  }

  function body(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      name: "Burek",
      species: "dog",
      instructions: [{ id: instructionId, title: "Karmienie", is_sensitive: false }],
      ...overrides,
    });
  }

  async function petName(id: string): Promise<string | undefined> {
    const { data } = await owner.client.from("pets").select("name").eq("id", id).single();
    return data?.name;
  }

  beforeAll(async () => {
    const authed = await createAuthenticatedOwner();
    cookieHeader = authed.cookieHeader;
    owner = authed.owner;
    ({ petId, instructionId } = await seedPet("Burek"));
  });

  // ── Auth ────────────────────────────────────────────────────────────────────────────────
  //
  // Two cases, because they fail differently and only the second one is sharp. PROTECTED_ROUTES
  // matches "/pets" with startsWith, and "/api/pets/x" does not start with "/pets" — so nothing
  // upstream gates this path and the handler's own guard is the entire fence.
  it("refuses with no session at all", async () => {
    const { status } = await callPut({ cookieHeader: null, userId: null, petId, rawBody: body({ name: "hacked" }) });
    expect(status).toBe(401);
    expect(await petName(petId)).toBe("Burek");
  });

  it("refuses a valid session cookie when locals.user is null — the handler guard is the only fence", async () => {
    const { status } = await callPut({ cookieHeader, userId: null, petId, rawBody: body({ name: "hacked" }) });
    expect(status).toBe(401);
    expect(await petName(petId)).toBe("Burek");
  });

  // ── CSRF ────────────────────────────────────────────────────────────────────────────────
  //
  // This route sends a JSON body, which lands it in Astro's no-check branch — the framework
  // contributes nothing, so the explicit check below is the whole control. These assertions are
  // the only place that is observable.
  it("refuses a cross-origin request", async () => {
    const { status, body: payload } = await callPut({
      cookieHeader,
      userId: owner.userId,
      petId,
      rawBody: body({ name: "hacked" }),
      origin: "https://evil.example",
    });
    expect(status).toBe(403);
    expect(errorOf(payload)).toBe("Nieprawidłowe źródło żądania");
    expect(await petName(petId)).toBe("Burek");
  });

  it("refuses an opaque origin, which arrives as the string 'null'", async () => {
    const { status } = await callPut({
      cookieHeader,
      userId: owner.userId,
      petId,
      rawBody: body({ name: "hacked" }),
      origin: "null",
    });
    expect(status).toBe(403);
    expect(await petName(petId)).toBe("Burek");
  });

  it("accepts a same-origin request", async () => {
    const seeded = await seedPet("SameOrigin");
    const { status } = await callPut({
      cookieHeader,
      userId: owner.userId,
      petId: seeded.petId,
      origin: ORIGIN,
      rawBody: JSON.stringify({
        name: "SameOrigin renamed",
        species: "dog",
        instructions: [{ id: seeded.instructionId, title: "Karmienie", is_sensitive: false }],
      }),
    });
    expect(status).toBe(200);
    expect(await petName(seeded.petId)).toBe("SameOrigin renamed");
  });

  // ── Validation ──────────────────────────────────────────────────────────────────────────
  it("refuses a malformed pet id before touching the database", async () => {
    const { status, body: payload } = await callPut({
      cookieHeader,
      userId: owner.userId,
      petId: "not-a-uuid",
      rawBody: body(),
    });
    expect(status).toBe(400);
    expect(errorOf(payload)).toBe("Validation failed");
  });

  it("refuses a body that is not JSON", async () => {
    const { status } = await callPut({ cookieHeader, userId: owner.userId, petId, rawBody: "{not json" });
    expect(status).toBe(400);
    expect(await petName(petId)).toBe("Burek");
  });

  // The newer error convention: a single Polish sentence the island renders verbatim, with no
  // `issues` array. Asserting the SENTENCE, not just the status, is what keeps zod's English
  // defaults from reaching an owner's screen.
  it("refuses a missing name with a Polish sentence", async () => {
    const { status, body: payload } = await callPut({
      cookieHeader,
      userId: owner.userId,
      petId,
      rawBody: JSON.stringify({ species: "dog", instructions: [] }),
    });
    expect(status).toBe(400);
    expect(errorOf(payload)).toBe("Imię zwierzęcia jest wymagane");
    expect(await petName(petId)).toBe("Burek");
  });

  it("refuses a non-object body with a Polish sentence", async () => {
    const { status, body: payload } = await callPut({
      cookieHeader,
      userId: owner.userId,
      petId,
      rawBody: JSON.stringify(42),
    });
    expect(status).toBe(400);
    expect(errorOf(payload)).toBe("Dane są niepoprawne");
  });

  it("refuses an unknown species with a Polish sentence", async () => {
    const { status, body: payload } = await callPut({
      cookieHeader,
      userId: owner.userId,
      petId,
      rawBody: body({ species: "dragon" }),
    });
    expect(status).toBe(400);
    expect(errorOf(payload)).toBe("Wybierz gatunek zwierzęcia");
  });

  it("refuses a malformed instruction id with a Polish sentence", async () => {
    const { status, body: payload } = await callPut({
      cookieHeader,
      userId: owner.userId,
      petId,
      rawBody: body({ instructions: [{ id: "nope", title: "X", is_sensitive: false }] }),
    });
    expect(status).toBe(400);
    expect(errorOf(payload)).toBe("Nieprawidłowy identyfikator instrukcji");
  });

  // ── Misses ──────────────────────────────────────────────────────────────────────────────
  it("answers 404 for a pet that does not exist", async () => {
    const { status, body: payload } = await callPut({
      cookieHeader,
      userId: owner.userId,
      petId: crypto.randomUUID(),
      rawBody: JSON.stringify({ name: "X", species: "dog", instructions: [] }),
    });
    expect(status).toBe(404);
    expect(errorOf(payload)).toBe("Nie znaleziono zwierzęcia");
  });

  // ── The happy path, and its side effect ─────────────────────────────────────────────────
  it("replaces the pet and synchronises its instruction set", async () => {
    const seeded = await seedPet("Sync");
    const { status, body: payload } = await callPut({
      cookieHeader,
      userId: owner.userId,
      petId: seeded.petId,
      rawBody: JSON.stringify({
        name: "Sync renamed",
        species: "cat",
        breed: "dachowiec",
        instructions: [
          { id: seeded.instructionId, title: "Karmienie 2x", body: "250g", is_sensitive: false },
          { title: "Kod bramy", body: "4829#", is_sensitive: true },
        ],
      }),
    });

    expect(status).toBe(200);
    expect(payload).toEqual({ petId: seeded.petId });

    const { data: pet } = await owner.client
      .from("pets")
      .select("name, species, breed, care_instructions(title, body, is_sensitive, sort_order)")
      .eq("id", seeded.petId)
      .single();
    expect(pet).toMatchObject({ name: "Sync renamed", species: "cat", breed: "dachowiec" });
    const rows = [...(pet?.care_instructions ?? [])].sort((x, y) => x.sort_order - y.sort_order);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "Karmienie 2x", body: "250g", is_sensitive: false });
    expect(rows[1]).toMatchObject({ title: "Kod bramy", body: "4829#", is_sensitive: true });
  });

  // ── The freeze, as the route reports it ─────────────────────────────────────────────────
  it("answers 409 with an actionable Polish sentence when the flag is frozen", async () => {
    const seeded = await seedPet("Frozen");
    const sensitive = await owner.client
      .from("care_instructions")
      .insert({ pet_id: seeded.petId, title: "Kod bramy", is_sensitive: true, sort_order: 1 })
      .select("id")
      .single();
    expect(sensitive.error).toBeNull();
    if (!sensitive.data) {
      throw new Error("pets.put test: seeding a sensitive instruction failed");
    }

    // Cover the pet with a live trip carrying a real claim, through the real doors.
    const token = generateInviteToken();
    const { data: period } = await owner.client.rpc("create_period_with_slots", {
      p_title: "Wyjazd",
      p_start_date: "2026-10-01",
      p_end_date: "2026-10-02",
      p_token_digest: await digestInviteToken(token),
      p_pet_ids: [seeded.petId],
    });
    if (!period) {
      throw new Error("pets.put test: seeding a covering period failed");
    }
    const { data: slots } = await owner.client.from("care_slots").select("id").eq("period_id", period.id).limit(1);
    const slotId = slots?.[0]?.id;
    if (!slotId) {
      throw new Error("pets.put test: the seeded period produced no slots");
    }
    const { error: claimError } = await createAnonClient().rpc("claim_slots", {
      p_token: token,
      p_slot_ids: [slotId],
      p_claim_secret: generateClaimSecret(),
      p_name: "Ania",
    });
    expect(claimError).toBeNull();

    const { status, body: payload } = await callPut({
      cookieHeader,
      userId: owner.userId,
      petId: seeded.petId,
      rawBody: JSON.stringify({
        name: "Frozen",
        species: "dog",
        instructions: [
          { id: seeded.instructionId, title: "Karmienie", is_sensitive: false },
          { id: sensitive.data.id, title: "Kod bramy", is_sensitive: false },
        ],
      }),
    });

    expect(status).toBe(409);
    const message = errorOf(payload) ?? "";
    // The count comes from the PT409 DETAIL payload, and the remedy names what to do next —
    // a terminal refusal that does not say "try again", because a retry cannot succeed.
    expect(message).toContain("1 instrukcji");
    expect(message).toContain("odwołaj wyjazd");

    // And nothing landed — the raise rolled the whole call back.
    const { data: still } = await owner.client
      .from("care_instructions")
      .select("is_sensitive")
      .eq("id", sensitive.data.id)
      .single();
    expect(still?.is_sensitive).toBe(true);
  });
});
