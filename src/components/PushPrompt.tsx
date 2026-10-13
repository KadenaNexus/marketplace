import { useState } from "react";
import { BellRing, Loader2, PlusSquare, Share, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/useNotifications";
import { useWallet } from "@/hooks/useWallet";

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
  const [hidden, setHidden] = useState(hiddenNow);
  const [busy, setBusy] = useState(false);
  if (!account || !enabled || hidden || (push !== "needs-install" && push !== "default")) return null;
  const hide = () => { try { localStorage.setItem(HIDE_KEY, String(Date.now() + 14 * 86400e3)); } catch { /* ignore */ } setHidden(true); };

  return (
    <section className="relative rounded-2xl border-2 border-primary/30 bg-primary/5 p-4" aria-label="Get trade notifications">
      <button type="button" onClick={hide} aria-label="Not now" className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      <p className="flex items-center gap-2 pr-6 font-semibold"><BellRing className="h-5 w-5 text-primary" />Don't miss your turn</p>
      {push === "needs-install" ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">Get a notification when a trade needs you, even with the page closed. On iPhone, add the Marketplace to your Home Screen first:</p>
          <ol className="mt-3 space-y-2 text-sm">
            {[
              [Share, <>Tap <b>Share</b> at the bottom of Safari</>],
              [PlusSquare, <>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b></>],
              [Smartphone, <>Open the Marketplace from the new icon and tap <b>Turn on notifications</b></>],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof Share;
              return (
                <li key={i} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background text-primary shadow-sm"><I className="h-4 w-4" /></span>
                  <span>{text as React.ReactNode}</span>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">Get a notification when a trade needs you (accepted, funded, paid, deadlines), even with the page closed.</p>
          <Button className="mt-3 h-11 w-full gap-2" disabled={busy} onClick={async () => { setBusy(true); try { await turnOnPush(false); } finally { setBusy(false); } }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}Turn on notifications
          </Button>
        </>
      )}
      <button type="button" onClick={hide} className="mt-3 text-xs text-muted-foreground underline">Not now</button>
    </section>
  );
}
