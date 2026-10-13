/**
 * Payout details: where the KDA holder (seller) wants the payment – a USDT address, a bank account, a PayPal
 * email… one line per payment method of the offer.
 *
 * Who may do what is read from the chain, not taken from the browser:
 *   - write: the KDA holder (SELL offer: its creator; BUY offer: whoever accepted it), only while the trade is
 *     CREATED or ACCEPTED. From FUNDED on the details are locked, so the buyer pays to what they saw.
 *   - read: the KDA holder; the payer once the offer is accepted; the arbiter.
 *
 *   GET /api/offers/:offerId/payout   (wallet, publicKey, signedCmd in the query)
 *   PUT /api/offers/:offerId/payout   { wallet, publicKey, signedCmd, details: [{ method, value }] }
 */
import { hash as blakeHash } from "@kadena/cryptography-utils";

const env = (k, d) => (process.env[k] ?? d);
const cfg = () => ({
  contract: `${env("VITE_CONTRACT_NAMESPACE", "free")}.${env("VITE_CONTRACT_MODULE", "p2p-escrow-v10")}`,
  apis: env("ALERTS_CHAIN_API", "https://api.chainweb-community.org,https://chainweb.chaddex.com,https://api.chainweb.com")
    .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean),
});

export const EDITABLE_STATES = ["CREATED", "ACCEPTED"];
const MAX_ITEMS = 6;

/** One escrow from the chain: { creator, buyer, arbiter, side, state } or null. */
export async function readEscrowFromChain(offerId) {
  const c = cfg();
  const ct = Math.floor(Date.now() / 1000);
  const code = `(${c.contract}.get-escrow ${JSON.stringify(offerId)})`;
  const cmd = JSON.stringify({ networkId: "mainnet01", payload: { exec: { code, data: {} } }, signers: [], meta: { chainId: "1", sender: "", gasLimit: 10000, gasPrice: 1e-8, ttl: 600, creationTime: ct }, nonce: `payout-${ct}-${Math.random()}` });
  const body = JSON.stringify({ cmd, hash: blakeHash(cmd), sigs: [] });
  let last;
  for (const base of c.apis) {
    try {
      const r = await fetch(`${base}/chainweb/0.0/mainnet01/chain/1/pact/api/v1/local?preflight=false&signatureVerification=false`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status} from ${base}`);
      const d = await r.json();
      if (d.result?.status !== "success") return null; // no such offer
      const e = d.result.data || {};
      return { creator: String(e.creator || ""), buyer: String(e.buyer || ""), arbiter: String(e.arbiter || ""), side: String(e.side || "").toUpperCase() === "BUY" ? "BUY" : "SELL", state: String(e.state || "").toUpperCase() };
    } catch (err) { last = err; }
  }
  throw last || new Error("No chain API configured");
}

/** The KDA holder and the payer of an escrow (either may be "" before accept). */
export function sidesOf(e) {
  return e.side === "SELL" ? { holder: e.creator, payer: e.buyer } : { holder: e.buyer, payer: e.creator };
}

// USDT/USDC: the network is chosen separately, and the address must fit it (same list as src/lib/payoutApi.ts)
const EVM = /^0x[0-9a-fA-F]{40}$/;
export const STABLE_NETWORKS = { TRC20: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, ERC20: EVM, BEP20: EVM, Polygon: EVM, Arbitrum: EVM, Solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ };
const isStable = (m) => /^(USDT|USDC)$/i.test(m);

export function cleanDetails(raw) {
  if (!Array.isArray(raw)) return { error: "details must be a list" };
  const out = [];
  for (const it of raw.slice(0, MAX_ITEMS)) {
    const method = String(it?.method ?? "").trim().slice(0, 40);
    const value = String(it?.value ?? "").replace(/\r/g, "").trim();
    if (!method || !value) continue;
    if (value.length > 300) return { error: `${method}: keep it under 300 characters` };
    if (isStable(method)) {
      const network = String(it?.network ?? "");
      const re = STABLE_NETWORKS[network];
      if (!re) return { error: `${method}: choose the network` };
      if (!re.test(value)) return { error: `${method}: that address does not fit the ${network} network` };
      out.push({ method, value, network });
      continue;
    }
    out.push({ method, value });
  }
  if (!out.length) return { error: "Add where you want to be paid for at least one payment method" };
  return { details: out };
}

export function registerPayoutRoutes(app, { getPool, requireAuth, sendAuthError, readEscrow = readEscrowFromChain }) {
  const offerIdOk = (s) => typeof s === "string" && s.length > 0 && s.length <= 255;

  app.get("/api/offers/:offerId/payout", async (req, res) => {
    const auth = requireAuth(req, "query");
    if (!auth.ok) return sendAuthError(res, auth);
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: "Database not ready" });
    const { offerId } = req.params;
    if (!offerIdOk(offerId)) return res.status(400).json({ error: "Invalid offer" });
    try {
      const e = await readEscrow(offerId);
      if (!e) return res.status(404).json({ error: "Offer not found" });
      const { holder, payer } = sidesOf(e);
      const me = auth.wallet;
      const isHolder = !!holder && me === holder;
      const allowed = isHolder || (!!payer && me === payer && e.state !== "CREATED") || me === e.arbiter;
      if (!allowed) return res.status(403).json({ error: "Payment details are shown to the two sides of the trade once it is accepted" });
      const { rows } = await pool.query("SELECT wallet, details, updated_at FROM trade_payouts WHERE offer_id = $1", [offerId]);
      const row = rows[0];
      // details saved by someone who is no longer the holder (e.g. a refunded BUY trade re-accepted) are not shown
      const details = row && row.wallet === holder ? row.details : [];
      return res.json({ details, updatedAt: row && row.wallet === holder ? row.updated_at : null, isMine: isHolder, editable: isHolder && EDITABLE_STATES.includes(e.state), state: e.state });
    } catch (err) {
      console.error("GET /api/offers/:offerId/payout", err);
      return res.status(502).json({ error: "Could not check the offer on the chain. Try again." });
    }
  });

  app.put("/api/offers/:offerId/payout", async (req, res) => {
    const auth = requireAuth(req, "body");
    if (!auth.ok) return sendAuthError(res, auth);
    if (req.body?.wallet !== auth.wallet) return res.status(400).json({ error: "Wallet must match authenticated wallet" });
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: "Database not ready" });
    const { offerId } = req.params;
    if (!offerIdOk(offerId)) return res.status(400).json({ error: "Invalid offer" });
    const c = cleanDetails(req.body?.details);
    if (c.error) return res.status(400).json({ error: c.error });
    try {
      const e = await readEscrow(offerId);
      if (!e) return res.status(404).json({ error: "Offer not found" });
      const { holder } = sidesOf(e);
      if (!holder || holder !== auth.wallet) return res.status(403).json({ error: "Only the side that holds the KDA sets where to be paid" });
      if (!EDITABLE_STATES.includes(e.state)) return res.status(409).json({ error: "The KDA is already locked, so the payment details can no longer change" });
      await pool.query(
        `INSERT INTO trade_payouts (offer_id, wallet, details, updated_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (offer_id) DO UPDATE SET wallet = EXCLUDED.wallet, details = EXCLUDED.details, updated_at = NOW()`,
        [offerId, auth.wallet, JSON.stringify(c.details)]
      );
      return res.json({ ok: true, details: c.details });
    } catch (err) {
      console.error("PUT /api/offers/:offerId/payout", err);
      return res.status(502).json({ error: "Could not save. Try again." });
    }
  });
}
