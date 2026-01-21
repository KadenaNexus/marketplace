import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWallet } from "@/hooks/useWallet";
import { 
  buildCreateOfferTx, 
  signTransaction, 
  submitTransaction,
  pollTransaction,
} from "@/lib/kadena";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface CreateOfferFormProps {
  onSuccess?: (offerId: string, txHash: string) => void;
  role?: "buyer" | "seller";
}

export function CreateOfferForm({ onSuccess, role = "seller" }: CreateOfferFormProps) {
  const { account, isConnected } = useWallet();
  const [offerId, setOfferId] = useState("");
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const generateOfferId = () => {
    const id = `offer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setOfferId(id);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!account) {
      toast.error("Please connect your wallet first");
      return;
    }

    if (!offerId || !amount) {
      toast.error("Please fill in offer ID and amount");
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setIsLoading(true);

    try {
      // Build the transaction (platform arbiter is fixed in the contract)
      const tx = buildCreateOfferTx(
        offerId,
        amountNum,
        account.account,
        account.publicKey
      );

      console.log("Built transaction:", tx);
      console.log("Transaction type:", typeof tx);
      console.log("Transaction keys:", Object.keys(tx || {}));

      // Sign with wallet
      const signedTx = await signTransaction(tx);

      // Submit to chain
      const requestKey = await submitTransaction(signedTx);

      // Wait for tx to be included in a block and check on-chain result
      const txResult = await pollTransaction(requestKey);
      const res = txResult?.result;
      if (res?.status === "failure") {
        let errMsg = "Transaction failed on-chain";
        const e = res.error;
        if (typeof e === "string") errMsg = e;
        else if (e && typeof e === "object") {
          const o = e as Record<string, unknown>;
          errMsg = String(o.message ?? o.msg ?? o.info ?? o.detail ?? errMsg);
        }
        throw new Error(errMsg);
      }

      toast.success("Offer created!", {
        description: `Request Key: ${requestKey.slice(0, 16)}...`,
      });

      onSuccess?.(offerId, requestKey);
      
      // Reset form
      setOfferId("");
      setAmount("");
    } catch (error) {
      console.error("Create offer error:", error);
      toast.error("Failed to create offer", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="escrow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-primary" />
          {role === "buyer" ? "Create Buy Offer" : "Create Sell Offer"}
        </CardTitle>
        <CardDescription>
          {role === "buyer" 
            ? "Create a new buy offer. Note: The contract currently supports seller-created offers. This will create a sell offer that you can accept."
            : "Create a new P2P escrow offer as the seller"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="offerId">Offer ID</Label>
            <div className="flex gap-2">
              <Input
                id="offerId"
                value={offerId}
                onChange={(e) => setOfferId(e.target.value)}
                placeholder="Enter unique offer ID"
                className="font-mono"
              />
              <Button 
                type="button" 
                variant="secondary" 
                onClick={generateOfferId}
              >
                Generate
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount (KDA)</Label>
            <Input
              id="amount"
              type="number"
              step="0.00000001"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="font-mono"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Platform arbiter is set in the contract and can release or refund in disputes.
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-500">
            If Create Offer fails with &quot;table not found&quot;, the escrows table was not created. The deployer must run{" "}
            <code className="rounded bg-muted px-0.5">(create-table free.p2p-escrow.escrows)</code> in the deployment tx. See{" "}
            <code>DEPLOY.md</code>.
          </p>

          <Button 
            type="submit" 
            className="w-full" 
            disabled={!isConnected || isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Offer"
            )}
          </Button>

          {!isConnected && (
            <p className="text-sm text-muted-foreground text-center">
              Connect your wallet to create offers
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
