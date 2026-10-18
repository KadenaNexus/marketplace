/**
 * The arbiter tidies the market: open pools nobody is following up (forgotten, creator gone) can be
 * hidden from the offer list. The contract only lets the creator close a pool, so nothing changes
 * on the chain: the pool is hidden in the Marketplace, its creator is told (bell, push, email) and can
 * close it or post it again. Only open pools can be hidden; what is locked in open trades stays on the chain.
 *
 *   GET    /api/hidden-offers                         -> [{ offerId, reason, hiddenAt }]   (public: the app filters with it; ids are pool ids)
 *   GET    /api/admin/open-offers   (query auth)      -> open pools where you are the arbiter, with age and creator activity
 *   POST   /api/offers/:offerId/hide   { wallet, publicKey, signedCmd, reason? }        (:offerId = a pool id)
 *   DELETE /api/offers/:offerId/hide   { wallet, publicKey, signedCmd }
 *   POST   /api/offers/:offerId/relist { wallet, publicKey, signedCmd }   the creator lists an expired offer again (v10)
 *
 * Expiry: a v11 pool expires on the chain (its own `expires-at`); the server only reminds the creator a day
 * before (`poolExpiryReminders`). The v10 rule (`expireOldOffers`: hide an offer listed OFFER_EXPIRY_DAYS
 * without a buyer) is kept for the old contract but no longer runs.
 */
import { notify, tradeCode } from "./notifications.js";
import { createChainCache } from "./trust.js";
import { fetchChainOffers } from "./alerts.js";
import { configFor, fetchChain, readConfig, parseRef, readPool } from "./chain.js";

const DAY = 86400000;
export const expiryDays = () => { const n = Number(process.env.OFFER_EXPIRY_DAYS ?? 7); return Number.isFinite(n) && n >= 0 ? n : 7; };
/** v10 CREATED and v11 OPEN both mean "open, nothing taken yet from this listing". */
const isOpen = (state) => state === "CREATED" || state === "OPEN";

/* ---------------- v11 pools as moderation targets ---------------- */
const configCache = new Map(); // chain -> { at, v }
async function arbiter(chain) {
  const c = configCache.get(chain);
  if (c && Date.now() - c.at < 60 * 1000) return c.v.arbiter;
  const v = await readConfig({ chain });
  configCache.set(chain, { at: Date.now(), v });
  return v.arbiter;
}
/** A pool (by reference, "2:pool-…" on chain 2) in the shape the routes check: { creator, arbiter, side, state, amount, … } or null. */
export async function readPoolTarget(poolId) {
  const p = await readPool(poolId);
  return p ? { ...p, id: p.poolId, amount: p.available, arbiter: await arbiter(parseRef(poolId).chain) } : null;
}
/** Open pools of every v11 chain for the admin list (the arbiter comes from each chain's config). */
export async function fetchOpenPools() {
  const c = await fetchChain();
  return c.pools.filter((p) => p.state === "OPEN").map((p) => ({ ...p, id: p.poolId, amount: p.available, arbiter: configFor(c, p.chain).arbiter }));
}

/**
 * A day before a pool's on-chain expiry, tell its creator once (kind carries the expiry time, so a new expiry
 * set with Edit is reminded again). Returns the pool ids warned.
 */
export async function poolExpiryReminders(pool, { pools, now = Date.now(), notifyFn = notify } = {}) {
  const open = (pools || await fetchOpenPools()).filter((p) => p.state === "OPEN" && p.expiresAt);
  const warned = [];
  for (const p of open) {
    const leftMs = new Date(p.expiresAt).getTime() - now;
    if (leftMs <= 0 || leftMs > DAY) continue;
    const code = tradeCode(p.poolId), hours = Math.max(1, Math.round(leftMs / 3600000));
    const sent = await notifyFn(pool, {
      wallet: p.creator, offer_id: p.poolId, kind: `expiring-pool-${new Date(p.expiresAt).toISOString().slice(0, 16)}`,
      title: "Your offer expires tomorrow",
      body: `${code ? `#${code} ` : ""}expires in about ${hours} hour${hours === 1 ? "" : "s"} and then leaves the market. Nothing moves: the unsold KDA stays in the offer until you close it. Open My offers to extend the expiry or close the offer.`,
    }).catch((e) => { console.warn("[expiry] warn:", e.message); return null; });
    if (sent?.created !== false) warned.push(p.poolId);
  }
  return { warned };
}

export function startPoolExpiryWatcher(getPool, everyMs = 30 * 60 * 1000) {
  const tick = () => poolExpiryReminders(getPool())
    .then((r) => { if (r.warned.length) console.log("[expiry] warned:", r.warned.length); })
    .catch((e) => console.warn("[expiry]", e.message));
  setTimeout(tick, 60 * 1000);
  return setInterval(tick, everyMs);
}

/**
 * One round of the automatic rule. Listed since = the later of when the offer was posted and when its creator
 * last listed it again (for offers without details, when the server first saw it). Returns what it hid.
 */
export async function expireOldOffers(pool, { offers, now = Date.now(), days = expiryDays(), notifyFn = notify } = {}) {
  if (!days) return { hidden: [] };
  const open = (offers || await fetchChainOffers()).filter((o) => o.state === "CREATED");
  if (!open.length) return { hidden: [] };
  const ids = open.map((o) => o.id);
  const r = await pool.query(
    `SELECT o.id, GREATEST(d.created_at, x.relisted_at, CASE WHEN d.created_at IS NULL THEN s.first_seen_at END) AS since
       FROM unnest($1::text[]) AS o(id)
       LEFT JOIN offer_details d ON d.offer_id = o.id
       LEFT JOIN offer_relists x ON x.offer_id = o.id
       LEFT JOIN alert_offers_seen s ON s.offer_id = o.id
      WHERE NOT EXISTS (SELECT 1 FROM hidden_offers h WHERE h.offer_id = o.id)`, [ids]);
  const byId = new Map(open.map((o) => [o.id, o]));
  const hidden = [], warned = [];
  for (const row of r.rows) {
    if (!row.since) continue;
    const age = now - new Date(row.since).getTime();
    // a day before: tell the creator, once per listing period (listing again starts a new one)
    if (age >= (days - 1) * DAY && age < days * DAY) {
      const o = byId.get(row.id), code = tradeCode(row.id), hours = Math.max(1, Math.round((days * DAY - age) / 3600000));
      const sent = await notifyFn(pool, {
        wallet: o.creator, offer_id: row.id, kind: `expiring-offer-${new Date(row.since).toISOString().slice(0, 16)}`,
        title: "Your offer expires tomorrow",
        body: `${code ? `#${code} ` : ""}has been listed ${days - 1} days without a buyer and leaves the market in about ${hours} hour${hours === 1 ? "" : "s"}. Open My trades and tap "Keep listed" to keep it for ${days} more days.`,
      }).catch((e) => { console.warn("[expiry] warn:", e.message); return null; });
      if (sent?.created !== false) warned.push(row.id);
      continue;
    }
    if (age < days * DAY) continue;
    const ins = await pool.query("INSERT INTO hidden_offers (offer_id, hidden_by, reason) VALUES ($1, 'auto', 'expired') ON CONFLICT DO NOTHING RETURNING offer_id", [row.id]);
    if (!ins.rows.length) continue;
    hidden.push(row.id);
    const o = byId.get(row.id), code = tradeCode(row.id);
    await notifyFn(pool, {
      wallet: o.creator, offer_id: row.id, kind: `expired-offer-${new Date(now).toISOString().slice(0, 10)}`,
      title: "Your offer expired",
      body: `${code ? `#${code} ` : ""}was listed for ${days} days without a buyer, so it is no longer shown in the market. Nothing was locked. Open My trades to list it again for ${days} more days, or delete it.`,
    }).catch((e) => console.warn("[expiry] notify:", e.message));
  }
  return { hidden, warned };
}

export function startOfferExpiryWatcher(getPool, everyMs = 30 * 60 * 1000) {
  const tick = () => expireOldOffers(getPool())
    .then((r) => { if (r.hidden.length || r.warned?.length) console.log("[expiry] warned:", r.warned?.length || 0, "hid:", r.hidden.length); })
    .catch((e) => console.warn("[expiry]", e.message));
  setTimeout(tick, 60 * 1000);
  return setInterval(tick, everyMs);
}

export const REASONS = {
  expired: "",
  inactive: "The creator has not been active for a while.",
  stale: "The offer has been open for a long time without a trade.",
  other: "",
};

export function registerOfferModerationRoutes(app, { getPool, requireAuth, sendAuthError, readEscrow = readPoolTarget, chainOffers = createChainCache({ fetchOffers: fetchOpenPools }), notifyFn = notify }) {
  const okId = (id) => typeof id === "string" && id.length > 0 && id.length <= 255;
  const auth = (req, res, from) => {
    const a = requireAuth(req, from);
    if (!a.ok) { sendAuthError(res, a); return null; }
    if ((from === "query" ? req.query : req.body)?.wallet !== a.wallet) { res.status(400).json({ error: "Wallet must match authenticated wallet" }); return null; }
    return a.wallet;
  };
  /** The offer must be open, and you must be its arbiter (read from the chain). */
  async function arbiterOf(req, res, wallet) {
    const id = req.params.offerId;
    if (!okId(id)) { res.status(400).json({ error: "Bad offer id" }); return null; }
    let e;
    try { e = await readEscrow(id); } catch { res.status(503).json({ error: "Could not read the chain right now" }); return null; }
    if (!e) { res.status(404).json({ error: "Offer not found" }); return null; }
    if (e.arbiter !== wallet) { res.status(403).json({ error: "Only the arbiter of this offer can do this" }); return null; }
    return e;
  }

  app.get("/api/hidden-offers", async (_req, res) => {
    const r = await getPool().query("SELECT offer_id, reason, hidden_at FROM hidden_offers ORDER BY hidden_at DESC");
    res.set("Cache-Control", "no-store"); // a change shows at once
    return res.json(r.rows.map((x) => ({ offerId: x.offer_id, reason: x.reason, hiddenAt: x.hidden_at })));
  });

  app.get("/api/admin/open-offers", async (req, res) => {
    const w = auth(req, res, "query"); if (!w) return;
    let offers;
    try { offers = await chainOffers(); } catch { return res.status(503).json({ error: "Could not read the chain right now" }); }
    const open = offers.filter((o) => isOpen(o.state) && o.arbiter === w);
    if (!open.length) return res.json([]);
    const ids = open.map((o) => o.id), creators = [...new Set(open.map((o) => o.creator))];
    const pool = getPool();
    const [det, seen, hid] = await Promise.all([
      pool.query("SELECT offer_id, price, fiat_currency, payment_method, created_at FROM offer_details WHERE offer_id = ANY($1)", [ids]),
      pool.query("SELECT wallet, last_seen FROM profiles WHERE wallet = ANY($1)", [creators]),
      pool.query("SELECT offer_id, reason, hidden_at FROM hidden_offers WHERE offer_id = ANY($1)", [ids]),
    ]);
    const d = new Map(det.rows.map((x) => [x.offer_id, x]));
    const s = new Map(seen.rows.map((x) => [x.wallet, x.last_seen]));
    const h = new Map(hid.rows.map((x) => [x.offer_id, x]));
    return res.json(open.map((o) => {
      const x = d.get(o.id), created = o.createdAt ?? x?.created_at ?? null, last = s.get(o.creator) ?? null;
      const active = [created, last].filter(Boolean).map((t) => new Date(t).getTime());
      return {
        offerId: o.id, code: tradeCode(o.id), side: o.side, amount: o.amount, creator: o.creator,
        // v11: price and currency are on the pool; v10: in offer_details
        price: o.price ?? (x ? Number(x.price) : null), currency: o.currency ?? x?.fiat_currency ?? null,
        min: o.min ?? null, max: o.max ?? null, expiresAt: o.expiresAt ?? null,
        createdAt: created, creatorLastActive: active.length ? new Date(Math.max(...active)).toISOString() : null,
        hidden: h.has(o.id) ? { reason: h.get(o.id).reason, hiddenAt: h.get(o.id).hidden_at } : null,
      };
    }));
  });

  app.post("/api/offers/:offerId/hide", async (req, res) => {
    const w = auth(req, res, "body"); if (!w) return;
    const e = await arbiterOf(req, res, w); if (!e) return;
    if (!isOpen(e.state)) return res.status(409).json({ error: `Only open offers can be hidden (this one is ${e.state})` });
    const key = String(req.body?.reason || "inactive");
    const reason = key in REASONS ? key : "other";
    const r = await getPool().query("INSERT INTO hidden_offers (offer_id, hidden_by, reason) VALUES ($1, $2, $3) ON CONFLICT (offer_id) DO NOTHING RETURNING offer_id", [req.params.offerId, w, reason]);
    if (r.rows.length) {
      const code = tradeCode(req.params.offerId);
      notifyFn(getPool(), {
        wallet: e.creator, offer_id: req.params.offerId, kind: "hidden",
        title: "Your offer was hidden from the market",
        body: `${code ? `#${code}: ` : ""}${REASONS[reason] || "It looked forgotten."} Nothing was locked in a trade and nothing moved on the chain. Close it from My offers to get the unsold KDA back, or post it again if you still want to trade.`,
      }).catch((err) => console.warn("[moderation] notify:", err.message));
    }
    return res.json({ ok: true, hidden: true });
  });

  // The creator of an offer that expired lists it again: the clock starts over.
  app.post("/api/offers/:offerId/relist", async (req, res) => {
    const w = auth(req, res, "body"); if (!w) return;
    const id = req.params.offerId;
    if (!okId(id)) return res.status(400).json({ error: "Bad offer id" });
    let e;
    try { e = await readEscrow(id); } catch { return res.status(503).json({ error: "Could not read the chain right now" }); }
    if (!e) return res.status(404).json({ error: "Offer not found" });
    if (e.creator !== w) return res.status(403).json({ error: "Only the creator of this offer can list it again" });
    if (!isOpen(e.state)) return res.status(409).json({ error: `This offer is ${e.state}, not open` });
    const pool = getPool();
    const h = (await pool.query("SELECT reason FROM hidden_offers WHERE offer_id = $1", [id])).rows[0];
    if (h && h.reason !== "expired") return res.status(403).json({ error: "The Marketplace hid this offer. Delete it and post a new one, or ask in the Telegram group." });
    await pool.query("INSERT INTO offer_relists (offer_id, relisted_at) VALUES ($1, now()) ON CONFLICT (offer_id) DO UPDATE SET relisted_at = now()", [id]);
    await pool.query("DELETE FROM hidden_offers WHERE offer_id = $1 AND reason = 'expired'", [id]);
    return res.json({ ok: true, days: expiryDays() });
  });

  app.delete("/api/offers/:offerId/hide", async (req, res) => {
    const w = auth(req, res, "body"); if (!w) return;
    const e = await arbiterOf(req, res, w); if (!e) return;
    const pool = getPool();
    await pool.query("DELETE FROM hidden_offers WHERE offer_id = $1", [req.params.offerId]);
    // shown again on purpose: the expiry clock starts over, so the automatic rule does not hide it straight back
    await pool.query("INSERT INTO offer_relists (offer_id, relisted_at) VALUES ($1, now()) ON CONFLICT (offer_id) DO UPDATE SET relisted_at = now()", [req.params.offerId]);
    return res.json({ ok: true, hidden: false });
  });
}
