import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWallet } from "@/hooks/useWallet";
import { useRefreshV11 } from "@/hooks/useV11";
import { appChainShortfall, isInsufficientFunds, readCoinDetailsLocal, CHAIN_ID } from "@/lib/kadena";
import { buildCreatePoolTx, newPoolId, poolVault } from "@/lib/v11";
import { sendV11 } from "@/lib/v11ui";
import { txFinished } from "@/lib/txProgress";
import { putPoolDetails } from "@/lib/poolsApi";
import { authProof } from "@/lib/session";
import { useMarket, vsMarket, vsMarketText } from "@/lib/market";
import { formatFiat } from "@/lib/utils";
import {
  DEFAULT_PAY_WINDOW, EXPIRY_DAYS, KADENA_TOKENS, PAY_WINDOWS, POOL_CURRENCIES, addressProblem, isKadenaToken, isStableCurrency, networksFor,
} from "@/lib/markets";
import { TradeEmailGate, useNeedsTradeEmail } from "../TradeEmail";
import { useMyCompletedTrades, useTermsGate } from "../Trust";
import { NEW_TRADER_MAX_KDA, NEW_TRADER_TRADES, isNewTrader, newTraderProblem } from "@/lib/trust";
import { Gift, Loader2, Lock, Plus, ShoppingCart, Store, Zap } from "lucide-react";
import { toast } from "sonner";

interface CreatePoolFormProps {
  onSuccess?: (poolId: string, requestKey: string) => void;
  role?: "buyer" | "seller";
  /** Phone layout: the page around it already sets buy or sell, so no card, no title and no side buttons. */
  compact?: boolean;
}

const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : NaN; };
const fmt = (n: number) => String(Number(n.toFixed(6)));

/**
 * Post a pool (escrow v11): a total with a min and max per trade. A SELL pool locks the whole total when it is
 * posted (one signature); buyers then take slices with no accept or deposit step.
 */
export function CreatePoolForm({ onSuccess, role = "seller", compact = false }: CreatePoolFormProps) {
  const { account, isConnected } = useWallet();
  const refresh = useRefreshV11();
  const [side, setSide] = useState<"BUY" | "SELL">(role === "buyer" ? "BUY" : "SELL");
  const [total, setTotal] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [minTouched, setMinTouched] = useState(false);
  const [maxTouched, setMaxTouched] = useState(false);
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<string>("USDT");
  const [networks, setNetworks] = useState<string[]>(["USDT:TRC20"]);
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [payWindow, setPayWindow] = useState(DEFAULT_PAY_WINDOW);
  const [expiryDays, setExpiryDays] = useState(0);
  const [giveaway, setGiveaway] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const free = giveaway && side === "SELL";
  const instant = !free && isKadenaToken(currency);
  const stable = !free && isStableCurrency(currency);
  const token = KADENA_TOKENS.find((t) => t.symbol === currency);

  const needsEmail = useNeedsTradeEmail();
  const [emailGateOpen, setEmailGateOpen] = useState(false);
  const myCompleted = useMyCompletedTrades();
  const formRef = useRef<HTMLFormElement>(null);
  const terms = useTermsGate(() => formRef.current?.requestSubmit());
  const { data: market } = useMarket();

  // Defaults: min = 10% of the total, max = the total, until the person edits them
  useEffect(() => {
    const t = num(total);
    if (!(t > 0)) return;
    if (!minTouched) setMin(fmt(t / 10));
    if (!maxTouched) setMax(fmt(t));
  }, [total, minTouched, maxTouched]);

  // Changing the currency: USDT/USDC start with their first network; a token has no network
  const changeCurrency = (c: string) => {
    setCurrency(c);
    setNetworks(isStableCurrency(c) ? [networksFor(c)[0].id] : []);
  };
  const toggleNetwork = (id: string, on: boolean) => setNetworks((ns) => (on ? [...ns, id] : ns.filter((n) => n !== id)));

  // The reference price: USDT and USDC track the USD market price; a token has its own
  const marketRef = useMemo(() => market?.prices?.[stable ? "USD" : currency], [market, stable, currency]);
  const pct = marketRef ? vsMarket(num(price), stable ? "USD" : currency, market) : null;

  const totalN = num(total), minN = num(min), maxN = num(max), priceN = free ? 0 : num(price);
  const problems: string[] = [];
  if (!(totalN > 0)) problems.push("Enter the total amount of KDA");
  if (!(minN > 0)) problems.push("Enter the minimum per trade");
  if (!(maxN > 0)) problems.push("Enter the maximum per trade");
  if (minN > 0 && maxN > 0 && minN > maxN) problems.push("The minimum is larger than the maximum");
  if (maxN > 0 && totalN > 0 && maxN > totalN) problems.push("The maximum per trade is larger than the total");
  if (!free && !(priceN > 0)) problems.push("Enter the price per KDA");
  if (stable && networks.length === 0) problems.push("Choose at least one network");
  if (stable && side === "SELL") for (const n of networks) { const p = addressProblem(n, addresses[n] ?? ""); if (p) problems.push(`${n.replace(":", " ")}: ${p}`); }
  const limitProblem = maxN > 0 ? newTraderProblem(maxN, myCompleted) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return toast.error("Please connect your wallet first");
    if (needsEmail) { setEmailGateOpen(true); return; }
    if (problems.length) return toast.error("Check the form", { description: problems[0] });
    if (limitProblem) return toast.error(`Up to ${NEW_TRADER_MAX_KDA} KDA per trade for now`, { description: limitProblem });
    if (!(await terms.check())) return;

    setBusy(true);
    const poolId = newPoolId();
    try {
      const [shortfall, coin] = await Promise.all([
        appChainShortfall(account.account, side === "SELL" ? totalN : 0),
        readCoinDetailsLocal(account.account),
      ]);
      if (shortfall) { toast.error(shortfall.title, { description: shortfall.description, duration: 20000 }); return; }
      if (!coin) throw new Error(`No coin account on chain ${CHAIN_ID} for ${account.account}. Fund this account on this chain first.`);

      const vault = side === "SELL" ? await poolVault(poolId) : undefined;
      const expiresAt = expiryDays > 0 ? new Date(Date.now() + expiryDays * 86400000).toISOString() : null;
      const requestKey = await sendV11(
        free ? `Locking the ${fmt(totalN)} KDA giveaway` : side === "SELL" ? `Locking ${fmt(totalN)} KDA in your pool` : "Posting your buy offer",
        () => buildCreatePoolTx({
          poolId, creator: account.account, pubKey: account.publicKey, side, total: totalN, min: minN, max: maxN,
          // the contract wants a currency even for a giveaway (price 0, no token); "FREE" is what the lists show
          price: priceN, currency: free ? "FREE" : currency, token: instant ? token?.module ?? "" : "", payWindow, expiresAt, vault,
        }),
        { hold: true },
      );

      // Then the off-chain part: the networks and where you get paid (the buyer sees the address after taking)
      if (!free) {
        try {
          const signedCmd = await authProof(account.account, account.publicKey);
          const payout = side === "SELL" ? Object.fromEntries(networks.map((n) => [n, (addresses[n] ?? "").trim()])) : {};
          await putPoolDetails(poolId, { networks: stable ? networks : [], payout, notes: notes.trim() }, { wallet: account.account, publicKey: account.publicKey, signedCmd });
        } catch (err) {
          console.warn("Pool details save failed:", err);
          toast.warning("Posted on chain. The server could not save your payment details; add them from Manage.");
        }
      }
      txFinished();
      toast.success(free ? "Giveaway posted" : "Pool posted", { description: `Request key: ${requestKey.slice(0, 16)}…` });
      refresh();
      onSuccess?.(poolId, requestKey);
      setTotal(""); setMin(""); setMax(""); setMinTouched(false); setMaxTouched(false); setPrice(""); setAddresses({}); setNotes(""); setGiveaway(false);
    } catch (err) {
      txFinished();
      console.error("Create pool error:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (isInsufficientFunds(msg) && account) {
        const s = await appChainShortfall(account.account, side === "SELL" ? totalN : 0).catch(() => null);
        if (s) { toast.error(s.title, { description: s.description, duration: 20000 }); return; }
      }
      toast.error("Could not post the offer", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const lockText = side === "SELL"
    ? free ? `You'll approve one transaction that locks ${total ? fmt(totalN) : "the"} KDA for the giveaway.` : `You'll approve one transaction that locks ${total ? fmt(totalN) : "the"} KDA in your pool. Buyers take slices from it; the unsold part comes back when you close the pool.`
    : "You'll approve one transaction that posts the offer. Sellers who take it lock their KDA; you pay them and they release.";

  return (
    <Card className={compact ? "border-0 bg-transparent shadow-none" : "escrow-card"}>
      {!compact && (
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-primary" />{role === "buyer" ? "New buy offer" : "New sell offer"}</CardTitle>
          <CardDescription>A pool with a minimum and maximum per trade. Several buyers can take slices at the same time.</CardDescription>
        </CardHeader>
      )}
      <CardContent className={compact ? "p-0" : undefined}>
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4" aria-busy={busy}>
          <div className={compact ? "hidden" : "space-y-2"}>
            <Label>Side</Label>
            <div className="flex gap-2">
              <Button type="button" variant={side === "SELL" ? "default" : "outline"} className="flex-1 gap-2" onClick={() => setSide("SELL")}><Store className="h-4 w-4" />Sell KDA</Button>
              <Button type="button" variant={side === "BUY" ? "default" : "outline"} className="flex-1 gap-2" onClick={() => { setSide("BUY"); setGiveaway(false); }}><ShoppingCart className="h-4 w-4" />Buy KDA</Button>
            </div>
          </div>

          {side === "SELL" && (
            <label className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${free ? "border-primary bg-primary/5" : "border-border"}`}>
              <Checkbox checked={giveaway} onCheckedChange={(v) => setGiveaway(v === true)} className="mt-0.5" aria-label="Free giveaway" />
              <span>
                <b className="flex items-center gap-1.5"><Gift className="h-4 w-4 text-emerald-600" />Free giveaway</b>
                <span className="block text-muted-foreground">Price 0: whoever claims a slice gets it at once. Nothing to pay, nothing to release.</span>
              </span>
            </label>
          )}

          <div className="space-y-2">
            <Label htmlFor="total">{side === "SELL" ? "Total KDA to sell" : "Total KDA to buy"}</Label>
            <Input id="total" type="number" inputMode="decimal" step="any" min="0" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="1000" className="h-12 font-mono text-lg" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="min">Min per trade</Label>
              <Input id="min" type="number" inputMode="decimal" step="any" min="0" value={min} onChange={(e) => { setMin(e.target.value); setMinTouched(true); }} placeholder="100" className="h-12 font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max">Max per trade</Label>
              <Input id="max" type="number" inputMode="decimal" step="any" min="0" value={max} onChange={(e) => { setMax(e.target.value); setMaxTouched(true); }} placeholder="1000" className="h-12 font-mono" aria-describedby={isNewTrader(myCompleted) ? "max-limit" : undefined} />
            </div>
          </div>
          {isNewTrader(myCompleted) && (
            <p id="max-limit" className={`text-xs ${limitProblem ? "text-destructive" : "text-muted-foreground"}`}>
              New traders: up to {NEW_TRADER_MAX_KDA} KDA per trade ({myCompleted} of {NEW_TRADER_TRADES} trades done).
            </p>
          )}

          {!free && (<>
            <div className="space-y-2">
              <Label htmlFor="currency">Paid in</Label>
              <Select value={currency} onValueChange={changeCurrency}>
                <SelectTrigger id="currency" className="h-12"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {POOL_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{isKadenaToken(c) ? `${c} · instant` : c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {instant && (
                <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm">
                  <Zap className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
                  <span>Instant: the {side === "SELL" ? "buyer pays you" : "seller is paid"} {currency} on the Kadena chain and the KDA moves in the same transaction. No waiting, no release step.</span>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="price">Price per KDA ({currency})</Label>
              <Input id="price" type="number" inputMode="decimal" step="any" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" className="h-12 font-mono text-lg" />
              {marketRef ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">
                    Market: <b className="text-foreground">{formatFiat(marketRef, stable ? "USD" : currency)} {currency}</b>
                    {pct !== null && <> · <span className={Math.abs(pct) >= 15 ? "font-medium text-amber-700 dark:text-amber-300" : ""}>yours is {vsMarketText(pct)}</span></>}
                  </span>
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setPrice(String(Number(marketRef.toPrecision(4))))}>Use market price</Button>
                </div>
              ) : null}
            </div>

            {stable && (
              <div className="space-y-3 rounded-xl border border-border p-3">
                <div>
                  <Label className="text-base">{currency} network{side === "SELL" ? " and where you receive it" : ""}</Label>
                  <p className="text-xs text-muted-foreground">
                    {side === "SELL" ? "The buyer sees the address only after taking a slice. Sending on another network loses the money, so check it twice." : "Sellers who take your offer tell you where to send it, in the trade."}
                  </p>
                </div>
                {networksFor(currency).map((n) => {
                  const on = networks.includes(n.id);
                  const problem = on && side === "SELL" && (addresses[n.id] ?? "") ? addressProblem(n.id, addresses[n.id]) : null;
                  return (
                    <div key={n.id} className="space-y-2">
                      <label className="flex items-center gap-3 text-sm">
                        <Checkbox checked={on} onCheckedChange={(v) => toggleNetwork(n.id, v === true)} aria-label={n.label} />
                        <span>{n.networkLabel}</span>
                      </label>
                      {on && side === "SELL" && (
                        <div className="space-y-1 pl-7">
                          <Input id={`address-${n.id}`} value={addresses[n.id] ?? ""} onChange={(e) => setAddresses((a) => ({ ...a, [n.id]: e.target.value }))}
                            placeholder={n.hint} dir="ltr" autoComplete="off" spellCheck={false} className="h-11 font-mono text-sm" aria-label={`Your ${n.label} address`} />
                          {problem && <p className="text-xs text-destructive">{problem}</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!instant && (
              <div className="space-y-2">
                <Label htmlFor="pay-window">Payment window</Label>
                <Select value={String(payWindow)} onValueChange={(v) => setPayWindow(Number(v))}>
                  <SelectTrigger id="pay-window" className="h-12"><SelectValue /></SelectTrigger>
                  <SelectContent>{PAY_WINDOWS.map((w) => <SelectItem key={w.seconds} value={String(w.seconds)}>{w.label}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">How long a buyer has to pay after taking a slice. After that, the seller can take the KDA back.</p>
              </div>
            )}
          </>)}

          <div className="space-y-2">
            <Label htmlFor="expiry">Expires</Label>
            <Select value={String(expiryDays)} onValueChange={(v) => setExpiryDays(Number(v))}>
              <SelectTrigger id="expiry" className="h-12"><SelectValue /></SelectTrigger>
              <SelectContent>{EXPIRY_DAYS.map((x) => <SelectItem key={x.days} value={String(x.days)}>{x.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {!free && (
            <div className="space-y-2">
              <Label htmlFor="notes">Note for traders (optional)</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder="e.g. I answer within minutes" className="h-11" />
            </div>
          )}

          <p className="flex items-start gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{lockText}</span>
          </p>

          <Button type="submit" className={compact ? "h-12 w-full text-base" : "w-full"} disabled={!isConnected || busy}>
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Posting…</> : free ? "Post giveaway" : side === "SELL" ? `Lock ${total ? fmt(totalN) : ""} KDA and post` : "Post buy offer"}
          </Button>
          {!isConnected && <p className="text-center text-sm text-muted-foreground">Connect your wallet to post an offer</p>}

          <TradeEmailGate open={emailGateOpen} onOpenChange={setEmailGateOpen} />
          {terms.gate}
        </form>
      </CardContent>
    </Card>
  );
}
