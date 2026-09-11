import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { SIGNIN_FAILED } from "@/lib/auth-messages";

// Every failure answers with ONE sentence. See src/lib/auth-messages.ts for why the upstream
// wording is swallowed rather than forwarded, and what that costs.

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const failed = () => context.redirect(`/auth/signin?error=${encodeURIComponent(SIGNIN_FAILED)}`);

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
