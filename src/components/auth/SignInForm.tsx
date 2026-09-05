import React, { useState } from "react";
import { Input } from "@/components/ui/Input";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

interface Props {
  serverError?: string | null;
}

export default function SignInForm({ serverError }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  function validate() {
    const next: typeof errors = {};
    if (!email.trim()) {
      next.email = "Podaj adres e-mail";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = "Podaj poprawny adres e-mail";
    }
    if (!password) {
      next.password = "Podaj hasło";
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

  return (
    <form method="POST" action="/api/auth/signin" className="space-y-4" onSubmit={handleSubmit} noValidate>
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
        placeholder="••••••••"
        autoComplete="current-password"
        error={errors.password}
        revealable
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Logowanie...">Zaloguj się</SubmitButton>
    </form>
  );
}
