import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWallet } from "@/hooks/useWallet";
import { buildProfileAuthTx, signTransaction } from "@/lib/kadena";
import { openDispute } from "@/lib/disputeApi";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Escrow } from "@/lib/kadena";

interface OpenDisputeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  escrow: Escrow;
  onSuccess?: () => void;
}

export function OpenDisputeDialog({ open, onOpenChange, escrow, onSuccess }: OpenDisputeDialogProps) {
  const { account, isConnected } = useWallet();
  const [reason, setReason] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const isBuyer = account?.account === escrow.buyer;
  const isSeller = account?.account === escrow.seller;
  const allowedStates = ["CREATED", "ACCEPTED", "FUNDED", "PAID"] as const;
  const canOpenDispute = (isBuyer || isSeller) && allowedStates.includes(escrow.state as typeof allowedStates[number]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account || !isConnected) {
      toast.error("Connect your wallet first");
      return;
    }
    if (!reason.trim()) {
      toast.error("Please provide a reason for the dispute");
      return;
    }

    setIsLoading(true);
    try {
      const tx = buildProfileAuthTx(account.account, account.publicKey);
      let signedCmd = await signTransaction(tx);
      if (signedCmd?.signedCmd && !signedCmd.cmd) signedCmd = signedCmd.signedCmd;
      const sigs = Array.isArray(signedCmd?.sigs) ? signedCmd.sigs : [];
      if (sigs[0] && !sigs[0].pubKey) sigs[0] = { ...sigs[0], pubKey: account.publicKey };
      if (sigs[0]?.signature && !sigs[0].sig) sigs[0] = { ...sigs[0], sig: sigs[0].signature };

      await openDispute({
        offerId: escrow.offerId,
        openedBy: isBuyer ? "buyer" : "seller",
        reason: reason.trim(),
        wallet: account.account,
        publicKey: account.publicKey,
        signedCmd,
      });

      toast.success("Dispute opened successfully");
      setReason("");
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error("Failed to open dispute", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!canOpenDispute) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Open Dispute
          </DialogTitle>
          <DialogDescription>
            Explain why you're opening a dispute. Both parties can submit evidence.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dispute-reason">Reason for Dispute</Label>
            <Textarea
              id="dispute-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the issue that requires dispute resolution..."
              rows={5}
              maxLength={1000}
              className="resize-none"
              required
            />
            <p className="text-xs text-muted-foreground">
              {reason.length}/1000 characters
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Opening a dispute will notify the arbiter. You can submit evidence after opening the dispute.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading} variant="destructive">
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Opening...
                </>
              ) : (
                "Open Dispute"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
