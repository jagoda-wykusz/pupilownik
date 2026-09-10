import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { digestInviteToken, generateClaimSecret, generateInviteToken } from "@/lib/invite-token";
import { createAnonClient, createOwnerWithPet, type OwnerWithPetContext } from "../helpers/auth";
import { getTestEnv } from "../setup";
import type { Database } from "@/db/database.types";

// Risk #4 — sensitive instructions must not be visible before a slot is claimed, or to anyone
// outside the invite link (S-03 Phase 3).
//
// Both functions under test are SECURITY DEFINER, so RLS on pets and care_instructions does
// NOT apply inside them. There is no policy behind either one. The tier split rests entirely
// on two predicates — `is_sensitive = false` in the read door and `is_sensitive = true` in the
// reveal — and these assertions are the only thing that would notice either one flipping.
//
// test-plan.md:64 names the anti-pattern this file has to avoid: "asserting the DB column
// split while the API leaks the field anyway". So the public-tier test does not check that a
// column exists — it searches the WHOLE serialized payload for the sensitive body text.

const SECRET_BODY = "Klucze u sąsiadki, mieszkanie 4. Kod do klatki 1234#";
const SECRET_TITLE = "Dostęp do mieszkania";
const PUBLIC_TITLE = "Karmienie";
const PUBLIC_BODY = "Rano i wieczorem, pół szklanki suchej karmy.";
const NOTE = "Burek boi się burzy — wtedy najlepiej zostać z nim w pokoju.";

interface Instruction {
  id: string;
  title: string;
  body: string | null;
  sort_order: number;
}
interface Pet {
  id: string;
  name: string;
  species: string;
  instructions: Instruction[];
}
interface TokenPayload {
  period: { id: string; title: string; start_date: string; end_date: string };
  slots: { id: string; slot_date: string; time_of_day: string; is_claimed: boolean }[];
  pets: Pet[];
}
interface ClaimedDetails {
  name: string;
  caretaker_note: string | null;
  slots: { id: string; slot_date: string; time_of_day: string }[];
  pets: Pet[];
}
/** S-06 Phase 2: what a PROVEN claim-holder gets once the period is revoked. One bit, no
 *  content — deliberately not assignable to ClaimedDetails. */
interface RevokedAnswer {
  revoked: true;
}

describe("the two-tier reveal", () => {
  let anon: SupabaseClient<Database>;
  let a: OwnerWithPetContext;
  let b: OwnerWithPetContext;

  let aToken: string;
  let aPeriodId: string;
  let bToken: string;
  // The capability that actually claimed a slot on A's trip.
  let aSecret: string;

  async function seedInstructions(owner: OwnerWithPetContext): Promise<void> {
    const { error } = await owner.client.from("care_instructions").insert([
      { pet_id: owner.petId, title: PUBLIC_TITLE, body: PUBLIC_BODY, is_sensitive: false, sort_order: 1 },
      { pet_id: owner.petId, title: SECRET_TITLE, body: SECRET_BODY, is_sensitive: true, sort_order: 2 },
    ]);
    expect(error).toBeNull();
  }

  async function seedPeriod(
    owner: OwnerWithPetContext,
    title: string,
    note: string | null = null,
  ): Promise<{ id: string; token: string }> {
    const token = generateInviteToken();
    const { data, error } = await owner.client.rpc("create_period_with_slots", {
      p_title: title,
      p_start_date: "2027-02-01",
      p_end_date: "2027-02-02",
      p_token_digest: await digestInviteToken(token),
      p_pet_ids: [owner.petId],
      ...(note === null ? {} : { p_caretaker_note: note }),
    });
    expect(error).toBeNull();
    if (!data) {
      throw new Error(`reveal test: seeding "${title}" failed`);
    }
    return { id: data.id, token };
  }

  async function resolve(token: string): Promise<TokenPayload | null> {
    const { data, error } = await anon.rpc("get_period_by_token", { p_token: token });
    expect(error).toBeNull();
    return data as TokenPayload | null;
  }

  async function reveal(token: string, secret: string): Promise<ClaimedDetails | RevokedAnswer | null> {
    const { data, error } = await anon.rpc("get_claimed_details", { p_token: token, p_claim_secret: secret });
    expect(error).toBeNull();
    return data as ClaimedDetails | RevokedAnswer | null;
  }

  /** Narrow to the content answer, so a test that means "the payload came back" cannot be
   *  satisfied by S-06's contentless `{revoked: true}`. */
  async function revealDetails(token: string, secret: string): Promise<ClaimedDetails | null> {
    const answer = await reveal(token, secret);
    if (answer === null || "revoked" in answer) {
      return null;
    }
    return answer;
  }

  // Claim the first free slot of a period with a SPECIFIC secret, so one capability can be made
  // to span two trips. claimOne below is the mint-your-own convenience wrapper.
  async function claimWith(
    owner: OwnerWithPetContext,
    periodId: string,
    token: string,
    secret: string,
    name: string,
  ): Promise<void> {
    const { data } = await owner.client
      .from("care_slots")
      .select("id")
      .eq("period_id", periodId)
      .is("claimed_by_name", null)
      .order("slot_date")
      .order("time_of_day")
      .limit(1);
    const slotId = data?.[0]?.id;
    if (!slotId) {
      throw new Error(`reveal test: no free slot to claim in ${periodId}`);
    }

    const { error } = await anon.rpc("claim_slots", {
      p_token: token,
      p_slot_ids: [slotId],
      p_claim_secret: secret,
      p_name: name,
    });
    expect(error).toBeNull();
  }

  // Claim the first free slot of a period and return the capability secret that now holds it.
  async function claimOne(owner: OwnerWithPetContext, periodId: string, token: string, name: string): Promise<string> {
    const { data } = await owner.client
      .from("care_slots")
      .select("id")
      .eq("period_id", periodId)
      .order("slot_date")
      .order("time_of_day")
      .limit(1);
    const slotId = data?.[0]?.id;
    if (!slotId) {
      throw new Error(`reveal test: no slot to claim in ${periodId}`);
    }

    const secret = generateClaimSecret();
    const { error } = await anon.rpc("claim_slots", {
      p_token: token,
      p_slot_ids: [slotId],
      p_claim_secret: secret,
      p_name: name,
    });
    expect(error).toBeNull();
    return secret;
  }

  beforeAll(async () => {
    anon = createAnonClient();
    a = await createOwnerWithPet("A-Burek");
    b = await createOwnerWithPet("B-Mru");

    await seedInstructions(a);
    await seedInstructions(b);

    ({ id: aPeriodId, token: aToken } = await seedPeriod(a, "A-wyjazd", NOTE));
    ({ token: bToken } = await seedPeriod(b, "B-wyjazd", "B ma swoją notatkę"));

    aSecret = await claimOne(a, aPeriodId, aToken, "Ania");
  });

  // ── The public tier ─────────────────────────────────────────────────────────────────────
  describe("with the invite link alone", () => {
    it("shows the pets and their public instructions", async () => {
      const payload = await resolve(aToken);

      expect(payload?.pets).toHaveLength(1);
      expect(payload?.pets[0].name).toBe("A-Burek");
      expect(payload?.pets[0].species).toBe("dog");
      expect(payload?.pets[0].instructions).toHaveLength(1);
      expect(payload?.pets[0].instructions[0].title).toBe(PUBLIC_TITLE);
      expect(payload?.pets[0].instructions[0].body).toBe(PUBLIC_BODY);
      expect(Object.keys(payload?.pets[0] ?? {}).sort()).toEqual(["id", "instructions", "name", "species"]);
      expect(Object.keys(payload?.pets[0].instructions[0] ?? {}).sort()).toEqual(["body", "id", "sort_order", "title"]);
    });

    it("does NOT leak the sensitive tier anywhere in the payload", async () => {
      const payload = await resolve(aToken);
      const serialized = JSON.stringify(payload);

      // Searched over the whole serialized payload, not over a named field. A test that only
      // checked `instructions` would keep passing if the sensitive body arrived under some
      // other key — which is the failure test-plan.md warns about.
      expect(serialized).not.toContain(SECRET_BODY);
      expect(serialized).not.toContain(SECRET_TITLE);
      // The trip note is sensitive tier too, and it lives on care_periods rather than on an
      // instruction row — a different table, so a separate assertion rather than a variant.
      expect(serialized).not.toContain(NOTE);
      expect(serialized).not.toContain("caretaker_note");
    });

    it("returns pets: [] for a period with no linked pets, rather than null", async () => {
      // create_period_with_slots enforces "at least one pet", so this state is only reachable
      // by a raw insert — which is exactly why it must be tolerated: a pre-relation row or a
      // deleted last pet both produce it, and the caretaker page must not crash on one.
      const token = generateInviteToken();
      const { data, error } = await a.client
        .from("care_periods")
        .insert({
          owner_id: a.userId,
          title: "A-bez-zwierzat",
          start_date: "2027-03-01",
          end_date: "2027-03-01",
          token_digest: await digestInviteToken(token),
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      expect(data).not.toBeNull();

      const payload = await resolve(token);

      expect(payload?.pets).toEqual([]);
      expect(payload?.slots).toEqual([]);
    });
  });

  // ── The sensitive tier ──────────────────────────────────────────────────────────────────
  describe("with the invite link AND a capability that claimed a slot", () => {
    it("reveals the sensitive rows, the note and the caretaker's own slots", async () => {
      const details = await revealDetails(aToken, aSecret);

      expect(details?.name).toBe("Ania");
      expect(details?.caretaker_note).toBe(NOTE);
      expect(details?.slots).toHaveLength(1);
      expect(details?.pets).toHaveLength(1);
      expect(details?.pets[0].instructions).toHaveLength(1);
      expect(details?.pets[0].instructions[0].title).toBe(SECRET_TITLE);
      expect(details?.pets[0].instructions[0].body).toBe(SECRET_BODY);
    });

    it("returns ONLY the sensitive rows — the public ones stay with the read door", async () => {
      const details = await revealDetails(aToken, aSecret);

      // The two payloads partition the instruction set rather than overlapping. The page
      // composes them, and the design draws the sensitive block as a separated callout.
      expect(JSON.stringify(details)).not.toContain(PUBLIC_BODY);
      expect(JSON.stringify(details)).not.toContain(PUBLIC_TITLE);
    });

    it("keeps the exact key set", async () => {
      const details = await revealDetails(aToken, aSecret);

      expect(Object.keys(details ?? {}).sort()).toEqual(["caretaker_note", "name", "pets", "slots"]);
      expect(Object.keys(details?.slots[0] ?? {}).sort()).toEqual(["id", "slot_date", "time_of_day"]);
      // The NESTED sets too, symmetrically with the read door's (impl-review F8). Without
      // these, `is_sensitive`, `owner_id` or `created_at` could join the reveal's pet objects
      // without a red test — and this payload is the one that carries the house keys.
      expect(Object.keys(details?.pets[0] ?? {}).sort()).toEqual(["id", "instructions", "name", "species"]);
      expect(Object.keys(details?.pets[0].instructions[0] ?? {}).sort()).toEqual(["body", "id", "sort_order", "title"]);
    });
    // The migration states this invariant in a comment: "A pet with no sensitive rows still
    // appears, with instructions: []. Dropping it would make the two payloads disagree about
    // which pets are on the trip." Nothing checked it — both seeded pets carry a sensitive row
    // (impl-review F8). Phase 4 composes the two payloads pet by pet, so a pet present in one
    // and absent from the other is exactly the shape that would break it.
    it("still lists a pet that has no sensitive rows, with an empty instruction list", async () => {
      const { data: quietPet, error: petError } = await a.client
        .from("pets")
        .insert({ owner_id: a.userId, name: "A-Cichy", species: "cat" })
        .select("id")
        .single();
      expect(petError).toBeNull();
      if (!quietPet) {
        throw new Error("reveal test: seeding the sensitive-free pet failed");
      }

      const { error: insError } = await a.client.from("care_instructions").insert({
        pet_id: quietPet.id,
        title: PUBLIC_TITLE,
        body: PUBLIC_BODY,
        is_sensitive: false,
        sort_order: 1,
      });
      expect(insError).toBeNull();

      const token = generateInviteToken();
      const { data: period, error } = await a.client.rpc("create_period_with_slots", {
        p_title: "A-dwa-zwierzaki",
        p_start_date: "2027-05-01",
        p_end_date: "2027-05-02",
        p_token_digest: await digestInviteToken(token),
        p_pet_ids: [a.petId, quietPet.id],
      });
      expect(error).toBeNull();
      if (!period) {
        throw new Error("reveal test: seeding the two-pet trip failed");
      }

      const secret = await claimOne(a, period.id, token, "Ania");
      const details = await revealDetails(token, secret);

      // BOTH pets appear, ordered by name — "A-Burek" before "A-Cichy".
      expect(details?.pets.map((pet) => pet.name)).toEqual(["A-Burek", "A-Cichy"]);
      // The quiet one carries an empty array, not a missing entry and not null.
      expect(details?.pets[1].instructions).toEqual([]);
      // And the read door agrees about the pet set, which is what makes composition safe.
      const payload = await resolve(token);
      expect(payload?.pets.map((pet) => pet.name)).toEqual(["A-Burek", "A-Cichy"]);
    });
  });

  // ── Uniform failure ─────────────────────────────────────────────────────────────────────
  //
  // Every way of not being entitled returns the SAME null. A distinct answer for any of them
  // would tell a prober which half of the token/secret pair they got right.
  describe("without a matching capability", () => {
    it("refuses a wrong secret, an unclaimed capability, a bad token and a wrong-length input alike", async () => {
      const neverClaimed = generateClaimSecret();

      const outcomes = await Promise.all([
        // A valid token, a syntactically valid secret that holds nothing.
        reveal(aToken, neverClaimed),
        // A capability that DID claim, but on a token that resolves to nothing.
        reveal(generateInviteToken(), aSecret),
        // Both wrong.
        reveal(generateInviteToken(), neverClaimed),
        // Wrong-length inputs must not answer differently from unknown ones. Read these two
        // for what they are (impl-review F7, the same admission claim-slots.test.ts carries):
        // they pin the uniform-failure ANSWER, not the 43-character bound. Deleting the bound
        // leaves them green, because a short string simply hashes to a digest matching
        // nothing. The bound's real effect — that no hashing happens for an unauthenticated
        // caller — is not observable through PostgREST. What these DO catch is someone turning
        // the length check into a raise, which would separate "malformed" from "unknown" and
        // hand a prober an oracle.
        reveal("too-short", aSecret),
        reveal(aToken, "too-short"),
      ]);

      expect(outcomes).toEqual([null, null, null, null, null]);
    });

    it("does not let a capability earned on one trip open another", async () => {
      // aSecret genuinely holds a slot — on A's period. Presented with B's token it must be
      // worth nothing, because the lookup is scoped by period_id as well as by digest.
      await expect(reveal(bToken, aSecret)).resolves.toBeNull();

      // And B's sensitive content is not reachable this way.
      const details = await reveal(bToken, aSecret);
      expect(JSON.stringify(details)).not.toContain("B ma swoją notatkę");
    });

    // `period_id` scopes TWO queries in get_claimed_details: the authorization lookup, which
    // the test above pins, and the caretaker's-own-slots subquery, which nothing pinned —
    // because no capability in this suite held slots in more than one period, so scoping by
    // (period_id, digest) and by digest alone were observationally identical (impl-review F3).
    //
    // One browser holding one capability against two trips is not hypothetical: it is exactly
    // what Phase 4's Path=/invite cookie produces the moment a caretaker helps two households.
    it("shows only the addressed trip's slots when one capability holds slots in two", async () => {
      // The same secret string on both trips. claim_slots takes the raw secret and derives the
      // digest, so presenting it twice genuinely produces ONE capability across two periods —
      // which is the state this test needs and no other test in the file creates.
      const shared = generateClaimSecret();

      const tripOne = await seedPeriod(a, "A-dwa-wyjazdy-1", "notatka 1");
      const tripTwo = await seedPeriod(b, "B-dwa-wyjazdy-2", "notatka 2");
      await claimWith(a, tripOne.id, tripOne.token, shared, "Ania");
      await claimWith(b, tripTwo.id, tripTwo.token, shared, "Ania");

      const one = await revealDetails(tripOne.token, shared);
      const two = await revealDetails(tripTwo.token, shared);

      // Both resolve — the capability is genuine on both trips.
      expect(one).not.toBeNull();
      expect(two).not.toBeNull();

      // But each answer carries only its own trip's slot and its own trip's note. Drop
      // `period_id` from the slots subquery and each of these becomes 2, and the notes cross.
      expect(one?.slots).toHaveLength(1);
      expect(two?.slots).toHaveLength(1);
      expect(one?.slots[0].id).not.toBe(two?.slots[0].id);
      expect(one?.caretaker_note).toBe("notatka 1");
      expect(two?.caretaker_note).toBe("notatka 2");
      // And the pets do not cross either: B's pet must not appear in A's answer.
      expect(one?.pets.map((pet) => pet.name)).toEqual(["A-Burek"]);
      expect(two?.pets.map((pet) => pet.name)).toEqual(["B-Mru"]);
    });

    // ── S-06 Phase 2: the revoked answer, asserted in BOTH directions ────────────────────
    //
    // This is the codebase's second deliberate widening of rule 4, and the pair below is what
    // makes it a test of the widening rather than a description of it: the holder MUST get the
    // distinct answer, and a caller who cannot prove a claim on this period MUST stay
    // byte-identical to a stranger. Break the ordering inside get_claimed_details either way
    // and exactly one of these fails (context/foundation/lessons.md).
    it("tells a capability that holds slots that the trip was called off — and nothing more", async () => {
      const revoked = await seedPeriod(a, "A-odwolany", "notatka odwołanego");
      const secret = await claimOne(a, revoked.id, revoked.token, "Ania");

      // It reveals normally right up until the owner revokes.
      const before = await revealDetails(revoked.token, secret);
      expect(before?.caretaker_note).toBe("notatka odwołanego");

      const { error } = await a.client
        .from("care_periods")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", revoked.id);
      expect(error).toBeNull();

      const after = await reveal(revoked.token, secret);

      // CHANGED by S-06 Phase 2: this used to assert NULL. The holder now learns the trip is
      // off — which is the whole point of the slice.
      expect(after).toEqual({ revoked: true });

      // And learns NOTHING else. The KEY SET, not a substring search: impl-review F3 caught
      // that four `not.toContain` lines after the exact-equality assertion above were
      // unfailable by construction, and that routing "access is really gone" through
      // revealDetails was worse than unfailable — that helper returns null for ANY answer
      // carrying a `revoked` key, so it is the definition of relabelling, not a test of it.
      //
      // This is the assertion that bites: a future edit attaching the title, the note or the
      // caretaker's name to this branch adds a key, and the key set is the one thing such an
      // edit cannot leave alone.
      expect(Object.keys(after ?? {})).toEqual(["revoked"]);
      expect(Object.keys(after ?? {})).not.toContain("caretaker_note");
    });

    it("keeps a revoked period byte-identical to a stranger for anyone who cannot prove a claim", async () => {
      const revoked = await seedPeriod(a, "A-odwolany-obcy", "notatka obcego");
      // Kept, not discarded (impl-review F5): this is the capability that genuinely holds a
      // slot on the REVOKED period, and the last assertion below needs exactly it.
      const revokedSecret = await claimOne(a, revoked.id, revoked.token, "Ania");
      const { error } = await a.client
        .from("care_periods")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", revoked.id);
      expect(error).toBeNull();

      // The reference answer: a token that never existed.
      const stranger = await reveal(generateInviteToken(), generateClaimSecret());
      expect(stranger).toBeNull();

      // A wrong secret on the revoked period — the case that would leak if the revoked branch
      // were moved ahead of the claim_digest gate.
      await expect(reveal(revoked.token, generateClaimSecret())).resolves.toEqual(stranger);

      // A capability earned on ANOTHER trip, presented against the revoked one. The cookie
      // rides along on every /invite URL, so this is the common real-world case.
      const other = await seedPeriod(a, "A-inny-wyjazd");
      const otherSecret = await claimOne(a, other.id, other.token, "Basia");
      await expect(reveal(revoked.token, otherSecret)).resolves.toEqual(stranger);

      // An unknown token while holding the revoked trip's OWN capability — the case the plan
      // named, and the one that pins the widening to the period the TOKEN resolves to rather
      // than to the secret. Previously this passed `otherSecret`, which made the comment false
      // and duplicated the case above (impl-review F5).
      await expect(reveal(generateInviteToken(), revokedSecret)).resolves.toEqual(stranger);
    });
  });

  // ── Grant posture ───────────────────────────────────────────────────────────────────────
  describe("grant posture", () => {
    it("anon may execute get_claimed_details — it is the caretaker's door", async () => {
      const { error } = await anon.rpc("get_claimed_details", {
        p_token: generateInviteToken(),
        p_claim_secret: generateClaimSecret(),
      });
      // Execution permitted; the function answered NULL from its own body. A 42501 here means
      // anon lost EXECUTE.
      expect(error).toBeNull();
    });

    it("an authenticated owner may execute it", async () => {
      const { error } = await a.client.rpc("get_claimed_details", {
        p_token: generateInviteToken(),
        p_claim_secret: generateClaimSecret(),
      });
      expect(error).toBeNull();
    });

    it("service_role may NOT execute it", async () => {
      const serviceKey = process.env.SUPABASE_SERVICE_KEY;
      if (!serviceKey) {
        throw new Error("SUPABASE_SERVICE_KEY must be set in .env.test (see .env.test.example).");
      }
      const service = createClient<Database>(getTestEnv().url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { error } = await service.rpc("get_claimed_details", {
        p_token: aToken,
        p_claim_secret: aSecret,
      });

      // Assert the refusal: Supabase's ALTER DEFAULT PRIVILEGES grants service_role EXECUTE on
      // every new function in `public`, so this passes only while the explicit revoke stands.
      expect(error?.code).toBe("42501");
    });

    it("anon still cannot read pets or care_instructions directly", async () => {
      // The reveal reads both tables as its owner, bypassing RLS. That is only safe while anon
      // holds no grant of its own — otherwise the tier split could be walked around entirely.
      const pets = await anon.from("pets").select("id");
      const instructions = await anon.from("care_instructions").select("id");

      // The refusal, not the absence of rows: with the grant restored, deny-by-default RLS
      // would return [] and a `toEqual([])` assertion would pass either way.
      expect(pets.error?.code).toBe("42501");
      expect(instructions.error?.code).toBe("42501");
    });
  });
});
