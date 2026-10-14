import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWallet } from "@/hooks/useWallet";
import {
  buildCreateOfferTx,
  signTransaction,
  submitTransaction,
  pollTransaction,
  getChainwebDebugInfo,
  describePactFailure,
  isPactExecutionFailure,
  readCoinDetailsLocal,
  CHAIN_ID,
  appChainShortfall,
  isInsufficientFunds,
} from "@/lib/kadena";
import { putOfferDetails } from "@/lib/offerDetailsApi";
import { getPayout, hasNetwork, putPayout, stableProblem } from "@/lib/payoutApi";
import { takeOfferDraft } from "@/lib/repeatOffer";
import { PayoutInput, type PayoutDraft } from "./PayoutInput";
import { TradeCode } from "./TradeCode";
import { authProof } from "@/lib/session";
import { Plus, Loader2, ShoppingCart, Store, Info } from "lucide-react";
import { toast } from "sonner";

import { GIVEAWAY_METHOD, PAY_CURRENCIES, PAYMENT_METHODS, TOKEN_CURRENCIES, currencyPrefix, isTokenCurrency, methodsFor } from "@/lib/markets";
import { useMarket, vsMarket, vsMarketText } from "@/lib/market";
import { formatFiat } from "@/lib/utils";
import { TradeEmailGate, useNeedsTradeEmail } from "./TradeEmail";
import { useMyCompletedTrades, useTermsGate } from "./Trust";
import { NEW_TRADER_MAX_KDA, NEW_TRADER_TRADES, isNewTrader, newTraderProblem } from "@/lib/trust";
const TX_CONFIRM_MESSAGE = "Transaction in progress… Confirming on the Kadena network. This may take up to 60 seconds.";

interface CreateOfferFormProps {
  onSuccess?: (offerId: string, txHash: string) => void;
  role?: "buyer" | "seller";
  /** Phone layout: the page around it already sets buy or sell, so no card, no title, no side buttons and a ready-made offer ID. */
  compact?: boolean;
}

export function CreateOfferForm({ onSuccess, role = "seller", compact = false }: CreateOfferFormProps) {
  const { account, isConnected } = useWallet();
  const [offerId, setOfferId] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">(role === "buyer" ? "BUY" : "SELL");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  // SELL offers: where the seller is paid, per payment method (shown to the buyer once someone accepts)
  const needsEmail = useNeedsTradeEmail();
  const [emailGateOpen, setEmailGateOpen] = useState(false);
  // New traders: limited amount until a few completed trades; terms accepted once before the first trade
  const myCompleted = useMyCompletedTrades();
  const formRef = useRef<HTMLFormElement>(null);
  const terms = useTermsGate(() => formRef.current?.requestSubmit());
  const { data: market } = useMarket();
  const [payout, setPayout] = useState<Record<string, PayoutDraft>>({});
  const [fiatCurrency, setFiatCurrency] = useState("USD");
  // Free giveaway (sell offers only): price 0, nothing for the winner to pay
  const [giveaway, setGiveaway] = useState(false);
  const free = giveaway && side === "SELL";
  const [isLoading, setIsLoading] = useState(false);

  const generateOfferId = () => {
    const id = `offer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setOfferId(id);
  };
  useEffect(() => {
    if (compact) setOfferId((v) => v || `offer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  }, [compact]);

  // "Post again" from a finished offer: fill in the same terms (and, for a sell offer, where you get paid)
  const [repeatedFrom, setRepeatedFrom] = useState<string | null>(null);
  useEffect(() => {
    const d = takeOfferDraft(side);
    if (!d) return;
    setRepeatedFrom(d.from);
    setAmount(String(d.amount));
    setPrice(String(d.price));
    setFiatCurrency(d.fiatCurrency);
    setPaymentMethods(d.paymentMethods);
    if (d.side !== "SELL" || !account) return;
    (async () => {
      try {
        const signedCmd = await authProof(account.account, account.publicKey);
        const p = await getPayout(d.from, { wallet: account.account, publicKey: account.publicKey, signedCmd });
        if (!p?.isMine) return;
        setPayout(Object.fromEntries(p.details.filter((x) => d.paymentMethods.includes(x.method)).map((x) => [x.method, { value: x.value, network: x.network }])));
      } catch { /* the details can be typed again */ }
    })();
    // once, when the form opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Currency: fiat (paid by USDT, USDC, Wise, Revolut) or a Kadena token (paid in that token on the chain).
  // Prices in a token are a different unit altogether, so switching between the two clears the price.
  const changeCurrency = (c: string) => {
    const wasToken = isTokenCurrency(fiatCurrency), token = isTokenCurrency(c);
    setFiatCurrency(c);
    if (wasToken !== token) setPrice("");
    if (token) {
      setPaymentMethods([c]);
      if (account) setPayout((p) => (p[c]?.value ? p : { ...p, [c]: { value: account.account, network: TOKEN_CURRENCIES[c].chains[0] } }));
    } else if (wasToken) {
      setPaymentMethods((ms) => ms.filter((m) => (PAYMENT_METHODS as readonly string[]).includes(m)));
    }
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
    if (needsEmail) { setEmailGateOpen(true); return; }

    if (!offerId || (!price && !free) || !amount) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (!free && paymentMethods.length === 0) {
      toast.error("Please select at least one payment method");
      return;
    }

    const payoutItems = (free ? [] : paymentMethods)
      .map((m) => ({ method: m, value: (payout[m]?.value ?? "").trim(), ...(hasNetwork(m) ? { network: payout[m]?.network } : {}) }))
      .filter((x) => x.value);
    const payoutProblem = payoutItems.map(stableProblem).find(Boolean);
    if (side === "SELL" && payoutProblem) {
      toast.error("Check where you get paid", { description: payoutProblem });
      return;
    }
    if (side === "SELL" && !free && payoutItems.length === 0) {
      toast.error("Add where you want to be paid", { description: "Fill in at least one payment detail, e.g. your USDT address or bank IBAN." });
      return;
    }

    const priceNum = free ? 0 : parseFloat(price);
    const amountNum = parseFloat(amount);

    if (!free && (isNaN(priceNum) || priceNum <= 0)) {
      toast.error("Please enter a valid price");
      return;
    }

    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Please enter a valid amount (KDA)");
      return;
    }
    const limitProblem = newTraderProblem(amountNum, myCompleted);
    if (limitProblem) {
      toast.error(`Up to ${NEW_TRADER_MAX_KDA} KDA for now`, { description: limitProblem });
      return;
    }
    if (!(await terms.check())) return;

    setIsLoading(true);
    // Yield so React paints the status message before wallet/signing
    await new Promise((r) => setTimeout(r, 0));

    try {
      // Check chain 1 before anything is signed. A seller must later deposit the full amount,
      // so they find out now (not after someone accepts); a buyer only needs gas.
      const [shortfall, coinDetails] = await Promise.all([
        appChainShortfall(account.account, side === "SELL" ? amountNum : 0),
        readCoinDetailsLocal(account.account),
      ]);
      if (shortfall) {
        toast.error(shortfall.title, { description: shortfall.description, duration: 20000 });
        return;
      }

      if (!coinDetails) {
        throw new Error(
          `No coin account on chain ${CHAIN_ID} for ${account.account}. Fund this account on this chain first.`
        );
      }

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
      if (isPactExecutionFailure(txResult)) {
        const detail = describePactFailure(txResult, {
          account: account.account,
          operation: "create-offer",
        });
        console.error("[CreateOffer] On-chain failure — full poll result:", JSON.stringify(txResult, null, 2));
        console.error("[CreateOffer] Chain API used:", getChainwebDebugInfo());
        throw new Error(detail);
      }

      // Then save off-chain offer details (price, limits, payment method)
      let offChainSaved = true;
      const paymentMethodJson = JSON.stringify(free ? [GIVEAWAY_METHOD] : paymentMethods);
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

      if (side === "SELL" && !free) {
        try {
          const signedCmd = await authProof(account.account, account.publicKey);
          await putPayout(offerId, payoutItems, { wallet: account.account, publicKey: account.publicKey, signedCmd });
        } catch (payErr) {
          console.warn("Payout details save failed:", payErr);
          toast.warning("Offer created. Your payment details were not saved: add them in the trade details before you deposit.");
        }
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
      setPayout({});
    } catch (error) {
      console.error("Create offer error:", error);
      console.error("[CreateOffer] Chain API at time of error:", getChainwebDebugInfo());
      const msg = error instanceof Error ? error.message : "Unknown error";
      const isReadOnly = /read-only|system-only|database operation/.test(msg);
      const isChain = /Send failed|On-chain:|requestKey|Transaction failed/.test(msg) || isReadOnly;
      const hint = isReadOnly
        ? `The Chainweb API is in read-only mode (no table writes). Set VITE_CHAINWEB_API to the full Pact URL for a write-capable node and restart. Current API: ${getChainwebDebugInfo().apiHost}`
        : isChain
          ? "Chain/node: " + msg
          : msg;
      if (isInsufficientFunds(msg) && account) {
        const shortfall = await appChainShortfall(account.account, side === "SELL" ? parseFloat(amount) || 0 : 0).catch(() => null);
        if (shortfall) {
          toast.error(shortfall.title, { description: shortfall.description, duration: 20000 });
          return;
        }
      }
      toast.error("Failed to create offer", { description: hint });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className={compact ? "border-0 bg-transparent shadow-none" : "escrow-card"}>
      {!compact && (
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
      )}
      <CardContent className={compact ? "p-0" : undefined}>
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          {repeatedFrom && (
            <p role="status" className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm leading-7">
              Filled in from <TradeCode offerId={repeatedFrom} className="mx-1 align-middle" />. Check the price and amount, then post.
            </p>
          )}
          {isLoading && (
            <Alert className="border-primary/50 bg-primary/5">
              <Info className="h-4 w-4" />
              <AlertTitle>Transaction in progress</AlertTitle>
              <AlertDescription>{TX_CONFIRM_MESSAGE}</AlertDescription>
            </Alert>
          )}
          {/* Side Selection */}
          <div className={compact ? "hidden" : "space-y-2"}>
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
          <div className={compact ? "hidden" : "space-y-2"}>
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

          {/* Free giveaway (sell offers only) */}
          {side === "SELL" && (
            <label className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${free ? "border-primary bg-primary/5" : "border-border"}`}>
              <Checkbox checked={giveaway} onCheckedChange={(v) => setGiveaway(v === true)} className="mt-0.5" aria-label="Free giveaway" />
              <span>
                <b>Free giveaway</b>
                <span className="block text-muted-foreground">Price 0: the winner pays nothing. You still lock the KDA in escrow and release it to them; they mark it as received with one tap.</span>
              </span>
            </label>
          )}

          {!free && (<>
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
            {(() => {
              const ref = market?.prices?.[fiatCurrency];
              if (!ref) return null;
              const pct = vsMarket(parseFloat(price), fiatCurrency, market);
              return (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">
                    Market: <b className="text-foreground">{currencyPrefix(fiatCurrency)}{formatFiat(ref, fiatCurrency)}</b>
                    {pct !== null && <> · <span className={Math.abs(pct) >= 15 ? "font-medium text-amber-700 dark:text-amber-300" : ""}>yours is {vsMarketText(pct)}</span></>}
                  </span>
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setPrice(String(Number(ref.toPrecision(4))))}>Use market price</Button>
                </div>
              );
            })()}
          </div>

          </>)}
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
              aria-describedby={isNewTrader(myCompleted) ? "amount-limit" : undefined}
            />
            {isNewTrader(myCompleted) && (
              <p id="amount-limit" className={`text-xs ${newTraderProblem(parseFloat(amount), myCompleted) ? "text-destructive" : "text-muted-foreground"}`}>
                New traders can trade up to {NEW_TRADER_MAX_KDA} KDA at a time ({myCompleted} of {NEW_TRADER_TRADES} trades done).
              </p>
            )}
          </div>

          {!free && (<>
          {/* Fiat Currency */}
          <div className="space-y-2">
            <Label htmlFor="fiatCurrency">Currency</Label>
            <Select value={fiatCurrency} onValueChange={changeCurrency}>
              <SelectTrigger id="fiatCurrency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAY_CURRENCIES.map((curr) => (
                  <SelectItem key={curr} value={curr}>{isTokenCurrency(curr) ? `${curr} (${TOKEN_CURRENCIES[curr].note})` : curr}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Payment Methods */}
          <div className="space-y-2">
            <Label>Payment Methods</Label>
            {isTokenCurrency(fiatCurrency) ? (
              <p className="rounded-lg border p-4 text-sm">
                Paid in <b>{fiatCurrency}</b>: the buyer sends {fiatCurrency} on the Kadena chain to {side === "SELL" ? "your" : "the seller's"} Kadena account. Price and total are in {fiatCurrency}.
              </p>
            ) : (
            <div className="grid grid-cols-2 gap-3 p-4 border rounded-lg">
              {methodsFor(fiatCurrency).map((method) => (
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
            )}
            {paymentMethods.length === 0 && (
              <p className="text-xs text-destructive">Select at least one payment method</p>
            )}
          </div>

          </>)}
          {/* Where the seller gets paid: private, shown only to the buyer after they accept */}
          {side === "SELL" && !free && paymentMethods.length > 0 && (
            <div className="space-y-3 rounded-lg border-2 border-amber-300 bg-amber-50/60 p-4 dark:border-amber-700 dark:bg-amber-950/30">
              <div>
                <Label className="text-base">Where you get paid</Label>
                <p className="text-xs text-muted-foreground">Only the buyer sees this, after accepting your offer. You can change it until you deposit.</p>
              </div>
              {paymentMethods.map((m) => (
                <PayoutInput key={m} method={m} small draft={payout[m] ?? { value: "" }} onChange={(d) => setPayout((p) => ({ ...p, [m]: d }))} />
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Platform arbiter is set in the contract and can release or refund in disputes.
          </p>

          <Button 
            type="submit" 
            className={compact ? "h-12 w-full text-base" : "w-full"} 
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
          <TradeEmailGate open={emailGateOpen} onOpenChange={setEmailGateOpen} />
          {terms.gate}
        </form>
      </CardContent>
    </Card>
  );
}
