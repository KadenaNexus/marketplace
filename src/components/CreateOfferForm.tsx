import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWallet } from "@/hooks/useWallet";
import { 
  CONTRACT_NAMESPACE,
  CONTRACT_MODULE,
  buildCreateOfferTx, 
  signTransaction, 
  submitTransaction,
  pollTransaction,
  getChainwebDebugInfo,
} from "@/lib/kadena";
import { putOfferDetails } from "@/lib/offerDetailsApi";
import { Plus, Loader2, ShoppingCart, Store, Info } from "lucide-react";
import { toast } from "sonner";

const PAYMENT_METHODS = ["USDT", "USDC", "BUSD", "Bank Transfer", "PayPal", "Wise", "Revolut", "Cash App"];
const FIAT_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"];
const TX_CONFIRM_MESSAGE = "Transaction in progress… Confirming on the Kadena network. This may take up to 60 seconds.";

interface CreateOfferFormProps {
  onSuccess?: (offerId: string, txHash: string) => void;
  role?: "buyer" | "seller";
}

export function CreateOfferForm({ onSuccess, role = "seller" }: CreateOfferFormProps) {
  const { account, isConnected } = useWallet();
  const [offerId, setOfferId] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">(role === "buyer" ? "BUY" : "SELL");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
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

    if (!offerId || !price || !amount) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (paymentMethods.length === 0) {
      toast.error("Please select at least one payment method");
      return;
    }

    const priceNum = parseFloat(price);
    const amountNum = parseFloat(amount);

    if (isNaN(priceNum) || priceNum <= 0) {
      toast.error("Please enter a valid price");
      return;
    }

    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Please enter a valid amount (KDA)");
      return;
    }

    setIsLoading(true);
    // Yield so React paints the status message before wallet/signing
    await new Promise((r) => setTimeout(r, 0));

    try {
      // On-chain first: create-offer (id, creator, amount, side only)
      const tx = buildCreateOfferTx(
        offerId,
        amountNum,
        account.account,
        account.publicKey,
        side
      );

      const signedTx = await signTransaction(tx);
      console.debug("[CreateOffer] Sending create-offer tx — API:", getChainwebDebugInfo());
      const requestKey = await submitTransaction(signedTx);
      console.debug("[CreateOffer] Send OK, requestKey:", requestKey);

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
        // Debug: full chain response and API used (for "read-only" / node issues)
        console.error("[CreateOffer] On-chain failure — full poll result:", JSON.stringify(txResult, null, 2));
        console.error("[CreateOffer] Chain API used:", getChainwebDebugInfo());
        throw new Error(`On-chain: ${errMsg}`);
      }

      // Then save off-chain offer details (price, limits, payment method)
      let offChainSaved = true;
      const paymentMethodJson = JSON.stringify(paymentMethods);
      try {
        await putOfferDetails({
          offerId,
          creator: account.account,
          amount: amountNum,
          side,
          price: priceNum,
          paymentMethod: paymentMethodJson,
          fiatCurrency,
        });
      } catch (apiErr) {
        offChainSaved = false;
        console.warn("Off-chain offer details save failed:", apiErr);
        toast.warning("Offer created on-chain. Server could not save price/payment details (check DB write access).");
      }

      toast.success("Offer created!", {
        description: offChainSaved
          ? `Request Key: ${requestKey.slice(0, 16)}...`
          : `On-chain only. Request Key: ${requestKey.slice(0, 16)}...`,
      });

      onSuccess?.(offerId, requestKey);
      
      // Reset form
      setOfferId("");
      setPrice("");
      setAmount("");
      setPaymentMethods([]);
    } catch (error) {
      console.error("Create offer error:", error);
      console.error("[CreateOffer] Chain API at time of error:", getChainwebDebugInfo());
      const msg = error instanceof Error ? error.message : "Unknown error";
      const isReadOnly = /read-only|system-only|database operation/.test(msg);
      const isChain = /Send failed|On-chain:|requestKey|Transaction failed/.test(msg) || isReadOnly;
      const hint = isReadOnly
        ? `The Chainweb API is in read-only mode (no table writes). Use a write-capable API: set VITE_CHAINWEB_API to the full Pact URL (e.g. https://api.chainweb.com/chainweb/0.0/mainnet01/chain/1/pact) and restart. Current API: ${getChainwebDebugInfo().apiHost}`
        : isChain
          ? "Chain/node: " + msg
          : msg;
      toast.error("Failed to create offer", { description: hint });
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
          {isLoading && (
            <Alert className="border-primary/50 bg-primary/5">
              <Info className="h-4 w-4" />
              <AlertTitle>Transaction in progress</AlertTitle>
              <AlertDescription>{TX_CONFIRM_MESSAGE}</AlertDescription>
            </Alert>
          )}
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
              step="any"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="font-mono"
            />
          </div>

          {/* Amount (KDA) — required; one fixed amount per offer */}
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

          {import.meta.env.DEV && (() => {
            const info = getChainwebDebugInfo();
            return (
              <p className="text-xs text-muted-foreground border-t pt-2 mt-2" title="For read-only errors: check this API supports writes">
                Chain API: {info.apiHost} (network: {info.networkId}, chain: {info.chainId})
              </p>
            );
          })()}
        </form>
      </CardContent>
    </Card>
  );
}
