#!/usr/bin/env node
/**
 * After revision 3 is deployed, the station funded and set-sponsorship run: check that a free take built exactly like
 * the site builds it (src/lib/v11.ts buildFreeTakeTx) passes the gas station on mainnet. Nothing is sent: a /local
 * preflight runs buy-gas (the station's GAS_PAYER) and the take for a brand-new key, with signatures not checked.
 *
 *   node contracts/deploy/check-free-take.mjs <chain> <pool-id> [amount]
 *
 * The pool must be an open USDT/USDC SELL pool on that chain with at least `amount` (default: its minimum) left.
 * "OK" with the gas used means free takes work; anything else: turn them off (set-sponsorship "" 0 0 0.0) and look.
 */
import crypto from "node:crypto";
import { hash } from "@kadena/cryptography-utils";

const [chain = "1", poolId, amountArg] = process.argv.slice(2);
if (!poolId) { console.error("usage: node contracts/deploy/check-free-take.mjs <chain> <pool-id> [amount]"); process.exit(2); }
const NODE = process.env.CHAINWEB || "https://api.chainweb-community.org";
const url = (path) => `${NODE}/chainweb/0.0/mainnet01/chain/${chain}/pact/api/v1/${path}`;
const dec = (n) => { const s = Number(n).toFixed(12).replace(/0+$/, ""); return s.endsWith(".") ? s + "0" : s; };

async function local(code, { signers = [], sender = "", data = {}, gasLimit = 150000, gasPrice = 1e-8, preflight = false } = {}) {
  const cmd = JSON.stringify({ networkId: "mainnet01", payload: { exec: { code, data } }, signers,
    meta: { chainId: chain, sender, gasLimit, gasPrice, ttl: 600, creationTime: Math.floor(Date.now() / 1000) - 30 }, nonce: crypto.randomUUID() });
  const r = await fetch(`${url("local")}?signatureVerification=false&preflight=${preflight}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd, hash: hash(cmd), sigs: [] }) });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`); }
  return j.preflightResult ?? j;
}

const station = (await local("(free.p2p-escrow-v11-gas.account)")).result?.data;
const pool = (await local(`(free.p2p-escrow-v11.get-offer ${JSON.stringify(poolId)})`)).result?.data;
if (!station || !pool) { console.error("Station or pool not found on chain", chain); process.exit(1); }
const pub = crypto.randomBytes(32).toString("hex"), taker = `k:${pub}`;
const left = (await local(`(free.p2p-escrow-v11.free-takes-left ${JSON.stringify(taker)})`)).result?.data;
console.log("station", station, "| free takes left today", left);
const amount = Number(amountArg ?? (typeof pool.min === "object" ? pool.min.decimal : pool.min));

// the same command as the site's buildFreeTakeTx
const res = await local('(free.p2p-escrow-v11.take-offer (read-msg "trade") (read-msg "offer") (read-msg "taker") (read-decimal "amount"))', {
  preflight: true, sender: station, gasLimit: 1800, gasPrice: 0.00000001,
  data: { trade: `check-${Date.now()}`, offer: poolId, taker, amount: { decimal: dec(amount) }, "taker-guard": { keys: [pub], pred: "keys-all" } },
  signers: [{ pubKey: pub, clist: [
    { name: "free.p2p-escrow-v11-gas.GAS_PAYER", args: [taker, { int: 1800 }, { decimal: "0.00000001" }] },
    { name: "free.p2p-escrow-v11.ACCOUNT_AUTH", args: [taker] },
  ] }],
});
const ok = res.result?.status === "success";
console.log(ok ? `OK: a free take of ${amount} KDA passes the station (gas ${res.gas} of 1800)` : `FAILED: ${res.result?.error?.message ?? JSON.stringify(res).slice(0, 400)}`);
process.exit(ok ? 0 : 1);
