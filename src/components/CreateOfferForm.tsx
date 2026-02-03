import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWallet } from "@/hooks/useWallet";
import { 
  buildCreateOfferTx, 
  signTransaction, 
  submitTransaction,
  pollTransaction,
} from "@/lib/kadena";
import { putOfferDetails } from "@/lib/offerDetailsApi";
import { Plus, Loader2, ShoppingCart, Store } from "lucide-react";
import { toast } from "sonner";

const PAYMENT_METHODS = ["USDT", "USDC", "BUSD", "Bank Transfer", "PayPal", "Wise", "Revolut", "Cash App"];
const FIAT_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"];

interface CreateOfferFormProps {
  onSuccess?: (offerId: string, txHash: string) => void;
  role?: "buyer" | "seller";
}

export function CreateOfferForm({ onSuccess, role = "seller" }: CreateOfferFormProps) {
  const { account, isConnected } = useWallet();
  const [offerId, setOfferId] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">(role === "buyer" ? "BUY" : "SELL");
  const [price, setPrice] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [fiatCurrency, setFiatCurrency] = useState("USD");
  const [isLoading, setIsLoading] = useState(false);

  const generateOfferId = () => {
    const id = `offer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setOfferId(id);
  };

  const handlePaymentMethodToggle = (method: string, checked: boolean) => {
    if (checked) {
      setPaymentMethods([...paymentMethods, method]);
    } else {
      setPaymentMethods(paymentMethods.filter(m => m !== method));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!account) {
      toast.error("Please connect your wallet first");
      return;
    }

    if (!offerId || !price || !minAmount || !maxAmount) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (paymentMethods.length === 0) {
      toast.error("Please select at least one payment method");
      return;
    }

    const priceNum = parseFloat(price);
    const minAmountNum = parseFloat(minAmount);
    const maxAmountNum = parseFloat(maxAmount);

    if (isNaN(priceNum) || priceNum <= 0) {
      toast.error("Please enter a valid price");
      return;
    }

    if (isNaN(minAmountNum) || minAmountNum <= 0) {
      toast.error("Please enter a valid minimum amount");
      return;
    }

    if (isNaN(maxAmountNum) || maxAmountNum <= 0) {
      toast.error("Please enter a valid maximum amount");
      return;
    }

    if (maxAmountNum < minAmountNum) {
      toast.error("Maximum amount must be greater than or equal to minimum amount");
      return;
    }

    // Use maxAmount as the available amount
    const amountNum = maxAmountNum;

    setIsLoading(true);

    try {
      // Save off-chain offer details (price, limits, payment method); contract stores only trustless data
      const paymentMethodJson = JSON.stringify(paymentMethods);
      await putOfferDetails({
        offerId,
        creator: account.account,
        amount: amountNum,
        side,
        price: priceNum,
        minAmount: minAmountNum,
        maxAmount: maxAmountNum,
        paymentMethod: paymentMethodJson,
        fiatCurrency,
      });

      // On-chain: create-offer (id, creator, amount, side only)
      const tx = buildCreateOfferTx(
        offerId,
        amountNum,
        account.account,
        account.publicKey,
        side
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
      setPrice("");
      setMinAmount("");
      setMaxAmount("");
      setPaymentMethods([]);
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
          {/* Side Selection */}
          <div className="space-y-2">
            <Label>Trade Side</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={side === "SELL" ? "default" : "outline"}
                className="flex-1 gap-2"
                onClick={() => setSide("SELL")}
              >
                <Store className="h-4 w-4" />
                Sell KDA
              </Button>
              <Button
                type="button"
                variant={side === "BUY" ? "default" : "outline"}
                className="flex-1 gap-2"
                onClick={() => setSide("BUY")}
              >
                <ShoppingCart className="h-4 w-4" />
                Buy KDA
              </Button>
            </div>
          </div>

          {/* Offer ID */}
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

          {/* Price */}
          <div className="space-y-2">
            <Label htmlFor="price">Price per KDA ({fiatCurrency})</Label>
            <Input
              id="price"
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="font-mono"
            />
          </div>

          {/* Min/Max Limits */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="minAmount">Min Transaction (KDA)</Label>
              <Input
                id="minAmount"
                type="number"
                step="0.00000001"
                min="0"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                placeholder="0.00"
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxAmount">Max Transaction (KDA)</Label>
              <Input
                id="maxAmount"
                type="number"
                step="0.00000001"
                min="0"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                placeholder="0.00"
                className="font-mono"
              />
            </div>
          </div>

          {/* Fiat Currency */}
          <div className="space-y-2">
            <Label htmlFor="fiatCurrency">Fiat Currency</Label>
            <Select value={fiatCurrency} onValueChange={setFiatCurrency}>
              <SelectTrigger id="fiatCurrency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIAT_CURRENCIES.map((curr) => (
                  <SelectItem key={curr} value={curr}>{curr}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Payment Methods */}
          <div className="space-y-2">
            <Label>Payment Methods</Label>
            <div className="grid grid-cols-2 gap-3 p-4 border rounded-lg">
              {PAYMENT_METHODS.map((method) => (
                <div key={method} className="flex items-center space-x-2">
                  <Checkbox
                    id={`payment-${method}`}
                    checked={paymentMethods.includes(method)}
                    onCheckedChange={(checked) => handlePaymentMethodToggle(method, checked as boolean)}
                  />
                  <Label
                    htmlFor={`payment-${method}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {method}
                  </Label>
                </div>
              ))}
            </div>
            {paymentMethods.length === 0 && (
              <p className="text-xs text-destructive">Select at least one payment method</p>
            )}
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
