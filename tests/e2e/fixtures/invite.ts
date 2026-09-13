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

    // EVERYTHING after the pet exists is inside try/finally, and that is load-bearing rather than
    // tidy. Playwright runs the second half of a fixture ONLY if `provide` was reached — so with a
    // bare sequential body, a throw from the instruction insert or the RPC below skips teardown
    // entirely and orphans the pet created a line ago, permanently, on every failed run
    // (implementation review F3).
    let periodId: string | null = null;
    let teardownError: string | null = null;
    try {
      // The two tiers. `is_sensitive` is the whole subject of Risk #4: the read door serves only
      // the false rows, the reveal door only the true ones.
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
      periodId = data.id;

      await provide({
        token,
        petName,
        publicTitle: PUBLIC_TITLE,
        publicBody: PUBLIC_BODY,
        secretTitle: SECRET_TITLE,
        secretBody: SECRET_BODY,
        note: NOTE,
      });
    } finally {
      // Teardown. The period goes first — and the reason is NOT that the other order errors, which
      // is what this comment claimed until the implementation review measured it. Both of
      // `care_period_pets`' foreign keys are `on delete cascade`
      // (supabase/migrations/20260906165005_period_pets_relation.sql:19-20), so deleting the pet
      // first SUCCEEDS: it silently cascades the junction row away and leaves a childless period
      // behind. Period first is right because it removes the parent that owns the relationship.
      // Slots and instructions go with their parents by cascade either way.
      //
      // `periodId` is null when the RPC never got that far; the pet still needs removing.
      //
      // Both deletes RECORD their error rather than swallowing it — a teardown blocked by RLS or
      // an FK would otherwise leave rows behind while the fixture reported success, the shape
      // `tests/rls/*` and seed.spec.ts already guard against.
      //
      // Recorded and re-thrown AFTER this block, never from inside it. A `throw` in `finally`
      // REPLACES an exception already in flight, so a seeding failure would be masked by whatever
      // its own half-done teardown then hit — the opposite of what this fixture wants, and what
      // `no-unsafe-finally` exists to stop. With the throw outside, a failed `try` propagates its
      // own error (the trailing statement never runs) and a successful one still surfaces a dirty
      // teardown.
      if (periodId !== null) {
        const { error: periodError } = await owner.client.from("care_periods").delete().eq("id", periodId);
        if (periodError) {
          teardownError = `tearing down the period failed: ${periodError.message}`;
        }
      }
      const { error: petError } = await owner.client.from("pets").delete().eq("id", owner.petId);
      if (petError) {
        teardownError ??= `tearing down the pet failed: ${petError.message}`;
      }
      // The auth user is left behind, matching what the vitest suite does — removing one needs the
      // service-role key, and importing that here to tidy up would put a RLS-bypassing credential
      // into the E2E path for no assertion's benefit.
    }

    if (teardownError !== null) {
      throw new Error(`invite fixture: ${teardownError}`);
    }
  },
});

export { expect } from "@playwright/test";
