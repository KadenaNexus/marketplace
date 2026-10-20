import { useState } from "react";
import { Check, CheckCircle2, Copy, ExternalLink, Loader2, Radar } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useTradeAuto } from "@/hooks/useAutoRelease";
import { isAutoActive, paymentTxUrl, type TradeAuto } from "@/lib/autoReleaseApi";
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
      <p className="rounded-xl border border-border bg-muted p-3 text-sm text-muted-foreground">
        Auto-release is off for this trade{a.reason ? ` (${a.reason.replace(/\.$/, "").toLowerCase()})` : ""}. {payer ? "After paying, press I paid." : "Release yourself once you've checked the payment."}
      </p>
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
              The last digits identify your payment, so the KDA is released automatically when it arrives. Send this exact amount from a wallet; some exchanges change the amount.
            </p>
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
