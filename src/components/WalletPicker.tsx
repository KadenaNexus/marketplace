import { useEffect, useState } from "react";
import { AlertTriangle, BellRing, Check, ChevronRight, Copy, Loader2, Monitor, QrCode, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isPhone, onPendingApproval } from "@/lib/walletconnect";
import { LINX_IOS, linxStoreLink } from "./OpenInLinx";

/** Choice shown when this browser has the Ecko extension and phone wallets are also possible. */
export function WalletPicker({ open, onOpenChange, onEcko, onPhone }: {
  open: boolean; onOpenChange: (o: boolean) => void; onEcko: () => void; onPhone: () => void;
}) {
  const option = (Icon: typeof Monitor, title: string, body: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{body}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Connect a wallet</DialogTitle>
          <DialogDescription>Your keys stay in your wallet. Each step asks you to approve it there.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {option(Monitor, "Ecko Wallet extension", "In this browser", onEcko)}
          {option(Smartphone, "Linx Wallet on your phone", "Scan a code with the Linx app.", onPhone)}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** While a phone wallet is asked to sign: where to approve, a way back to the wallet app, and Cancel. */
export function WalletApprovalBanner() {
  const [p, setP] = useState<Parameters<Parameters<typeof onPendingApproval>[0]>[0]>(null);
  const [slow, setSlow] = useState(false);
  const [resent, setResent] = useState(false);
  useEffect(() => onPendingApproval(setP), []);
  // After a while without an answer: help for a wallet app that did not pick the request up
  const since = p?.since;
  useEffect(() => {
    setSlow(false); setResent(false);
    if (!since) return;
    const t = setTimeout(() => setSlow(true), Math.max(0, since + 15000 - Date.now()));
    return () => clearTimeout(t);
  }, [since]);
  if (!p) return null;
  return (
    <div role="status" aria-live="assertive" className="fixed inset-x-0 bottom-0 z-[80] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {/* Yellow and pulsing: the trade waits for you in the wallet app */}
      <div className="relative mx-auto max-w-md">
        <div className="relative rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 text-amber-950 shadow-xl motion-safe:animate-alert-glow dark:bg-amber-950 dark:text-amber-50">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 motion-safe:animate-pulse items-center justify-center rounded-full bg-amber-400 text-amber-950">
              <BellRing className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-bold">Approve in {p.wallet}: {p.what}</p>
              <p className="text-sm opacity-80">
                {p.signIn
                  ? <>Second approval: sign in. You do this once on this phone. Switch to {p.wallet}, approve, then come back here.</>
                  : <>Switch to {p.wallet}, check the request and approve it, then come back here. This page updates by itself.</>}
              </p>
            </div>
            <button type="button" onClick={p.cancel} aria-label="Stop waiting" className="-m-1 rounded p-1 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
          </div>
          {slow && (
            <div className="mt-3 space-y-2 rounded-xl bg-white/70 p-3 text-sm dark:bg-black/20">
              <p className="font-semibold">{p.wallet} not showing it?</p>
              <ol className="list-decimal space-y-1 pl-5 opacity-90">
                <li>Close {p.wallet} completely (swipe it away) and open it again. The request is still waiting, so don't cancel here.</li>
                {p.resend && <li>Or send it again. If {p.wallet} then shows it twice, approve one and decline the other.</li>}
              </ol>
              {p.resend && (
                <button
                  type="button"
                  onClick={() => { p.resend?.(); setResent(true); }}
                  className="flex h-10 w-full items-center justify-center rounded-md border-2 border-amber-500 font-semibold hover:bg-amber-100 dark:hover:bg-amber-900"
                >
                  {resent ? `Sent again. Check ${p.wallet}` : `Send to ${p.wallet} again`}
                </button>
              )}
            </div>
          )}
          {p.href && (
            // a real link: iPhone opens an app from a tapped link more reliably than from script
            <a href={p.href} className="mt-3 flex h-11 w-full items-center justify-center rounded-md bg-amber-500 text-sm font-semibold text-amber-950 hover:bg-amber-400">Open {p.wallet}</a>
          )}
        </div>
      </div>
    </div>
  );
}

export const LINX_APP_STORE = LINX_IOS;

/** What approving in Linx looks like, so nobody is surprised by the requests. */
function LinxExpectations() {
  return (
    <div className="space-y-1.5 rounded-xl bg-muted/60 p-3 text-sm">
      <p className="font-semibold">What to expect in Linx</p>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li>Now: <b className="text-foreground">2 approvals</b>, Connect and Sign in. Once per phone.</li>
        <li>Then <b className="text-foreground">1 approval for every trade step</b>: post a pool, take, I paid, release. Switch to Linx, approve, come back.</li>
      </ul>
      <p className="pt-1 text-xs text-muted-foreground">
        No Linx yet? <a href={linxStoreLink()} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">Get Linx Wallet</a>
      </p>
    </div>
  );
}

/**
 * Connecting a phone wallet. Kadena wallets mostly connect by scanning or pasting a WalletConnect link,
 * so: a QR code on a computer; on a phone, Copy link (to paste in the wallet's WalletConnect screen).
 * (No generic "open wallet" wc: link: iPhone hands it to whichever wallet app claimed wc: links,
 * which may not be a Kadena wallet.)
 */
export function PhoneWalletSheet({ state }: { state: { uri: string | null; cancel: () => void; error?: string; retry?: () => void } | null }) {
  const phone = typeof navigator !== "undefined" && isPhone();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(!phone);
  const uri = state?.uri ?? null;

  useEffect(() => { setCopied(false); setShowQr(!phone); }, [state?.cancel, phone]);
  useEffect(() => {
    setQr(null);
    if (!uri || !showQr) return;
    import("qrcode")
      .then((QRCode) => QRCode.toDataURL(uri, { margin: 1, width: 480, errorCorrectionLevel: "M", color: { dark: "#123A48", light: "#FFFFFF" } }))
      .then(setQr).catch(() => setQr(null));
  }, [uri, showQr]);

  const copy = async () => {
    if (!uri) return;
    try { await navigator.clipboard.writeText(uri); }
    catch {
      const t = document.createElement("textarea"); t.value = uri; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      t.remove();
    }
    setCopied(true);
  };

  const qrBlock = (
    <div className="flex justify-center">
      <div className="flex h-60 w-60 items-center justify-center rounded-2xl border border-border bg-white p-3">
        {qr ? <img src={qr} alt="WalletConnect code to scan with your phone wallet" className="h-full w-full" /> : <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );

  return (
    <Dialog open={!!state} onOpenChange={(o) => { if (!o) state?.cancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Connect Linx Wallet</DialogTitle>
          <DialogDescription>The marketplace works with the Linx wallet app. Your keys stay in Linx.</DialogDescription>
        </DialogHeader>
        {state?.error ? (
          <div className="space-y-4">
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />{state.error}</p>
            <div className="flex flex-col gap-2">
              {state.retry && <Button className="h-11 w-full" onClick={state.retry}>Retry</Button>}
              <Button variant="outline" className="h-11 w-full" onClick={state.cancel}>Cancel</Button>
            </div>
          </div>
        ) : !uri ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Preparing a secure connection link…</p>
        ) : phone ? (
          <div className="space-y-4">
            <ol className="space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                <div className="flex-1 space-y-2">
                  <p>Copy the connection link.</p>
                  <Button className="h-11 w-full gap-2" onClick={copy}>
                    {copied ? <><Check className="h-4 w-4" />Copied</> : <><Copy className="h-4 w-4" />Copy link</>}
                  </Button>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                <p className="flex-1">Open <b>Linx</b>, tap <b>Scan</b>, then <b>Paste</b>.</p>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                <p className="flex-1">Approve <b>twice</b> in Linx: first <b>Connect</b> (check it says Kadena P2P Marketplace), then <b>Sign in</b>. Come back to this browser after each one. Then you can trade.</p>
              </li>
            </ol>
            <div className="space-y-2 border-t border-border pt-4">
              {!showQr ? (
                <button type="button" onClick={() => setShowQr(true)} className="flex w-full items-center justify-center gap-2 py-1 text-sm text-primary">
                  <QrCode className="h-4 w-4" />Wallet on another phone? Show QR code
                </button>
              ) : qrBlock}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {qrBlock}
            <p className="text-center text-sm">Open <b>Linx</b> on your phone, tap <b>Scan</b> and scan this code. Then approve twice in Linx: <b>Connect</b>, then <b>Sign in</b>.</p>
            <Button variant="outline" className="h-10 w-full gap-2" onClick={copy}>
              {copied ? <><Check className="h-4 w-4" />Copied</> : <><Copy className="h-4 w-4" />Copy link instead</>}
            </Button>
          </div>
        )}
        {uri && <LinxExpectations />}
        {uri && (
          <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />Waiting for your wallet…
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
