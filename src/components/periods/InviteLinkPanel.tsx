import { useState } from "react";
import { Check, Copy, Link2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

// The design's "Link gotowy do wysłania" panel.
//
// This is the only place the raw token is ever shown. It is not stored anywhere —
// only its digest reached the database — so once this panel leaves the screen the
// value is gone for good, and the copy says so plainly rather than leaving the owner
// to find out by reloading.

interface Props {
  token: string;
  /** Absolute origin, passed down from the page. The owner needs an address they can
   *  paste into a message, and reading window here would either break SSR or make the
   *  server and client renders disagree. */
  origin: string;
  /** Shown instead of the "zapisz go teraz" line when the link was just regenerated. */
  regenerated?: boolean;
}

export function InviteLinkPanel({ token, origin, regenerated = false }: Props) {
  const [copied, setCopied] = useState(false);
  const url = `${origin}/invite/${token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Clipboard access can be refused (insecure context, denied permission). The
      // link is on screen and selectable, so this is not worth an error state.
      setCopied(false);
    }
  }

  return (
    <div className="border-border bg-card rounded-lg border-[1.5px] p-5">
      <p className="text-foreground font-heading flex items-center gap-2 text-[15px] font-bold">
        <Link2 className="text-primary size-4 shrink-0" />
        {regenerated ? "Nowy link gotowy do wysłania" : "Link gotowy do wysłania"}
      </p>

      <div className="border-input bg-background mt-3 flex items-center gap-3 rounded-lg border-[1.5px] p-2 pl-4">
        <code className="text-foreground min-w-0 flex-1 truncate text-[13px]" title={url}>
          {url}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Skopiowano" : "Kopiuj"}
        </Button>
      </div>

      <p className="text-muted-foreground mt-3 flex items-start gap-2 text-[13px]">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          Pokazujemy ten link tylko teraz — nie przechowujemy go. Skopiuj go i wyślij opiekunowi. Jeśli go zgubisz,
          wygeneruj nowy, a poprzedni przestanie działać.
          {regenerated && " Poprzedni link już nie działa."}
        </span>
      </p>

      <p className="text-muted-foreground mt-3 text-[12px] leading-[1.5]">
        Każdy z linkiem zajmie wolny dzień. Instrukcje pokażą się po zapisaniu.
      </p>
    </div>
  );
}
