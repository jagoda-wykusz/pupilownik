import { test as base } from "@playwright/test";
import { digestInviteToken, generateInviteToken } from "@/lib/invite-token";
import { createOwnerWithPet } from "../../helpers/auth";
import { NOTE, PUBLIC_BODY, PUBLIC_TITLE, SECRET_BODY, SECRET_TITLE } from "../../helpers/reveal";

// One seeded trip per TEST, for the caretaker specs.
//
// PER TEST, NOT PER RUN — a deliberate departure from the plan's wording, made to kill
// anti-pattern #3 (shared state between tests) outright rather than manage it. The claim flow
// MUTATES the trip: claiming a slot flips `is_claimed`, and the capability cookie is keyed to the
// trip that minted it. Three tests sharing one trip would have to coordinate which slots each may
// take, and `fullyParallel` would decide the order. Seeding is a handful of RPC calls, so the
// isolation is nearly free and the tests become order-independent by construction.
//
// IT REUSES THE VITEST HELPERS RATHER THAN RE-IMPLEMENTING THEM, and that is the point of
// `tests/helpers/reveal.ts` existing at all: `SECRET_BODY` is ASSERTED against, not merely
// inserted, so two definitions of it would be two definitions of what a leak looks like. Same
// reason `createOwnerWithPet` is imported instead of copied.
//
// ANON-KEYED throughout (`createOwnerWithPet` builds the client from the publishable key and a
// real signUp). Never service-role: it bypasses RLS, which would make the seeding a different
// operation from the one the app performs and every surrounding assertion a tautology.

export interface InviteTrip {
  /** The raw invite token. Only ever exists here and in the URL; the DB stores its digest. */
  token: string;
  petName: string;
  /** Visible to anyone holding the link. */
  publicTitle: string;
  publicBody: string;
  /** Visible ONLY after a claim. These two are what Risk #4 is about. */
  secretTitle: string;
  secretBody: string;
  /** The trip note — same reveal rule as the sensitive rows. */
  note: string;
}

export const test = base.extend<{ trip: InviteTrip }>({
  // Playwright's fixture signature takes the fixture bag first; this one needs nothing from it.
  // eslint-disable-next-line no-empty-pattern -- the empty pattern IS the Playwright signature.
  trip: async ({}, provide) => {
    // The second parameter is named `provide`, not Playwright's usual `use`, purely to keep
    // `react-hooks/rules-of-hooks` out of the way: that rule treats any `use(...)` call as a React
    // hook and rejects it outside a component. The name is arbitrary to Playwright.
    // Unique per test so parallel workers and repeat runs cannot collide, and so a heading
    // assertion cannot match a pet left behind by an earlier run (anti-pattern #5).
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const petName = `Opiekun-E2E ${suffix}`;

    const owner = await createOwnerWithPet(petName);

    // The two tiers. `is_sensitive` is the whole subject of Risk #4: the read door serves only the
    // false rows, the reveal door only the true ones.
    const { error: instructionsError } = await owner.client.from("care_instructions").insert([
      { pet_id: owner.petId, title: PUBLIC_TITLE, body: PUBLIC_BODY, is_sensitive: false, sort_order: 1 },
      { pet_id: owner.petId, title: SECRET_TITLE, body: SECRET_BODY, is_sensitive: true, sort_order: 2 },
    ]);
    if (instructionsError) {
      throw new Error(`invite fixture: seeding instructions failed: ${instructionsError.message}`);
    }

    const token = generateInviteToken();
    const { data, error } = await owner.client.rpc("create_period_with_slots", {
      p_title: `Wyjazd ${suffix}`,
      p_start_date: "2027-02-01",
      p_end_date: "2027-02-02",
      p_token_digest: await digestInviteToken(token),
      p_pet_ids: [owner.petId],
      p_caretaker_note: NOTE,
    });
    // Check `error`, not `data` — supabase-js types `data` as non-null in the no-error branch of
    // its discriminated response, so a `!data` guard is statically dead and lint rejects it. Same
    // reasoning `tests/helpers/auth.ts` records for the identical shape.
    if (error) {
      throw new Error(`invite fixture: seeding the period failed: ${error.message}`);
    }

    await provide({
      token,
      petName,
      publicTitle: PUBLIC_TITLE,
      publicBody: PUBLIC_BODY,
      secretTitle: SECRET_TITLE,
      secretBody: SECRET_BODY,
      note: NOTE,
    });

    // Teardown. The period goes first: `care_period_pets` references both, and deleting the pet
    // while a period still points at it is the one ordering that can fail. Slots and instructions
    // go with their parents by cascade.
    //
    // The auth user is left behind, matching what the vitest suite does — removing one needs the
    // service-role key, and importing that here to tidy up would put a RLS-bypassing credential
    // into the E2E path for no assertion's benefit.
    await owner.client.from("care_periods").delete().eq("id", data.id);
    await owner.client.from("pets").delete().eq("id", owner.petId);
  },
});

export { expect } from "@playwright/test";
