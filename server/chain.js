/**
 * Chain reader for escrow v11 (contracts/p2p-escrow-v11.pact, see docs/v11-site-spec.md).
 *
 * A pool is what a creator posts (on chain: "offer"); a trade is a slice someone took. The server reads
 * both with one /local call each and maps the records exactly like src/lib/v11.ts does, so the two layers
 * never disagree about a field. `tradeAsLegacyEscrow` turns a trade into the v10 escrow shape the older
 * modules (notifications, payout, proofs, trust, disputes) consume, so they keep working unchanged.
 *
 * The contract runs on chains 1 and 2 (shared/v11-chains.js). Every pool and trade carries `chain`, and its
 * `poolId` / `tradeId` is a reference: "2:pool-…" on chain 2, the bare id on chain 1. Everything built on this reader
 * (pool list, notifications, alerts, feed, the server's tables) keys on those references, so the same id on both
 * chains never clashes, and rows written before chain 2 (bare ids) stay chain 1.
 *
 * Env: VITE_CONTRACT_NAMESPACE (default free), VITE_CONTRACT_MODULE_V11 (default p2p-escrow-v11),
 *      V11_CHAINS (comma-separated, default 1,2),
 *      ALERTS_CHAIN_API (comma-separated Chainweb base URLs; the local demo chain works too).
 * The v10 reader (`fetchChainOffers` in alerts.js) stays as it is, for history (chain 1).
 */
import { hash as blakeHash } from "@kadena/cryptography-utils";
import { V11_CHAINS, parseRef, toRef } from "../shared/v11-chains.js";

export { parseRef, toRef };
const env = (k, d) => (process.env[k] && process.env[k].trim() !== "" ? process.env[k].trim() : d);
export const chainConfig = () => ({
  contract: `${env("VITE_CONTRACT_NAMESPACE", "free")}.${env("VITE_CONTRACT_MODULE_V11", "p2p-escrow-v11")}`,
  chains: env("V11_CHAINS", V11_CHAINS.join(",")).split(",").map((s) => s.trim()).filter(Boolean),
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

/** `id` is the on-chain id; the result's poolId is the reference (chain 1: the id itself). */
export function toPool(id, o = {}, chain = "1") {
  return {
    poolId: toRef(chain, id), chain: String(chain), creator: String(o.creator ?? ""), side: o.side === "BUY" ? "BUY" : "SELL",
    available: pactNumber(o.available), locked: pactNumber(o.locked), min: pactNumber(o.min), max: pactNumber(o.max),
    price: pactNumber(o.price), currency: String(o.currency ?? ""), token: String(o.token ?? ""),
    payWindow: pactNumber(o["pay-window"]), expiresAt: pactTime(o["expires-at"]), agent: String(o.agent ?? ""),
    state: o.state === "CLOSED" ? "CLOSED" : "OPEN", createdAt: pactTime(o["created-at"]), takes: pactNumber(o.takes),
  };
}
export function toTrade(id, t = {}, chain = "1") {
  return {
    tradeId: toRef(chain, id), poolId: toRef(chain, String(t.offer ?? "")), chain: String(chain), seller: String(t.seller ?? ""), buyer: String(t.buyer ?? ""),
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

/** Run `code` on `chain` (default 1; read only). Tries each node in turn; a Pact error is final (the code is wrong, not the node). */
export function pactLocal(code, opts = {}) { return serial(() => localOnce(code, opts)); }
async function localOnce(code, { api, apis = api ? [api] : chainConfig().apis, gasLimit = 150000, chain = "1" } = {}) {
  const ct = Math.floor(Date.now() / 1000);
  const cmd = JSON.stringify({ networkId: "mainnet01", payload: { exec: { code, data: {} } }, signers: [], meta: { chainId: String(chain), sender: "", gasLimit, gasPrice: 1e-8, ttl: 600, creationTime: ct }, nonce: `chain-${ct}-${Math.random()}` });
  const body = JSON.stringify({ cmd, hash: blakeHash(cmd), sigs: [] });
  let last;
  for (const base of apis.map((s) => s.replace(/\/$/, ""))) {
    try {
      const r = await fetch(`${base}/chainweb/0.0/mainnet01/chain/${encodeURIComponent(chain)}/pact/api/v1/local?preflight=false&signatureVerification=false`,
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
/**
 * A Pact error that means "not there": no such row, or the contract is not on this chain. Anything else
 * ("Unknown exception", gas, timeouts inside Pact) is a failed read, not an answer, and must not be
 * mistaken for "no such trade" (that once hid a seller's address from the buyer, and could empty a
 * chain's pools for a cycle).
 */
export const isAbsent = (e) => isPactError(e) && /not found|No value found|Cannot (find|resolve) module|has no such member|row not found|does not exist/i.test(String(e.message));

/* ---------------- reads ---------------- */
/** One chain: open pools, every trade, the config, and the closed pools that trades refer to. */
async function fetchOneChain(chain, opts) {
  const M = chainConfig().contract, o = { ...opts, chain };
  // one after the other: a single Pact server (the local demo chain) answers parallel reads with "Unknown exception"
  const rawPools = await pactLocal(`(map (lambda (k) {"id": k, "o": (${M}.get-offer k)}) (${M}.list-offer-ids))`, o);
  const rawTrades = await pactLocal(`(map (lambda (k) {"id": k, "t": (${M}.get-trade k)}) (${M}.list-trade-ids))`, o);
  const rawConfig = await pactLocal(`(${M}.get-config)`, o);
  const pools = (rawPools || []).map((x) => toPool(x.id, x.o, chain));
  const trades = (rawTrades || []).map((x) => toTrade(x.id, x.t, chain));
  const known = new Set(pools.map((p) => p.poolId));
  const missing = [...new Set(trades.map((t) => t.poolId).filter((id) => id && !known.has(id)))].map((ref) => parseRef(ref).id);
  if (missing.length) {
    // list-offer-ids returns OPEN pools only; trades of closed pools still need their pool (creator, side)
    const more = await pactLocal(`(map (lambda (k) {"id": k, "o": (${M}.get-offer k)}) [${missing.map(q).join(" ")}])`, o);
    for (const x of more || []) pools.push(toPool(x.id, x.o, chain));
  }
  return { pools, trades, config: toConfig(rawConfig) };
}

/**
 * Open pools, every trade and the config of every v11 chain (V11_CHAINS). `config` is the first chain's (same
 * governance everywhere), `configs` each chain's. A chain whose contract is not there yet (a Pact error) counts as
 * empty; a chain the nodes cannot reach throws, so the caller keeps its last good read instead of losing trades.
 */
export async function fetchChain({ api, chains = chainConfig().chains } = {}) {
  const pools = [], trades = [], configs = {};
  let lastPactError = null;
  for (const chain of chains) {
    let r;
    try { r = await fetchOneChain(chain, { api }); }
    catch (e) { if (!isAbsent(e)) throw e; console.warn(`[chain] v11 on chain ${chain}:`, e.message); lastPactError = e; continue; }
    pools.push(...r.pools); trades.push(...r.trades); configs[chain] = r.config;
  }
  if (lastPactError && !Object.keys(configs).length) throw lastPactError; // not on any chain: a setup error, not "no trades"
  const config = configs[chains[0]] ?? Object.values(configs)[0] ?? toConfig({});
  return { pools, trades, config, configs };
}
/** The config that applies to a pool or trade of `chain` in a fetchChain() result. */
export const configFor = (c, chain) => c?.configs?.[chain] ?? c?.config ?? toConfig({});

/** A pool by reference ("2:pool-…" or a chain-1 id). null when there is no such pool. */
export async function readPool(ref, opts) {
  const { chain, id } = parseRef(ref);
  try { return toPool(id, await pactLocal(`(${chainConfig().contract}.get-offer ${q(id)})`, { ...opts, chain }), chain); }
  catch (e) { if (isAbsent(e)) return null; throw e; }
}
export async function readTrade(ref, opts) {
  const { chain, id } = parseRef(ref);
  try { return toTrade(id, await pactLocal(`(${chainConfig().contract}.get-trade ${q(id)})`, { ...opts, chain }), chain); }
  catch (e) { if (isAbsent(e)) return null; throw e; }
}
/** One call on the trade's chain: the trade, its pool and that chain's config (for the arbiter). null when there is no such trade. */
export async function readTradeWithPool(ref, opts) {
  const M = chainConfig().contract;
  const { chain, id } = parseRef(ref);
  try {
    const d = await pactLocal(`(let ((t (${M}.get-trade ${q(id)}))) {"t": t, "o": (${M}.get-offer (at "offer" t)), "c": (${M}.get-config)})`, { ...opts, chain });
    const trade = toTrade(id, d.t, chain);
    return { trade, pool: toPool(parseRef(trade.poolId).id, d.o, chain), config: toConfig(d.c) };
  } catch (e) { if (isAbsent(e)) return null; throw e; }
}
export async function readConfig(opts = {}) { return toConfig(await pactLocal(`(${chainConfig().contract}.get-config)`, { ...opts, chain: opts.chain ?? chainConfig().chains[0] ?? "1" })); }

/* ---------------- legacy shape ---------------- */
/**
 * A v11 trade in the v10 escrow shape. `creator` is the pool's creator and `buyer` the other party, so for a
 * SELL pool buyer = the payer (trade.buyer) and for a BUY pool "buyer" = the KDA holder (trade.seller), exactly
 * as v10 recorded an accepted BUY offer. `parties` (notifications.js) and `sidesOf` (payout.js) then stay right.
 * Times are epoch ms (what the deadline math expects); `acceptedAt` = `fundedAt` since a take funds at once.
 * `arbiter` is the arbiter's account, or the trade chain's config (then `tRelease` comes along too).
 */
export function tradeAsLegacyEscrow(t, poolsById = new Map(), arbiter = "") {
  const pool = poolsById instanceof Map ? poolsById.get(t.poolId) : poolsById?.[t.poolId];
  const side = pool ? pool.side : "SELL";
  const creator = pool ? pool.creator : t.seller;
  const cfg = arbiter && typeof arbiter === "object" ? arbiter : null;
  return {
    id: t.tradeId, poolId: t.poolId, chain: t.chain || "1", state: t.state, side, amount: t.amount,
    creator, buyer: side === "SELL" ? t.buyer : t.seller, arbiter: (cfg ? cfg.arbiter : arbiter) || "",
    ...(cfg && cfg.tRelease ? { tRelease: cfg.tRelease } : {}),
    acceptedAt: ms(t.fundedAt), fundedAt: ms(t.fundedAt), paidAt: ms(t.paidAt), closedAt: ms(t.closedAt),
    price: t.price, currency: t.currency, token: t.token, payAmount: t.payAmount, payWindow: t.payWindow, agent: t.agent, fee: t.fee,
  };
}
/** Pools keyed by reference. */
export const poolsById = (pools) => new Map(pools.map((p) => [p.poolId, p]));
