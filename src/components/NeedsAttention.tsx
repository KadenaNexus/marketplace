import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  T1_SECONDS, T2_SECONDS, T3_SECONDS, type Escrow,
  buildRefundTx, buildTimeoutAcceptedCloseTx, getEscrowVaultAccount, signTransaction, submitTransaction, pollTransaction, getTxExplorerUrl,
} from "@/lib/kadena";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

/**
 * Trades that need the arbiter's eye, read from the chain (not from opened disputes).
 * A buyer who never marks "paid" cannot open a dispute (the contract only allows that after
 * PAID + T3), so such trades never reach the dispute inbox. This list catches them.
 */
type Item = { e: Escrow; kind: "disputed" | "paid-expired" | "funded-expired" | "accepted-expired"; since: number };

const ms = (iso?: string) => (iso ? new Date(iso).getTime() : NaN);
const short = (a?: string | null) => (a ? `${a.slice(0, 8)}…${a.slice(-4)}` : "—");
function ago(t: number) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function needsAttention(escrows: Escrow[], arbiter: string, now = Date.now()): Item[] {
  const out: Item[] = [];
  for (const e of escrows) {
    if (e.arbiter !== arbiter) continue;
    if (e.state === "DISPUTED") out.push({ e, kind: "disputed", since: ms(e.paidAt) || ms(e.fundedAt) || now });
    else if (e.state === "PAID" && now > ms(e.paidAt) + T3_SECONDS * 1000) out.push({ e, kind: "paid-expired", since: ms(e.paidAt) + T3_SECONDS * 1000 });
    else if (e.state === "FUNDED" && now > ms(e.fundedAt) + T2_SECONDS * 1000) out.push({ e, kind: "funded-expired", since: ms(e.fundedAt) + T2_SECONDS * 1000 });
    else if (e.state === "ACCEPTED" && now > ms(e.acceptedAt) + T1_SECONDS * 1000) out.push({ e, kind: "accepted-expired", since: ms(e.acceptedAt) + T1_SECONDS * 1000 });
  }
  const order = { disputed: 0, "paid-expired": 1, "funded-expired": 2, "accepted-expired": 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.since - b.since);
}

const LABEL: Record<Item["kind"], { badge: string; variant: "destructive" | "secondary" | "outline"; text: string }> = {
  disputed: { badge: "Disputed on-chain", variant: "destructive", text: "Only you can settle it: release to the buyer or refund the seller." },
  "paid-expired": { badge: "Release overdue", variant: "destructive", text: "Buyer marked paid but the seller did not release within 1 hour. Either party can now press Open dispute; after that you can release or refund." },
  "funded-expired": { badge: "Payment window expired", variant: "secondary", text: "Seller funded, but the buyer never marked the payment within 4 hours. The seller can reclaim it from the trade, or you can refund the seller." },
  "accepted-expired": { badge: "Never funded", variant: "outline", text: "Accepted but not funded within 1 hour. No KDA is locked; anyone can close it to clear the list." },
};

export function NeedsAttention({ escrows, account, onDone }: { escrows: Escrow[]; account: { account: string; publicKey: string }; onDone: () => void }) {
  const items = needsAttention(escrows, account.account);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(e: Escrow, build: () => Promise<any>, done: string, failed: string) {
    setBusy(e.offerId);
    try {
      const signed = await signTransaction(await build());
      const key = await submitTransaction(signed);
      const res = (await pollTransaction(key))?.result;
      if (res?.status === "failure") throw new Error(typeof res.error === "string" ? res.error : (res.error as any)?.message ?? "Transaction failed");
      toast.success(done, { description: <a href={getTxExplorerUrl(key)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>View on Explorer ↗</a> });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : failed);
    } finally {
      setBusy(null);
    }
  }

  function refundSeller(e: Escrow) {
    if (!e.seller) return toast.error("Cannot determine the seller");
    if (!confirm(`Refund ${e.amount} KDA to the seller (${short(e.seller)})? The buyer never marked the payment as sent.`)) return;
    run(e, async () => buildRefundTx(e.offerId, account.account, account.publicKey, e.seller, e.amount, await getEscrowVaultAccount(e.offerId)), "Refunded to seller", "Refund failed");
  }

  function closeUnfunded(e: Escrow) {
    if (!confirm(`Close this never-funded trade? No KDA moves; the offer is marked CLOSED on-chain. You pay a tiny gas fee.`)) return;
    run(e, async () => buildTimeoutAcceptedCloseTx(e.offerId, account.account, account.publicKey), "Trade closed", "Close failed");
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
        <CardDescription>
          Read from the chain: disputed trades, overdue releases, unpaid funded trades and expired accepts where you are the arbiter. Trades appear here even if nobody opened a dispute.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-center text-muted-foreground py-6">Nothing needs attention.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 font-medium">Trade ID</th>
                  <th className="text-left py-2 font-medium">Situation</th>
                  <th className="text-left py-2 font-medium">Seller / Buyer</th>
                  <th className="text-left py-2 font-medium">Amount</th>
                  <th className="text-left py-2 font-medium">Since</th>
                  <th className="text-right py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map(({ e, kind, since }) => (
                  <tr key={e.offerId} className="border-b align-top">
                    <td className="py-2 font-mono text-xs" title={e.offerId}>{e.offerId.slice(0, 16)}…</td>
                    <td className="py-2 max-w-[360px]">
                      <Badge variant={LABEL[kind].variant}>{LABEL[kind].badge}</Badge>
                      <p className="text-xs text-muted-foreground mt-1">{LABEL[kind].text}</p>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground font-mono">{short(e.seller)}<br />{short(e.buyer)}</td>
                    <td className="py-2">{e.amount} KDA</td>
                    <td className="py-2 text-xs text-muted-foreground">{Number.isFinite(since) ? ago(since) : "—"}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {kind === "funded-expired" && (
                        <Button size="sm" variant="outline" disabled={busy === e.offerId} onClick={() => refundSeller(e)}>
                          {busy === e.offerId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refund seller"}
                        </Button>
                      )}
                      {kind === "accepted-expired" && (
                        <Button size="sm" variant="ghost" disabled={busy === e.offerId} onClick={() => closeUnfunded(e)}>
                          {busy === e.offerId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Close"}
                        </Button>
                      )}
                      {kind === "disputed" && (

                        <Link to={`/admin/disputes/${encodeURIComponent(e.offerId)}`}><Button size="sm" variant="ghost">Open</Button></Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
