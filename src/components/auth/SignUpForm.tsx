import React, { useState } from "react";
import { Input } from "@/components/ui/Input";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

const MIN_PASSWORD_LENGTH = 6;

interface Props {
  serverError?: string | null;
}

// Polish counts three ways. With MIN_PASSWORD_LENGTH at 6 the remainder is only ever
// 1-5, so the general rule is not needed — but 5 already takes the genitive plural,
// so a naive singular/plural split would print "5 znaki".
function pluralZnak(count: number): string {
  if (count === 1) return "znak";
  return count >= 2 && count <= 4 ? "znaki" : "znaków";
}

export default function SignUpForm({ serverError }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirmPassword?: string }>({});

  function validate() {
    const next: typeof errors = {};

    if (!email.trim()) {
      next.email = "Podaj adres e-mail";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = "Podaj poprawny adres e-mail";
    }

    if (!password) {
      next.password = "Podaj hasło";
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków`;
    }

    if (!confirmPassword) {
      next.confirmPassword = "Powtórz hasło";
    } else if (password !== confirmPassword) {
      next.confirmPassword = "Hasła nie są takie same";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  // Live countdown toward the minimum length. Rendered beside the field rather than
  // inside Input, so the component stays to what the design actually shows.
  const remaining = MIN_PASSWORD_LENGTH - password.length;
  const showHint = !errors.password && password.length > 0 && remaining > 0;

  return (
    <form method="POST" action="/api/auth/signup" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <Input
        id="email"
        name="email"
        type="email"
        label="E-MAIL"
        value={email}
        onChange={(v) => {
          setEmail(v);
          clearError("email");
        }}
        placeholder="anna@example.com"
        autoComplete="email"
        error={errors.email}
      />

      <div>
        <Input
          id="password"
          name="password"
          type="password"
          label="HASŁO"
          value={password}
          onChange={(v) => {
            setPassword(v);
            clearError("password");
          }}
          placeholder="Min. 6 znaków"
          autoComplete="new-password"
          error={errors.password}
          revealable
        />
        {showHint && (
          <p className="text-muted-foreground mt-1.5 ml-1 text-[13px]">
            Jeszcze {remaining} {pluralZnak(remaining)}
          </p>
        )}
      </div>

      <Input
        id="confirmPassword"
        name="confirmPassword"
        type="password"
        label="POWTÓRZ HASŁO"
        value={confirmPassword}
        onChange={(v) => {
          setConfirmPassword(v);
          clearError("confirmPassword");
        }}
        placeholder="••••••••"
        autoComplete="new-password"
        error={errors.confirmPassword}
        revealable
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Zakładanie konta...">Załóż konto</SubmitButton>
    </form>
  );
}
