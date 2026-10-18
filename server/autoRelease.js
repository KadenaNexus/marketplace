/**
 * Auto-release for USDT/USDC trades (escrow v11, contracts/p2p-escrow-v11.pact).
 *
 * An offer can name the platform's release agent (config `agent`, set by governance); its trades snapshot it at take.
 * For such a trade the buyer is asked to send the contract's pay-amount plus a small extra of 1–999 micro-units
 * (0.533 -> 0.533017), unique among the open auto trades paying the same address on the same network. This server
 * watches the seller's receiving address on Tron (TronGrid) and Ethereum (Etherscan); when a transfer of exactly that
 * amount of the official token arrives in the trade's time window, it re-reads the trade on chain and calls
 * `release` signed by the agent. The seller can still release; anything that does not match exactly is left to the
 * manual flow. Nothing here can send KDA anywhere but to the trade's buyer: that is all `release` does.
 *
 * Tables (schema.sql): auto_release (one row per trade) and auto_release_watch (the address snapshot per network).
 * Status: watching -> matched -> releasing -> released; or manual (the trade left the auto path: disputed, released
 * by the seller, address changed, agent not ours) / expired (closed without a match, or the window passed).
 *
 *   GET /api/v11/auto-release              -> { enabled, agent, networks }                   (public)
 *   GET /api/v11/trades/:ref/auto          (wallet, publicKey, signedCmd in the query; the two sides and the arbiter)
 *     -> { enabled, reason?, amount, currency, networks: [{ id, address }], notWatched, status, matchedTx, ... }
 *
 * Env: AUTO_RELEASE_SECRET (ed25519 secret key, 64 hex; unset = off), TRONGRID_API, TRONGRID_API_KEY,
 *      ETHERSCAN_API, ETHERSCAN_API_KEY (needed for the Ethereum networks), CHAINWEB_NETWORK_ID (default mainnet01),
 *      AUTO_RELEASE_INTERVAL_MS (default 30000), VITE_DEMO_TIME=1 (local demo chain only). The secret is never logged.
 */
import crypto from "node:crypto";
import { hash as blakeHash, restoreKeyPairFromSecretKey, signHash } from "@kadena/cryptography-utils";
import { chainConfig, configFor, fetchChain, parseRef, toConfig, toPool, toTrade } from "./chain.js";
import { createChainCache } from "./trust.js";
import { NETWORKS as ADDRESS_SHAPES } from "./pools.js";
import { currencyInfo } from "../shared/v11-chains.js";

/** The networks auto-release can watch, with the only token contract accepted on each. */
export const AUTO_NETWORKS = {
  "USDT:TRC20": { kind: "tron", contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6 },
  "USDT:ERC20": { kind: "erc20", contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
  "USDC:ERC20": { kind: "erc20", contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
};
export const OPEN_STATUSES = ["watching", "matched", "releasing"];
export const EARLY_MS = 2 * 60 * 1000;        // a transfer may be stamped a little before the take
export const GRACE_MS = 15 * 60 * 1000;       // and arrive a little after the deadline
export const ERC20_CONFIRMATIONS = 12;
export const RELEASE_TTL = 600;               // seconds a release transaction can land; never resent before that
const FETCH_TIMEOUT_MS = 10000;
const MAX_SEND_ATTEMPTS = 5;
const OFFSET_TRIES = 25;
const ACTIVE = ["FUNDED", "PAID"];
const CLOSED = ["COMPLETED", "REFUNDED", "CANCELLED", "SPLIT"];

/* ---------------- config ---------------- */

/**
 * Read the env. The secret stays inside `sign` (a closure); the returned object holds no key material, so logging
 * it is safe.
 */
export function autoReleaseConfig(env = process.env) {
  const v = (k, d = "") => (env[k] != null && String(env[k]).trim() !== "" ? String(env[k]).trim() : d);
  const secret = v("AUTO_RELEASE_SECRET");
  const off = (reason) => ({ enabled: false, reason, agent: "", networks: [], notWatched: Object.keys(AUTO_NETWORKS) });
  if (!secret) return off("Auto-release is not configured on this server");
  if (!/^[0-9a-fA-F]{64}$/.test(secret)) return off("AUTO_RELEASE_SECRET must be 64 hex characters");
  let kp;
  try { kp = restoreKeyPairFromSecretKey(secret.toLowerCase()); } catch { return off("AUTO_RELEASE_SECRET is not a valid key"); }
  const pair = { publicKey: kp.publicKey, secretKey: kp.secretKey };
  const ethKey = v("ETHERSCAN_API_KEY");
  const networks = Object.keys(AUTO_NETWORKS).filter((n) => AUTO_NETWORKS[n].kind === "tron" || !!ethKey);
  const interval = Number(v("AUTO_RELEASE_INTERVAL_MS", "30000"));
  return {
    enabled: true,
    agent: `k:${kp.publicKey}`,
    publicKey: kp.publicKey,
    sign: (h) => signHash(h, pair).sig,
    networks,
    notWatched: Object.keys(AUTO_NETWORKS).filter((n) => !networks.includes(n)),
    tronApi: v("TRONGRID_API", "https://api.trongrid.io").replace(/\/$/, ""),
    tronKey: v("TRONGRID_API_KEY"),
    ethApi: v("ETHERSCAN_API", "https://api.etherscan.io/v2/api"),
    ethKey,
    networkId: v("CHAINWEB_NETWORK_ID", "mainnet01"),
    demoTime: v("VITE_DEMO_TIME") === "1",
    intervalMs: Number.isFinite(interval) && interval >= 1000 ? interval : 30000,
  };
}

/* ---------------- amounts and addresses ---------------- */

/** 0.533 -> 533000n (6 decimals; the contract rounds pay-amount to 6). */
export const toUnits6 = (n) => BigInt(Math.round(Number(n) * 1e6));
/** 533017n -> "0.533017" (always 6 decimals, so the buyer sees every digit to send) */
export const fromUnits6 = (u) => { const s = BigInt(u).toString().padStart(7, "0"); return `${s.slice(0, -6)}.${s.slice(-6)}`; };
/** How an address is compared: Ethereum is case-insensitive, Tron (base58) is not. */
export const addressKey = (network, address) => (AUTO_NETWORKS[network]?.kind === "erc20" ? String(address).toLowerCase() : String(address));
const sameContract = (network, contract) => {
  const n = AUTO_NETWORKS[network];
  if (!n || !contract) return false;
  return n.kind === "erc20" ? String(contract).toLowerCase() === n.contract.toLowerCase() : String(contract) === n.contract;
};

/** The deadline that applies now: the payment window while FUNDED, the release window after mark-paid. */
export function tradeDeadline(trade, tRelease = 3600) {
  if (trade.state === "PAID" && trade.paidAt) return Date.parse(trade.paidAt) + (tRelease || 3600) * 1000;
  return Date.parse(trade.fundedAt) + trade.payWindow * 1000;
}

/**
 * Does one incoming transfer pay one watched trade? Every condition must hold: the official token contract, the
 * snapshot address, exactly the expected base units, stamped from funded_at − 2 min to deadline + 15 min, and on
 * Ethereum at least 12 confirmations. (The tx hash being unused is checked by the caller and the DB.)
 *   row: { funded_at, deadline }, watch: { network, address_key, expected_units }
 *   tr:  { network, txid, contract, to, value (string|bigint), timeMs, confirmations?, confirmed? }
 */
export function transferMatches(row, watch, tr) {
  if (!tr || tr.network !== watch.network) return false;
  if (!sameContract(watch.network, tr.contract)) return false;
  if (addressKey(watch.network, tr.to) !== watch.address_key) return false;
  let value;
  try { value = BigInt(String(tr.value)); } catch { return false; }
  if (value !== BigInt(watch.expected_units)) return false;
  const t = Number(tr.timeMs);
  if (!Number.isFinite(t)) return false;
  if (t < new Date(row.funded_at).getTime() - EARLY_MS) return false;
  if (t > new Date(row.deadline).getTime() + GRACE_MS) return false;
  if (AUTO_NETWORKS[watch.network].kind === "erc20" && !(Number(tr.confirmations) >= ERC20_CONFIRMATIONS)) return false;
  if (AUTO_NETWORKS[watch.network].kind === "tron" && tr.confirmed === false) return false;
  return !!tr.txid;
}

/* ---------------- the service ---------------- */

/**
 * Everything external is injectable: `fetchFn` (TronGrid, Etherscan and Chainweb /local, /send, /poll), `chain` (the
 * cached read of every v11 trade, for making rows proactively), `now`.
 */
export function createAutoRelease({
  getPool,
  config = autoReleaseConfig(),
  fetchFn = (...a) => globalThis.fetch(...a),
  now = () => Date.now(),
  chain = createChainCache({ fetchOffers: fetchChain, freshMs: 15 * 1000 }),
  apis = chainConfig().apis,
  contract = chainConfig().contract,
  log = console,
  /** (tradeRef, status) when a payment is found or the release lands, so open pages can refresh */
  onChange = () => {},
} = {}) {
  const db = () => getPool();
  const timed = (url, opts = {}) => fetchFn(url, { ...opts, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const chainUrl = (base, chainId, path) => `${base.replace(/\/$/, "")}/chainweb/0.0/${config.networkId || "mainnet01"}/chain/${encodeURIComponent(chainId)}/pact/api/v1/${path}`;

  /* ----- chain ----- */

  /** /local on the trade's chain: the trade, its pool and that chain's config. null when there is no such trade. */
  async function readTrade(ref) {
    const { chain: c, id } = parseRef(ref);
    const q = JSON.stringify(id);
    const code = `(let ((t (${contract}.get-trade ${q}))) {"t": t, "o": (${contract}.get-offer (at "offer" t)), "c": (${contract}.get-config)})`;
    const ct = Math.floor(now() / 1000);
    const cmd = JSON.stringify({ networkId: config.networkId || "mainnet01", payload: { exec: { code, data: {} } }, signers: [], meta: { chainId: String(c), sender: "", gasLimit: 150000, gasPrice: 1e-8, ttl: 600, creationTime: ct }, nonce: `auto-read-${ct}-${Math.random()}` });
    const body = JSON.stringify({ cmd, hash: blakeHash(cmd), sigs: [] });
    let last;
    for (const base of apis) {
      try {
        const r = await timed(`${chainUrl(base, c, "local")}?preflight=false&signatureVerification=false`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (d.result?.status !== "success") {
          const msg = String(d.result?.error?.message || "unknown");
          if (/not found|No value found|row not found/i.test(msg)) return null;
          throw Object.assign(new Error(`Pact error: ${msg}`), { pact: true });
        }
        const trade = toTrade(id, d.result.data.t, c);
        return { trade, pool: toPool(parseRef(trade.poolId).id, d.result.data.o, c), config: toConfig(d.result.data.c) };
      } catch (e) { last = e; if (e.pact) throw e; }
    }
    throw new Error(`Chain read failed: ${last?.message}`);
  }

  /** The release transaction, signed by the agent: capabilities coin.GAS and ACCOUNT_AUTH(agent), gas paid by the agent. */
  function buildRelease(ref) {
    const { chain: c, id } = parseRef(ref);
    const ms = now();
    const creationTime = Math.floor(ms / 1000) - 30; // a little in the past, like wallets, for clock skew between nodes
    const data = config.demoTime ? { "demo-now": new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z") } : {};
    const cmd = JSON.stringify({
      networkId: config.networkId || "mainnet01",
      payload: { exec: { code: `(${contract}.release ${JSON.stringify(id)})`, data } },
      signers: [{ pubKey: config.publicKey, clist: [{ name: "coin.GAS", args: [] }, { name: `${contract}.ACCOUNT_AUTH`, args: [config.agent] }] }],
      meta: { chainId: String(c), sender: config.agent, gasLimit: 9000, gasPrice: 1e-8, ttl: RELEASE_TTL, creationTime },
      nonce: `auto-release:${id}:${ms}`,
    });
    const hash = blakeHash(cmd);
    return { chain: String(c), hash, expiresAt: new Date((creationTime + RELEASE_TTL) * 1000), body: JSON.stringify({ cmds: [{ hash, sigs: [{ sig: config.sign(hash) }], cmd }] }) };
  }

  /** "sent" (a node took it), "rejected" (every node answered no: it cannot land) or "unknown" (some node did not answer). */
  async function send(tx) {
    let unknown = false, lastErr = "";
    for (const base of apis) {
      try {
        const r = await timed(chainUrl(base, tx.chain, "send"), { method: "POST", headers: { "Content-Type": "application/json" }, body: tx.body });
        const text = await r.text();
        if (r.ok) return { outcome: "sent" };
        lastErr = `HTTP ${r.status}: ${text.slice(0, 200)}`;
      } catch (e) { unknown = true; lastErr = String(e.message || e); }
    }
    return { outcome: unknown ? "unknown" : "rejected", error: lastErr };
  }

  /** { status: "success" | "failure" | "pending", error? }; throws when no node answers. */
  async function poll(chainId, key) {
    let answered = false, last;
    for (const base of apis) {
      try {
        const r = await timed(chainUrl(base, chainId, "poll"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestKeys: [key] }) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        answered = true;
        const res = d?.[key]?.result;
        if (res?.status === "success") return { status: "success" };
        if (res?.status === "failure") return { status: "failure", error: String(res.error?.message || "failed on chain").slice(0, 300) };
      } catch (e) { last = e; }
    }
    if (!answered) throw new Error(`Poll failed: ${last?.message}`);
    return { status: "pending" };
  }

  /* ----- token transfers ----- */

  /** Incoming transfers of the network's official token to `address` since `sinceMs`, normalized. */
  async function fetchTransfers(network, address, sinceMs) {
    const n = AUTO_NETWORKS[network];
    if (n.kind === "tron") {
      const q = new URLSearchParams({ only_to: "true", only_confirmed: "true", contract_address: n.contract, min_timestamp: String(Math.max(0, Math.floor(sinceMs))), limit: "200" });
      const r = await timed(`${config.tronApi}/v1/accounts/${encodeURIComponent(address)}/transactions/trc20?${q}`, { headers: config.tronKey ? { "TRON-PRO-API-KEY": config.tronKey } : {} });
      if (!r.ok) throw new Error(`TronGrid HTTP ${r.status}`);
      const d = await r.json();
      if (d?.success === false) throw new Error(`TronGrid: ${String(d.error || "error").slice(0, 120)}`);
      return (Array.isArray(d?.data) ? d.data : []).filter((x) => !x.type || x.type === "Transfer").map((x) => ({
        network, txid: String(x.transaction_id || ""), contract: x.token_info?.address, to: x.to, from: x.from, value: String(x.value ?? ""),
        timeMs: Number(x.block_timestamp), confirmed: true,
      }));
    }
    const q = new URLSearchParams({ chainid: "1", module: "account", action: "tokentx", contractaddress: n.contract, address, startblock: "0", page: "1", offset: "200", sort: "desc", apikey: config.ethKey });
    const r = await timed(`${config.ethApi}?${q}`);
    if (!r.ok) throw new Error(`Etherscan HTTP ${r.status}`);
    const d = await r.json();
    if (!Array.isArray(d?.result)) throw new Error(`Etherscan: ${String(d?.result || d?.message || "error").slice(0, 120)}`);
    return d.result.map((x) => ({
      network, txid: String(x.hash || ""), contract: x.contractAddress, to: x.to, from: x.from, value: String(x.value ?? ""),
      timeMs: Number(x.timeStamp) * 1000, confirmations: Number(x.confirmations),
    }));
  }

  /* ----- rows ----- */

  const isOffchain = (t) => !t.token && currencyInfo(t.currency)?.kind === "offchain";

  /** Why this trade cannot be auto-released (null = it can). */
  function disqualify(trade) {
    if (!config.enabled) return config.reason;
    if (!ACTIVE.includes(trade.state)) return "The trade is not waiting for payment";
    if (!trade.agent || trade.agent !== config.agent) return "This offer does not use auto-release";
    if (!isOffchain(trade)) return "Auto-release is for USDT and USDC paid outside Kadena";
    if (!(trade.payAmount > 0) || !trade.fundedAt) return "Nothing to pay";
    return null;
  }

  /** The seller's receiving address per watched network of the trade's currency, read now from the server's tables. */
  async function currentAddresses(trade, pool) {
    const out = {};
    const want = (n) => n.startsWith(`${trade.currency}:`) && config.networks.includes(n);
    if (pool?.side === "BUY") {
      // the taker (KDA holder) said where to be paid after the take (server/payout.js)
      const r = (await db().query("SELECT wallet, details FROM trade_payouts WHERE offer_id = $1", [trade.tradeId])).rows[0];
      if (!r || r.wallet !== trade.seller) return out;
      for (const d of Array.isArray(r.details) ? r.details : []) {
        const n = `${String(d.method || "").toUpperCase()}:${d.network}`;
        if (want(n) && ADDRESS_SHAPES[n]?.test(String(d.value || "")) && !out[n]) out[n] = String(d.value);
      }
      return out;
    }
    // a SELL pool: the creator's addresses on the pool (server/pools.js)
    const r = (await db().query("SELECT creator, networks, payout FROM pool_details WHERE pool_id = $1", [trade.poolId])).rows[0];
    if (!r || r.creator !== trade.seller) return out;
    for (const n of Array.isArray(r.networks) ? r.networks : []) {
      const a = r.payout?.[n];
      if (want(n) && a && ADDRESS_SHAPES[n]?.test(String(a))) out[n] = String(a);
    }
    return out;
  }

  const loadRow = async (ref) => {
    const row = (await db().query("SELECT * FROM auto_release WHERE trade_ref = $1", [ref])).rows[0];
    if (!row) return null;
    row.watches = (await db().query("SELECT * FROM auto_release_watch WHERE trade_ref = $1 ORDER BY network", [ref])).rows;
    return row;
  };

  /** Close a row: it stops being watched and its offset is free again. */
  async function finish(ref, status, fields = {}) {
    const sets = ["status = $2", "updated_at = now()"], vals = [ref, status];
    for (const [k, v] of Object.entries(fields)) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
    await db().query(`UPDATE auto_release SET ${sets.join(", ")} WHERE trade_ref = $1`, vals);
    if (!OPEN_STATUSES.includes(status)) await db().query("UPDATE auto_release_watch SET open = false WHERE trade_ref = $1", [ref]);
  }

  /**
   * The trade's row, made now if the trade qualifies: a random offset unique among the open trades paying the same
   * address on the same network (enforced by the unique indexes; a clash picks again). { row } or { reason }.
   */
  async function ensureRow(trade, pool, cfg) {
    const existing = await loadRow(trade.tradeId);
    if (existing) return { row: existing };
    const why = disqualify(trade);
    if (why) return { reason: why };
    const addrs = await currentAddresses(trade, pool);
    const nets = Object.keys(addrs);
    if (!nets.length) {
      return { reason: pool?.side === "BUY" ? "The seller has not said where to be paid yet" : "No receiving address on a network auto-release watches" };
    }
    const payUnits = toUnits6(trade.payAmount);
    const deadline = new Date(tradeDeadline(trade, cfg?.tRelease));
    for (let i = 0; i < OFFSET_TRIES; i++) {
      const offset = crypto.randomInt(1, 1000);
      const expected = (payUnits + BigInt(offset)).toString();
      const client = await db().connect();
      try {
        await client.query("BEGIN");
        const ins = await client.query(
          `INSERT INTO auto_release (trade_ref, chain, pool_ref, agent, currency, pay_units, amount_offset, expected_units, funded_at, deadline)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (trade_ref) DO NOTHING`,
          [trade.tradeId, trade.chain, trade.poolId, trade.agent, trade.currency, payUnits.toString(), offset, expected, new Date(trade.fundedAt), deadline]);
        if (ins.rowCount === 0) { await client.query("ROLLBACK"); return { row: await loadRow(trade.tradeId) }; } // made by a parallel request
        for (const n of nets) {
          await client.query("INSERT INTO auto_release_watch (trade_ref, network, address, address_key, amount_offset, expected_units) VALUES ($1, $2, $3, $4, $5, $6)",
            [trade.tradeId, n, addrs[n], addressKey(n, addrs[n]), offset, expected]);
        }
        await client.query("COMMIT");
        return { row: await loadRow(trade.tradeId) };
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        if (e.code !== "23505") throw e; // unique violation: that offset or amount is taken on this address, pick again
      } finally { client.release(); }
    }
    return { reason: "Too many open auto-release trades on this address right now" };
  }

  /** What the endpoint shows. */
  function view(row) {
    const watching = row.watches.filter((w) => w.open || row.status === "released" || row.matched_network === w.network);
    return {
      // a row means this trade is on the auto path; `status` says where it is (manual/expired: it left it, see `reason`)
      enabled: true,
      amount: fromUnits6(row.expected_units),
      payAmount: fromUnits6(row.pay_units),
      currency: row.currency,
      networks: watching.map((w) => ({ id: w.network, address: w.address })),
      notWatched: config.notWatched.filter((n) => n.startsWith(`${row.currency}:`)),
      status: row.status,
      matchedTx: row.matched_tx || null,
      matchedNetwork: row.matched_network || null,
      releaseRequestKey: row.release_request_key || null,
      deadline: new Date(row.deadline).toISOString(),
      agent: row.agent,
      ...(row.status === "manual" || row.status === "expired" ? { reason: row.last_error || null } : {}),
    };
  }

  /**
   * Keep a row in step with the chain and the server's tables: closed or disputed trades stop being watched, the
   * deadline follows mark-paid, and a network whose receiving address changed is no longer watched.
   */
  async function housekeep(row, trade, cfg, pool) {
    if (!OPEN_STATUSES.includes(row.status)) return row.status;
    if (row.status === "watching") {
      if (trade.state === "DISPUTED") { await finish(row.trade_ref, "manual", { last_error: "The trade is in dispute" }); return "manual"; }
      if (trade.state === "COMPLETED") { await finish(row.trade_ref, "manual", { last_error: "Released by the seller" }); return "manual"; }
      if (CLOSED.includes(trade.state)) { await finish(row.trade_ref, "expired", { last_error: `The trade was ${trade.state.toLowerCase()}` }); return "expired"; }
      if (trade.agent !== config.agent) { await finish(row.trade_ref, "manual", { last_error: "The trade's agent is not this server's" }); return "manual"; }
      const d = new Date(tradeDeadline(trade, cfg?.tRelease));
      if (d.getTime() !== new Date(row.deadline).getTime()) { await db().query("UPDATE auto_release SET deadline = $2, updated_at = now() WHERE trade_ref = $1", [row.trade_ref, d]); row.deadline = d; }
      const now_ = await currentAddresses(trade, pool);
      for (const w of row.watches.filter((x) => x.open)) {
        if (now_[w.network] !== w.address) {
          await db().query("UPDATE auto_release_watch SET open = false WHERE trade_ref = $1 AND network = $2", [row.trade_ref, w.network]);
          w.open = false;
        }
      }
      if (!row.watches.some((w) => w.open)) { await finish(row.trade_ref, "manual", { last_error: "The receiving address changed after the trade started" }); return "manual"; }
    }
    return row.status;
  }

  /**
   * One step of releasing a matched row. Re-reads the trade first; never sends while an earlier request may still
   * land (its TTL), and only to a trade that is FUNDED or PAID with our agent.
   */
  async function releaseStep(ref) {
    const row = await loadRow(ref);
    if (!row || !["matched", "releasing"].includes(row.status)) return row?.status;
    let fresh;
    try { fresh = await readTrade(ref); } catch (e) { await db().query("UPDATE auto_release SET last_error = $2, updated_at = now() WHERE trade_ref = $1", [ref, String(e.message).slice(0, 300)]); return row.status; }
    if (!fresh) { await finish(ref, "manual", { last_error: "Trade not found on the chain" }); return "manual"; }
    const t = fresh.trade;
    if (row.release_request_key) {
      let p;
      try { p = await poll(row.chain, row.release_request_key); } catch { return row.status; } // no node answered: ask again next round
      if (p.status === "success") { await finish(ref, "released"); log.log?.(`[auto-release] ${ref} released (${row.release_request_key})`); onChange(ref, "released"); return "released"; }
      if (p.status === "pending" && now() < new Date(row.release_expires_at).getTime() + 60 * 1000) return row.status; // may still land
      // failed on chain, or its TTL passed without it landing: it can never land now
      await db().query("UPDATE auto_release SET release_request_key = NULL, release_expires_at = NULL, last_error = $2, updated_at = now() WHERE trade_ref = $1",
        [ref, p.status === "failure" ? `Release failed: ${p.error}` : "Release did not land in time"]);
    }
    if (t.state === "COMPLETED") { await finish(ref, "manual", { last_error: "Released by the seller" }); return "manual"; }
    if (t.state === "DISPUTED") { await finish(ref, "manual", { last_error: "The trade is in dispute" }); return "manual"; }
    if (!ACTIVE.includes(t.state)) { await finish(ref, "expired", { last_error: `The trade was ${t.state.toLowerCase()}` }); return "expired"; }
    if (t.agent !== config.agent) { await finish(ref, "manual", { last_error: "The trade's agent is not this server's" }); return "manual"; }
    if (row.release_attempts >= MAX_SEND_ATTEMPTS) { await finish(ref, "manual", { last_error: `Gave up after ${row.release_attempts} release attempts` }); return "manual"; }
    const tx = buildRelease(ref);
    // recorded before sending: if this process stops right after /send, the next run polls instead of sending again
    await db().query("UPDATE auto_release SET status = 'releasing', release_request_key = $2, release_expires_at = $3, release_attempts = release_attempts + 1, updated_at = now() WHERE trade_ref = $1",
      [ref, tx.hash, tx.expiresAt]);
    const s = await send(tx);
    if (s.outcome === "rejected") {
      await db().query("UPDATE auto_release SET release_request_key = NULL, release_expires_at = NULL, last_error = $2, updated_at = now() WHERE trade_ref = $1", [ref, `Send rejected: ${s.error}`.slice(0, 300)]);
      log.warn?.(`[auto-release] ${ref}: send rejected: ${s.error}`);
    } else if (s.outcome === "unknown") {
      await db().query("UPDATE auto_release SET last_error = $2, updated_at = now() WHERE trade_ref = $1", [ref, `Send unanswered: ${s.error}`.slice(0, 300)]);
    } else {
      log.log?.(`[auto-release] ${ref}: release sent (${tx.hash})`);
    }
    return "releasing";
  }

  /** Match transfers to the watching rows, grouped by network + address (one request per address). */
  async function matchTransfers(rows) {
    const groups = new Map();
    for (const row of rows.filter((r) => r.status === "watching")) {
      for (const w of row.watches.filter((x) => x.open && config.networks.includes(x.network))) {
        const k = `${w.network}|${w.address_key}`;
        if (!groups.has(k)) groups.set(k, { network: w.network, address: w.address, items: [] });
        groups.get(k).items.push({ row, w });
      }
    }
    const matched = [], unchecked = new Set();
    for (const g of groups.values()) {
      const since = Math.min(...g.items.map((x) => new Date(x.row.funded_at).getTime())) - EARLY_MS;
      let transfers;
      try { transfers = await fetchTransfers(g.network, g.address, since); }
      catch (e) { log.warn?.(`[auto-release] ${g.network} ${g.address}: ${e.message}`); g.items.forEach((x) => unchecked.add(x.row.trade_ref)); continue; }
      transfers.sort((a, b) => a.timeMs - b.timeMs);
      for (const tr of transfers) {
        const hit = g.items.find((x) => x.row.status === "watching" && transferMatches(x.row, x.w, tr));
        if (!hit) continue;
        const used = (await db().query("SELECT 1 FROM auto_release WHERE matched_tx = $1", [tr.txid])).rowCount > 0;
        if (used) continue;
        try {
          const u = await db().query(
            "UPDATE auto_release SET status = 'matched', matched_tx = $2, matched_network = $3, matched_at = now(), updated_at = now() WHERE trade_ref = $1 AND status = 'watching'",
            [hit.row.trade_ref, tr.txid, g.network]);
          if (u.rowCount) { hit.row.status = "matched"; matched.push(hit.row.trade_ref); log.log?.(`[auto-release] ${hit.row.trade_ref}: payment ${tr.txid} on ${g.network}`); onChange(hit.row.trade_ref, "matched"); }
        } catch (e) { if (e.code !== "23505") throw e; } // the tx hash was just used by another row
      }
    }
    return { matched, unchecked };
  }

  let running = false;
  /** One round. Returns a small summary (for tests and logs). */
  async function tick() {
    if (!config.enabled || running) return { skipped: true };
    running = true;
    const out = { created: 0, matched: [], released: [] };
    try {
      // 1. rows for qualifying open trades nobody opened yet, and rows in step with the chain
      let snap = null;
      try { snap = await chain(); } catch (e) { log.warn?.("[auto-release] chain read:", e.message); }
      if (snap) {
        const pools = new Map((snap.pools || []).map((p) => [p.poolId, p]));
        const have = new Set((await db().query("SELECT trade_ref FROM auto_release")).rows.map((r) => r.trade_ref));
        for (const t of snap.trades || []) {
          if (have.has(t.tradeId) || disqualify(t)) continue;
          try { const r = await ensureRow(t, pools.get(t.poolId), configFor(snap, t.chain)); if (r.row) out.created++; }
          catch (e) { log.warn?.(`[auto-release] ${t.tradeId}: ${e.message}`); }
        }
        const byId = new Map((snap.trades || []).map((t) => [t.tradeId, t]));
        const open = (await db().query("SELECT trade_ref FROM auto_release WHERE status = 'watching'")).rows;
        for (const { trade_ref } of open) {
          const t = byId.get(trade_ref);
          if (!t) continue; // not in the cached read (just taken): leave it
          const row = await loadRow(trade_ref);
          await housekeep(row, t, configFor(snap, t.chain), pools.get(t.poolId));
        }
      }
      // 2. look for the payments
      const refs = (await db().query("SELECT trade_ref FROM auto_release WHERE status = ANY($1) ORDER BY created_at", [OPEN_STATUSES])).rows.map((r) => r.trade_ref);
      const rows = [];
      for (const ref of refs) rows.push(await loadRow(ref));
      const m = await matchTransfers(rows);
      out.matched = m.matched;
      // 3. windows that passed with no payment (not when this round could not look: the payment may be there)
      for (const row of rows.filter((r) => r.status === "watching" && !m.unchecked.has(r.trade_ref))) {
        if (now() > new Date(row.deadline).getTime() + GRACE_MS) await finish(row.trade_ref, "expired", { last_error: "No matching payment arrived in time" });
      }
      // 4. release what matched (and follow up on releases in flight)
      for (const row of rows.filter((r) => r.status === "matched" || r.status === "releasing")) {
        const s = await releaseStep(row.trade_ref);
        if (s === "released") out.released.push(row.trade_ref);
      }
    } finally { running = false; }
    return out;
  }

  /** The trade's auto-release state for one of its sides, the row made now if it qualifies. */
  async function forTrade(ref) {
    if (!config.enabled) return { status: 200, body: { enabled: false, reason: config.reason } };
    let fresh;
    try { fresh = await readTrade(ref); } catch { return { status: 503, body: { error: "Could not read the chain right now" } }; }
    if (!fresh) return { status: 404, body: { error: "Trade not found" } };
    return { fresh };
  }

  return { config, tick, readTrade, ensureRow, loadRow, view, forTrade, housekeep, releaseStep, fetchTransfers, disqualify, buildRelease };
}

/* ---------------- routes and the loop ---------------- */

export function registerAutoReleaseRoutes(app, { getPool, requireAuth, sendAuthError, auto }) {
  app.get("/api/v11/auto-release", (_req, res) => {
    const c = auto.config;
    res.set("Cache-Control", "public, max-age=60");
    return res.json({ enabled: !!c.enabled, agent: c.enabled ? c.agent : "", networks: c.enabled ? c.networks : [], notWatched: c.notWatched, ...(c.enabled ? {} : { reason: c.reason }) });
  });

  app.get("/api/v11/trades/:ref/auto", async (req, res) => {
    const a = requireAuth(req, "query");
    if (!a.ok) return sendAuthError(res, a);
    if (req.query.wallet !== a.wallet) return res.status(400).json({ error: "Wallet must match authenticated wallet" });
    const ref = req.params.ref;
    const { id } = parseRef(ref);
    if (!id || id.length > 128) return res.status(400).json({ error: "Bad trade id" });
    if (!getPool()) return res.status(503).json({ error: "Database not ready" });
    res.set("Cache-Control", "no-store");
    const f = await auto.forTrade(ref);
    if (!f.fresh) return res.status(f.status).json(f.body);
    const { trade, pool, config } = f.fresh;
    const me = a.wallet;
    if (me !== trade.seller && me !== trade.buyer && me !== config.arbiter) return res.status(403).json({ error: "Only the two sides of this trade can see this" });
    try {
      let row = await auto.loadRow(trade.tradeId);
      if (row && OPEN_STATUSES.includes(row.status)) {
        await auto.housekeep(row, trade, config, pool);
        row = await auto.loadRow(trade.tradeId);
      }
      if (!row) {
        const r = await auto.ensureRow(trade, pool, config);
        if (!r.row) return res.json({ enabled: false, reason: r.reason, currency: trade.currency, notWatched: auto.config.notWatched.filter((n) => n.startsWith(`${trade.currency}:`)) });
        row = r.row;
      }
      return res.json(auto.view(row));
    } catch (e) {
      console.error("GET /api/v11/trades/:ref/auto", e.message);
      return res.status(500).json({ error: "Could not load auto-release" });
    }
  });
}

/** Every config.intervalMs while the server runs. Does nothing (and starts nothing) when auto-release is off. */
export function startAutoReleaseWatcher(auto) {
  if (!auto.config.enabled) return null;
  console.log(`[auto-release] on: agent ${auto.config.agent}, watching ${auto.config.networks.join(", ")}${auto.config.notWatched.length ? ` (not ${auto.config.notWatched.join(", ")}: set ETHERSCAN_API_KEY)` : ""}`);
  const run = () => auto.tick().catch((e) => console.warn("[auto-release] round failed:", e.message));
  setTimeout(run, 5000);
  return setInterval(run, auto.config.intervalMs);
}
