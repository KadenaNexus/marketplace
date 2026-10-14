/**
 * The arbiter tidies the market: open offers nobody is following up (forgotten, creator gone) can be
 * hidden from the offer list. The contract only lets the creator close an open offer, so nothing changes
 * on the chain: the offer is hidden in the Marketplace, its creator is told (bell, push, email) and can
 * delete it or post it again. Only open (CREATED) offers can be hidden; nothing is locked in them.
 *
 *   GET    /api/hidden-offers                         -> [{ offerId, reason, hiddenAt }]   (public: the app filters with it)
 *   GET    /api/admin/open-offers   (query auth)      -> open offers where you are the arbiter, with age and creator activity
 *   POST   /api/offers/:offerId/hide   { wallet, publicKey, signedCmd, reason? }
 *   DELETE /api/offers/:offerId/hide   { wallet, publicKey, signedCmd }
 */
import { readEscrowFromChain } from "./payout.js";
import { notify, tradeCode } from "./notifications.js";
import { createChainCache } from "./trust.js";

export const REASONS = {
  inactive: "The creator has not been active for a while.",
  stale: "The offer has been open for a long time without a trade.",
  other: "",
};

export function registerOfferModerationRoutes(app, { getPool, requireAuth, sendAuthError, readEscrow = readEscrowFromChain, chainOffers = createChainCache(), notifyFn = notify }) {
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
    const open = offers.filter((o) => o.state === "CREATED" && o.arbiter === w);
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
      const x = d.get(o.id), created = x?.created_at ?? null, last = s.get(o.creator) ?? null;
      const active = [created, last].filter(Boolean).map((t) => new Date(t).getTime());
      return {
        offerId: o.id, code: tradeCode(o.id), side: o.side, amount: o.amount, creator: o.creator,
        price: x ? Number(x.price) : null, currency: x?.fiat_currency ?? null,
        createdAt: created, creatorLastActive: active.length ? new Date(Math.max(...active)).toISOString() : null,
        hidden: h.has(o.id) ? { reason: h.get(o.id).reason, hiddenAt: h.get(o.id).hidden_at } : null,
      };
    }));
  });

  app.post("/api/offers/:offerId/hide", async (req, res) => {
    const w = auth(req, res, "body"); if (!w) return;
    const e = await arbiterOf(req, res, w); if (!e) return;
    if (e.state !== "CREATED") return res.status(409).json({ error: `Only open offers can be hidden (this one is ${e.state})` });
    const key = String(req.body?.reason || "inactive");
    const reason = key in REASONS ? key : "other";
    const r = await getPool().query("INSERT INTO hidden_offers (offer_id, hidden_by, reason) VALUES ($1, $2, $3) ON CONFLICT (offer_id) DO NOTHING RETURNING offer_id", [req.params.offerId, w, reason]);
    if (r.rows.length) {
      const code = tradeCode(req.params.offerId);
      notifyFn(getPool(), {
        wallet: e.creator, offer_id: req.params.offerId, kind: "hidden",
        title: "Your offer was hidden from the market",
        body: `${code ? `#${code}: ` : ""}${REASONS[reason] || "It looked forgotten."} Nothing was locked and nothing moved. Delete it from My trades, or post it again if you still want to trade.`,
      }).catch((err) => console.warn("[moderation] notify:", err.message));
    }
    return res.json({ ok: true, hidden: true });
  });

  app.delete("/api/offers/:offerId/hide", async (req, res) => {
    const w = auth(req, res, "body"); if (!w) return;
    const e = await arbiterOf(req, res, w); if (!e) return;
    await getPool().query("DELETE FROM hidden_offers WHERE offer_id = $1", [req.params.offerId]);
    return res.json({ ok: true, hidden: false });
  });
}
