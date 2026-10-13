import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, ImagePlus, Loader2, ShieldCheck, Unlock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWallet } from "@/hooks/useWallet";
import { authProof } from "@/lib/session";
import type { Escrow } from "@/lib/kadena";
import { addProof, getProofs, type Proof } from "@/lib/proofApi";
import { offerMethods } from "./PayoutCard";

const methodsText = (e: Escrow) => offerMethods(e).join(" or ") || "the payment method you agreed on";
const refHint = (e: Escrow) => {
  const m = offerMethods(e);
  if (m.some((x) => /usdt|usdc/i.test(x))) return "Transaction ID (hash) of the USDT/USDC transfer";
  return "Transfer reference from Wise or Revolut";
};

export function useProofs(escrow: Escrow | null | undefined) {
  const { account, isConnected } = useWallet();
  const me = account?.account;
  const involved = !!escrow && !!me && escrow.state !== "CREATED" && (me === escrow.seller || me === escrow.buyer || me === escrow.arbiter);
  return useQuery({
    queryKey: ["proofs", escrow?.offerId, me, escrow?.state],
    queryFn: async () => {
      const signedCmd = await authProof(account!.account, account!.publicKey);
      return getProofs(escrow!.offerId, { wallet: account!.account, publicKey: account!.publicKey, signedCmd });
    },
    enabled: involved && isConnected,
    staleTime: 10000,
  });
}

function ProofItems({ proofs }: { proofs: Proof[] }) {
  return (
    <ul className="space-y-2">
      {proofs.map((p, i) => (
        <li key={i} className="flex items-start gap-3 rounded-lg bg-muted p-3">
          {p.fileUrl && (/\.pdf$/i.test(p.fileUrl)
            ? <a href={p.fileUrl} target="_blank" rel="noopener noreferrer" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-border bg-background"><FileText className="h-6 w-6" /></a>
            : <a href={p.fileUrl} target="_blank" rel="noopener noreferrer" className="shrink-0"><img src={p.fileUrl} alt="Payment screenshot" className="h-16 w-16 rounded-md border border-border object-cover" /></a>)}
          <span className="min-w-0 flex-1 text-sm">
            {p.reference && <span className="block break-all font-mono">{p.reference}</span>}
            {p.fileUrl && <a href={p.fileUrl} target="_blank" rel="noopener noreferrer" className="block text-primary underline">Open the screenshot</a>}
            <span className="block text-xs text-muted-foreground">Added {new Date(p.at).toLocaleString()}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The buyer's proof of payment, in the trade details (both sides) and on the arbiter's dispute page. */
export function ProofCard({ escrow }: { escrow: Escrow }) {
  const { data: proofs = [] } = useProofs(escrow);
  if (!proofs.length) return null;
  return (
    <section className="space-y-2 rounded-xl border-2 border-border p-4" aria-label="Proof of payment">
      <h3 className="font-semibold">Proof of payment from the buyer</h3>
      <ProofItems proofs={proofs} />
      <p className="text-xs text-muted-foreground">A screenshot can be faked. The seller checks the money in their own account before releasing.</p>
    </section>
  );
}

/**
 * Mark as Paid: the buyer adds a screenshot and/or the transfer reference first. Kept with the trade so
 * the seller knows where to look and the arbiter has it in a dispute.
 */
export function MarkPaidDialog({ escrow, total, open, onOpenChange, onConfirm }: {
  escrow: Escrow; total: string; open: boolean; onOpenChange: (o: boolean) => void; onConfirm: () => void;
}) {
  const { account } = useWallet();
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [own, setOwn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const ready = (!!file || reference.trim().length > 0) && own;

  const submit = async () => {
    if (!account) return;
    setBusy(true); setError(null);
    try {
      const signedCmd = await authProof(account.account, account.publicKey);
      await addProof(escrow.offerId, { file, reference: reference.trim() }, { wallet: account.account, publicKey: account.publicKey, signedCmd });
      onOpenChange(false);
      onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload the proof");
      setFailed(true);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Mark as paid</DialogTitle>
          <DialogDescription>Add proof that you sent {total} by {methodsText(escrow)}. The seller and, if needed, the arbiter will see it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Screenshot of the payment</Label>
            <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file ? (
              <div className="flex items-center gap-2 rounded-lg bg-muted p-2 text-sm">
                <FileText className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{file.name}</span>
                <button type="button" aria-label="Remove the screenshot" onClick={() => { setFile(null); if (input.current) input.current.value = ""; }}><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="h-12 w-full gap-2" onClick={() => input.current?.click()}><ImagePlus className="h-5 w-5" />Choose screenshot</Button>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="proof-ref">{refHint(escrow)}</Label>
            <Input id="proof-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Paste it here" dir="ltr" autoComplete="off" maxLength={300} />
            <p className="text-xs text-muted-foreground">Add a screenshot, the reference, or both.</p>
          </div>
          <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" checked={own} onChange={(e) => setOwn(e.target.checked)} />
            <span>I sent exactly <b>{total}</b> from an account in <b>my own name</b>.</span>
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button type="button" className="h-12 w-full gap-2" disabled={!ready || busy} onClick={submit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Add proof and mark as paid
          </Button>
          {failed && (
            <button type="button" className="text-sm text-muted-foreground underline" onClick={() => { onOpenChange(false); onConfirm(); }}>
              Mark as paid without proof (the upload is not working)
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Release: the step that cannot be undone. The seller confirms they checked their own account, not a
 * screenshot, before the KDA goes to the buyer.
 */
export function ReleaseDialog({ escrow, total, open, onOpenChange, onConfirm }: {
  escrow: Escrow; total: string; open: boolean; onOpenChange: (o: boolean) => void; onConfirm: () => void;
}) {
  const { data: proofs = [] } = useProofs(open ? escrow : null);
  const [checked, setChecked] = useState(false);
  const [named, setNamed] = useState(false);
  const close = (o: boolean) => { onOpenChange(o); if (!o) { setChecked(false); setNamed(false); } };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl"><AlertTriangle className="h-5 w-5 text-amber-500" />Before you release</DialogTitle>
          <DialogDescription>Release sends the KDA to the buyer and cannot be undone.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-amber-950 dark:bg-amber-950 dark:text-amber-50">
            Open your <b>{methodsText(escrow)}</b> app and check that <b>{total}</b> has really arrived. <b>A screenshot is not proof</b>: fake screenshots are the most common scam.
          </div>
          {proofs.length > 0 && (
            <div className="space-y-2">
              <p className="font-medium">What the buyer sent as proof</p>
              <ProofItems proofs={proofs} />
            </div>
          )}
          <label className="flex items-start gap-3 rounded-lg border border-border p-3">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>I checked my own account: <b>{total}</b> has arrived in full.</span>
          </label>
          <label className="flex items-start gap-3 rounded-lg border border-border p-3">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" checked={named} onChange={(e) => setNamed(e.target.checked)} />
            <span>It came from an account in the buyer's name (or the buyer's wallet for USDT/USDC).</span>
          </label>
          <p className="text-xs text-muted-foreground">Not arrived, or something looks wrong? Don't release. Write in the chat, or open a dispute.</p>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button type="button" className="h-12 w-full gap-2" disabled={!checked || !named} onClick={() => { close(false); onConfirm(); }}>
            <Unlock className="h-4 w-4" />Release {escrow.amount.toLocaleString("en-US", { maximumFractionDigits: 4 })} KDA to the buyer
          </Button>
          <Button type="button" variant="outline" className="h-11 w-full" onClick={() => close(false)}>Not yet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
