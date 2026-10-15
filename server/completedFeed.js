/**
 * "A trade was just completed": a little social proof for everyone on the Marketplace.
 *  - live: io.emit("trade-completed", item) when the notification watcher sees a trade become COMPLETED
 *  - GET /api/trades/recent -> { recent: [item…] (newest first, up to 5), week: n (completed in the last 7 days) }
 * item = { offerId, code, amount, currency, total, token, at, requestKey }. All of it is public chain data or shown in
 * the offer list anyway; wallets are not included (the client gets them only to skip its own trades in the live event).
 * v10 trades take amount/price from offer_details; v11 trades (chain.js) carry amount, currency and the total paid
 * (`payAmount`: the token amount for an instant swap, 0 for a giveaway) on the chain.
 */
import { tradeCode } from "./notifications.js";

const ITEM_SQL = `
  SELECT s.offer_id, s.updated_at AS at, d.amount, d.price, d.fiat_currency,
         (SELECT t.request_key FROM trade_txs t WHERE t.offer_id = s.offer_id AND t.fn IN ('release', 'take-offer', 'take-and-settle', 'resolve') AND t.status = 'ok'
           ORDER BY t.created_at DESC LIMIT 1) AS request_key
    FROM trade_states s LEFT JOIN offer_details d ON d.offer_id = s.offer_id
   WHERE s.state = 'COMPLETED'`;

/** `trade` = the v11 trade (amount, currency, token, payAmount, closedAt) when the id is one; else v10 from the row. */
export const toItem = (r, amount, trade) => {
  if (trade) {
    return {
      offerId: r.offer_id, code: tradeCode(r.offer_id), amount: Number(trade.amount ?? amount), currency: trade.currency || null,
      total: Number(trade.payAmount) || 0, token: trade.token || null,
      at: trade.closedAt ? new Date(trade.closedAt).toISOString() : r.at ? new Date(r.at).toISOString() : new Date().toISOString(), requestKey: r.request_key || null,
    };
  }
  const a = Number(r.amount ?? amount);
  return {
    offerId: r.offer_id, code: tradeCode(r.offer_id), amount: Number.isFinite(a) ? a : null,
    currency: r.fiat_currency || null, total: r.price != null && Number.isFinite(a) ? Number(r.price) * a : null, token: null,
    at: r.at ? new Date(r.at).toISOString() : new Date().toISOString(), requestKey: r.request_key || null,
  };
};

/** `trades` = the v11 trades from the chain, to fill in the rows that are v11 trade ids. */
export async function recentCompleted(pool, limit = 5, trades = []) {
  const [rows, week] = await Promise.all([
    pool.query(`${ITEM_SQL} ORDER BY s.updated_at DESC LIMIT $1`, [limit]),
    pool.query("SELECT count(*)::int AS n FROM trade_states WHERE state = 'COMPLETED' AND updated_at > now() - interval '7 days'"),
  ]);
  const byId = new Map(trades.map((t) => [t.tradeId, t]));
  return { recent: rows.rows.map((r) => toItem(r, undefined, byId.get(r.offer_id))), week: week.rows[0].n };
}

export async function completedItem(pool, offerId, amount, trade) {
  const r = (await pool.query(`${ITEM_SQL} AND s.offer_id = $1`, [offerId])).rows[0];
  return toItem(r || { offer_id: offerId }, amount, trade);
}

/** `chain` = a cached reader returning { trades } (server/chain.js); without it the list is v10 only. */
export function registerCompletedFeedRoutes(app, getPool, { chain } = {}) {
  app.get("/api/trades/recent", async (_req, res) => {
    try {
      let trades = [];
      if (chain) { try { trades = (await chain()).trades; } catch (e) { console.warn("[feed] chain:", e.message); } }
      res.set("Cache-Control", "public, max-age=15");
      return res.json(await recentCompleted(getPool(), 5, trades));
    } catch (e) {
      console.error("GET /api/trades/recent", e.message);
      return res.status(500).json({ error: "Could not load recent trades" });
    }
  });
}
