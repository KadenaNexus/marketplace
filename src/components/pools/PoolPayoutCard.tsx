import { useState } from "react";
import { SignInPrompt } from "@/components/SignIn";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Landmark, Loader2 } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { authProof, useSignedIn } from "@/lib/session";
import { getPoolPayout, tradeNetwork } from "@/lib/poolsApi";
import { isGiveawayPool, isInstant, networkLabel, paymentNetwork } from "@/lib/markets";
import { exactPay, type V11Escrow } from "@/lib/v11ui";
import { useTradeAuto } from "@/hooks/useAutoRelease";
import { isAutoActive } from "@/lib/autoReleaseApi";

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label={`${label} ${text}`}
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ } }}
      className="flex h-9 shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:border-primary">
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{done ? "Copied" : label}
    </button>
  );
}

/** A take from a moment ago: the server may answer 403 until its chain read catches up. Ask again this many times, this far apart. */
const PAYOUT_TRIES = 6;
const PAYOUT_RETRY_MS = 5000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Payment instructions for a v11 trade on a SELL pool: the pool's receiving address for the chosen network,
 * the exact amount, and the rules. The seller sees the same addresses as a reminder of what the buyer was shown.
 */
export function PoolPayoutCard({ escrow: e }: { escrow: V11Escrow }) {
  const { account, isConnected } = useWallet();
  const me = account?.account;
  const t = e.trade;
  const involved = !!me && (me === t.seller || me === t.buyer || me === e.arbiter);
  const active = ["FUNDED", "PAID", "DISPUTED"].includes(t.state);
  const signedIn = useSignedIn(me);
  const { data: payout, isLoading } = useQuery({
    queryKey: ["pool-payout", t.poolId, t.tradeId, me],
    queryFn: async () => {
      const signedCmd = await authProof(account!.account, account!.publicKey);
      const auth = { wallet: account!.account, publicKey: account!.publicKey, signedCmd };
      // the trade id lets the server check a just-taken trade on the chain; a null (403) on a live trade is asked again
      for (let i = 1; ; i++) {
        const p = await getPoolPayout(t.poolId, auth, t.tradeId);
        if (p || !active || i >= PAYOUT_TRIES) return p;
        await wait(PAYOUT_RETRY_MS);
      }
    },
    enabled: involved && isConnected && signedIn && !isInstant(t) && !isGiveawayPool(t),
    staleTime: 60 * 1000,
    retry: 1,
  });
  // auto-release: the buyer sends the exact amount with the identifying digits (AutoReleaseCard explains them)
  const { data: auto } = useTradeAuto(e);
  if (!me || !involved || isInstant(t) || isGiveawayPool(t)) return null;
  if (!signedIn) return <SignInPrompt what="the payment details" />;
  if (isLoading) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading payment details…</p>;

  const networks = e.networks?.length ? e.networks : Object.keys(payout ?? {});
  const chosen = tradeNetwork(t.tradeId);
  const ordered = chosen && networks.includes(chosen) ? [chosen, ...networks.filter((n) => n !== chosen)] : networks;
  const agent = isAutoActive(auto);
  // what is shown is exactly what Copy copies: the contract's pay-amount, never rounded
  const amountText = agent ? auto.amount : exactPay(t.payAmount);
  const amount = `${amountText} ${t.currency}`;
  const buyer = me === t.buyer;
  const live = t.state === "FUNDED";
  // a closed trade whose addresses the server no longer gives out: nothing useful to show
  if (!live && !["PAID", "DISPUTED"].includes(t.state) && !networks.some((n) => payout?.[n])) return null;

  return (
    <section className={`space-y-3 rounded-xl border-2 p-4 ${buyer && live ? "border-primary/40" : "border-border"}`} aria-label={buyer ? "Where to send the payment" : "Where you get paid"}>
      <div>
        <h3 className="flex items-center gap-2 font-semibold"><Landmark className="h-4 w-4 text-primary" />{buyer ? "Where to send the payment" : me === t.seller ? "Where you get paid" : "Seller's payment details"}</h3>
        {buyer && (
          <p className="text-sm text-muted-foreground">
            {live ? <>The KDA is locked for you. Send <b className="text-foreground">exactly {amount}</b>{agent ? "; the KDA is released automatically when it arrives." : ", then press I paid."}</> : "The address you were given for this trade."}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted-foreground">Amount to send</span>
          <span className="block font-mono text-xl font-bold tabular-nums">{amount}</span>
        </span>
        <CopyButton text={amountText} />
      </div>

      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{buyer ? "Address not available yet. Do not pay. Reload in a moment, or cancel the trade." : "No receiving address is saved for this pool. Add it from Manage."}</p>
      ) : (
        <ul className="space-y-2">
          {ordered.map((n) => {
            const addr = payout?.[n];
            const net = paymentNetwork(n);
            const isChosen = ordered.length > 1 && n === chosen;
            return (
              <li key={n} className={`flex items-center gap-3 rounded-lg p-3 ${isChosen ? "border-2 border-primary bg-primary/5" : "bg-muted"}`}>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">{networkLabel(n)}{isChosen ? " · the one you chose" : ""}</span>
                  <span className="my-1 block rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-950 dark:bg-amber-950 dark:text-amber-100">
                    Send {t.currency} on {net?.networkLabel ?? n.split(":")[1] ?? n} only. Another network loses the money.
                  </span>
                  {addr ? <span className="block break-all font-mono text-sm">{addr}</span> : <span className="block text-sm text-muted-foreground">Address not available yet. Do not pay. Reload in a moment, or cancel the trade.</span>}
                </span>
                {addr && <CopyButton text={addr} />}
              </li>
            );
          })}
        </ul>
      )}

      {buyer && live && (
        <div className="space-y-1.5 rounded-lg border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50">
          <p><b>From a wallet</b> (Trust Wallet, TronLink…): send exactly this amount. <b>From an exchange</b>: the fee and rounding change the amount, so {agent ? <>use <b>Paying from an exchange</b> in the Auto-release box and give the transaction ID.</> : "add the fee on top so the full amount arrives, and give the transaction ID with I paid."}</p>
          <p><b>Type the amount in {t.currency}, not in dollars.</b> Some wallets switch to a $ value; the {t.currency} field must show <span className="font-mono font-semibold">{amountText}</span>.</p>
        </div>
      )}
      {buyer && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {agent
            ? <li>From a wallet <b className="text-foreground">you control</b>, send <b className="text-foreground">exactly this amount</b>. Paying from an exchange? Use <b className="text-foreground">Paying from an exchange</b> in the Auto-release box: you give the transaction ID instead.</li>
            : <li><b className="text-foreground">This amount must arrive in full.</b> Paying from an exchange? Add its withdrawal fee on top, and give the transaction ID (TXID) with I paid.</li>}
          <li>Pay only to the address shown here, never to one sent in chat, and never to your own address.</li>
          {!agent && <li>After sending, press I paid and add the transaction hash or a screenshot.</li>}
        </ul>
      )}
    </section>
  );
}
