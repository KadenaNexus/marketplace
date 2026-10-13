/**
 * KDA market price, for "2% above market" on offers and "Use market price" when creating one.
 * One request to CoinGecko a minute at most, shared by everyone (the site asks our server, never CoinGecko
 * directly, so there is no browser CORS or rate-limit trouble). If CoinGecko is down, the last price is kept
 * for up to 30 minutes, then the site simply shows no comparison.
 *
 *   GET /api/market/kda -> { prices: { USD, EUR, SAR, AED }, change24h: {...}, updatedAt, source }
 */
const env = (k, d) => (process.env[k] ?? d);
export const MARKET_CURRENCIES = ["USD", "EUR", "SAR", "AED"];
const url = () => env("MARKET_PRICE_URL", `https://api.coingecko.com/api/v3/simple/price?ids=kadena&vs_currencies=${MARKET_CURRENCIES.join(",").toLowerCase()}&include_24hr_change=true&include_last_updated_at=true`);

/** CoinGecko's answer -> our shape, or null when it has no usable price. */
export function parseCoinGecko(j) {
  const k = j?.kadena;
  if (!k) return null;
  const prices = {}, change24h = {};
  for (const c of MARKET_CURRENCIES) {
    const p = Number(k[c.toLowerCase()]);
    if (Number.isFinite(p) && p > 0) prices[c] = p;
    const ch = Number(k[`${c.toLowerCase()}_24h_change`]);
    if (Number.isFinite(ch)) change24h[c] = Math.round(ch * 100) / 100;
  }
  if (!prices.USD) return null;
  const t = Number(k.last_updated_at);
  return { prices, change24h, updatedAt: new Date(Number.isFinite(t) && t > 0 ? t * 1000 : Date.now()).toISOString(), source: "CoinGecko" };
}

export function createMarket({ fetcher = (u) => fetch(u, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } }), freshMs = 60 * 1000, keepMs = 30 * 60 * 1000, now = () => Date.now() } = {}) {
  let last = null, lastAt = 0, inflight = null;
  return async function getMarket() {
    if (last && now() - lastAt < freshMs) return last;
    if (!inflight) {
      inflight = (async () => {
        try {
          const r = await fetcher(url());
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const m = parseCoinGecko(await r.json());
          if (m) { last = m; lastAt = now(); }
        } catch (e) {
          console.warn("[market] price fetch failed:", e.message);
        } finally { inflight = null; }
      })();
    }
    await inflight;
    return last && now() - lastAt < keepMs ? last : null;
  };
}

export function registerMarketRoutes(app, getMarket = createMarket()) {
  app.get("/api/market/kda", async (_req, res) => {
    const m = await getMarket();
    res.set("Cache-Control", "public, max-age=30");
    if (!m) return res.status(503).json({ error: "Market price not available right now" });
    return res.json(m);
  });
}
