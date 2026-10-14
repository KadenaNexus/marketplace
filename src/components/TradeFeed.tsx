import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PartyPopper } from "lucide-react";
import { toast } from "sonner";
import { getSocket } from "@/hooks/useOnlineStatus";
import { useWallet } from "@/hooks/useWallet";
import { getTxExplorerUrl } from "@/lib/kadena";
import { currencyPrefix } from "@/lib/markets";
import { cn, formatFiat } from "@/lib/utils";

/** A trade that just completed on the Marketplace (server/completedFeed.js). */
export interface CompletedTrade { offerId: string; code: string; amount: number | null; currency: string | null; total: number | null; at: string; requestKey: string | null }
interface Feed { recent: CompletedTrade[]; week: number }

const kda = (n: number | null) => (n == null ? "" : `${n.toLocaleString("en-US", { maximumFractionDigits: 4 })} KDA`);
// price 0 is only allowed for a free giveaway
const forTotal = (t: CompletedTrade) => (t.total === 0 ? " (free giveaway)" : t.total != null && t.currency ? ` for ${currencyPrefix(t.currency)}${formatFiat(t.total, t.currency)}` : "");
function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** Everyone online gets a short celebration toast when a trade completes (not the two traders: they get their own notice). */
export function TradeFeedToasts() {
  const { account } = useWallet();
  const queryClient = useQueryClient();
  useEffect(() => {
    const socket = getSocket();
    const me = account?.account;
    const on = (t: CompletedTrade & { wallets?: string[] }) => {
      queryClient.invalidateQueries({ queryKey: ["trades-recent"] });
      if (me && t.wallets?.includes(me)) return;
      toast("Trade completed", {
        icon: <PartyPopper className="h-4 w-4 text-primary" />,
        description: `${kda(t.amount)}${forTotal(t)}${t.code ? ` · #${t.code}` : ""}, settled through the escrow just now.`,
        duration: 6000,
        ...(t.requestKey ? { action: { label: "View", onClick: () => window.open(getTxExplorerUrl(t.requestKey!), "_blank", "noopener") } } : {}),
      });
    };
    socket?.on("trade-completed", on);
    return () => { socket?.off("trade-completed", on); };
  }, [account?.account, queryClient]);
  return null;
}

/** "Latest trade: 300 KDA for $2.82 · 5 min ago · View ↗ · 12 trades this week" under the market price. */
export function TradeFeed({ className }: { className?: string }) {
  const { data } = useQuery<Feed | null>({
    queryKey: ["trades-recent"],
    queryFn: async () => { const r = await fetch("/api/trades/recent"); return r.ok ? r.json() : null; },
    staleTime: 30 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
  const last = data?.recent?.[0];
  // a short highlight when a new trade arrives while the screen is open
  const [flash, setFlash] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  useEffect(() => {
    if (!last) return;
    if (seen && seen !== last.offerId) { setFlash(true); const t = setTimeout(() => setFlash(false), 2500); setSeen(last.offerId); return () => clearTimeout(t); }
    setSeen(last.offerId);
  }, [last, seen]);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 60 * 1000); return () => clearInterval(t); }, []);

  if (!last) return null;
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground transition-colors", flash && "text-primary", className)} aria-live="polite">
      <PartyPopper className={cn("h-4 w-4 shrink-0 text-primary", flash && "animate-bounce")} />
      <span>Latest trade: <b className="text-foreground">{kda(last.amount)}</b>{forTotal(last)} · {ago(last.at)}</span>
      {last.requestKey && (
        <a href={getTxExplorerUrl(last.requestKey)} target="_blank" rel="noopener noreferrer" className="text-primary underline">View ↗</a>
      )}
      {data!.week > 1 && <span>· {data!.week} trades this week</span>}
    </p>
  );
}
