/**
 * Who may see or act on a dispute. The two sides of the trade and the arbiter are read from the chain, never from
 * the browser (server/payout.js readEscrowFromChain). Used by the dispute routes in server/index.js.
 *
 *   requireDisputeParty(req, res, offerId, from)  the holder, the payer or the arbiter; after a refund the chain
 *                                                forgets the buyer, so whoever opened the dispute or sent evidence
 *                                                (both checked at the time) keeps access
 *   requireArbiter(req, res, offerId, from)       the arbiter only, with a fresh wallet signature (no session token)
 *
 * Both answer { ok: true, wallet, escrow } or send the error and answer { ok: false }.
 */
import { readEscrowFromChain, sidesOf } from "./payout.js";

export function createDisputeAuthz({ getPool, requireAuth, sendAuthError, readEscrow = readEscrowFromChain }) {
  /** The signed-in wallet, which must also be the wallet named in the request. */
  function signedWallet(req, res, from, opts) {
    const auth = requireAuth(req, from, opts);
    if (!auth.ok) { sendAuthError(res, auth); return null; }
    const data = from === "query" ? req.query : req.body;
    if (data?.wallet !== auth.wallet) { res.status(400).json({ error: "Wallet must match authenticated wallet" }); return null; }
    return auth.wallet;
  }

  async function requireDisputeParty(req, res, offerId, from = "body") {
    const me = signedWallet(req, res, from);
    if (!me) return { ok: false };
    let e;
    try { e = await readEscrow(offerId); }
    catch { res.status(502).json({ error: "Could not check the trade on the chain. Try again." }); return { ok: false }; }
    if (e) {
      const { holder, payer } = sidesOf(e);
      if ((holder && me === holder) || (payer && me === payer) || (e.arbiter && me === e.arbiter)) return { ok: true, wallet: me, escrow: e };
    }
    // took part before: opened the dispute or sent evidence (not: posted a message, which a party could only do
    // after passing this check, but which would otherwise keep anyone who ever got in)
    const before = await getPool().query(
      `SELECT 1 FROM disputes WHERE offer_id = $1 AND opened_by_wallet = $2
       UNION SELECT 1 FROM evidence WHERE offer_id = $1 AND submitted_by = $2 LIMIT 1`,
      [offerId, me]
    ).catch(() => ({ rows: [] }));
    if (before.rows.length) return { ok: true, wallet: me, escrow: e };
    res.status(403).json({ error: "Only the two sides of this trade and the arbiter can see or add to its dispute" });
    return { ok: false };
  }

  async function requireArbiter(req, res, offerId, from = "body") {
    const me = signedWallet(req, res, from, { allowSession: false });
    if (!me) return { ok: false };
    let e;
    try { e = await readEscrow(offerId); }
    catch { res.status(502).json({ error: "Could not check the trade on the chain. Try again." }); return { ok: false }; }
    if (!e) { res.status(404).json({ error: "Trade not found on the chain" }); return { ok: false }; }
    if (!e.arbiter || me !== e.arbiter) { res.status(403).json({ error: "Only the arbiter of this trade can do this" }); return { ok: false }; }
    return { ok: true, wallet: me, escrow: e };
  }

  return { requireDisputeParty, requireArbiter };
}
