import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarket, vsMarket, vsMarketText } from "@/lib/market";

/**
 * "2.1% above market" next to an offer's price. Neutral colors on purpose: above market is good for a
 * seller and bad for a buyer, so the tag only informs. Far from the market (over 15%) it turns amber.
 */
export function MarketTag({ price, currency, className }: { price: number; currency?: string | null; className?: string }) {
  const { data: m } = useMarket();
  const pct = vsMarket(price, currency, m);
  if (pct === null) return null;
  const far = Math.abs(pct) >= 15;
  const Icon = Math.abs(pct) < 0.5 ? Minus : pct > 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs", far ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground", className)}
      title={`Market price from ${m?.source}: ${m?.prices?.[currency ?? ""]} ${currency}`}
    >
      <Icon className="h-3 w-3" />{vsMarketText(pct)}
    </span>
  );
}

/** "KDA market: $0.00939 · 24 h −3.5%" for the top of the offers list. */
export function MarketLine({ currency = "USD", className }: { currency?: string; className?: string }) {
  const { data: m } = useMarket();
  const p = m?.prices?.[currency];
  if (!p) return null;
  const ch = m?.change24h?.[currency];
  const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : `${currency} `;
  return (
    <p className={cn("text-sm text-muted-foreground", className)} title={`From ${m?.source}, updated ${new Date(m!.updatedAt).toLocaleTimeString()}`}>
      KDA market: <b className="font-mono text-foreground">{sym}{p < 1 ? p.toFixed(5) : p.toFixed(2)}</b>
      {ch !== undefined && <span className={cn("ml-1.5", ch >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>24 h {ch >= 0 ? "+" : "−"}{Math.abs(ch).toFixed(1)}%</span>}
    </p>
  );
}
