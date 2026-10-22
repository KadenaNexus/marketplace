import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Check, CheckCircle2, Copy, ExternalLink, Loader2, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWallet } from "@/hooks/useWallet";
import { useTradeAuto } from "@/hooks/useAutoRelease";
import { authProof } from "@/lib/session";
import { claimPayment, isAutoActive, paymentTxUrl, type TradeAuto } from "@/lib/autoReleaseApi";
import { networkLabel, paymentNetwork } from "@/lib/markets";
import type { V11Escrow } from "@/lib/v11ui";

function CopyAmount({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label={`Copy ${text}`}
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ } }}
      className="flex h-9 shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:border-primary">
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{done ? "Copied" : "Copy"}
    </button>
  );
}

/** "Watching for your payment" → "Payment found: releasing" → "Released". */
function StatusLine({ a, payer }: { a: TradeAuto; payer: boolean }) {
  if (a.status === "released") {
    return <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />{payer ? "Payment found. The KDA was released to you." : "Payment found. The KDA was released to the buyer."}</p>;
  }
  if (a.status === "matched" || a.status === "releasing") {
    return <p className="flex items-center gap-2 text-sm font-semibold" role="status"><Loader2 className="h-4 w-4 animate-spin text-primary" />Payment found: releasing</p>;
  }
  return <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />{payer ? "Watching for your payment" : "Watching for the buyer's payment"}</p>;
}

function MatchedTx({ a }: { a: TradeAuto }) {
  if (!a.matchedTx) return null;
  const href = paymentTxUrl(a.matchedNetwork, a.matchedTx);
  return (
    <p className="text-xs text-muted-foreground">
      Payment{a.matchedNetwork ? ` on ${networkLabel(a.matchedNetwork)}` : ""}:{" "}
      {href ? <a href={href} target="_blank" rel="noreferrer" className="break-all font-mono text-foreground underline">{a.matchedTx}<ExternalLink className="ml-1 inline h-3 w-3" /></a> : <span className="break-all font-mono text-foreground">{a.matchedTx}</span>}
    </p>
  );
}

/** The smallest amount an exchange payer must make arrive: the pay amount rounded up to cents (exchanges round). */
const atLeast = (payAmount: string) => (Math.ceil(Number(payAmount) * 100 - 1e-9) / 100).toFixed(2);

/**
 * Paid from an exchange: the fee or rounding changes the amount, so the identifying digits are lost. The buyer gives
 * the transaction ID from the withdrawal history; the server checks it on the network and releases.
 */
function ExchangePay({ e, a, open: startOpen = false }: { e: V11Escrow; a: TradeAuto; open?: boolean }) {
  const { account } = useWallet();
  const qc = useQueryClient();
  const nets = a.byTxid ?? [];
  const [open, setOpen] = useState(startOpen);
  const [network, setNetwork] = useState(nets[0]?.id ?? "");
  const [txid, setTxid] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!nets.length || !account) return null;
  const currency = a.currency || e.trade.currency;
  const min = atLeast(a.payAmount ?? String(e.trade.payAmount));
  async function check() {
    if (!account) return;
    setBusy(true); setMsg(null);
    try {
      const signedCmd = await authProof(account.account, account.publicKey);
      const r = await claimPayment(e.trade.tradeId, network, txid.trim(), { wallet: account.account, publicKey: account.publicKey, signedCmd });
      if (r.ok) {
        setMsg({ ok: true, text: "Payment found. The KDA is being released to you." });
        qc.setQueryData(["trade-auto", e.trade.tradeId, account.account], r.auto);
        void qc.invalidateQueries({ queryKey: ["trade-auto", e.trade.tradeId] });
      } else setMsg({ ok: false, text: "error" in r ? r.error : "Could not check the payment" });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not check the payment" });
    } finally { setBusy(false); }
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 text-sm font-medium text-primary underline-offset-2 hover:underline">
        <Building2 className="h-4 w-4" aria-hidden="true" />Paying from an exchange (Binance, OKX…)?
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
      <p className="flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4 text-primary" aria-hidden="true" />Paid from an exchange</p>
      <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>Withdraw {currency} to the seller's address above, on the right network, so that <b className="text-foreground">at least {min} {currency} arrives</b>. Exchanges take a fee: add it on top. Most exchanges also need 2–10 {currency} per withdrawal.</li>
        <li>When the withdrawal is done, copy its <b className="text-foreground">transaction ID (TXID)</b> from the exchange's withdrawal history and paste it here.</li>
      </ol>
      {nets.length > 1 && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Network you paid on">
          {nets.map((n) => (
            <button key={n.id} type="button" role="radio" aria-checked={network === n.id} onClick={() => setNetwork(n.id)}
              className={`h-9 rounded-full border px-3 text-xs ${network === n.id ? "border-primary bg-primary/10 font-semibold" : "border-border"}`}>{networkLabel(n.id)}</button>
          ))}
        </div>
      )}
      <Input value={txid} onChange={(ev) => setTxid(ev.target.value)} placeholder={network.endsWith("ERC20") ? "0x…" : "Transaction ID (64 characters)"} className="font-mono text-xs" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="Transaction ID" />
      <Button type="button" className="h-11 w-full" disabled={busy || txid.trim().length < 64} onClick={() => void check()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check my payment"}
      </Button>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`} role="status">{msg.text}</p>}
      <p className="text-xs text-muted-foreground">If the check can't release it (for example, the payment could be someone else's), tap I paid and add the transaction ID; the seller checks and releases.</p>
    </div>
  );
}

/**
 * Auto-release on a USDT/USDC trade: the exact amount to send (payer), what the agent waits for (KDA holder), and the
 * live state. Nothing shows when the trade is not on the automatic path; "I paid" and Release stay as they are.
 */
export function AutoReleaseCard({ escrow: e }: { escrow: V11Escrow }) {
  const { account } = useWallet();
  const { data: a } = useTradeAuto(e);
  const me = account?.account;
  const t = e.trade;
  if (!a || !me) return null;
  const payer = me === t.buyer;
  const currency = a.currency || t.currency;

  if (!isAutoActive(a)) {
    // it was automatic and left that path (address changed, dispute, window passed…): say so once, plainly
    if (!a.enabled || !a.status || !["manual", "expired"].includes(a.status) || !["FUNDED", "PAID"].includes(t.state)) return null;
    return (
      <div className="space-y-3 rounded-xl border border-border bg-muted p-3">
        <p className="text-sm text-muted-foreground">
          Auto-release is off for this trade{a.reason ? ` (${a.reason.replace(/\.$/, "").toLowerCase()})` : ""}. {payer ? "After paying, press I paid." : "Release yourself once you've checked the payment."}
        </p>
        {payer && a.status === "expired" && <ExchangePay e={e} a={a} />}
      </div>
    );
  }

  const nets = a.networks ?? [];
  const where = nets.map((n) => networkLabel(n.id)).join(" or ");
  // the pool also takes a network nobody watches: say the automatic part is for the others only
  const someManual = (e.networks ?? []).some((n) => (a.notWatched ?? []).includes(n));
  // on a SELL pool the payment card below already shows the amount with Copy; a BUY pool's card does not
  return (
    <section className="space-y-3 rounded-xl border-2 border-primary/40 bg-primary/5 p-4" aria-label="Auto-release">
      <h3 className="flex items-center gap-2 font-semibold"><Radar className="h-4 w-4 text-primary" aria-hidden="true" />Auto-release</h3>
      {payer ? (
        a.status !== "released" && (
          <>
            {e.side === "BUY" ? (
              <div className="flex items-center gap-3 rounded-lg bg-card p-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">Send exactly</span>
                  <span className="block font-mono text-xl font-bold tabular-nums">{a.amount} {currency}</span>
                </span>
                <CopyAmount text={a.amount} />
              </div>
            ) : (
              <p className="text-sm">Send exactly <b className="font-mono">{a.amount} {currency}</b>.</p>
            )}
            <p className="text-sm text-muted-foreground">
              From a wallet: send this exact amount. The last digits identify your payment, so the KDA is released automatically when it arrives.
            </p>
            <ExchangePay e={e} a={a} />
            {someManual && where && <p className="text-xs text-muted-foreground">Automatic on {where} only. On another network, press I paid after sending.</p>}
          </>
        )
      ) : (
        <p className="text-sm">
          Auto-release is on: the KDA is released when <b className="font-mono">{a.amount} {currency}</b> arrives at{" "}
          {nets.length ? nets.map((n, i) => <span key={n.id}>{i > 0 ? " or " : ""}<span className="break-all font-mono">{n.address}</span> on {paymentNetwork(n.id)?.networkLabel ?? networkLabel(n.id)}</span>) : "your address"}.
          {a.status !== "released" && " You can still release yourself once you've checked."}
        </p>
      )}
      <StatusLine a={a} payer={payer} />
      <MatchedTx a={a} />
    </section>
  );
}
