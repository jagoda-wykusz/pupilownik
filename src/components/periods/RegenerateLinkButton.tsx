import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServerError } from "@/components/auth/ServerError";
import { InviteLinkPanel } from "@/components/periods/InviteLinkPanel";

// The only way to recover a lost link in this slice: mint a new token, which replaces
// the digest and so invalidates the previous link. Revoking without replacing is S-06.
//
// The new raw token is shown here and nowhere else, for the same reason the create
// screen shows it once — it is never stored, so a reload cannot bring it back.

interface Props {
  periodId: string;
  /** Absolute origin, so the minted link is pasteable. See InviteLinkPanel. */
  origin: string;
}

export default function RegenerateLinkButton({ periodId, origin }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function regenerate() {
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/periods/${periodId}/token`, { method: "POST" });

      if (res.status === 401) {
        window.location.href = "/auth/signin";
        return;
      }
      if (res.ok) {
        const body = (await res.json()) as { inviteToken: string };
        setToken(body.inviteToken);
        return;
      }
      setError("Nie udało się wygenerować nowego linku. Spróbuj ponownie.");
    } catch {
      setError("Błąd połączenia. Sprawdź sieć i spróbuj ponownie.");
    } finally {
      setPending(false);
    }
  }

  if (token) {
    return <InviteLinkPanel token={token} origin={origin} regenerated />;
  }

  return (
    <div className="space-y-3">
      <Button type="button" variant="outline" className="w-full" disabled={pending} onClick={regenerate}>
        <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} />
        {pending ? "Generowanie..." : "Wygeneruj nowy link"}
      </Button>
      <ServerError message={error} />
      <p className="text-muted-foreground text-[13px]">
        Linku nie da się odczytać ponownie — pokazujemy go tylko w chwili utworzenia. Wygenerowanie nowego unieważnia
        poprzedni.
      </p>
    </div>
  );
}
