import { useEffect, useState } from "react";
import { ChevronRight, Monitor, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { onPendingApproval } from "@/lib/walletconnect";

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
