/**
 * Escrow v11 chain reader tests. No database and no real chain: a tiny HTTP server plays the Chainweb node
 * (chains 1 and 2, each with its own tables) and answers the exact /local calls fetchChain makes, with records
 * shaped like the Pact server returns them.
 *   node --test server/chain.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fetchChain, readPool, readTrade, readTradeWithPool, tradeAsLegacyEscrow, poolsById, toPool, toTrade, pactTime, pactNumber, chainConfig, configFor } from "./chain.js";

const S = "k:" + "a".repeat(64), B = "k:" + "b".repeat(64), ARB = "k:" + "d".repeat(64);
const M = chainConfig().contract; // free.p2p-escrow-v11 unless the env says otherwise
const time = (iso) => ({ time: iso });
const EPOCH = time("1970-01-01T00:00:00Z");

// what the Pact server returns for (get-offer) / (get-trade): numbers as plain, {int} or {decimal}; times as {time}
const offers = {
  "pool-1": { creator: S, side: "SELL", available: 900, locked: { decimal: "100" }, min: 50, max: 500, price: 0.01, currency: "USDT", token: "", "pay-window": { int: 1800 }, "expires-at": EPOCH, agent: "", state: "OPEN", "created-at": time("2026-10-15T10:00:00Z"), takes: { int: 1 } },
  "pool-2": { creator: B, side: "BUY", available: 180, locked: 20, min: 10, max: 200, price: 0.012, currency: "USDC", token: "", "pay-window": 3600, "expires-at": time("2026-11-01T00:00:00Z"), agent: "", state: "OPEN", "created-at": time("2026-10-15T10:00:00Z"), takes: 1 },
  "pool-closed": { creator: S, side: "SELL", available: 0, locked: 5, min: 1, max: 5, price: 0.5, currency: "kb-USDC", token: "n_x.kb-usdc", "pay-window": 900, "expires-at": EPOCH, agent: ARB, state: "CLOSED", "created-at": time("2026-10-14T10:00:00Z"), takes: 1 },
};
const trades = {
  "trade-1": { offer: "pool-1", seller: S, buyer: B, amount: 100, price: 0.01, currency: "USDT", token: "", "pay-amount": 1, fee: 0, "pay-window": { int: 1800 }, agent: "", state: "FUNDED", "funded-at": time("2026-10-15T11:00:00Z"), "paid-at": EPOCH, "closed-at": EPOCH },
  "trade-2": { offer: "pool-2", seller: S, buyer: B, amount: 20, price: 0.012, currency: "USDC", token: "", "pay-amount": 0.24, fee: 0, "pay-window": 3600, agent: "", state: "PAID", "funded-at": time("2026-10-15T11:00:00Z"), "paid-at": time("2026-10-15T11:20:00Z"), "closed-at": EPOCH },
  "trade-3": { offer: "pool-closed", seller: S, buyer: B, amount: 5, price: 0.5, currency: "kb-USDC", token: "n_x.kb-usdc", "pay-amount": 2.5, fee: 0, "pay-window": 900, agent: ARB, state: "COMPLETED", "funded-at": time("2026-10-14T12:00:00Z"), "paid-at": time("2026-10-14T12:00:00Z"), "closed-at": time("2026-10-14T12:00:00Z") },
};
const config = { arbiter: ARB, "t-release": { int: 1800 }, "fee-bps": { int: 0 }, "fee-account": ARB, paused: false };
// chain 2: the same contract with its own tables. "pool-1" and "trade-1" exist on both chains on purpose.
const KB_ETH = "n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-ETH";
const offers2 = {
  "pool-1": { creator: B, side: "SELL", available: 40, locked: 0, min: 1, max: 20, price: 0.0000045, currency: "kb-ETH", token: KB_ETH, "pay-window": 900, "expires-at": EPOCH, agent: "", state: "OPEN", "created-at": time("2026-10-18T10:00:00Z"), takes: 1 },
};
const trades2 = {
  "trade-1": { offer: "pool-1", seller: B, buyer: S, amount: 10, price: 0.0000045, currency: "kb-ETH", token: KB_ETH, "pay-amount": { decimal: "0.000045" }, fee: 0, "pay-window": 900, agent: "", state: "COMPLETED", "funded-at": time("2026-10-18T11:00:00Z"), "paid-at": time("2026-10-18T11:00:00Z"), "closed-at": time("2026-10-18T11:00:00Z") },
};
const config2 = { ...config, "t-release": { int: 7200 } };
const tables = { "1": { offers, trades, config }, "2": { offers: offers2, trades: trades2, config: config2 } };
let chain2Missing = false; // chain 2 before the contract is deployed there

/** Evaluate the handful of Pact expressions the reader sends, against one chain's tables. */
function evalPact(code, chain = "1") {
  if (chain === "2" && chain2Missing) return { result: { status: "failure", error: { message: `Cannot resolve module ${M}` } } };
  const { offers, trades, config } = tables[chain];
  const ok = (data) => ({ result: { status: "success", data } });
  const fail = (message) => ({ result: { status: "failure", error: { message } } });
  const get = (table, id) => { if (!table[id]) throw new Error(`No value found in table ${id}`); return table[id]; };
  try {
    if (code === `(${M}.get-config)`) return ok(config);
    let m;
    if (code.includes(`(${M}.list-offer-ids)`)) return ok(Object.keys(offers).filter((k) => offers[k].state === "OPEN").map((id) => ({ id, o: offers[id] })));
    if (code.includes(`(${M}.list-trade-ids)`)) return ok(Object.keys(trades).map((id) => ({ id, t: trades[id] })));
    if ((m = code.match(/^\(map \(lambda \(k\) \{"id": k, "o": \(.*\.get-offer k\)\}\) \[(.*)\]\)$/))) return ok(JSON.parse(`[${m[1].replace(/" "/g, '","')}]`).map((id) => ({ id, o: get(offers, id) })));
    if ((m = code.match(/^\(let \(\(t \(.*\.get-trade "([^"]+)"\)\)\) /))) { const t = get(trades, m[1]); return ok({ t, o: get(offers, t.offer), c: config }); }
    if ((m = code.match(/^\(.*\.get-offer "([^"]+)"\)$/))) return ok(get(offers, m[1]));
    if ((m = code.match(/^\(.*\.get-trade "([^"]+)"\)$/))) return ok(get(trades, m[1]));
    return fail(`unexpected code: ${code}`);
  } catch (e) { return fail(e.message); }
}

let server, base, calls = [], firstNodeDown = false;
before(async () => {
  const app = express(); app.use(express.json({ limit: "1mb" }));
  app.post("/down/chainweb/0.0/mainnet01/chain/:chain/pact/api/v1/local", (_req, res) => res.status(503).send("down"));
  app.post("/chainweb/0.0/mainnet01/chain/:chain/pact/api/v1/local", (req, res) => {
    const cmd = JSON.parse(req.body.cmd), chain = req.params.chain;
    if (!tables[chain]) return res.status(404).send("no such chain");
    assert.equal(String(cmd.meta.chainId), chain, "the command names the chain it is sent to");
    const code = cmd.payload.exec.code;
    calls.push(chain === "1" ? code : `[${chain}] ${code}`);
    res.json(evalPact(code, chain));
  });
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.ALERTS_CHAIN_API = `${base}/down,${base}`; // the first node fails: the reader must move on to the next
  firstNodeDown = true;
});
after(() => { server?.close(); delete process.env.ALERTS_CHAIN_API; });

test("records are parsed like src/lib/v11.ts: numbers in any Pact form, EPOCH as 'not set'", () => {
  assert.equal(pactNumber({ decimal: "12.5" }), 12.5);
  assert.equal(pactNumber({ int: 3 }), 3);
  assert.equal(pactNumber(7), 7);
  assert.equal(pactNumber("x"), 0);
  assert.equal(pactTime(EPOCH), undefined);
  assert.equal(pactTime({ timep: "2026-10-15T10:00:00Z" }), "2026-10-15T10:00:00.000Z");
  assert.equal(pactTime("2026-10-15T10:00:00Z"), "2026-10-15T10:00:00.000Z");
  const p = toPool("pool-1", offers["pool-1"]);
  assert.deepEqual([p.poolId, p.chain, p.side, p.locked, p.payWindow, p.expiresAt, p.takes, p.state], ["pool-1", "1", "SELL", 100, 1800, undefined, 1, "OPEN"]);
  const p2 = toPool("pool-1", offers2["pool-1"], "2");
  assert.deepEqual([p2.poolId, p2.chain, p2.currency], ["2:pool-1", "2", "kb-ETH"], "chain 2: the id becomes the reference 2:<id>");
  assert.equal(toPool("pool-2", offers["pool-2"]).expiresAt, "2026-11-01T00:00:00.000Z");
  const t = toTrade("trade-2", trades["trade-2"]);
  assert.deepEqual([t.tradeId, t.poolId, t.payAmount, t.state, t.paidAt, t.closedAt], ["trade-2", "pool-2", 0.24, "PAID", "2026-10-15T11:20:00.000Z", undefined]);
  const t2 = toTrade("trade-1", trades2["trade-1"], "2");
  assert.deepEqual([t2.tradeId, t2.poolId, t2.chain, t2.payAmount], ["2:trade-1", "2:pool-1", "2", 0.000045]);
});

test("a trade in the legacy escrow shape: pool creator, the right 'buyer' per side, times in ms", () => {
  const by = poolsById([toPool("pool-1", offers["pool-1"]), toPool("pool-2", offers["pool-2"])]);
  const sell = tradeAsLegacyEscrow(toTrade("trade-1", trades["trade-1"]), by, ARB);
  assert.deepEqual([sell.id, sell.side, sell.creator, sell.buyer, sell.arbiter, sell.state, sell.poolId], ["trade-1", "SELL", S, B, ARB, "FUNDED", "pool-1"]);
  assert.equal(sell.acceptedAt, Date.parse("2026-10-15T11:00:00Z"), "acceptedAt = fundedAt (a take funds at once)");
  assert.equal(sell.fundedAt, sell.acceptedAt);
  assert.equal(sell.paidAt, null);
  assert.deepEqual([sell.price, sell.currency, sell.payAmount, sell.payWindow, sell.agent, sell.token, sell.fee], [0.01, "USDT", 1, 1800, "", "", 0]);
  // BUY pool: the creator is the payer, the KDA holder (trade.seller) goes in "buyer" like v10 did
  const buy = tradeAsLegacyEscrow(toTrade("trade-2", trades["trade-2"]), by, ARB);
  assert.deepEqual([buy.side, buy.creator, buy.buyer, buy.paidAt], ["BUY", B, S, Date.parse("2026-10-15T11:20:00Z")]);
  // unknown pool: treated as the seller's own SELL pool
  const orphan = tradeAsLegacyEscrow(toTrade("trade-1", trades["trade-1"]), new Map());
  assert.deepEqual([orphan.side, orphan.creator, orphan.buyer, orphan.arbiter], ["SELL", S, B, ""]);
});

test("fetchChain: open pools, every trade, the config, and the closed pools that trades refer to, on chains 1 and 2; nodes fail over", async () => {
  calls = [];
  const c = await fetchChain();
  assert.ok(firstNodeDown);
  assert.deepEqual(c.pools.map((p) => [p.poolId, p.chain, p.state]), [["pool-1", "1", "OPEN"], ["pool-2", "1", "OPEN"], ["pool-closed", "1", "CLOSED"], ["2:pool-1", "2", "OPEN"]]);
  assert.deepEqual(c.trades.map((t) => t.tradeId), ["trade-1", "trade-2", "trade-3", "2:trade-1"]);
  assert.deepEqual(c.config, { arbiter: ARB, tRelease: 1800, feeBps: 0, feeAccount: ARB, paused: false });
  assert.deepEqual([c.configs["1"].tRelease, c.configs["2"].tRelease, configFor(c, "2").tRelease], [1800, 7200, 7200], "each chain has its own config row");
  assert.equal(calls.length, 7, "chain 1: pools, trades, config, the missing pools; chain 2: pools, trades, config");
  assert.match(calls[3], /\["pool-closed"\]/);
  assert.ok(calls.slice(4).every((x) => x.startsWith("[2] ")), "chain 2 is read on chain 2");
  const legacy = c.trades.map((t) => tradeAsLegacyEscrow(t, poolsById(c.pools), c.config.arbiter));
  assert.equal(legacy[2].creator, S, "the closed pool's creator is known");
  assert.equal(legacy[2].agent, ARB);
});

test("the same pool and trade id on chains 1 and 2 never mix: each trade finds its own chain's pool", async () => {
  const c = await fetchChain();
  const by = poolsById(c.pools);
  assert.equal(by.size, c.pools.length, "no pool overwrites another");
  const [one, two] = ["trade-1", "2:trade-1"].map((id) => c.trades.find((t) => t.tradeId === id));
  const e1 = tradeAsLegacyEscrow(one, by, configFor(c, one.chain)), e2 = tradeAsLegacyEscrow(two, by, configFor(c, two.chain));
  assert.deepEqual([e1.id, e1.poolId, e1.chain, e1.creator, e1.currency, e1.state, e1.tRelease], ["trade-1", "pool-1", "1", S, "USDT", "FUNDED", 1800]);
  assert.deepEqual([e2.id, e2.poolId, e2.chain, e2.creator, e2.currency, e2.state, e2.tRelease], ["2:trade-1", "2:pool-1", "2", B, "kb-ETH", "COMPLETED", 7200]);
  assert.equal(e2.arbiter, ARB, "a config passed in gives the arbiter too");
});

test("V11_CHAINS picks the chains; a chain without the contract yet counts as empty", async () => {
  process.env.V11_CHAINS = "1";
  calls = [];
  let c = await fetchChain();
  assert.deepEqual(c.trades.map((t) => t.tradeId), ["trade-1", "trade-2", "trade-3"]);
  assert.ok(calls.every((x) => !x.startsWith("[2]")), "chain 2 is not read");
  delete process.env.V11_CHAINS;
  chain2Missing = true;
  c = await fetchChain();
  assert.deepEqual(c.pools.map((p) => p.chain).filter((ch) => ch === "2"), []);
  assert.equal(c.trades.length, 3, "chain 1 still reads");
  assert.equal(await readPool("2:pool-1"), null);
  chain2Missing = false;
});

test("single reads: a pool, a trade, a trade with its pool; a missing id is null, not an error", async () => {
  assert.equal((await readPool("pool-2")).currency, "USDC");
  assert.equal((await readTrade("trade-3")).state, "COMPLETED");
  const r = await readTradeWithPool("trade-3");
  assert.deepEqual([r.trade.tradeId, r.pool.poolId, r.pool.state, r.config.arbiter], ["trade-3", "pool-closed", "CLOSED", ARB]);
  assert.equal(await readPool("pool-none"), null);
  assert.equal(await readTrade("trade-none"), null);
  assert.equal(await readTradeWithPool("trade-none"), null);
  // a reference reads its own chain
  assert.equal((await readPool("2:pool-1")).currency, "kb-ETH");
  assert.equal((await readPool("pool-1")).currency, "USDT", "no prefix: chain 1");
  assert.equal((await readPool("1:pool-1")).currency, "USDT", "1: is chain 1 too");
  const r2 = await readTradeWithPool("2:trade-1");
  assert.deepEqual([r2.trade.tradeId, r2.trade.chain, r2.pool.poolId, r2.pool.creator, r2.config.tRelease], ["2:trade-1", "2", "2:pool-1", B, 7200]);
  assert.equal((await readTrade("2:trade-1")).payAmount, 0.000045);
  // every node down: that is an error (the caller keeps its last good read)
  process.env.ALERTS_CHAIN_API = `${base}/down`;
  await assert.rejects(readPool("pool-1"), /All Chainweb nodes failed/);
  process.env.ALERTS_CHAIN_API = `${base}/down,${base}`;
});

test("a failed read is not mistaken for 'no such trade'", async () => {
  const { isAbsent } = await import("./chain.js");
  assert.equal(isAbsent(new Error("Pact error: No value found in table free.p2p-escrow-v11_trades for key: x")), true);
  assert.equal(isAbsent(new Error("Pact error: Module free.p2p-escrow-v11 has no such member: get-config")), true, "contract not on this chain");
  assert.equal(isAbsent(new Error("Pact error: Cannot find module: free.p2p-escrow-v11")), true);
  assert.equal(isAbsent(new Error("Pact error: Unknown exception")), false);
  assert.equal(isAbsent(new Error("HTTP 502 from https://node")), false);
});
