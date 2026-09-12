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

async function callPost(cookieHeader: string | null, userId: string | null, rawBody: string): Promise<CallResult> {
  const url = new URL("http://127.0.0.1/api/pets");
  const request = new Request(url, {
    method: "POST",
    headers: {
      ...(cookieHeader === null ? {} : { Cookie: cookieHeader }),
      "Content-Type": "application/json",
    },
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

  // The guard at src/pages/api/pets.ts:11 had no test of its own — the only untested owner guard
  // in the repo. Two cases, because they fail differently and only the second one is sharp.
  it("refuses a request with no session at all (401) and writes nothing", async () => {
    // No Cookie header: the handler's Supabase client is anon-keyed. Removing the guard would
    // NOT produce a row here — anon holds no EXECUTE on create_pet_with_instructions, so the
    // write dies at the database. What this pins is the ANSWER: a clean 401 rather than a 500
    // carrying a database error. tests/api/token-scope.test.ts covers this shape against a
    // caller holding a live invite token.
    const before = await owner.client.from("pets").select("id");

    const { status } = await callPost(null, null, JSON.stringify({ name: "Rex", species: "dog", instructions: [] }));

    expect(status).toBe(401);

    const after = await owner.client.from("pets").select("id");
    expect(after.data?.length).toBe(before.data?.length ?? 0);
  });

  it("checks auth BEFORE the write, with a valid session cookie but no locals.user", async () => {
    // The sharp one, and the shape a middleware mistake actually produces: the Cookie header
    // carries a genuine session, so createClient yields an AUTHENTICATED client which does hold
    // EXECUTE on create_pet_with_instructions. Here the route guard is the only fence, and
    // measured: delete it and this answers 201 with a real row. Mirrors
    // tests/api/revoke-period.test.ts:130 for this route.
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

  // BOUNDS, added by `testing-input-validation` phase 3. Each is a PAIR: the value exactly at the
  // limit is accepted, one more is refused. A one-sided "too long is rejected" test would keep
  // passing if someone tightened the bound to 10 — it proves a bound exists, not where it is.
  // Same shape as periods.post.test.ts:129-156, which pins the 31/32-day span this way.
  //
  // These matter more here than they look. The database carries NO length bound at all — verified
  // against information_schema on 2026-09-12: zero columns in this schema have a length limit, so
  // `22001` is unreachable and these zod caps are the ONLY bound in the system, not a first line
  // in front of a second.
  describe("the declared bounds are where they say they are", () => {
    const petWith = (overrides: Record<string, unknown>) =>
      JSON.stringify({ name: "Rex", species: "dog", instructions: [], ...overrides });

    it("accepts a 120-character name and refuses 121", async () => {
      const ok = await callPost(cookieHeader, owner.userId, petWith({ name: "n".repeat(120) }));
      expect(ok.status).toBe(201);

      const before = await owner.client.from("pets").select("id");
      const tooLong = await callPost(cookieHeader, owner.userId, petWith({ name: "n".repeat(121) }));
      expect(tooLong.status).toBe(400);

      const after = await owner.client.from("pets").select("id");
      expect(after.data?.length).toBe(before.data?.length ?? 0);
    });

    it("accepts a 120-character instruction title and refuses 121", async () => {
      // Found by a slipped mutation rather than by the plan: changing this bound from 120 to 119
      // broke nothing, which is the definition of an unpinned rule. It is a separate bound from
      // the pet's `name`, and both are 120, so a single test would not have distinguished them.
      const titled = (length: number) => [{ title: "t".repeat(length), is_sensitive: false }];

      const ok = await callPost(cookieHeader, owner.userId, petWith({ instructions: titled(120) }));
      expect(ok.status).toBe(201);

      const before = await owner.client.from("pets").select("id", { count: "exact", head: true });
      const tooLong = await callPost(cookieHeader, owner.userId, petWith({ instructions: titled(121) }));
      expect(tooLong.status).toBe(400);

      const after = await owner.client.from("pets").select("id", { count: "exact", head: true });
      expect(after.count).toBe(before.count);
    });

    it("accepts a 2000-character instruction body and refuses 2001", async () => {
      const instruction = (length: number) => [{ title: "t", body: "b".repeat(length), is_sensitive: false }];

      const ok = await callPost(cookieHeader, owner.userId, petWith({ instructions: instruction(2000) }));
      expect(ok.status).toBe(201);

      const before = await owner.client.from("pets").select("id");
      const tooLong = await callPost(cookieHeader, owner.userId, petWith({ instructions: instruction(2001) }));
      expect(tooLong.status).toBe(400);

      const after = await owner.client.from("pets").select("id");
      expect(after.data?.length).toBe(before.data?.length ?? 0);
    });

    it("accepts 50 instructions and refuses 51", async () => {
      const many = (count: number) =>
        Array.from({ length: count }, (_, index) => ({ title: `t${index}`, is_sensitive: false }));

      const ok = await callPost(cookieHeader, owner.userId, petWith({ instructions: many(50) }));
      expect(ok.status).toBe(201);

      const before = await owner.client.from("pets").select("id");
      const tooMany = await callPost(cookieHeader, owner.userId, petWith({ instructions: many(51) }));
      expect(tooMany.status).toBe(400);

      const after = await owner.client.from("pets").select("id");
      expect(after.data?.length).toBe(before.data?.length ?? 0);
    });

    it("accepts the largest sort_order the column can hold and refuses one more", async () => {
      // The one bound that was MISSING until this change, and the only case here that was a live
      // defect rather than an unpinned rule. Measured 2026-09-12 before the fix: sort_order 1e12
      // answered 500 "Nie udało się zapisać zwierzęcia", because create_pet_with_instructions
      // casts `(i ->> 'sort_order')::int` and Postgres raised 22003 — bad client input reading as
      // a server fault. 2147483647 created the pet, so the ceiling is exactly the integer type's.
      const withOrder = (value: number) =>
        petWith({ instructions: [{ title: "t", is_sensitive: false, sort_order: value }] });

      const ok = await callPost(cookieHeader, owner.userId, withOrder(2147483647));
      expect(ok.status).toBe(201);

      const before = await owner.client.from("pets").select("id", { count: "exact", head: true });
      const tooLarge = await callPost(cookieHeader, owner.userId, withOrder(2147483648));
      expect(tooLarge.status, "an out-of-range sort_order must not read as a server fault").toBe(400);

      // WHICH LAYER, not just which status — and this assertion is the whole difference between a
      // pair that bites in both directions and one that only bites when the bound is TIGHTENED.
      // Without it, deleting `.max(2147483647)` from the schema leaves this test green: the value
      // then reaches Postgres, raises 22003, and pets.ts maps it to 400 as well. Both layers answer
      // 400, so only the message distinguishes them. Found by the full-plan review, after the
      // loosening mutation came back green and was read as a virtue rather than a dead assertion.
      expect(
        (tooLarge.body as { error?: string }).error,
        "the schema should refuse this before the database sees it",
      ).toBe("Validation failed");

      const after = await owner.client.from("pets").select("id", { count: "exact", head: true });
      expect(after.count).toBe(before.count);
    });
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
