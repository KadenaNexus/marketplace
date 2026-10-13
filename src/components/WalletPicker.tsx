import { useEffect, useState } from "react";
import { Check, ChevronRight, Copy, ExternalLink, Loader2, Monitor, QrCode, Smartphone, X } from "lucide-react";
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
          {option(Smartphone, "Phone wallet", "Ecko app, Linx, Koala or another Kadena wallet. Scan a QR code with your phone.", onPhone)}
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
            <p className="font-semibold">Approve in {p.wallet}</p>
            <p className="text-sm text-muted-foreground">Check the request in {p.wallet} and approve it, then come back here. This page updates by itself.</p>
          </div>
          <button type="button" onClick={p.cancel} aria-label="Stop waiting" className="-m-1 rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {p.open && (
          <Button className="mt-3 h-11 w-full" onClick={p.open}>Open {p.wallet}</Button>
        )}
      </div>
    </div>
  );
}

/**
 * Connecting a phone wallet. Kadena wallets mostly connect by scanning or pasting a WalletConnect link,
 * so: a QR code on a computer; on a phone, Copy link (to paste in the wallet) and Open wallet app.
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
          <DialogTitle className="font-display text-xl">Connect your phone wallet</DialogTitle>
          <DialogDescription>Works with Ecko, Linx, Koala and other Kadena wallets that support WalletConnect.</DialogDescription>
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
                <p className="flex-1">Open your wallet app, go to <b>WalletConnect</b> (often a scan icon) and choose <b>Paste</b>.</p>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                <p className="flex-1">Check the site name says <b>Kadena P2P Marketplace</b>, approve, then come back here. This page connects by itself.</p>
              </li>
            </ol>
            <div className="space-y-2 border-t border-border pt-4">
              <a href={uri} className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-border text-sm font-medium hover:border-primary">
                <ExternalLink className="h-4 w-4" />Open wallet app
              </a>
              <p className="text-center text-xs text-muted-foreground">Works when your wallet opens WalletConnect links. If nothing happens, use Copy link.</p>
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
            <p className="text-center text-sm">Open <b>Ecko</b>, <b>Linx</b> or <b>Koala</b> on your phone, go to <b>WalletConnect</b> and scan this code.</p>
            <Button variant="outline" className="h-10 w-full gap-2" onClick={copy}>
              {copied ? <><Check className="h-4 w-4" />Copied</> : <><Copy className="h-4 w-4" />Copy link instead</>}
            </Button>
          </div>
        )}
        {uri && (
          <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />Waiting for your wallet…
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
