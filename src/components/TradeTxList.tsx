import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { fetchTradeTxs, getTxExplorerUrl, type Escrow, type TradeTx } from "@/lib/kadena";

type Local = { action: string; requestKey: string; timestamp: Date };

const STEP_ORDER = ["create-offer", "accept-offer", "deposit", "mark-paid", "release"];

/**
 * Every on-chain step of a trade (Create offer → Accept → Deposit → Mark paid → Release, and cancel,
 * refund or timeouts), for both sides, on any device. Our server records each step from the signed
 * transaction and keeps it once the chain confirms it. Steps sent from this page that the server has not
 * listed yet are added from this page's own memory.
 */
export function TradeTxList({ escrow, local }: { escrow: Escrow; local: Local[] }) {
  const { data: server = [], isLoading } = useQuery({
    queryKey: ["trade-txs", escrow.offerId, escrow.state],
    queryFn: () => fetchTradeTxs(escrow.offerId),
    refetchInterval: (q) => ((q.state.data as TradeTx[] | undefined)?.some((t) => t.status === "pending") ? 5000 : 30000),
  });

  const known = new Set(server.map((t) => t.requestKey));
  const rows: TradeTx[] = [
    ...server,
    ...local
      .filter((t) => !known.has(t.requestKey))
      .reverse()
      .map((t) => ({ requestKey: t.requestKey, fn: "", action: t.action, sender: "", status: "confirmed" as const, at: t.timestamp.toISOString() })),
  ];

  const who = (w: string) => (!w ? null : w === escrow.seller ? "Seller" : w === escrow.buyer ? "Buyer" : w === escrow.arbiter ? "Arbiter" : null);
  const missing = escrow.state !== "CREATED" && !server.some((t) => t.fn === "create-offer");

  if (isLoading && !rows.length) return null;

  return (
    <section className="space-y-3 border-t border-border pt-4" aria-label="Transactions for this trade">
      <div>
        <h3 className="font-display text-base font-semibold">Transactions for this trade</h3>
        <p className="text-sm text-muted-foreground">Each step on the Kadena chain. Tap one to see it in the explorer.</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No transactions recorded yet.</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((t) => {
            const by = who(t.sender);
            const step = STEP_ORDER.indexOf(t.fn);
            return (
              <li key={t.requestKey}>
                <a
                  href={getTxExplorerUrl(t.requestKey)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg bg-muted p-3 hover:bg-muted/70"
                >
                  {t.status === "pending"
                    ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Confirming" />
                    : <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-label="Confirmed" />}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {step >= 0 ? `${step + 1}. ` : ""}{t.action}
                      {by && <span className="font-normal text-muted-foreground"> · {by}</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t.status === "pending" ? "Confirming…" : format(new Date(t.at), "d MMM yyyy, HH:mm")}
                      {" · "}
                      <span className="font-mono">{t.requestKey.slice(0, 10)}…{t.requestKey.slice(-6)}</span>
                    </span>
                  </span>
                  <ExternalLink className="h-4 w-4 shrink-0 text-primary" />
                </a>
              </li>
            );
          })}
        </ol>
      )}
      {missing && (
        <p className="text-xs text-muted-foreground">Steps taken before this list was added may be missing here; they are still on the chain.</p>
      )}
    </section>
  );
}
