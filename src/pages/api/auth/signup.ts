import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { SIGNUP_FAILED } from "@/lib/auth-messages";

// Every failure answers with ONE sentence, and here that is load-bearing rather than tidy:
// forwarding GoTrue's "User already registered" told an anonymous caller which addresses have
// accounts. See src/lib/auth-messages.ts.

export const POST: APIRoute = async (context) => {
  const failed = () => context.redirect(`/auth/signup?error=${encodeURIComponent(SIGNUP_FAILED)}`);

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
    console.error("signup: request body was not form-encoded");
    return failed();
  }

  // Still `as string` rather than a schema: FormData.get returns `string | File | null`, and a
  // missing field therefore reaches GoTrue as null, which answers with an error and lands on the
  // same redirect — measured, not assumed. Tightening this is a separate decision.
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    console.error("signup: supabase client unavailable (configuration)");
    return failed();
  }

  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    console.error("signup failed:", error.code, error.message);
    return failed();
  }

  return context.redirect("/auth/confirm-email");
};
