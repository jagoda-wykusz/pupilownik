import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { petIdSchema, updatePetSchema } from "@/lib/schemas/pet";

// PUT and DELETE /api/pets/[id] — the owner's edit and remove paths for a pet.
//
// The FIRST non-POST/GET verbs in this codebase. Every other route in src/pages/api exports
// POST only, so there is no precedent for the verb itself — but the body of the handler
// follows api/periods/[id]/token.ts step for step (own auth check, own id validation, a
// SECURITY INVOKER RPC, NULL -> 404, an error log that names code and message only), and the
// body-parsing half follows api/pets.ts, which is the route this one edits the output of.
//
// PUT rather than PATCH, and the difference is a contract, not a preference: the body carries
// the COMPLETE desired instruction set, and a stored row the payload does not name is deleted
// by update_pet_with_instructions. That is a replacement of the resource, which is what PUT
// means. A PATCH here would promise that omission is a no-op, and it is the opposite.
//
// The auth check is NOT redundant. PROTECTED_ROUTES (src/middleware.ts:8) matches on
// startsWith and lists "/pets", not "/api/pets" — "/api/pets/x" does not start with "/pets" —
// so nothing upstream gates this path. The middleware populates context.locals.user for every
// request, but it is a SESSION LOADER everywhere and a GATE only on those three page prefixes.
// Route-level auth is this handler's job.
export const PUT: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // An EXPLICIT Origin check, and here it is MANDATORY rather than belt-and-braces.
  //
  // Astro's security.checkOrigin defaults to true, but it only inspects a non-safe request
  // that carries NO Content-Type. This route reads a JSON body, so the island must send
  // `Content-Type: application/json`, which lands the request in the middleware's no-check
  // branch and means the framework contributes NOTHING here — the same position
  // src/pages/invite/claim.ts:13-15 is in, and the reason that route grew its own check.
  //
  // Note that reasoning about Content-Type on the server would not substitute for this:
  // request.json() ignores the header entirely, and a cross-site form POST with
  // enctype=text/plain can forge a JSON body.
  //
  // Coverage: a cross-origin fetch always sends Origin; so does a cross-site form submission;
  // an opaque origin sends the string "null", which fails the equality too. An ABSENT Origin
  // is allowed, because non-browser callers omit it entirely and refusing them would buy
  // nothing that SameSite=Lax does not already provide.
  const origin = context.request.headers.get("Origin");
  if (origin !== null && origin !== context.url.origin) {
    return jsonResponse({ error: "Nieprawidłowe źródło żądania" }, 403);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Supabase is not configured" }, 500);
  }

  const parsedId = petIdSchema.safeParse(context.params.id);
  if (!parsedId.success) {
    return jsonResponse({ error: "Validation failed" }, 400);
  }

  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return jsonResponse({ error: "Nie udało się odczytać danych formularza" }, 400);
  }

  const parsed = updatePetSchema.safeParse(payload);
  if (!parsed.success) {
    // The newer of the two error conventions in this codebase. api/pets.ts answers
    // `{ error: "Validation failed", issues }`; periods.ts:33-42 dropped `issues` because
    // nothing read it and it shipped zod's English internals alongside the Polish sentence.
    // The island renders `error` verbatim, so every 400 here has to carry a sentence an owner
    // can act on — which is why updatePetSchema carries PET_MESSAGES at the type level.
    //
    // Prefer an issue with a field path; the fallback is the find() miss, which is a body that
    // produced only root-level issues (a non-object). `issues` is never empty on a failed
    // parse, and TS types issues[0] as present.
    const issue = parsed.error.issues.find((i) => i.path.length > 0) ?? parsed.error.issues[0];
    return jsonResponse({ error: issue.message }, 400);
  }

  const { name, species, breed, age, instructions } = parsed.data;
  const { data, error } = await supabase.rpc("update_pet_with_instructions", {
    p_pet_id: parsedId.data,
    p_name: name,
    // breed/age are optional free text. The RPC's text params are non-optional in the
    // generated types (no SQL default), so an omitted field is passed as "" — the same
    // "absent" api/pets.ts uses, and the column stays nullable for later use.
    p_breed: breed ?? "",
    p_age: age ?? "",
    p_species: species,
    p_instructions: instructions,
  });

  if (error) {
    // Log the code and message, NOT the whole error.
    //
    // The reason matters and is easy to copy wrongly, so it is stated for THIS call site
    // rather than borrowed: the claim that "PostgREST echoes the offending value into
    // `details`" is FALSE under RLS — measured `details: null` for every violation an
    // `authenticated` caller can cause. The practice stays because a SECURITY DEFINER function
    // owned by `postgres` DOES receive the full row in DETAIL, and this project has four.
    //
    // update_pet_with_instructions is SECURITY INVOKER, so its errors are RLS-suppressed like
    // any other — with ONE exception this route creates deliberately: the PT409 branch below
    // reads error.details, because that function puts a JSON array THERE ON PURPOSE. That is
    // the claim_slots shape (20260907171514:251-254), and it is the only reason `details` is
    // touched at all. It carries instruction ids, which are not secrets, and it is still never
    // logged.
    console.error("update_pet_with_instructions failed:", error.code, error.message);

    if (error.code === "PT409") {
      return jsonResponse({ error: frozenMessage(error.details) }, 409);
    }
    // 22003 (sort_order out of int range) cannot be reached through THIS route — the update
    // RPC derives sort_order from array position and updatePetSchema has no such field — so a
    // branch for it here would be dead code dressed as defence (the test api/pets.ts applies
    // to its own unreachable 42501). It is deliberately absent.
    //
    // 22P05 / 22021 — a NUL inside a string, which Postgres refuses while PARSING the jsonb
    // argument, before the function body runs. zod rejects it first, so this is
    // belt-and-braces; it is kept for the reason pets.ts keeps its own pair — the zod bound
    // and this mapping are one fix in two layers, and neither `pets` nor `care_instructions`
    // carries a character-class constraint to fall back on.
    if (["22P05", "22021"].includes(error.code)) {
      return jsonResponse({ error: "Tekst zawiera niedozwolony znak" }, 400);
    }
    return jsonResponse({ error: "Nie udało się zapisać zmian" }, 500);
  }

  // The RPC returns `uuid` and answers NULL for a miss — a real runtime case, not a defensive
  // one — so this guard is required, exactly as token.ts's is. (periods.ts omits its guard
  // because ITS function returns a composite, which is never null in the no-error branch.)
  //
  // Not this owner's pet and no such pet collapse into one 404 on purpose: the owner has no
  // use for the difference, and a distinct "exists but not yours" would confirm the pet exists.
  if (!data) {
    return jsonResponse({ error: "Nie znaleziono zwierzęcia" }, 404);
  }

  // 200, not 201: this replaces an existing resource rather than creating one.
  return jsonResponse({ petId: data }, 200);
};

// DELETE /api/pets/[id] — remove a pet, or refuse while a live trip covers it.
//
// The same order of operations as PUT above, minus body parsing: auth, Origin, client, id, RPC,
// error mapping, NULL -> 404. What differs is the shape of the request it answers and the two
// ways it can say no.
//
// THE ORIGIN CHECK IS HERE EVEN THOUGH THIS REQUEST WOULD INHERIT ASTRO'S. DeletePetButton
// sends no headers and no body, so the framework's origin middleware — which only inspects a
// non-safe method carrying NO Content-Type — does cover it, exactly as it covers the revoke
// route. The three lines stay anyway, for the reason revoke.ts:42-61 spells out: the framework
// check is a DEFAULT, not a control this file owns, and three edits remove it silently
// (`checkOrigin: false` in astro.config.mjs, a deployment path that skips Astro's internal
// middlewares, or a refactor that routes island calls through a helper adding Content-Type).
// This is an irreversible action, and a comment is not a control.
//
// delete_pet is SECURITY INVOKER, so pets_delete_own decides whether this owner may remove the
// row. Not this owner's pet and no such pet collapse into the same 404 — and so does a foreign
// pet that a live trip covers, because the blocker query inside the function is RLS-scoped too.
// A stranger never learns that a trip exists.
export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const origin = context.request.headers.get("Origin");
  if (origin !== null && origin !== context.url.origin) {
    return jsonResponse({ error: "Nieprawidłowe źródło żądania" }, 403);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Supabase is not configured" }, 500);
  }

  const parsedId = petIdSchema.safeParse(context.params.id);
  if (!parsedId.success) {
    return jsonResponse({ error: "Validation failed" }, 400);
  }

  const { data, error } = await supabase.rpc("delete_pet", {
    p_pet_id: parsedId.data,
  });

  if (error) {
    // Code and message only, never the whole error — the same discipline as PUT above, and the
    // same single exception: the PT409 branch reads error.details, because delete_pet puts JSON
    // there on purpose. Those blocking titles are the owner's own text; they reach the owner in
    // the response and are still never logged.
    console.error("delete_pet failed:", error.code, error.message);

    if (error.code === "PT409") {
      return jsonResponse({ error: blockedMessage(error.details) }, 409);
    }
    return jsonResponse({ error: "Nie udało się usunąć zwierzęcia" }, 500);
  }

  if (!data) {
    return jsonResponse({ error: "Nie znaleziono zwierzęcia" }, 404);
  }

  return jsonResponse({ petId: data }, 200);
};

// The PT409 payload is a JSON array of `{ id, title }` for every unrevoked period covering the
// pet. Unlike the freeze's ids, these ARE useful to the owner: the remedy is to revoke one of
// these trips, and the owner needs to know which.
//
// Parsed defensively: a malformed or absent DETAIL must still produce a usable sentence rather
// than a crash inside an error handler. At most two titles are named — a pet on six trips would
// otherwise produce a sentence nobody reads — and the rest are counted.
function blockedMessage(details: string | null): string {
  const remedy = "Aby usunąć zwierzę, najpierw odwołaj wyjazd.";
  const titles = blockingTitles(details);

  if (titles.length === 0) {
    return `Nie można usunąć zwierzęcia — obejmuje je aktywny wyjazd. ${remedy}`;
  }

  // Polish quotation marks around a title the owner typed: „…” — the pair this codebase uses
  // in every other owner-facing sentence. A straight ASCII quote here would also collide with
  // the ones a title may itself contain.
  const named = titles
    .slice(0, 2)
    .map((title) => `„${title}”`)
    .join(", ");
  const rest = titles.length - Math.min(titles.length, 2);
  const tail = rest > 0 ? ` i ${rest} inn${rest === 1 ? "y" : "e"}` : "";
  return `Nie można usunąć zwierzęcia — obejmuje je aktywny wyjazd: ${named}${tail}. ${remedy}`;
}

function blockingTitles(details: string | null): string[] {
  if (!details) {
    return [];
  }
  try {
    const rows: unknown = JSON.parse(details);
    if (!Array.isArray(rows)) {
      return [];
    }
    // Checked, not cast. This payload crosses a process boundary, and a row whose `title` is
    // not a string would otherwise reach the sentence as "[object Object]".
    //
    // `row: unknown` is explicit because `Array.isArray` narrows an `unknown` to `any[]`, not to
    // `unknown[]` — without the annotation every element is `any` and the checks below are
    // decoration the type system does not enforce (four no-unsafe-* errors, caught by lint).
    return rows
      .map((row: unknown) =>
        typeof row === "object" && row !== null && "title" in row && typeof row.title === "string" ? row.title : null,
      )
      .filter((title): title is string => title !== null && title.length > 0);
  } catch {
    return [];
  }
}

// The PT409 payload is a JSON array of instruction ids. The ids are of no use to the owner, so
// the sentence names the COUNT and the remedy instead — the ids exist in DETAIL for a future
// island that wants to highlight the offending rows, and for debugging.
//
// Parsed defensively: a malformed or absent DETAIL must still produce a usable sentence rather
// than a crash inside an error handler.
function frozenMessage(details: string | null): string {
  const remedy = "Aby to zmienić, najpierw odwołaj wyjazd, na którym ktoś zajął już termin.";
  if (!details) {
    return `Nie można zmienić oznaczenia instrukcji jako wrażliwej. ${remedy}`;
  }
  try {
    const ids: unknown = JSON.parse(details);
    const count = Array.isArray(ids) ? ids.length : 0;
    if (count > 0) {
      // No singular/plural branch: Polish takes the genitive plural "instrukcji" after 1, 2
      // and 5 alike here, so a ternary would have two identical arms.
      return `Nie można zmienić oznaczenia ${count} instrukcji jako wrażliwej. ${remedy}`;
    }
  } catch {
    // Fall through to the generic sentence.
  }
  return `Nie można zmienić oznaczenia instrukcji jako wrażliwej. ${remedy}`;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
