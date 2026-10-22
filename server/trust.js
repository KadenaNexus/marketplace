/**
 * Trust and safety:
 *  - Completed trades per wallet, counted on the chain (for the new-trader limit and the "New trader" tag).
 *  - Terms of use, accepted once per wallet (per terms version).
 *  - A one-time re-check of rating registrations made before they were checked against the chain.
 *
 *   GET  /api/traders/completed?w=k:…,k:…   -> { "k:…": 2, … }   (public: it is chain data)
 *   GET  /api/terms                         (wallet, publicKey, signedCmd in the query) -> { version, accepted }
 *   POST /api/terms/accept                  { wallet, publicKey, signedCmd, version }
 */
import { fetchChainOffers } from "./alerts.js";
import { configFor, fetchChain, poolsById, tradeAsLegacyEscrow } from "./chain.js";

export const TERMS_VERSION = "2026-10-14"; // BRO added as a way to pay

/** Completed trades per wallet from all escrows (either side counts): v10 offers and v11 trades alike. */
export function completedCounts(offers) {
  const n = new Map();
  for (const o of offers) {
    if (o.state !== "COMPLETED") continue;
    for (const w of new Set([o.creator, o.buyer])) if (w) n.set(w, (n.get(w) || 0) + 1);
  }
  return n;
}

/**
 * v10 escrows (history) plus every v11 trade in the same legacy shape, for the counts. Read one after the other
 * (a single Pact server rejects parallel reads). If one contract cannot be read, the other still counts; both
 * failing throws, so the cache keeps its last good read.
 */
export async function fetchAllEscrows() {
  const out = [];
  let failed = 0;
  try { out.push(...await fetchChainOffers()); } catch (e) { failed++; console.warn("[trust] v10 read failed:", e.message); }
  try { const c = await fetchChain(); const by = poolsById(c.pools); out.push(...c.trades.map((t) => tradeAsLegacyEscrow(t, by, configFor(c, t.chain).arbiter))); }
  catch (e) { failed++; console.warn("[trust] v11 read failed:", e.message); }
  if (failed === 2) throw new Error("chain not reachable");
  return out;
}

export function createChainCache({ fetchOffers = fetchAllEscrows, freshMs = 60 * 1000, now = () => Date.now() } = {}) {
  let last = null, at = 0, inflight = null;
  return async function offers() {
    if (last && now() - at < freshMs) return last;
    if (!inflight) inflight = fetchOffers().then((o) => { last = o; at = now(); }).catch((e) => console.warn("[trust] chain read failed:", e.message)).finally(() => { inflight = null; });
    await inflight;
    if (!last) throw new Error("chain not reachable");
    return last;
  };
}

/**
 * Reputation per wallet from the server's tables, for many wallets in three grouped queries (not three per
 * wallet): { [wallet]: { averageRating, totalRatings, completedTrades, disputedCount, completionRate } }.
 * A wallet nobody traded with or rated gets zeros and a completion rate of 1.
 */
export async function ratingSummaries(pool, wallets) {
  const list = [...new Set(wallets)];
  const out = Object.fromEntries(list.map((w) => [w, { averageRating: 0, totalRatings: 0, completedTrades: 0, disputedCount: 0, completionRate: 1 }]));
  if (!list.length) return out;
  const [completed, disputed, agg] = await Promise.all([
    pool.query(
      `SELECT w AS wallet, COUNT(c.offer_id)::int AS cnt FROM unnest($1::text[]) AS w
         LEFT JOIN completed_offers c ON c.buyer_wallet = w OR c.seller_wallet = w GROUP BY w`, [list]),
    pool.query(
      `SELECT w AS wallet, COUNT(DISTINCT d.id)::int AS cnt FROM unnest($1::text[]) AS w
         JOIN completed_offers c ON c.buyer_wallet = w OR c.seller_wallet = w
         JOIN disputes d ON d.offer_id = c.offer_id GROUP BY w`, [list]),
    pool.query(
      `SELECT rated_wallet AS wallet, AVG(rating)::float AS avg_rating, COUNT(*)::int AS cnt FROM ratings
        WHERE rated_wallet = ANY($1::text[]) GROUP BY rated_wallet`, [list]),
  ]);
  for (const r of completed.rows) out[r.wallet].completedTrades = r.cnt;
  for (const r of disputed.rows) out[r.wallet].disputedCount = r.cnt;
  for (const r of agg.rows) { out[r.wallet].averageRating = Math.round(r.avg_rating * 10) / 10; out[r.wallet].totalRatings = r.cnt; }
  for (const o of Object.values(out)) {
    // completion rate: share of completed trades that had no dispute
    const rate = o.completedTrades > 0 ? Math.max(0, (o.completedTrades - o.disputedCount) / o.completedTrades) : 1;
    o.completionRate = Math.round(rate * 100) / 100;
  }
  return out;
}

/** Owners of a trade on the chain: { seller (KDA holder), buyer (payer) }. */
const sides = (o) => (o.side === "SELL" ? { seller: o.creator, buyer: o.buyer } : { seller: o.buyer, buyer: o.creator });

/**
 * Rating registrations (completed_offers) made before the server checked them against the chain: keep the
 * ones that are a real COMPLETED trade between the same two wallets; move the others, and any ratings on
 * them, to *_removed tables (kept, not lost). Runs once; marked done in alert_state.
 */
export async function recheckCompletedOffers(pool, { fetchOffers = fetchChainOffers, key = "completed_offers_rechecked_v1" } = {}) {
  const done = await pool.query("SELECT 1 FROM alert_state WHERE key = $1", [key]);
  if (done.rows.length) return { skipped: true };
  const offers = await fetchOffers(); // throws when the chain is unreachable: try again at the next start
  const byId = new Map(offers.map((o) => [o.id, o]));
  const rows = (await pool.query("SELECT offer_id, buyer_wallet, seller_wallet FROM completed_offers")).rows;
  const bad = [];
  for (const r of rows) {
    const o = byId.get(r.offer_id);
    const s = o && sides(o);
    const ok = o && o.state === "COMPLETED" && s.buyer === r.buyer_wallet && s.seller === r.seller_wallet;
    if (!ok) bad.push({ ...r, reason: !o ? "not on chain" : o.state !== "COMPLETED" ? `state ${o.state}` : "wallets differ from chain" });
  }
  let ratingsMoved = 0;
  for (const b of bad) {
    await pool.query("INSERT INTO completed_offers_removed (offer_id, buyer_wallet, seller_wallet, reason) VALUES ($1, $2, $3, $4) ON CONFLICT (offer_id) DO NOTHING", [b.offer_id, b.buyer_wallet, b.seller_wallet, b.reason]);
    const moved = await pool.query(
      `WITH m AS (DELETE FROM ratings WHERE offer_id = $1 RETURNING *)
       INSERT INTO ratings_removed (offer_id, rater_wallet, rated_wallet, rating, comment, created_at) SELECT offer_id, rater_wallet, rated_wallet, rating, comment, created_at FROM m`, [b.offer_id]);
    ratingsMoved += moved.rowCount || 0;
    await pool.query("DELETE FROM completed_offers WHERE offer_id = $1", [b.offer_id]);
  }
  await pool.query("INSERT INTO alert_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING", [key, JSON.stringify({ checked: rows.length, removed: bad.length, ratingsMoved, at: new Date().toISOString() })]);
  return { checked: rows.length, removed: bad.length, ratingsMoved, reasons: bad.map((b) => `${b.offer_id}: ${b.reason}`) };
}

export function registerTrustRoutes(app, { getPool, requireAuth, sendAuthError, chainOffers = createChainCache() }) {
  const okWallet = (w) => /^k:[0-9a-f]{64}$/.test(w);

  app.get("/api/traders/completed", async (req, res) => {
    const ws = String(req.query.w || "").split(",").map((s) => s.trim()).filter(okWallet).slice(0, 100);
    try {
      const n = completedCounts(await chainOffers());
      res.set("Cache-Control", "public, max-age=30");
      return res.json(Object.fromEntries(ws.map((w) => [w, n.get(w) || 0])));
    } catch {
      return res.status(503).json({ error: "Could not read the chain right now" });
    }
  });

  const auth = (req, res, from) => {
    const a = requireAuth(req, from);
    if (!a.ok) { sendAuthError(res, a); return null; }
    if ((from === "query" ? req.query : req.body)?.wallet !== a.wallet) { res.status(400).json({ error: "Wallet must match authenticated wallet" }); return null; }
    return a.wallet;
  };
  app.get("/api/terms", async (req, res) => {
    const w = auth(req, res, "query"); if (!w) return;
    const r = await getPool().query("SELECT accepted_at FROM terms_acceptances WHERE wallet = $1 AND version = $2", [w, TERMS_VERSION]);
    return res.json({ version: TERMS_VERSION, accepted: r.rows.length > 0 });
  });
  app.post("/api/terms/accept", async (req, res) => {
    const w = auth(req, res, "body"); if (!w) return;
    if (req.body?.version !== TERMS_VERSION) return res.status(409).json({ error: "The terms changed. Reload the page and read the new version." });
    await getPool().query("INSERT INTO terms_acceptances (wallet, version) VALUES ($1, $2) ON CONFLICT DO NOTHING", [w, TERMS_VERSION]);
    return res.json({ ok: true, version: TERMS_VERSION });
  });
}
