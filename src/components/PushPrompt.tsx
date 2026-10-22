import { useState } from "react";
import { BellRing, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/useNotifications";
import { useWallet } from "@/hooks/useWallet";
import { TradeEmailForm, useTradeEmail } from "./TradeEmail";

const HIDE_KEY = "nx-push-card-hidden-until";
const hiddenNow = () => { try { return Number(localStorage.getItem(HIDE_KEY) || 0) > Date.now(); } catch { return false; } };

/**
 * Trade deadlines are 1 and 4 hours, so phone notifications matter. iPhone only allows them for sites
 * added to the Home Screen; this card walks people through it (or turns them on where already possible).
 * "Not now" hides it for 2 weeks on this device.
 */
export function PushPrompt() {
  const { account } = useWallet();
  const { enabled, push, turnOnPush } = useNotifications();
  const { data: mail } = useTradeEmail();
  const [hidden, setHidden] = useState(hiddenNow);
  const [busy, setBusy] = useState(false);
  const askPush = push === "default"; // Linx-only: no "Add to Home Screen" steps
  const askMail = !!mail?.available && !mail.on;
  if (!account || !enabled || hidden || (!askPush && !askMail)) return null;
  const hide = () => { try { localStorage.setItem(HIDE_KEY, String(Date.now() + 14 * 86400e3)); } catch { /* ignore */ } setHidden(true); };

  return (
    <section className="relative rounded-2xl border-2 border-primary/30 bg-primary/5 p-4" aria-label="Get trade notifications">
      <button type="button" onClick={hide} aria-label="Not now" className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      <p className="flex items-center gap-2 pr-6 font-semibold"><BellRing className="h-5 w-5 text-primary" />Don't miss your turn</p>
      {!askPush ? (
        <p className="mt-1 text-sm text-muted-foreground">Add your email: it's needed to trade, and every step of your trades comes there.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">Get a notification when a trade needs you (accepted, funded, paid, deadlines), even with the page closed.</p>
          <Button className="mt-3 h-11 w-full gap-2" disabled={busy} onClick={async () => { setBusy(true); try { await turnOnPush(false); } finally { setBusy(false); } }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}Turn on notifications
          </Button>
        </>
      )}
      {askMail && (
        <div className={askPush ? "mt-4 border-t border-border pt-3" : "mt-3"}>
          {askPush && <p className="mb-1 text-sm font-medium">Your email (needed to trade)</p>}
          <TradeEmailForm compact />
        </div>
      )}
      <button type="button" onClick={hide} className="mt-3 text-xs text-muted-foreground underline">Not now</button>
    </section>
  );
}
