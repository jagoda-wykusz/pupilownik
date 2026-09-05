import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

interface SubmitButtonProps {
  pendingText: string;
  children: ReactNode;
}

// Styling now comes entirely from the Button primary variant — the starter's
// hardcoded purple is gone. The design's buttons carry no leading icon, so the
// former `icon` prop went with it; the pending spinner stays, because it is
// behaviour rather than decoration.
export function SubmitButton({ pendingText, children }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? (
        <span className="flex items-center gap-2">
          <span className="size-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
          {pendingText}
        </span>
      ) : (
        children
      )}
    </Button>
  );
}
