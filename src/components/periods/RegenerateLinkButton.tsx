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
  /** True when the period carries revoked_at. Regenerating one would return 200 and a
   *  link that resolves to nothing: get_period_by_token filters on `revoked_at is null`,
   *  and regenerate_period_token deliberately leaves that column alone (un-revoking is
   *  S-06's decision, not a side effect of minting). So the action is refused here rather
   *  than handing the owner a dead link the panel calls "gotowy do wysłania". */
  revoked?: boolean;
}

export default function RegenerateLinkButton({ periodId, origin, revoked = false }: Props) {
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
      // 404 gets its own terminal sentence (S-06 Phase 3, from Phase 1's impl-review F1).
      // Since Phase 1 the RPC refuses a revoked period in SQL, so this route answers 404 for a
      // trip whose link was ended — a request that can NEVER now succeed. "Spróbuj ponownie"
      // would send the owner into a loop against it. The `revoked` prop below normally hides
      // this path, but it is a snapshot from render time: revoke in one tab, regenerate in
      // another, and this branch is reached by an ordinary sequence of clicks. Same reasoning
      // ReleaseSlotButton gives for treating its own 404 as actionable rather than retryable.
      setError(
        res.status === 404
          ? "Nie ma już takiego aktywnego wyjazdu — jego link mógł zostać unieważniony. Odśwież stronę, żeby zobaczyć aktualny stan."
          : "Nie udało się wygenerować nowego linku. Spróbuj ponownie.",
      );
    } catch {
      setError("Błąd połączenia. Sprawdź sieć i spróbuj ponownie.");
    } finally {
      setPending(false);
    }
  }

  if (token) {
    return <InviteLinkPanel token={token} origin={origin} regenerated />;
  }

  if (revoked) {
    return (
      <p className="border-border bg-card text-muted-foreground rounded-lg border-[1.5px] p-5 text-[13px]">
        Link do tego wyjazdu został unieważniony, więc nowego nie da się tu wygenerować — każdy nowy link też by nie
        działał. Zaplanuj nowy wyjazd, jeśli opiekun ma znów zajmować terminy.
      </p>
    );
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
