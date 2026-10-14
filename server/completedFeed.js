/**
 * "A trade was just completed": a little social proof for everyone on the Marketplace.
 *  - live: io.emit("trade-completed", item) when the notification watcher sees a trade become COMPLETED
 *  - GET /api/trades/recent -> { recent: [item…] (newest first, up to 5), week: n (completed in the last 7 days) }
 * item = { offerId, code, amount, currency, total, at, requestKey }. All of it is public chain data or shown in the
 * offer list anyway; wallets are not included (the client gets them only to skip its own trades in the live event).
 */
import { tradeCode } from "./notifications.js";

const ITEM_SQL = `
  SELECT s.offer_id, s.updated_at AS at, d.amount, d.price, d.fiat_currency,
         (SELECT t.request_key FROM trade_txs t WHERE t.offer_id = s.offer_id AND t.fn = 'release' AND t.status = 'ok'
           ORDER BY t.created_at DESC LIMIT 1) AS request_key
    FROM trade_states s LEFT JOIN offer_details d ON d.offer_id = s.offer_id
   WHERE s.state = 'COMPLETED'`;

export const toItem = (r, amount) => {
  const a = Number(r.amount ?? amount);
  return {
    offerId: r.offer_id, code: tradeCode(r.offer_id), amount: Number.isFinite(a) ? a : null,
    currency: r.fiat_currency || null, total: r.price != null && Number.isFinite(a) ? Number(r.price) * a : null,
    at: r.at ? new Date(r.at).toISOString() : new Date().toISOString(), requestKey: r.request_key || null,
  };
};

export async function recentCompleted(pool, limit = 5) {
  const [rows, week] = await Promise.all([
    pool.query(`${ITEM_SQL} ORDER BY s.updated_at DESC LIMIT $1`, [limit]),
    pool.query("SELECT count(*)::int AS n FROM trade_states WHERE state = 'COMPLETED' AND updated_at > now() - interval '7 days'"),
  ]);
  return { recent: rows.rows.map((r) => toItem(r)), week: week.rows[0].n };
}

export async function completedItem(pool, offerId, amount) {
  const r = (await pool.query(`${ITEM_SQL} AND s.offer_id = $1`, [offerId])).rows[0];
  return toItem(r || { offer_id: offerId }, amount);
}

export function registerCompletedFeedRoutes(app, getPool) {
  app.get("/api/trades/recent", async (_req, res) => {
    try {
      res.set("Cache-Control", "public, max-age=15");
      return res.json(await recentCompleted(getPool()));
    } catch (e) {
      console.error("GET /api/trades/recent", e.message);
      return res.status(500).json({ error: "Could not load recent trades" });
    }
  });
}
