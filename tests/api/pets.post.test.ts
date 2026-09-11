import { beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/pages/api/pets";
import { createAuthenticatedOwner } from "../helpers/session";
import type { OwnerContext } from "../helpers/auth";

// Risk #7 — server-side validation on POST /api/pets (S-01, test-plan §6.4).
//
// Drives the REAL handler against the local Supabase stack with a genuine owner
// session (auth is never mocked). Asserts BOTH sides of the contract: zod rejects
// malformed input before any write (400, DB untouched), and a valid payload
// persists the pet + instructions for that owner (201 + follow-up query proves
// the side-effect, not just the status code).

// Minimal AstroCookies stand-in: the handler's Supabase client reads cookies from
// the request's Cookie header, not from here — this only absorbs setAll writes a
// token refresh may emit.
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

async function callPost(cookieHeader: string, userId: string | null, rawBody: string): Promise<CallResult> {
  const url = new URL("http://127.0.0.1/api/pets");
  const request = new Request(url, {
    method: "POST",
    headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
    body: rawBody,
  });

  const context = {
    request,
    cookies: createFakeCookies(),
    locals: { user: userId === null ? null : { id: userId } },
  };

  type PostArgs = Parameters<typeof POST>;
  const response = await POST(context as unknown as PostArgs[0]);
  const body: unknown = await response.json();
  return { status: response.status, body };
}

describe("POST /api/pets — validated atomic create", () => {
  let cookieHeader: string;
  let owner: OwnerContext;

  beforeAll(async () => {
    const authed = await createAuthenticatedOwner();
    cookieHeader = authed.cookieHeader;
    owner = authed.owner;
  });

  it("refuses a request with no session (401) and writes nothing", async () => {
    // The guard at src/pages/api/pets.ts:11 had no test of its own — the only untested owner
    // guard in the repo. Note what removing it does NOT do: the write still fails, because a
    // sessionless caller gets an anon-keyed client and anon holds no EXECUTE on
    // create_pet_with_instructions. What this pins is that the route answers a clean 401 rather
    // than a 500 carrying a database error. tests/api/token-scope.test.ts covers the same guard
    // against a caller holding a live invite token.
    const before = await owner.client.from("pets").select("id");

    const { status } = await callPost(
      cookieHeader,
      null,
      JSON.stringify({ name: "Rex", species: "dog", instructions: [] }),
    );

    expect(status).toBe(401);

    const after = await owner.client.from("pets").select("id");
    expect(after.data?.length).toBe(before.data?.length ?? 0);
  });

  it("rejects a payload with a missing name (400) and writes nothing", async () => {
    const before = await owner.client.from("pets").select("id");
    const { status } = await callPost(cookieHeader, owner.userId, JSON.stringify({ species: "dog", instructions: [] }));

    expect(status).toBe(400);

    const after = await owner.client.from("pets").select("id");
    expect(after.data?.length).toBe(before.data?.length ?? 0);
  });

  it("rejects an invalid species (400)", async () => {
    const { status, body } = await callPost(
      cookieHeader,
      owner.userId,
      JSON.stringify({ name: "Rex", species: "dragon", instructions: [] }),
    );

    expect(status).toBe(400);
    expect((body as { error?: string }).error).toBe("Validation failed");
  });

  it("rejects a non-array instructions field (400)", async () => {
    const { status } = await callPost(
      cookieHeader,
      owner.userId,
      JSON.stringify({ name: "Rex", species: "dog", instructions: "nope" }),
    );

    expect(status).toBe(400);
  });

  it("rejects a malformed (non-JSON) body (400)", async () => {
    const { status } = await callPost(cookieHeader, owner.userId, "{not json");
    expect(status).toBe(400);
  });

  it("creates the pet + instructions for the owner on a valid payload (201)", async () => {
    const { status, body } = await callPost(
      cookieHeader,
      owner.userId,
      JSON.stringify({
        name: "Latte",
        species: "cat",
        breed: "burmese",
        age: "2 lata",
        instructions: [
          { title: "Karmienie", body: "2x dziennie", is_sensitive: false, sort_order: 0 },
          { title: "Klucze", body: "u sąsiada", is_sensitive: true, sort_order: 1 },
        ],
      }),
    );

    expect(status).toBe(201);
    const pet = (body as { pet?: { id?: string; owner_id?: string; name?: string } }).pet;
    expect(pet?.name).toBe("Latte");
    expect(pet?.owner_id).toBe(owner.userId);
    const petId = pet?.id;
    if (!petId) {
      throw new Error("201 response did not include the new pet id");
    }

    // Follow-up query as the SAME owner proves the write landed under their RLS.
    const { data: rows } = await owner.client
      .from("pets")
      .select("id, name, care_instructions(title, is_sensitive)")
      .eq("id", petId);

    expect(rows?.length).toBe(1);
    const instructions = rows?.[0]?.care_instructions ?? [];
    expect(instructions.length).toBe(2);
    expect(instructions.some((i) => i.is_sensitive)).toBe(true);
    expect(instructions.some((i) => !i.is_sensitive)).toBe(true);
  });
});
