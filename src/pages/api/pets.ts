import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createPetSchema } from "@/lib/schemas/pet";

// POST /api/pets — the first domain API route and the pattern for later ones.
// JSON in/out (not formData): the payload is structured (nested instructions).
// The server is the source of truth — zod rejects bad input before any DB call,
// and the atomic create_pet_with_instructions RPC runs under the caller's RLS
// (security invoker), so ownership is enforced by the database, not this handler.
export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Supabase is not configured" }, 500);
  }

  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const parsed = createPetSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonResponse({ error: "Validation failed", issues: parsed.error.issues }, 400);
  }

  const { name, species, breed, age, instructions } = parsed.data;
  const { data, error } = await supabase.rpc("create_pet_with_instructions", {
    p_name: name,
    p_species: species,
    // breed/age are optional free text. The RPC's text params are non-optional in
    // the generated types (no SQL default), so an omitted field is passed as "" —
    // an acceptable "absent" for free text (the column stays nullable for later use).
    p_breed: breed ?? "",
    p_age: age ?? "",
    p_instructions: instructions,
  });

  if (error) {
    // Log the code and message, NOT the whole error: PostgREST's `details` echoes the
    // offending column value on a constraint violation, so logging the object widens
    // what a log dump exposes. The client still gets only a generic message, so
    // RLS/constraint internals never leak either way.
    console.error("create_pet_with_instructions failed:", error.code, error.message);

    // Bad INPUT is not a server fault, and answering 500 tells an owner the app broke when in
    // fact they sent a number the column cannot hold. This mirrors the mapping periods.ts:79-99
    // already carries; leaving it out here was the same defect one route over.
    //
    // 22003 is the ONE code measured reachable: create_pet_with_instructions casts
    // `(i ->> 'sort_order')::int`, and before the schema gained an upper bound a 1e12 sort_order
    // produced exactly this 500. It is now belt-and-braces — zod rejects such a value first — and
    // it is kept for the reason periods.ts keeps its own unreachable pair: the zod bound and this
    // mapping are one fix in two layers, and the two tables this route writes carry no
    // length or range bound of their own to fall back on (verified against information_schema: no
    // column in `pets` or `care_instructions` has a length limit. `care_periods.caretaker_note` does
    // carry a CHECK — a different table, and 23514 rather than 22001).
    //
    // 42501 is deliberately NOT mapped. The RPC sets `owner_id = (select auth.uid())` itself, so
    // an RLS with-check refusal is unreachable through this route — a branch for it would be dead
    // code dressed as defence.
    if (error.code === "22003") {
      return jsonResponse({ error: "Kolejność instrukcji jest poza dozwolonym zakresem" }, 400);
    }
    // 22P05 / 22021 — a NUL character inside a string. Postgres refuses it while parsing the jsonb
    // argument, before the function body runs. Found by the full-plan review and MEASURED: a NUL in
    // an instruction title answered 500 here until src/lib/schemas/pet.ts gained `textField`, which
    // now rejects it first. Same two-layer shape as 22003 above, and kept for the same reason — the
    // database has no character-class guard of its own on these columns.
    if (["22P05", "22021"].includes(error.code)) {
      return jsonResponse({ error: "Tekst zawiera niedozwolony znak" }, 400);
    }
    return jsonResponse({ error: "Nie udało się zapisać zwierzęcia" }, 500);
  }

  return jsonResponse({ pet: data }, 201);
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
