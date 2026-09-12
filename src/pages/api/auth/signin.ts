import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { SIGNIN_FAILED } from "@/lib/auth-messages";

// Every failure answers with ONE sentence. See src/lib/auth-messages.ts for why the upstream
// wording is swallowed rather than forwarded, and what that costs.

export const POST: APIRoute = async (context) => {
  const failed = () => context.redirect(`/auth/signin?error=${encodeURIComponent(SIGNIN_FAILED)}`);

  // WHY THIS IS WRAPPED. `formData()` REJECTS — it does not return empty — for any body that is
  // not multipart or urlencoded. Unwrapped, this line answered 500 to a JSON body, an empty body
  // and a text/plain body; measured 2026-09-12 during `testing-input-validation` research, both
  // through a running server and by calling the handler directly. It is reachable pre-auth by
  // anyone, and Astro's origin check does not stand in the way: `checkOrigin` skips
  // `application/json`, so the one content type that broke this route is the one the framework
  // waves through while refusing a form post with no Origin.
  //
  // The answer is the SAME generic redirect as every other failure, deliberately, rather than a
  // 400. These two routes hold exactly one observable failure shape — see src/lib/auth-messages.ts
  // and tests/api/auth-error-disclosure.test.ts, which compares whole responses across causes. A
  // distinct 400 would add a second shape and a new signal separating "bad body" from "bad
  // credentials". A content type is not a secret, but one shape is the rule here.
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    console.error("signin: request body was not form-encoded");
    return failed();
  }

  // Still `as string` rather than a schema: FormData.get returns `string | File | null`, and a
  // missing field therefore reaches GoTrue as null, which answers with an error and lands on the
  // same redirect — measured, not assumed. Tightening this is a separate decision.
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    // Deliberately indistinguishable from bad credentials. "Supabase is not configured" used to
    // reach this redirect, which told an UNAUTHENTICATED caller a fact about the server's state
    // on a pre-auth endpoint.
    console.error("signin: supabase client unavailable (configuration)");
    return failed();
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // The information is kept where it is useful and not caller-visible, matching the
    // `code, message` discipline the domain routes already use.
    console.error("signin failed:", error.code, error.message);
    return failed();
  }

  return context.redirect("/");
};
