/**
 * Trade transaction history: every on-chain step of a trade, for both sides, on any device.
 *
 * After the site sends an escrow transaction it posts the signed command here. The command is checked
 * (its hash must be the request key, it must call the escrow contract on mainnet chain 1) and saved as
 * pending; a watcher asks the chain for the result and keeps it only if it succeeded. Nothing here is
 * taken on trust from the browser: the action and the offer come from the signed command itself.
 *
 *   POST /api/trade-txs              { cmd, requestKey }
 *   GET  /api/trades/:offerId/txs    -> [{ requestKey, action, fn, sender, status, at }]
 */
import { hash as blakeHash } from "@kadena/cryptography-utils";

const env = (k, d) => (process.env[k] ?? d);
const cfg = () => ({
  contract: `${env("VITE_CONTRACT_NAMESPACE", "free")}.${env("VITE_CONTRACT_MODULE", "p2p-escrow-v10")}`,
  apis: env("ALERTS_CHAIN_API", "https://api.chainweb-community.org,https://chainweb.chaddex.com,https://api.chainweb.com")
    .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean),
});

/** Contract function -> what people see. */
export const ACTIONS = {
  "create-offer": "Create offer",
  "accept-offer": "Accept",
  "deposit": "Deposit",
  "mark-paid": "Mark paid",
  "release": "Release",
  "refund": "Refund",
  "close-offer": "Close offer",
  "delete-offer": "Delete offer",
  "cancel-accepted-offer": "Cancel",
  "timeout-accepted-close": "Closed: deposit time ran out",
  "timeout-funded-refund": "Refund: payment time ran out",
  "timeout-paid-dispute": "Dispute: release time ran out",
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The escrow call in a signed command, or null when it is something else. */
export function parseEscrowCall(cmd, contract = cfg().contract) {
  let c;
  try { c = JSON.parse(cmd); } catch { return null; }
  if (c?.networkId !== "mainnet01" && c?.networkId !== env("TRADE_TXS_NETWORK", "mainnet01")) return null;
  if (String(c?.meta?.chainId) !== "1") return null;
  const code = c?.payload?.exec?.code;
  if (typeof code !== "string" || code.length > 4000) return null;
  const m = code.match(new RegExp(`\\(\\s*${escapeRe(contract)}\\.([a-z-]+)\\s+"([^"]{1,255})"`));
  if (!m || !ACTIONS[m[1]]) return null;
  const sender = typeof c.meta?.sender === "string" && /^k:[0-9a-f]{64}$/i.test(c.meta.sender) ? c.meta.sender : "";
  return { fn: m[1], offerId: m[2], sender };
}

/** Save a just-sent escrow transaction as pending. Returns { ok } or { error }. */
export async function recordTradeTx(pool, { cmd, requestKey }) {
  if (typeof cmd !== "string" || cmd.length > 20000 || typeof requestKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(requestKey)) {
    return { error: "Invalid transaction" };
  }
  if (blakeHash(cmd) !== requestKey) return { error: "The command does not match the request key" };
  const call = parseEscrowCall(cmd);
  if (!call) return { error: "Not a marketplace escrow transaction" };
  await pool.query(
    `INSERT INTO trade_txs (request_key, offer_id, fn, sender) VALUES ($1, $2, $3, $4) ON CONFLICT (request_key) DO NOTHING`,
    [requestKey, call.offerId, call.fn, call.sender]
  );
  return { ok: true, offerId: call.offerId, fn: call.fn };
}

/** Results for request keys from the chain: { key: { status: "success"|"failure", blockTime } } (missing = not mined yet). */
export async function pollChain(keys) {
  let last;
  for (const base of cfg().apis) {
    try {
      const r = await fetch(`${base}/chainweb/0.0/mainnet01/chain/1/pact/api/v1/poll`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestKeys: keys }), signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} from ${base}`);
      const d = await r.json();
      const out = {};
      for (const [k, v] of Object.entries(d || {})) {
        const t = Number(v?.metaData?.blockTime);
        out[k] = { status: v?.result?.status === "success" ? "success" : "failure", blockTime: Number.isFinite(t) && t > 0 ? new Date(t / 1000) : null };
      }
      return out;
    } catch (e) { last = e; }
  }
  throw last || new Error("No chain API configured");
}

/** One pass: settle pending transactions from the last 30 minutes; give up on older ones. */
export async function settlePending(pool, poll = pollChain) {
  await pool.query(`UPDATE trade_txs SET status = 'unknown' WHERE status = 'pending' AND created_at < NOW() - INTERVAL '30 minutes'`);
  const { rows } = await pool.query(`SELECT request_key FROM trade_txs WHERE status = 'pending' ORDER BY created_at LIMIT 50`);
  if (!rows.length) return 0;
  const res = await poll(rows.map((r) => r.request_key));
  let n = 0;
  for (const [key, v] of Object.entries(res)) {
    await pool.query(`UPDATE trade_txs SET status = $2, block_time = $3 WHERE request_key = $1`, [key, v.status === "success" ? "ok" : "failed", v.blockTime]);
    n++;
  }
  return n;
}

export async function listTradeTxs(pool, offerId) {
  const { rows } = await pool.query(
    `SELECT request_key, fn, sender, status, COALESCE(block_time, created_at) AS at
       FROM trade_txs WHERE offer_id = $1 AND status IN ('ok', 'pending')
      ORDER BY COALESCE(block_time, created_at) ASC, created_at ASC`,
    [offerId]
  );
  return rows.map((r) => ({ requestKey: r.request_key, fn: r.fn, action: ACTIONS[r.fn] || r.fn, sender: r.sender, status: r.status === "ok" ? "confirmed" : "pending", at: r.at }));
}

export function registerTradeTxRoutes(app, getPool) {
  app.post("/api/trade-txs", async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: "Database not ready" });
    try {
      const r = await recordTradeTx(pool, req.body || {});
      if (r.error) return res.status(400).json(r);
      return res.json(r);
    } catch (e) {
      console.error("POST /api/trade-txs", e);
      return res.status(500).json({ error: "Database error" });
    }
  });
  app.get("/api/trades/:offerId/txs", async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: "Database not ready" });
    const offerId = String(req.params.offerId || "");
    if (!offerId || offerId.length > 255) return res.status(400).json({ error: "Invalid offer" });
    try {
      // settle anything still pending for this trade first, so a fresh step shows as confirmed quickly
      const pending = await pool.query(`SELECT 1 FROM trade_txs WHERE offer_id = $1 AND status = 'pending' LIMIT 1`, [offerId]);
      if (pending.rows.length) await settlePending(pool).catch(() => {});
      return res.json(await listTradeTxs(pool, offerId));
    } catch (e) {
      console.error("GET /api/trades/:offerId/txs", e);
      return res.status(500).json({ error: "Database error" });
    }
  });
}

export function startTradeTxWatcher(getPool, everyMs = 15000) {
  const tick = async () => {
    const pool = getPool();
    if (pool) await settlePending(pool).catch((e) => console.warn("[trade-txs]", e.message));
  };
  const t = setInterval(tick, everyMs);
  t.unref?.();
  return t;
}
