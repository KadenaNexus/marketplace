import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useWallet } from "@/hooks/useWallet";
import { useRefreshV11 } from "@/hooks/useV11";
import { appChainShortfall, isInsufficientFunds } from "@/lib/kadena";
import { buildTakeAndSettleTx, buildTakeTx, newTradeId, payAmountFor, tokenBalance, tokenPayFor, tokenPrecision, tradeVault } from "@/lib/v11";
import { sendV11 } from "@/lib/v11ui";
import { rememberTradeNetwork, type PoolListing } from "@/lib/poolsApi";
import { chainLabel, isGiveawayPool, isInstant, kadenaToken, networkLabel, paymentNetwork, windowLabel } from "@/lib/markets";
import { NEW_TRADER_MAX_KDA, newTraderProblem } from "@/lib/trust";
import { useMyCompletedTrades, useTermsGate } from "../Trust";
import { TradeEmailGate, useNeedsTradeEmail } from "../TradeEmail";
import { ProfileSummaryView } from "../ProfileSummary";
import { formatFiat, cn } from "@/lib/utils";
import { kdaAmount } from "./PoolCard";
import { Gift, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";

const round4 = (n: number) => Math.floor(n * 10000) / 10000;
/** A token amount with every decimal it has (kb-ETH: up to 18), never rounded for display. */
const tokenText = (pay: string) => pay.replace(/\.0$/, "");

interface TakeSheetProps {
  pool: PoolListing | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  profileMap?: Record<string, { username: string | null; avatar: string | null; wallet: string }>;
  /** A trade was created (or an instant swap / giveaway completed): open it */
  onTaken: (tradeId: string, pool: PoolListing) => void;
}

/**
 * Take a slice of a pool: the amount within min/max, what it costs, and one button. A SELL pool's KDA is
 * already locked, so the trade starts FUNDED; a BUY pool's taker locks the KDA in the same transaction.
 */
export function TakeSheet({ pool: p, open, onOpenChange, profileMap = {}, onTaken }: TakeSheetProps) {
  const { account } = useWallet();
  const refresh = useRefreshV11();
  const myCompleted = useMyCompletedTrades();
  const needsEmail = useNeedsTradeEmail();
  const [emailGateOpen, setEmailGateOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [network, setNetwork] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [precision, setPrecision] = useState<number | null>(null);
  const terms = useTermsGate(() => { void submit(); });

  const free = !!p && isGiveawayPool(p);
  const instant = !!p && isInstant(p);
  const token = p ? kadenaToken(p.currency) : undefined;
  const maxTake = p ? round4(Math.min(p.max, p.available)) : 0;
  const minTake = p ? p.min : 0;

  // Fresh defaults each time it opens: the minimum, and the only (or first) network
  useEffect(() => {
    if (!open || !p) return;
    setAmount(String(minTake));
    setNetwork(p.networks[0] ?? "");
    setPrecision(null);
    if (instant && p.token) tokenPrecision(p.token, p.chain).then(setPrecision).catch(() => setPrecision(token?.precision ?? 12));
  }, [open, p, minTake, instant, token?.precision]);

  const n = parseFloat(amount);
  const valid = Number.isFinite(n) && n > 0;
  // instant: the exact token amount as a Pact decimal string (rounded up to the token's precision)
  const tokenPay = useMemo(() => {
    if (!p || !valid || !instant) return "";
    try { return tokenPayFor(n, p.price, precision ?? token?.precision ?? 12); } catch { return ""; }
  }, [p, valid, n, instant, precision, token?.precision]);
  const pay = !p || !valid ? 0 : instant ? Number(tokenPay || 0) : payAmountFor(n, p.price);
  const problem = !p ? null
    : !valid ? "Enter an amount"
    : n < minTake ? `At least ${kdaAmount(minTake)} KDA`
    : n > maxTake ? `At most ${kdaAmount(maxTake)} KDA${p.available < p.max ? " (what is left)" : ""}`
    : p.networks.length > 1 && !network ? "Choose the network you'll pay on"
    : newTraderProblem(n, myCompleted);
  const chips = p ? [
    { label: "Min", value: minTake },
    { label: "25%", value: round4(Math.max(minTake, p.available * 0.25)) },
    { label: "50%", value: round4(Math.max(minTake, p.available * 0.5)) },
    { label: "Max", value: maxTake },
  ].filter((c, i, a) => c.value >= minTake && c.value <= maxTake && a.findIndex((x) => x.value === c.value) === i) : [];

  const verb = !p ? "" : free ? "Claim" : instant ? "Swap now" : p.side === "SELL" ? "Buy" : "Sell";
  const buttonText = !p ? "" : free ? `Claim ${valid ? kdaAmount(n) : ""} KDA` : instant ? "Swap now" : `${verb} ${valid ? kdaAmount(n) : ""} KDA`;
  const payText = !p ? "" : instant ? `${tokenText(tokenPay || "0")} ${p.currency}` : `${formatFiat(pay, "USD")} ${p.currency}`;

  async function submit() {
    if (!p || !account) return;
    if (needsEmail) { setEmailGateOpen(true); return; }
    if (problem) { toast.error(problem.startsWith("New traders") ? `Up to ${NEW_TRADER_MAX_KDA} KDA for now` : "Check the amount", { description: problem }); return; }
    if (!(await terms.check())) return;
    setBusy(true);
    const tradeId = newTradeId(p.chain); // a trade lives on its pool's chain
    try {
      let requestKey: string;
      if (instant) {
        const bal = await tokenBalance(p.token, account.account, p.chain);
        if (bal < pay) { toast.error(`Not enough ${p.currency} on chain ${p.chain}`, { description: `This swap needs ${payText} on chain ${p.chain}; your account has ${bal.toLocaleString("en-US", { maximumFractionDigits: token?.precision ?? 12 })} ${p.currency} there.` }); return; }
        requestKey = await sendV11(`Swapping ${payText} for ${kdaAmount(n)} KDA`, () =>
          buildTakeAndSettleTx(tradeId, p.poolId, account.account, account.publicKey, n, p.token, p.creator, tokenPay));
      } else if (p.side === "BUY") {
        // the taker is the KDA holder: it locks `n` KDA in the trade's vault
        const shortfall = await appChainShortfall(account.account, n, p.chain).catch(() => null);
        if (shortfall) { toast.error(shortfall.title, { description: shortfall.description, duration: 20000 }); return; }
        const vault = await tradeVault(tradeId);
        requestKey = await sendV11(`Locking ${kdaAmount(n)} KDA for the buyer`, () =>
          buildTakeTx(tradeId, p.poolId, account.account, account.publicKey, n, "BUY", vault));
      } else {
        requestKey = await sendV11(free ? `Claiming ${kdaAmount(n)} KDA` : `Taking ${kdaAmount(n)} KDA from the pool`, () =>
          buildTakeTx(tradeId, p.poolId, account.account, account.publicKey, n, "SELL"));
      }
      if (network) rememberTradeNetwork(tradeId, network);
      toast.success(free ? `${kdaAmount(n)} KDA is yours` : instant ? "Swapped" : p.side === "SELL" ? `${kdaAmount(n)} KDA locked for you` : `${kdaAmount(n)} KDA locked for the buyer`, { description: `Request key: ${requestKey.slice(0, 16)}…` });
      refresh();
      onOpenChange(false);
      onTaken(tradeId, p);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (isInsufficientFunds(msg) && p.side === "BUY") {
        const s = await appChainShortfall(account.account, n, p.chain).catch(() => null);
        if (s) { toast.error(s.title, { description: s.description, duration: 20000 }); return; }
      }
      toast.error(`${verb} failed`, { description: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-2xl sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:border">
        {p && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="font-display text-xl">
                {free ? <><Gift className="mr-1.5 inline h-5 w-5 text-emerald-600" />Claim free KDA</> : p.side === "SELL" ? "Buy KDA" : "Sell KDA"}
              </SheetTitle>
              <SheetDescription className="flex items-center gap-2">
                {p.side === "SELL" ? "From" : "To"} <ProfileSummaryView wallet={p.creator} summary={profileMap[p.creator]} size="sm" />
                <span className="ml-auto text-xs text-muted-foreground">{chainLabel(p.chain)}</span>
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="take-amount">Amount (KDA)</Label>
                <Input id="take-amount" type="number" inputMode="decimal" step="any" min={minTake} max={maxTake} value={amount} onChange={(e) => setAmount(e.target.value)} className="h-14 font-mono text-2xl" autoFocus />
                <p className="text-xs text-muted-foreground">{kdaAmount(minTake)}–{kdaAmount(maxTake)} KDA · {kdaAmount(p.available)} left in the pool</p>
                <div className="flex flex-wrap gap-2">
                  {chips.map((c) => (
                    <button key={c.label} type="button" onClick={() => setAmount(String(c.value))}
                      className={cn("h-9 rounded-full border px-3 text-sm", String(c.value) === amount ? "border-primary bg-primary/10 font-semibold" : "border-border hover:border-primary")}>
                      {c.label} · {kdaAmount(c.value)}
                    </button>
                  ))}
                </div>
                {problem && valid && <p className="text-sm text-destructive">{problem}</p>}
              </div>

              {p.networks.length > 1 && (
                <div className="space-y-2">
                  <Label>{p.side === "SELL" ? "You'll pay on" : "You'll be paid on"}</Label>
                  <div className="grid gap-2">
                    {p.networks.map((id) => (
                      <button key={id} type="button" onClick={() => setNetwork(id)}
                        className={cn("flex h-12 items-center justify-between rounded-xl border px-3 text-sm", network === id ? "border-primary bg-primary/10 font-semibold" : "border-border")}>
                        <span>{paymentNetwork(id)?.label ?? networkLabel(id)}</span>
                        <span className={cn("h-4 w-4 rounded-full border-2", network === id ? "border-primary bg-primary" : "border-border")} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className={cn("rounded-xl border-2 p-3", free ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40" : "border-primary/40 bg-primary/5")}>
                {free ? (
                  <p className="text-sm">Nothing to pay. The KDA goes straight to your wallet when you claim.</p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">{p.side === "SELL" ? "You pay" : "You receive"}</p>
                    <p className="font-mono text-2xl font-bold tabular-nums">{valid ? payText : "—"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatFiat(p.price, p.currency)} {p.currency} per KDA
                      {instant ? <> · <Zap className="inline h-3 w-3 text-orange-600" /> paid from your Kadena account on chain {p.chain} in the same transaction</> : p.side === "SELL" ? <> · {p.networks.length === 1 ? `by ${networkLabel(p.networks[0])}` : network ? `by ${networkLabel(network)}` : p.currency} within {windowLabel(p.payWindow)} of taking</> : <> · the buyer pays you within {windowLabel(p.payWindow)}, then you release</>}
                    </p>
                  </>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                {free ? "One transaction, signed in your wallet."
                  : instant ? "One transaction: your token transfer and the KDA move together, or not at all."
                  : p.side === "SELL" ? "The KDA is already locked in escrow. After you take it, you'll see where to send the payment. You can cancel before paying."
                  : `You'll approve one transaction that locks ${valid ? kdaAmount(n) : "the"} KDA in escrow. The buyer pays you; then you release.`}
              </p>

              <Button className="h-14 w-full gap-2 text-lg" disabled={busy || !!problem || !account} onClick={() => void submit()}>
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : instant ? <Zap className="h-5 w-5" /> : free ? <Gift className="h-5 w-5" /> : null}
                {buttonText}
              </Button>
            </div>
            <TradeEmailGate open={emailGateOpen} onOpenChange={setEmailGateOpen} />
            {terms.gate}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
