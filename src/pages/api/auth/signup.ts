import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { SIGNUP_FAILED } from "@/lib/auth-messages";

// Every failure answers with ONE sentence, and here that is load-bearing rather than tidy:
// forwarding GoTrue's "User already registered" told an anonymous caller which addresses have
// accounts. See src/lib/auth-messages.ts.

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const failed = () => context.redirect(`/auth/signup?error=${encodeURIComponent(SIGNUP_FAILED)}`);

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
