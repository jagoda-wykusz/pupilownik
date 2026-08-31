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
    // Log the internal DB/constraint detail server-side; return a generic message
    // so RLS/constraint internals never leak to the client.
    console.error("create_pet_with_instructions failed:", error);
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
