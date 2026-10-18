import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Landmark, Loader2 } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { authProof } from "@/lib/session";
import { getPoolPayout, tradeNetwork } from "@/lib/poolsApi";
import { isGiveawayPool, isInstant, networkLabel, paymentNetwork } from "@/lib/markets";
import { formatFiat } from "@/lib/utils";
import type { V11Escrow } from "@/lib/v11ui";
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

/**
 * Payment instructions for a v11 trade on a SELL pool: the pool's receiving address for the chosen network,
 * the exact amount, and the rules. The seller sees the same addresses as a reminder of what the buyer was shown.
 */
export function PoolPayoutCard({ escrow: e }: { escrow: V11Escrow }) {
  const { account, isConnected } = useWallet();
  const me = account?.account;
  const t = e.trade;
  const involved = !!me && (me === t.seller || me === t.buyer || me === e.arbiter);
  const { data: payout, isLoading } = useQuery({
    queryKey: ["pool-payout", t.poolId, me],
    queryFn: async () => {
      const signedCmd = await authProof(account!.account, account!.publicKey);
      return getPoolPayout(t.poolId, { wallet: account!.account, publicKey: account!.publicKey, signedCmd });
    },
    enabled: involved && isConnected && !isInstant(t) && !isGiveawayPool(t),
    staleTime: 60 * 1000,
    retry: 0,
  });
  // auto-release: the buyer sends the exact amount with the identifying digits (AutoReleaseCard explains them)
  const { data: auto } = useTradeAuto(e);
  if (!me || !involved || isInstant(t) || isGiveawayPool(t)) return null;
  if (isLoading) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading payment details…</p>;

  const networks = e.networks?.length ? e.networks : Object.keys(payout ?? {});
  const chosen = tradeNetwork(t.tradeId);
  const ordered = chosen && networks.includes(chosen) ? [chosen, ...networks.filter((n) => n !== chosen)] : networks;
  const agent = isAutoActive(auto);
  const amountText = agent ? auto.amount : String(t.payAmount);
  const amount = agent ? `${auto.amount} ${t.currency}` : `${formatFiat(t.payAmount, "USD")} ${t.currency}`;
  const buyer = me === t.buyer;
  const live = t.state === "FUNDED";

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
        <p className="text-sm text-muted-foreground">{buyer ? "The seller's address could not be loaded. Ask for it in the chat, and pay only to an address the seller confirms there." : "No receiving address is saved for this pool. Add it from Manage."}</p>
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
                  {addr ? <span className="block break-all font-mono text-sm">{addr}</span> : <span className="block text-sm text-muted-foreground">Address not available from the server; ask in the chat.</span>}
                </span>
                {addr && <CopyButton text={addr} />}
              </li>
            );
          })}
        </ul>
      )}

      {buyer && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Send <b className="text-foreground">exactly this amount</b> from a wallet <b className="text-foreground">you control</b>, not from an exchange account.</li>
          <li>Pay only to the address shown here, never to one sent in chat.</li>
          {!agent && <li>After sending, press I paid and add the transaction hash or a screenshot.</li>}
        </ul>
      )}
    </section>
  );
}
