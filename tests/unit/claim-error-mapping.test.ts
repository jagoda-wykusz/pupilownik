import { beforeEach, describe, expect, it, vi } from "vitest";

// How POST /invite/claim turns the database's refusal codes into what a caretaker sees.
//
// WHY THIS EXISTS, and it is a correction. Phase 4 added two "overlapping selections" race
// tests whose comments claimed they were the only shape that could reach the 40P01 (deadlock)
// branch. That claim is FALSE, and the phase-4 review caught it: the guarded UPDATE in
// claim_slots carries no ORDER BY, so both racing sessions run identical SQL, get the same
// plan, and therefore take row locks in the SAME order. A consistent global lock order makes
// deadlock impossible — the loser blocks, re-evaluates `claimed_by_name is null` under READ
// COMMITTED, and raises PT409. Every time. Ten runs at each layer saw PT409 not by luck but
// because it is the only outcome the schedule permits.
//
// So the 40P01 → 409 mapping is unreachable through the database, and was untested while the
// plan claimed it was "exercised rather than assumed". Injecting the error is the only
// deterministic way to reach it, and it costs no stack: the client is mocked, so this runs in
// the Docker-free `unit` project.
//
// This is a MAPPING test, not a claim test. It asserts what the route does with an error it is
// handed — the real refusals are pinned against the real database in tests/api/invite-claim.test.ts.

const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ rpc }),
}));

const { POST: claimRoute } = await import("@/pages/invite/claim");

const TOKEN = "a".repeat(43);
const SLOT_ID = "11111111-1111-4111-8111-111111111111";

function createFakeCookies() {
  const store = new Map<string, { value: string; options: Record<string, unknown> }>();
  return {
    store,
    get(name: string) {
      const record = store.get(name);
      return record === undefined ? undefined : { value: record.value };
    },
    set(name: string, value: string, options: Record<string, unknown>) {
      store.set(name, { value, options });
    },
    delete(name: string) {
      store.delete(name);
    },
    has(name: string) {
      return store.has(name);
    },
  };
}

async function call(): Promise<{ status: number; body: { error?: string }; setCookie: boolean }> {
  const url = new URL("http://127.0.0.1/invite/claim");
  const request = new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN, slot_ids: [SLOT_ID], name: "Ania" }),
  });

  const cookies = createFakeCookies();
  const context = { request, url, cookies, params: {}, locals: { user: null } };

  type Args = Parameters<typeof claimRoute>;
  const response = await claimRoute(context as unknown as Args[0]);
  return {
    status: response.status,
    body: (await response.json()) as { error?: string },
    setCookie: cookies.store.size > 0,
  };
}

describe("POST /invite/claim — what each database refusal becomes", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("turns a DEADLOCK into a retryable 409, not an error page", async () => {
    // Unreachable through claim_slots today (see the header), which is exactly why it needs
    // injecting: the branch exists because a future schema change could reintroduce the
    // possibility, and a 500 here would tell a caretaker their claim broke when in fact the
    // transaction rolled back cleanly and retrying would work.
    rpc.mockResolvedValue({ data: null, error: { code: "40P01", message: "deadlock detected" } });

    const { status, body, setCookie } = await call();

    expect(status).toBe(409);
    expect(body.error).toBe("Ktoś zapisywał się w tej samej chwili. Spróbuj jeszcze raz.");
    expect(setCookie).toBe(false);
  });

  it("turns a PT400 into a 400 in Polish, never a zod message", async () => {
    // Reaching this means the database rejected something zod allowed — a genuine mismatch
    // between the two validation layers. The sentence is pinned because the alternative is
    // leaking `Invalid option: expected one of …` to a caretaker (test-plan.md §7 records the
    // same defect still live on two other routes).
    rpc.mockResolvedValue({ data: null, error: { code: "PT400", message: "p_name required" } });

    const { status, body, setCookie } = await call();

    expect(status).toBe(400);
    expect(body.error).toBe("Nie udało się zająć terminów. Odśwież stronę i spróbuj ponownie.");
    expect(setCookie).toBe(false);
  });

  it("names the taken terms on a PT409, from the DETAIL the function sends", async () => {
    // conflictMessage is module-private, so this is the only reachable assertion on its
    // composition: the DETAIL rows become "day, time-of-day" in Polish.
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "PT409",
        message: "slot taken",
        details: JSON.stringify([{ slot_date: "2027-07-14", time_of_day: "morning" }]),
      },
    });

    const { status, body } = await call();

    expect(status).toBe(409);
    expect(body.error).toContain("Zajęte już:");
    expect(body.error).toContain("lipca");
  });

  it("falls through to a 500 for a code it does not recognise", async () => {
    // The honest answer for an unclassified failure — and the one that must NOT be reached by
    // any of the three above, which is what makes those assertions worth having.
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "internal" } });

    const { status, body } = await call();

    expect(status).toBe(500);
    expect(body.error).toBe("Nie udało się zająć terminów");
  });

  it("answers the uniform 404 when the function returns NULL", async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    const { status, body, setCookie } = await call();

    expect(status).toBe(404);
    expect(body.error).toBe("Ten link nie działa");
    expect(setCookie).toBe(false);
  });
});
