/**
 * Escrow v11 chain reader tests. No database and no real chain: a tiny HTTP server plays the Chainweb node
 * and answers the exact /local calls fetchChain makes, with records shaped like the Pact server returns them.
 *   node --test server/chain.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fetchChain, readPool, readTrade, readTradeWithPool, tradeAsLegacyEscrow, poolsById, toPool, toTrade, pactTime, pactNumber, chainConfig } from "./chain.js";

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

/** Evaluate the handful of Pact expressions the reader sends. */
function evalPact(code) {
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
  app.post("/down/chainweb/0.0/mainnet01/chain/1/pact/api/v1/local", (_req, res) => res.status(503).send("down"));
  app.post("/chainweb/0.0/mainnet01/chain/1/pact/api/v1/local", (req, res) => {
    const code = JSON.parse(req.body.cmd).payload.exec.code;
    calls.push(code);
    res.json(evalPact(code));
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
  assert.deepEqual([p.poolId, p.side, p.locked, p.payWindow, p.expiresAt, p.takes, p.state], ["pool-1", "SELL", 100, 1800, undefined, 1, "OPEN"]);
  assert.equal(toPool("pool-2", offers["pool-2"]).expiresAt, "2026-11-01T00:00:00.000Z");
  const t = toTrade("trade-2", trades["trade-2"]);
  assert.deepEqual([t.tradeId, t.poolId, t.payAmount, t.state, t.paidAt, t.closedAt], ["trade-2", "pool-2", 0.24, "PAID", "2026-10-15T11:20:00.000Z", undefined]);
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

test("fetchChain: open pools, every trade, the config, and the closed pools that trades refer to; nodes fail over", async () => {
  calls = [];
  const c = await fetchChain();
  assert.ok(firstNodeDown);
  assert.deepEqual(c.pools.map((p) => [p.poolId, p.state]), [["pool-1", "OPEN"], ["pool-2", "OPEN"], ["pool-closed", "CLOSED"]]);
  assert.deepEqual(c.trades.map((t) => t.tradeId), ["trade-1", "trade-2", "trade-3"]);
  assert.deepEqual(c.config, { arbiter: ARB, tRelease: 1800, feeBps: 0, feeAccount: ARB, paused: false });
  assert.equal(calls.length, 4, "pools, trades, config, and one call for the missing pools");
  assert.match(calls[3], /\["pool-closed"\]/);
  const legacy = c.trades.map((t) => tradeAsLegacyEscrow(t, poolsById(c.pools), c.config.arbiter));
  assert.equal(legacy[2].creator, S, "the closed pool's creator is known");
  assert.equal(legacy[2].agent, ARB);
});

test("single reads: a pool, a trade, a trade with its pool; a missing id is null, not an error", async () => {
  assert.equal((await readPool("pool-2")).currency, "USDC");
  assert.equal((await readTrade("trade-3")).state, "COMPLETED");
  const r = await readTradeWithPool("trade-3");
  assert.deepEqual([r.trade.tradeId, r.pool.poolId, r.pool.state, r.config.arbiter], ["trade-3", "pool-closed", "CLOSED", ARB]);
  assert.equal(await readPool("pool-none"), null);
  assert.equal(await readTrade("trade-none"), null);
  assert.equal(await readTradeWithPool("trade-none"), null);
  // every node down: that is an error (the caller keeps its last good read)
  process.env.ALERTS_CHAIN_API = `${base}/down`;
  await assert.rejects(readPool("pool-1"), /All Chainweb nodes failed/);
  process.env.ALERTS_CHAIN_API = `${base}/down,${base}`;
});
