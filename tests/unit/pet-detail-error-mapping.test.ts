import { beforeEach, describe, expect, it, vi } from "vitest";

// How PUT and DELETE /api/pets/[id] turn the database's refusals into what an owner reads.
//
// WHY THIS EXISTS, and it is a correction made by S-09's own implementation review (F6). The
// plan's Testing Strategy named this file and the slice shipped without it, on the assumption
// that tests/api/pets.put.test.ts and pets.delete.test.ts cover the mapping. They cover the
// paths the DATABASE can actually produce — and six branches are not among them:
//
//   - blockingTitles' three defensive paths (DETAIL that is not JSON, not an array, or whose
//     rows carry a non-string `title`). delete_pet always emits well-formed {id,title} JSON, so
//     no integration test can reach them.
//   - blockedMessage's ">2 trips" tail and its empty-titles fallback.
//   - frozenMessage's two fallbacks (absent DETAIL, and DETAIL that is not an array).
//   - the 22P05 / 22021 pair on PUT, which the route's own comment calls belt-and-braces
//     because zod refuses a NUL first.
//
// That is the exact shape tests/unit/pets-error-mapping.test.ts was written for, and its header
// records the measurement behind the rule: deleting a whole mapping once left the route test
// green. This file follows it, including the mocked client that keeps it Docker-free and in the
// `unit` project.
//
// It is a MAPPING test, not a claim about the database. Whether delete_pet really raises PT409
// with {id,title} in DETAIL is pinned by tests/rls/delete-pet.test.ts against the real stack.

const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ rpc }),
}));

const { PUT, DELETE } = await import("@/pages/api/pets/[id]");

const PET_ID = "33333333-3333-4333-8333-333333333333";
const USER = { id: "11111111-1111-1111-1111-111111111111" };
const ORIGIN = "http://127.0.0.1";

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

interface DatabaseError {
  code: string;
  message: string;
  details?: string | null;
}

/** A body that PASSES updatePetSchema, so the only thing under test is what the route does with
 *  the database's answer. If this ever stops parsing, every case below would report the schema's
 *  400 instead of the mapping's — the confusion the sibling file was written to end. */
const VALID_BODY = {
  name: "Rex",
  species: "dog",
  instructions: [{ title: "Karma", is_sensitive: false }],
  expected_updated_at: "2026-09-14T10:00:00.000Z",
};

async function callPut(error: DatabaseError | null, data: unknown = null) {
  rpc.mockResolvedValue({ data, error });
  const url = new URL(`${ORIGIN}/api/pets/${PET_ID}`);
  const response = await PUT({
    request: new Request(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    }),
    url,
    params: { id: PET_ID },
    cookies: createFakeCookies(),
    locals: { user: USER },
  } as never);
  return { status: response.status, body: (await response.json()) as { error?: string } };
}

async function callDelete(error: DatabaseError | null, data: unknown = null) {
  rpc.mockResolvedValue({ data, error });
  const url = new URL(`${ORIGIN}/api/pets/${PET_ID}`);
  const response = await DELETE({
    request: new Request(url, { method: "DELETE" }),
    url,
    params: { id: PET_ID },
    cookies: createFakeCookies(),
    locals: { user: USER },
  } as never);
  return { status: response.status, body: (await response.json()) as { error?: string } };
}

beforeEach(() => {
  rpc.mockReset();
});

describe("DELETE — the blocking trips in the 409 sentence", () => {
  it("names one blocking trip", async () => {
    const { status, body } = await callDelete({
      code: "PT409",
      message: "delete_pet: 1 unrevoked period(s) still cover this pet",
      details: JSON.stringify([{ id: "a", title: "Majówka" }]),
    });

    expect(status).toBe(409);
    expect(body.error).toContain("Majówka");
    expect(body.error).toContain("odwołaj wyjazd");
  });

  it("names two and COUNTS the rest, so six trips do not produce a sentence nobody reads", async () => {
    const { status, body } = await callDelete({
      code: "PT409",
      message: "delete_pet: 4 unrevoked period(s) still cover this pet",
      details: JSON.stringify([
        { id: "a", title: "Wyjazd A" },
        { id: "b", title: "Wyjazd B" },
        { id: "c", title: "Wyjazd C" },
        { id: "d", title: "Wyjazd D" },
      ]),
    });

    expect(status).toBe(409);
    expect(body.error).toContain("Wyjazd A");
    expect(body.error).toContain("Wyjazd B");
    expect(body.error).not.toContain("Wyjazd C");
    // Polish agreement, three forms: 1 -> "inny", 2-4 -> "inne", 5+ -> "innych". Two remaining
    // trips take the middle one. This assertion was written the other way round first and the
    // code was wrong a third way — hence the explicit table below.
    expect(body.error).toContain("2 inne");
  });

  it.each([
    [3, "1 inny"],
    [4, "2 inne"],
    [6, "4 inne"],
    [7, "5 innych"],
    [14, "12 innych"],
    [24, "22 inne"],
  ])("agrees the remainder for %i blocking trips: %s", async (total, expected) => {
    const { body } = await callDelete({
      code: "PT409",
      message: `delete_pet: ${total} unrevoked period(s) still cover this pet`,
      details: JSON.stringify(Array.from({ length: total }, (_, i) => ({ id: String(i), title: `T${i}` }))),
    });

    // The whole table, not one representative case: 12-14 are the exception that takes the
    // genitive despite ending in 2-4, and 22 is the one that proves the rule is about the LAST
    // digit rather than the number's size.
    expect(body.error).toContain(expected);
  });

  it("uses the singular for a single remaining trip", async () => {
    const { body } = await callDelete({
      code: "PT409",
      message: "delete_pet: 3 unrevoked period(s) still cover this pet",
      details: JSON.stringify([
        { id: "a", title: "A" },
        { id: "b", title: "B" },
        { id: "c", title: "C" },
      ]),
    });

    expect(body.error).toContain("1 inny");
  });

  // The three defensive paths. Each one is a shape delete_pet does not produce — so if the
  // function and the route ever diverge, this is where it surfaces rather than as a crash
  // inside an error handler.
  it.each([
    ["DETAIL that is not JSON", "{not json"],
    ["DETAIL that is not an array", JSON.stringify({ id: "a", title: "T" })],
    ["rows whose title is not a string", JSON.stringify([{ id: "a", title: 42 }])],
    ["an empty array", JSON.stringify([])],
    ["absent DETAIL", null],
  ])("falls back to a usable sentence on %s", async (_label, details) => {
    const { status, body } = await callDelete({
      code: "PT409",
      message: "delete_pet: refused",
      details,
    });

    expect(status).toBe(409);
    // Still actionable, still terminal, and no "undefined" or "[object Object]" in it.
    expect(body.error).toContain("aktywny wyjazd");
    expect(body.error).toContain("odwołaj wyjazd");
    expect(body.error).not.toContain("undefined");
    expect(body.error).not.toContain("object Object");
  });

  it("does not map an unknown code", async () => {
    const { status, body } = await callDelete({ code: "53300", message: "too many connections" });

    expect(status).toBe(500);
    expect(body.error).toBe("Nie udało się usunąć zwierzęcia");
  });

  it("answers 404 on a NULL return, and 200 on a real one", async () => {
    expect((await callDelete(null, null)).status).toBe(404);
    expect((await callDelete(null, PET_ID)).status).toBe(200);
  });
});

describe("PUT — the freeze sentence", () => {
  it("names the count of frozen rows", async () => {
    const { status, body } = await callPut({
      code: "PT409",
      message: "frozen",
      details: JSON.stringify(["a", "b"]),
    });

    expect(status).toBe(409);
    expect(body.error).toContain("2 instrukcji");
    expect(body.error).toContain("odwołaj wyjazd");
  });

  it.each([
    ["absent DETAIL", null],
    ["DETAIL that is not an array", JSON.stringify({ nope: 1 })],
    ["DETAIL that is not JSON", "{not json"],
    ["an empty array", JSON.stringify([])],
  ])("falls back to the generic freeze sentence on %s", async (_label, details) => {
    const { status, body } = await callPut({ code: "PT409", message: "frozen", details });

    expect(status).toBe(409);
    expect(body.error).toContain("wrażliwej");
    expect(body.error).not.toContain("undefined");
  });
});

describe("PUT — the version token and the input codes", () => {
  it("maps PT412 to 409 and tells the owner to refresh, never to retry", async () => {
    const { status, body } = await callPut({
      code: "PT412",
      message: "the pet changed since this form was loaded",
    });

    expect(status).toBe(409);
    expect(body.error).toContain("Odśwież stronę");
    // Terminal: a retry with the same stale body is refused identically, so the sentence must
    // not invite one.
    expect(body.error).not.toContain("Spróbuj ponownie");
  });

  it("keeps PT412 and PT409 apart — the two refusals have different remedies", async () => {
    const stale = await callPut({ code: "PT412", message: "stale" });
    const frozen = await callPut({ code: "PT409", message: "frozen", details: JSON.stringify(["a"]) });

    // Both are 409 to the owner, and they must not say the same thing. Sharing one SQLSTATE
    // would have forced the route to sniff DETAIL to tell them apart.
    expect(stale.status).toBe(frozen.status);
    expect(stale.body.error).not.toBe(frozen.body.error);
  });

  it.each(["22P05", "22021"])("maps %s (a NUL inside a string) to 400", async (code) => {
    // Belt-and-braces by the route's own account: zod refuses a NUL first, so no integration
    // test can reach this branch — which is precisely why it needs this one.
    const { status, body } = await callPut({ code, message: "unsupported Unicode escape sequence" });

    expect(status).toBe(400);
    expect(body.error).toBe("Tekst zawiera niedozwolony znak");
  });

  it("does not map an unknown code", async () => {
    const { status, body } = await callPut({ code: "53300", message: "too many connections" });

    expect(status).toBe(500);
    expect(body.error).toBe("Nie udało się zapisać zmian");
  });

  it("proves the body itself is valid, so the statuses above came from the mapping", async () => {
    // The positive control. Without it, a body zod rejected would produce a 400 in several cases
    // above and each assertion would pass having never reached the code it names.
    const { status } = await callPut(null, PET_ID);

    expect(status).toBe(200);
  });
});
