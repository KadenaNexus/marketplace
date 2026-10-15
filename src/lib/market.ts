import { useQuery } from "@tanstack/react-query";

/** KDA market price from our server (CoinGecko behind it, refreshed at most once a minute). */
export interface Market {
  prices: Partial<Record<string, number>>;
  change24h: Partial<Record<string, number>>;
  updatedAt: string;
  source: string;
}

export function useMarket() {
  return useQuery<Market | null>({
    queryKey: ["market-kda"],
    queryFn: async () => {
      const r = await fetch("/api/market/kda");
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
    retry: 1,
  });
}

/** How far a price is from the market, in percent (positive = above), or null without a market price. */
export function vsMarket(price: number, currency: string | null | undefined, m: Market | null | undefined): number | null {
  const ref = currency ? m?.prices?.[currency] : undefined;
  if (!ref || !Number.isFinite(price) || price <= 0) return null;
  return ((price - ref) / ref) * 100;
}

/** "2.1% above market", "0.8% below market", "at market price" (within 0.5%). */
export function vsMarketText(pct: number): string {
  const a = Math.abs(pct);
  if (a < 0.5) return "at market price";
  const n = a >= 100 ? Math.round(a).toString() : a.toFixed(1);
  return `${n}% ${pct > 0 ? "above" : "below"} market`;
}
