import { CircleAlert } from "lucide-react";

interface ServerErrorProps {
  message?: string | null;
}

// Moved off the starter's hardcoded red-on-dark onto tokens, so it stays legible
// in all three themes. role="alert" is load-bearing: the message appears after a
// failed submit, and a screen-reader user needs it announced rather than merely
// present.
export function ServerError({ message }: ServerErrorProps) {
  if (!message) return null;

  return (
    <p
      role="alert"
      className="border-destructive/40 bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg border-[1.5px] px-4 py-3 text-[14px]"
    >
      <CircleAlert className="size-4 shrink-0" />
      {message}
    </p>
  );
}
