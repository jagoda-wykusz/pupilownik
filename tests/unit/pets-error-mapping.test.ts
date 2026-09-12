import { beforeEach, describe, expect, it, vi } from "vitest";

// How POST /api/pets turns the database's refusal codes into what an owner sees.
//
// WHY THIS EXISTS, and it is a correction. `testing-input-validation` phase 3 added the mapping in
// src/pages/api/pets.ts and believed `tests/api/pets.post.test.ts` covered it. The full-plan review
// showed it did not: that test sends `sort_order: 2147483648` and asserts only the STATUS, and the
// schema's own `.max(2147483647)` refuses the value before the route ever calls the database. The
// 400 it observes is zod's. Deleting the whole mapping left the suite green.
//
// That is the same shape as tests/unit/claim-error-mapping.test.ts, which exists because the 40P01
// branch is unreachable through the database — and this file follows it deliberately, including the
// reason it costs no stack: the client is mocked, so this runs in the Docker-free `unit` project.
//
// This is a MAPPING test, not a claim test. It asserts what the route does with an error it is
// HANDED. Whether the database really produces these codes is pinned elsewhere: 22003 and 22P05
// were both measured through the real route before the fixes landed (see the commit bodies), and
// the bounds that now prevent them are pinned by the boundary pairs in tests/api/pets.post.test.ts.

const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ rpc }),
}));

const { POST } = await import("@/pages/api/pets");

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

/** A payload that PASSES zod, so the only thing under test is what the route does with the
 *  database's answer. If this ever stops parsing, every case below would report the schema's 400
 *  instead of the mapping's — which is exactly the confusion this file was written to end. */
const VALID_PAYLOAD = {
  name: "Rex",
  species: "dog",
  instructions: [{ title: "Karma", is_sensitive: false, sort_order: 1 }],
};

async function callWithDatabaseError(error: { code: string; message: string } | null, data: unknown = null) {
  rpc.mockResolvedValue({ data, error });

  const url = new URL("http://127.0.0.1/api/pets");
  const response = await POST({
    request: new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_PAYLOAD),
    }),
    cookies: createFakeCookies(),
    locals: { user: { id: "11111111-1111-1111-1111-111111111111" } },
  } as never);

  return { status: response.status, body: (await response.json()) as { error?: string } };
}

beforeEach(() => {
  rpc.mockReset();
});

describe("a database refusal caused by client input answers 400, not 500", () => {
  it("maps 22003 (a number the column cannot hold)", async () => {
    const { status, body } = await callWithDatabaseError({
      code: "22003",
      message: 'value "1000000000000" is out of range for type integer',
    });

    expect(status).toBe(400);
    expect(body.error).toBe("Kolejność instrukcji jest poza dozwolonym zakresem");
  });

  it.each(["22P05", "22021"])("maps %s (a NUL character inside a string)", async (code) => {
    const { status, body } = await callWithDatabaseError({ code, message: "unsupported Unicode escape sequence" });

    expect(status).toBe(400);
    expect(body.error).toBe("Tekst zawiera niedozwolony znak");
  });

  it("proves the payload itself is valid, so the 400s above came from the mapping", async () => {
    // The positive control, and it is the whole reason this file can be trusted: without it, a
    // payload that zod rejected would produce a 400 in every case above and each assertion would
    // pass having never reached the code it names.
    const { status } = await callWithDatabaseError(null, { id: "22222222-2222-2222-2222-222222222222" });

    expect(status).toBe(201);
  });
});

describe("a genuine server fault still answers 500", () => {
  it("does not map an unknown code", async () => {
    const { status, body } = await callWithDatabaseError({ code: "53300", message: "too many connections" });

    expect(status).toBe(500);
    expect(body.error).toBe("Nie udało się zapisać zwierzęcia");
  });

  it("does not map 42501, which this route cannot reach", async () => {
    // Deliberate: create_pet_with_instructions sets `owner_id = (select auth.uid())` itself, so an
    // RLS with-check refusal cannot arise here — unlike POST /api/periods, where a foreign pet id
    // does reach one and periods.ts maps it. Pinning the 500 records that the exclusion is a
    // decision about reachability, not an oversight; if this route ever gains a path where a caller
    // names someone else's row, this test is where that shows up.
    const { status } = await callWithDatabaseError({
      code: "42501",
      message: "new row violates row-level security policy",
    });

    expect(status).toBe(500);
  });
});
