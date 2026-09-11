import { beforeAll, describe, expect, it } from "vitest";
import { POST as claimRoute } from "@/pages/invite/claim";
import { CLAIM_COOKIE } from "@/lib/claim-cookie";
import { digestInviteToken, generateInviteToken } from "@/lib/invite-token";
import { createOwnerWithPet, type OwnerWithPetContext } from "../helpers/auth";

// Risk #5 (the link-only path) and Risk #7 (server-side validation) on the route that turns a
// caretaker's click into a claim — S-03 Phase 4.
//
// This drives the REAL handler against the local stack. The two assertions that matter most
// are the two INVERSIONS from the repo's other API routes, because both look like bugs:
//
//   1. A claim with NO session succeeds. Every other route here answers 401 without
//      `locals.user`; this one must not, because a caretaker has no account and never will.
//   2. A cross-origin request is refused BY THIS HANDLER. Astro's checkOrigin skips
//      application/json, so nothing upstream does it.
//
// The third is the one a reader would not think to check: the raw capability secret must
// leave the server exactly once, into an HttpOnly cookie, and must not appear in the body.

interface CookieRecord {
  value: string;
  options: Record<string, unknown>;
}

// Astro's cookie object, only as much of it as the handler touches. Recording the OPTIONS is
// the point — the attribute set is the contract (src/lib/claim-cookie.ts), and a Path that
// drifts is a bug with no symptom.
function createFakeCookies(seed?: Record<string, string>) {
  const store = new Map<string, CookieRecord>();
  for (const [name, value] of Object.entries(seed ?? {})) {
    store.set(name, { value, options: {} });
  }
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

interface CallResult {
  status: number;
  body: Record<string, unknown>;
  cookies: ReturnType<typeof createFakeCookies>;
  rawBody: string;
}

async function call(init: {
  body: unknown;
  rawBody?: string;
  origin?: string;
  cookies?: Record<string, string>;
}): Promise<CallResult> {
  const url = new URL("http://127.0.0.1/invite/claim");
  const request = new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init.origin === undefined ? {} : { Origin: init.origin }),
    },
    body: init.rawBody ?? JSON.stringify(init.body),
  });

  const cookies = createFakeCookies(init.cookies);
  const context = {
    request,
    url,
    cookies,
    params: {},
    // No session at all — the caretaker's actual state, and the inversion this suite exists
    // to pin.
    locals: { user: null },
  };

  type Args = Parameters<typeof claimRoute>;
  const response = await claimRoute(context as unknown as Args[0]);
  const rawBody = await response.text();
  return { status: response.status, body: JSON.parse(rawBody) as Record<string, unknown>, cookies, rawBody };
}

/** Unique per call: the seeded period is shared by every test in this file, so a fixed name
 *  could collide with a claim made 300 lines earlier and make an assertion pass or fail for a
 *  reason that has nothing to do with the case under test. */
function suffix(): string {
  return crypto.randomUUID().slice(0, 8);
}

describe("POST /invite/claim", () => {
  let owner: OwnerWithPetContext;
  let token: string;
  let periodId: string;
  let slotIds: string[];

  async function freeSlots(count: number): Promise<string[]> {
    const { data, error } = await owner.client
      .from("care_slots")
      .select("id")
      .eq("period_id", periodId)
      .is("claimed_by_name", null)
      .order("slot_date")
      .order("time_of_day")
      .limit(count);
    expect(error).toBeNull();
    const ids = (data ?? []).map((slot) => slot.id);
    // Fail LOUDLY on exhaustion. Returning a short array silently changes what the caller
    // asserts: an empty slot_ids is caught by zod as a 400, so the "uniform 404" and "409
    // names the term" tests would both pass for entirely the wrong reason. This bit once.
    if (ids.length < count) {
      throw new Error(`invite-claim test: wanted ${count} free slots, found ${ids.length} — widen the seeded period`);
    }
    return ids;
  }

  beforeAll(async () => {
    owner = await createOwnerWithPet("Burek");
    token = generateInviteToken();
    const { data, error } = await owner.client.rpc("create_period_with_slots", {
      p_title: "Wyjazd",
      p_start_date: "2027-07-13",
      p_end_date: "2027-07-31",
      p_token_digest: await digestInviteToken(token),
      p_pet_ids: [owner.petId],
      p_caretaker_note: "Klucze u sąsiadki",
    });
    expect(error).toBeNull();
    if (!data) {
      throw new Error("invite-claim test: seeding the period failed");
    }
    periodId = data.id;
    slotIds = await freeSlots(9);
  });

  // ── The two inversions ──────────────────────────────────────────────────────────────────

  it("succeeds with NO session — the inversion that matters most", async () => {
    const ids = slotIds.slice(0, 2);
    const { status, body } = await call({ body: { token, slot_ids: ids, name: "Ania" } });

    expect(status).toBe(200);
    expect(body.name).toBe("Ania");
    expect(body.claimed).toBe(2);

    // And it actually wrote: a 200 that claimed nothing would pass an assertion on status alone.
    const { data } = await owner.client.from("care_slots").select("id, claimed_by_name").in("id", ids);
    expect(data?.every((slot) => slot.claimed_by_name === "Ania")).toBe(true);
  });

  it("refuses a cross-origin request (403) and writes nothing", async () => {
    const ids = await freeSlots(1);
    const { status } = await call({
      body: { token, slot_ids: ids, name: "Intruz" },
      origin: "https://evil.example",
    });

    expect(status).toBe(403);

    const { data } = await owner.client.from("care_slots").select("claimed_by_name").in("id", ids);
    expect(data?.[0].claimed_by_name).toBeNull();
  });

  it("accepts a same-origin request, and one with no Origin at all", async () => {
    // Same-origin is the browser case; absent Origin is every non-browser caller. Refusing the
    // latter would buy nothing SameSite=Lax does not already give.
    const sameOrigin = await call({
      body: { token, slot_ids: await freeSlots(1), name: "Basia" },
      origin: "http://127.0.0.1",
    });
    expect(sameOrigin.status).toBe(200);

    const noOrigin = await call({ body: { token, slot_ids: await freeSlots(1), name: "Celina" } });
    expect(noOrigin.status).toBe(200);
  });

  // ── The cookie ──────────────────────────────────────────────────────────────────────────

  it("sets the capability as an HttpOnly cookie scoped to /invite, and never in the body", async () => {
    const { body, cookies, rawBody } = await call({
      body: { token, slot_ids: await freeSlots(1), name: "Dorota" },
    });

    const record = cookies.store.get(CLAIM_COOKIE);
    expect(record).toBeDefined();
    expect(record?.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/invite",
    });
    expect(record?.options.maxAge).toBeGreaterThan(0);

    // The secret leaves the server exactly once, into that cookie. Asserted against the RAW
    // response text, not against parsed keys: a secret smuggled into any field, or into a
    // nested object, fails this. It is the same discipline the invite token gets.
    const secret = record?.value ?? "";
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rawBody).not.toContain(secret);
    expect(Object.keys(body).sort()).toEqual(["alreadyHeld", "claimed", "name"]);
  });

  it("reuses an existing capability and ignores the name sent with it", async () => {
    const first = await call({ body: { token, slot_ids: await freeSlots(1), name: "Ewa" } });
    const secret = first.cookies.store.get(CLAIM_COOKIE)?.value ?? "";

    // The follow-up carries the cookie, and a DIFFERENT name — what a tampered client, or a
    // second person on a shared browser, would send.
    const second = await call({
      body: { token, slot_ids: await freeSlots(1), name: "Fiona" },
      cookies: { [CLAIM_COOKIE]: secret },
    });

    expect(second.status).toBe(200);
    expect(second.body.name).toBe("Ewa");
    expect(second.cookies.store.get(CLAIM_COOKIE)?.value).toBe(secret);
  });

  it("is retry-safe: resending an identical claim succeeds and reports it as already held", async () => {
    const ids = await freeSlots(1);
    const first = await call({ body: { token, slot_ids: ids, name: "Gosia" } });
    const secret = first.cookies.store.get(CLAIM_COOKIE)?.value ?? "";
    expect(first.body.claimed).toBe(1);

    // The response was lost; the client resends. This must NOT read as a refusal.
    const retry = await call({ body: { token, slot_ids: ids }, cookies: { [CLAIM_COOKIE]: secret } });

    expect(retry.status).toBe(200);
    expect(retry.body.claimed).toBe(0);
    expect(retry.body.alreadyHeld).toBe(1);
  });

  it("recovers from a corrupted capability cookie instead of dead-ending on it", async () => {
    // Found in review. `existing ?? mint()` catches only null/undefined, so a truncated or
    // tampered cookie went straight to claim_slots, which raises PT400 on its 43-character
    // bound — and nothing clears the cookie, so that browser would get a 400 on every future
    // attempt, forever. Refreshing would not help, and the PAGE degrades silently for the same
    // input (get_claimed_details answers NULL), so the symptom points nowhere near the cause.
    const ids = await freeSlots(1);
    const { status, body, cookies } = await call({
      body: { token, slot_ids: ids, name: "Klara" },
      cookies: { [CLAIM_COOKIE]: "not-a-valid-capability" },
    });

    expect(status).toBe(200);
    expect(body.name).toBe("Klara");
    // A fresh, well-formed capability replaced the junk.
    const replaced = cookies.store.get(CLAIM_COOKIE)?.value ?? "";
    expect(replaced).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(replaced).not.toBe("not-a-valid-capability");
  });

  // ── Refusals ────────────────────────────────────────────────────────────────────────────

  it("answers 409 naming the taken term, and claims nothing", async () => {
    const taken = await freeSlots(1);
    await call({ body: { token, slot_ids: taken, name: "Hania" } });

    const alsoFree = await freeSlots(1);
    const { status, body, cookies } = await call({
      body: { token, slot_ids: [...taken, ...alsoFree], name: "Iwona" },
    });

    expect(status).toBe(409);
    // The sentence names the term rather than saying "a slot was taken" and sending the
    // caretaker back to a grid of nine to work out which.
    expect(body.error).toMatch(/Zajęte już:/);
    expect(body.error).toMatch(/lipca/);

    // All or nothing: the still-free slot was NOT claimed by Iwona.
    const { data } = await owner.client.from("care_slots").select("claimed_by_name").in("id", alsoFree);
    expect(data?.[0].claimed_by_name).toBeNull();

    // And no capability. "sets NO cookie on any refusal" below covers 403, 404 and 400 — this
    // is the PT409 path, the one refusal that comes from the database rather than the route,
    // and a cookie here would hand the loser a reveal they never earned.
    expect(cookies.store.has(CLAIM_COOKIE)).toBe(false);
  });

  it("answers a generic 409 when the conflict cannot be named", async () => {
    // A slot uuid from ANOTHER period. claim_slots refuses it but leaves DETAIL empty on
    // purpose — naming it would confirm it exists (Phase 2 impl-review F6). The route must
    // render that case rather than composing an empty sentence.
    const other = await createOwnerWithPet("Mru");
    const otherToken = generateInviteToken();
    const { data: otherPeriod } = await other.client.rpc("create_period_with_slots", {
      p_title: "Cudzy",
      p_start_date: "2027-08-01",
      p_end_date: "2027-08-01",
      p_token_digest: await digestInviteToken(otherToken),
      p_pet_ids: [other.petId],
    });
    if (!otherPeriod) {
      throw new Error("invite-claim test: seeding the other period failed");
    }
    const { data: foreign } = await other.client
      .from("care_slots")
      .select("id")
      .eq("period_id", otherPeriod.id)
      .limit(1);
    const foreignId = foreign?.[0].id ?? "";

    const { status, body } = await call({ body: { token, slot_ids: [foreignId], name: "Intruz" } });

    expect(status).toBe(409);
    expect(typeof body.error).toBe("string");
    // Not an empty or half-formed sentence.
    expect(body.error).toBe("Ten termin został właśnie zajęty. Odśwież stronę i wybierz inny.");
  });

  it("answers the uniform 404 for an unresolvable token", async () => {
    const { status, body } = await call({
      body: { token: generateInviteToken(), slot_ids: await freeSlots(1), name: "Ania" },
    });

    expect(status).toBe(404);
    // Says nothing about WHY. Unknown, malformed and revoked are indistinguishable here, as
    // they are everywhere else in this model.
    expect(body.error).toBe("Ten link nie działa");
  });

  it("answers the same uniform 404 for a REVOKED period as for an unknown token", async () => {
    // Rule 4 is about indistinguishability, and only the unknown-token half was covered here.
    // The SQL layer pins this (invite-token.test.ts); the route's own mapping did not.
    const revokedToken = generateInviteToken();
    const { data: revoked, error } = await owner.client.rpc("create_period_with_slots", {
      p_title: "Odwolany",
      p_start_date: "2027-09-01",
      p_end_date: "2027-09-02",
      p_token_digest: await digestInviteToken(revokedToken),
      p_pet_ids: [owner.petId],
    });
    expect(error).toBeNull();
    if (!revoked) {
      throw new Error("invite-claim test: seeding the revoked period failed");
    }
    const { data: slot } = await owner.client.from("care_slots").select("id").eq("period_id", revoked.id).limit(1);
    const slotId = slot?.[0].id ?? "";

    await owner.client.from("care_periods").update({ revoked_at: new Date().toISOString() }).eq("id", revoked.id);

    const revokedCall = await call({ body: { token: revokedToken, slot_ids: [slotId], name: "Ania" } });
    const unknownCall = await call({
      body: { token: generateInviteToken(), slot_ids: await freeSlots(1), name: "Ania" },
    });

    // Byte-identical, not merely both-4xx: a distinct answer for the revoked case would confirm
    // the period exists.
    expect(revokedCall.status).toBe(unknownCall.status);
    expect(revokedCall.body).toEqual(unknownCall.body);
    expect(revokedCall.status).toBe(404);
  });

  it("sets NO cookie on any refusal", async () => {
    // `cookies.set` sits after every refusal branch today, but nothing pinned that ordering —
    // moving it above the error handling would hand a capability to a caller whose claim was
    // rejected, and every existing test would stay green.
    const crossOrigin = await call({
      body: { token, slot_ids: await freeSlots(1), name: "Ania" },
      origin: "https://evil.example",
    });
    const unknownToken = await call({
      body: { token: generateInviteToken(), slot_ids: await freeSlots(1), name: "Ania" },
    });
    const badRequest = await call({ body: { token, slot_ids: [], name: "Ania" } });

    for (const refusal of [crossOrigin, unknownToken, badRequest]) {
      expect(refusal.status).toBeGreaterThanOrEqual(400);
      expect(refusal.cookies.store.has(CLAIM_COOKIE)).toBe(false);
    }
  });

  it("carries one capability across trips, and asks for the name again on each", async () => {
    // Path=/invite means the cookie rides along on EVERY invite link this browser opens, so
    // this is not a hypothetical. Phase 3 pinned the SQL half (each trip answers only its own
    // slots); this is the route half — and it pins the behaviour the cookie's own comment got
    // wrong until the Phase 4 review (F5): the CAPABILITY carries, the NAME does not.
    const secondToken = generateInviteToken();
    const { data: second } = await owner.client.rpc("create_period_with_slots", {
      p_title: "Drugi wyjazd",
      p_start_date: "2027-10-01",
      p_end_date: "2027-10-02",
      p_token_digest: await digestInviteToken(secondToken),
      p_pet_ids: [owner.petId],
    });
    if (!second) {
      throw new Error("invite-claim test: seeding the second trip failed");
    }
    const { data: secondSlots } = await owner.client
      .from("care_slots")
      .select("id")
      .eq("period_id", second.id)
      .limit(1);
    const secondSlotId = secondSlots?.[0].id ?? "";

    const first = await call({ body: { token, slot_ids: await freeSlots(1), name: "Jola" } });
    const secret = first.cookies.store.get(CLAIM_COOKIE)?.value ?? "";

    // Same cookie, second trip, NO name — must be refused, because claim_slots scopes the
    // stored name by period_id and finds none here.
    const withoutName = await call({
      body: { token: secondToken, slot_ids: [secondSlotId] },
      cookies: { [CLAIM_COOKIE]: secret },
    });
    expect(withoutName.status).toBe(400);

    // With a name it succeeds, and attaches to the SAME capability.
    const withName = await call({
      body: { token: secondToken, slot_ids: [secondSlotId], name: "Jola z drugiego pietra" },
      cookies: { [CLAIM_COOKIE]: secret },
    });
    expect(withName.status).toBe(200);
    expect(withName.body.name).toBe("Jola z drugiego pietra");
    expect(withName.cookies.store.get(CLAIM_COOKIE)?.value).toBe(secret);
  });

  // ── Contention ──────────────────────────────────────────────────────────────────────────
  //
  // The RPC-level race lives in tests/rls/claim-slots.test.ts. What it cannot reach is the
  // all-or-nothing invariant as the ROUTE reports it — one 200 and one 409 rather than two
  // receipts — with zod, hashing and an HTTP hop between the two callers.
  //
  // BE PRECISE about what this is worth, because the first version of this block was not. It
  // is a WEAKER race detector than the RPC one: two callers instead of six, with more jitter
  // between the UPDATEs. Under the mutation that removes the freeness predicate the RPC case
  // reports six winners and this one reports two. Its value is the route's own translation of
  // the outcome, not extra sensitivity to the race.
  //
  // Vitest runs files in parallel but tests within a file SERIALLY, so contention has to be
  // built inside one it() with Promise.all.
  //
  // THE SAME HONEST LIMIT the RPC file states applies here: nothing forces the two requests to
  // interleave, so this is an OUTCOME check that is opportunistically a mechanism check. A
  // deterministic proof needs two held transactions, which needs a `pg` client this repo
  // deliberately does not carry.
  describe("contention", () => {
    it("admits exactly one winner when two caretakers post for the same term at once", async () => {
      const [contested] = await freeSlots(1);
      const [first, second] = [`Ania-${suffix()}`, `Basia-${suffix()}`];

      const outcomes = await Promise.all([
        call({ body: { token, slot_ids: [contested], name: first } }),
        call({ body: { token, slot_ids: [contested], name: second } }),
      ]);

      // Compared as a sorted list rather than filtered by status: if a third status ever
      // appears — the 500 fallthrough under pool pressure, say — the failure names it instead
      // of reporting an undiagnosable "expected length 1, received 0".
      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([200, 409]);

      const won = outcomes.find((outcome) => outcome.status === 200);
      expect(String(won?.body.name)).toBe(
        outcomes.find((outcome) => outcome.status === 409) === outcomes[0] ? second : first,
      );

      // The table agrees with the receipts: one row, one name, and it is the winner's.
      const { data } = await owner.client.from("care_slots").select("claimed_by_name").eq("id", contested).single();
      expect(data?.claimed_by_name).toBe(won?.body.name);
    });

    it("keeps all-or-nothing under overlapping selections", async () => {
      // Overlapping sets exercise the multi-row rollback: the loser must hold NONE of its
      // terms, including the one it alone requested.
      //
      // They do NOT reach the deadlock branch, and the first version of this comment said they
      // did. claim_slots allocates with a single UPDATE carrying no ORDER BY, so both sessions
      // run identical SQL, get the same plan and take row locks in the same order — which makes
      // deadlock impossible here, not merely unlikely. The refusal is always PT409. The 40P01
      // mapping is covered deterministically in tests/unit/claim-error-mapping.test.ts.
      const ids = await freeSlots(3);
      const [first, shared, third] = ids;
      const [one, two] = [`Celina-${suffix()}`, `Dorota-${suffix()}`];

      const outcomes = await Promise.all([
        call({ body: { token, slot_ids: [first, shared], name: one } }),
        call({ body: { token, slot_ids: [shared, third], name: two } }),
      ]);

      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([200, 409]);

      const { data } = await owner.client.from("care_slots").select("id, claimed_by_name").in("id", ids);
      const byId = new Map((data ?? []).map((row) => [row.id, row.claimed_by_name]));
      const winner = String(outcomes.find((outcome) => outcome.status === 200)?.body.name);
      const loser = winner === one ? two : one;

      const winnerIds = winner === one ? [first, shared] : [shared, third];
      for (const id of winnerIds) {
        expect(byId.get(id)).toBe(winner);
      }
      // Names are suffixed per run, so this cannot collide with a claim an earlier test in this
      // file made in the same period.
      expect([...byId.values()]).not.toContain(loser);
    });
  });

  // ── Validation ──────────────────────────────────────────────────────────────────────────

  it("rejects a malformed body, a bad token shape, no slots and a missing name — all in Polish", async () => {
    const notJson = await call({ body: null, rawBody: "{not json" });
    const badToken = await call({ body: { token: "short", slot_ids: slotIds.slice(0, 1), name: "Ania" } });
    const noSlots = await call({ body: { token, slot_ids: [], name: "Ania" } });
    const noName = await call({ body: { token, slot_ids: slotIds.slice(0, 1) } });
    const notObject = await call({ body: 42 });

    for (const result of [notJson, badToken, noSlots, notObject]) {
      expect(result.status).toBe(400);
      expect(typeof result.body.error).toBe("string");
      // Polish, not zod's English internals leaking to a caretaker.
      expect(result.body.error).not.toMatch(/Invalid|Required|expected/i);
    }

    // A first claim with no name reaches the database, which raises PT400 — zod cannot know
    // whether this browser already holds a capability, so the name is optional at that layer.
    expect(noName.status).toBe(400);
  });

  it("refuses a slot-id array larger than any trip can hold", async () => {
    const tooMany = Array.from({ length: 94 }, () => crypto.randomUUID());
    const { status, body } = await call({ body: { token, slot_ids: tooMany, name: "Ania" } });

    expect(status).toBe(400);
    expect(body.error).toMatch(/najwyżej 93/);
  });
});
