import { useEffect, useState } from "react";
import { Check, ChevronRight, Copy, Loader2, Monitor, QrCode, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isPhone, onPendingApproval } from "@/lib/walletconnect";

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
  useEffect(() => onPendingApproval(setP), []);
  if (!p) return null;
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-0 z-[80] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="relative mt-1 flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Approve in {p.wallet}: {p.what}</p>
            <p className="text-sm text-muted-foreground">
              {p.signIn
                ? <>Second approval: sign in. You do this once on this phone. Switch to {p.wallet}, approve, then come back here.</>
                : <>Switch to {p.wallet}, check the request and approve it, then come back here. This page updates by itself.</>}
            </p>
          </div>
          <button type="button" onClick={p.cancel} aria-label="Stop waiting" className="-m-1 rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {p.href && (
          // a real link: iPhone opens an app from a tapped link more reliably than from script
          <a href={p.href} className="mt-3 flex h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90">Open {p.wallet}</a>
        )}
      </div>
    </div>
  );
}

export const LINX_APP_STORE = "https://apps.apple.com/app/linx-wallet/id6450412379";

/** What approving in Linx looks like, so nobody is surprised by the requests. */
function LinxExpectations() {
  return (
    <div className="space-y-1.5 rounded-xl bg-muted/60 p-3 text-sm">
      <p className="font-semibold">What to expect in Linx</p>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li>Now: <b className="text-foreground">2 approvals</b>, Connect and Sign in. Once per phone.</li>
        <li>Then <b className="text-foreground">1 approval for every trade step</b>: create, accept, deposit, mark as paid, release. Switch to Linx, approve, come back.</li>
      </ul>
      <p className="pt-1 text-xs text-muted-foreground">
        No Linx yet? <a href={LINX_APP_STORE} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">Get it on the App Store</a>
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
export function PhoneWalletSheet({ state }: { state: { uri: string | null; cancel: () => void } | null }) {
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
        {!uri ? (
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
