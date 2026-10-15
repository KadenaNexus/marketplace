/**
 * Chain reader for escrow v11 (contracts/p2p-escrow-v11.pact, see docs/v11-site-spec.md).
 *
 * A pool is what a creator posts (on chain: "offer"); a trade is a slice someone took. The server reads
 * both with one /local call each and maps the records exactly like src/lib/v11.ts does, so the two layers
 * never disagree about a field. `tradeAsLegacyEscrow` turns a trade into the v10 escrow shape the older
 * modules (notifications, payout, proofs, trust, disputes) consume, so they keep working unchanged.
 *
 * Env: VITE_CONTRACT_NAMESPACE (default free), VITE_CONTRACT_MODULE_V11 (default p2p-escrow-v11),
 *      ALERTS_CHAIN_API (comma-separated Chainweb base URLs; the local demo chain works too).
 * The v10 reader (`fetchChainOffers` in alerts.js) stays as it is, for history.
 */
import { hash as blakeHash } from "@kadena/cryptography-utils";

const env = (k, d) => (process.env[k] && process.env[k].trim() !== "" ? process.env[k].trim() : d);
export const chainConfig = () => ({
  contract: `${env("VITE_CONTRACT_NAMESPACE", "free")}.${env("VITE_CONTRACT_MODULE_V11", "p2p-escrow-v11")}`,
  apis: env("ALERTS_CHAIN_API", "https://api.chainweb-community.org,https://chainweb.chaddex.com,https://api.chainweb.com")
    .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean),
});

/* ---------------- parsing (same rules as src/lib/v11.ts) ---------------- */
/** A Pact number: plain, {int} or {decimal}. Anything else is 0. */
export const pactNumber = (v) => {
  const x = v && typeof v === "object" ? (v.int ?? v.decimal) : v;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};
/** A Pact time ({timep}/{time}/ISO) as an ISO string; EPOCH (1970) means "not set" -> undefined. */
export const pactTime = (v) => {
  const s = v && typeof v === "object" ? (v.timep ?? v.time) : v;
  if (typeof s !== "string" || s.startsWith("1970-01-01")) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
};
const ms = (iso) => (iso ? Date.parse(iso) : null);
const q = (s) => JSON.stringify(String(s));

export function toPool(id, o = {}) {
  return {
    poolId: String(id), creator: String(o.creator ?? ""), side: o.side === "BUY" ? "BUY" : "SELL",
    available: pactNumber(o.available), locked: pactNumber(o.locked), min: pactNumber(o.min), max: pactNumber(o.max),
    price: pactNumber(o.price), currency: String(o.currency ?? ""), token: String(o.token ?? ""),
    payWindow: pactNumber(o["pay-window"]), expiresAt: pactTime(o["expires-at"]), agent: String(o.agent ?? ""),
    state: o.state === "CLOSED" ? "CLOSED" : "OPEN", createdAt: pactTime(o["created-at"]), takes: pactNumber(o.takes),
  };
}
export function toTrade(id, t = {}) {
  return {
    tradeId: String(id), poolId: String(t.offer ?? ""), seller: String(t.seller ?? ""), buyer: String(t.buyer ?? ""),
    amount: pactNumber(t.amount), price: pactNumber(t.price), currency: String(t.currency ?? ""), token: String(t.token ?? ""),
    payAmount: pactNumber(t["pay-amount"]), fee: pactNumber(t.fee), payWindow: pactNumber(t["pay-window"]), agent: String(t.agent ?? ""),
    state: String(t.state ?? "FUNDED").toUpperCase(), fundedAt: pactTime(t["funded-at"]), paidAt: pactTime(t["paid-at"]), closedAt: pactTime(t["closed-at"]),
  };
}
export function toConfig(c = {}) {
  return { arbiter: String(c.arbiter ?? ""), tRelease: pactNumber(c["t-release"]) || 3600, feeBps: pactNumber(c["fee-bps"]), feeAccount: String(c["fee-account"] ?? ""), paused: c.paused === true };
}

/* ---------------- /local with node failover ---------------- */
// Reads go out one at a time: the watchers and routes share one process, and a single Pact server (the local
// demo chain) answers overlapping /local calls with "Unknown exception". Chainweb nodes would not mind.
let queue = Promise.resolve();
const serial = (fn) => { const r = queue.then(fn, fn); queue = r.catch(() => {}); return r; };

/** Run `code` on chain 1 (read only). Tries each node in turn; a Pact error is final (the code is wrong, not the node). */
export function pactLocal(code, opts = {}) { return serial(() => localOnce(code, opts)); }
async function localOnce(code, { api, apis = api ? [api] : chainConfig().apis, gasLimit = 150000 } = {}) {
  const ct = Math.floor(Date.now() / 1000);
  const cmd = JSON.stringify({ networkId: "mainnet01", payload: { exec: { code, data: {} } }, signers: [], meta: { chainId: "1", sender: "", gasLimit, gasPrice: 1e-8, ttl: 600, creationTime: ct }, nonce: `chain-${ct}-${Math.random()}` });
  const body = JSON.stringify({ cmd, hash: blakeHash(cmd), sigs: [] });
  let last;
  for (const base of apis.map((s) => s.replace(/\/$/, ""))) {
    try {
      const r = await fetch(`${base}/chainweb/0.0/mainnet01/chain/1/pact/api/v1/local?preflight=false&signatureVerification=false`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status} from ${base}`);
      const d = await r.json();
      if (d.result?.status !== "success") throw new Error(`Pact error: ${d.result?.error?.message || "unknown"}`);
      return d.result.data;
    } catch (e) { last = e; if (String(e.message).startsWith("Pact error")) throw e; }
  }
  throw new Error(`All Chainweb nodes failed: ${last?.message}`);
}
const isPactError = (e) => String(e?.message || "").startsWith("Pact error");

/* ---------------- reads ---------------- */
/** Open pools, every trade, and the config. Pools a trade refers to that are already closed are fetched too (state CLOSED). */
export async function fetchChain({ api } = {}) {
  const M = chainConfig().contract, opts = { api };
  // one after the other: a single Pact server (the local demo chain) answers parallel reads with "Unknown exception"
  const rawPools = await pactLocal(`(map (lambda (k) {"id": k, "o": (${M}.get-offer k)}) (${M}.list-offer-ids))`, opts);
  const rawTrades = await pactLocal(`(map (lambda (k) {"id": k, "t": (${M}.get-trade k)}) (${M}.list-trade-ids))`, opts);
  const rawConfig = await pactLocal(`(${M}.get-config)`, opts);
  const pools = (rawPools || []).map((x) => toPool(x.id, x.o));
  const trades = (rawTrades || []).map((x) => toTrade(x.id, x.t));
  const known = new Set(pools.map((p) => p.poolId));
  const missing = [...new Set(trades.map((t) => t.poolId).filter((id) => id && !known.has(id)))];
  if (missing.length) {
    // list-offer-ids returns OPEN pools only; trades of closed pools still need their pool (creator, side)
    const more = await pactLocal(`(map (lambda (k) {"id": k, "o": (${M}.get-offer k)}) [${missing.map(q).join(" ")}])`, opts);
    for (const x of more || []) pools.push(toPool(x.id, x.o));
  }
  return { pools, trades, config: toConfig(rawConfig) };
}
export async function readPool(id, opts) {
  try { return toPool(id, await pactLocal(`(${chainConfig().contract}.get-offer ${q(id)})`, opts)); }
  catch (e) { if (isPactError(e)) return null; throw e; }
}
export async function readTrade(id, opts) {
  try { return toTrade(id, await pactLocal(`(${chainConfig().contract}.get-trade ${q(id)})`, opts)); }
  catch (e) { if (isPactError(e)) return null; throw e; }
}
/** One call: the trade, its pool and the config (for the arbiter). null when there is no such trade. */
export async function readTradeWithPool(id, opts) {
  const M = chainConfig().contract;
  try {
    const d = await pactLocal(`(let ((t (${M}.get-trade ${q(id)}))) {"t": t, "o": (${M}.get-offer (at "offer" t)), "c": (${M}.get-config)})`, opts);
    const trade = toTrade(id, d.t);
    return { trade, pool: toPool(trade.poolId, d.o), config: toConfig(d.c) };
  } catch (e) { if (isPactError(e)) return null; throw e; }
}
export async function readConfig(opts) { return toConfig(await pactLocal(`(${chainConfig().contract}.get-config)`, opts)); }

/* ---------------- legacy shape ---------------- */
/**
 * A v11 trade in the v10 escrow shape. `creator` is the pool's creator and `buyer` the other party, so for a
 * SELL pool buyer = the payer (trade.buyer) and for a BUY pool "buyer" = the KDA holder (trade.seller), exactly
 * as v10 recorded an accepted BUY offer. `parties` (notifications.js) and `sidesOf` (payout.js) then stay right.
 * Times are epoch ms (what the deadline math expects); `acceptedAt` = `fundedAt` since a take funds at once.
 */
export function tradeAsLegacyEscrow(t, poolsById = new Map(), arbiter = "") {
  const pool = poolsById instanceof Map ? poolsById.get(t.poolId) : poolsById?.[t.poolId];
  const side = pool ? pool.side : "SELL";
  const creator = pool ? pool.creator : t.seller;
  return {
    id: t.tradeId, poolId: t.poolId, state: t.state, side, amount: t.amount,
    creator, buyer: side === "SELL" ? t.buyer : t.seller, arbiter: arbiter || "",
    acceptedAt: ms(t.fundedAt), fundedAt: ms(t.fundedAt), paidAt: ms(t.paidAt), closedAt: ms(t.closedAt),
    price: t.price, currency: t.currency, token: t.token, payAmount: t.payAmount, payWindow: t.payWindow, agent: t.agent, fee: t.fee,
  };
}
/** Pools keyed by id. */
export const poolsById = (pools) => new Map(pools.map((p) => [p.poolId, p]));
