/**
 * Live "trade completed" feed. Needs a Postgres with server/schema.sql applied (CI does this).
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kadena_nexus node --test server/completedFeed.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { recentCompleted, completedItem } from "./completedFeed.js";
import { runNotificationsOnce, onTradeCompleted } from "./notifications.js";
import { toTrade, tradeAsLegacyEscrow, poolsById, toPool } from "./chain.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/kadena_nexus" });
const A = "k:" + "a".repeat(64), B = "k:" + "b".repeat(64);
const clean = async () => {
  for (const t of ["trade_states", "offer_details", "trade_txs", "notifications"]) await pool.query(`DELETE FROM ${t} WHERE offer_id LIKE 'feed-test-%' OR offer_id LIKE '2:feed-test-%'`);
};
before(clean);
after(async () => { await clean(); await pool.end(); });

test("recent completed trades: newest first, with total and the release transaction", async () => {
  await pool.query(`INSERT INTO offer_details (offer_id, creator, amount, side, price, min_amount, max_amount, fiat_currency) VALUES ('feed-test-x1y2z3', $1, 300, 'SELL', 0.0094, 300, 300, 'USD')`, [A]);
  await pool.query(`INSERT INTO trade_states (offer_id, state, updated_at) VALUES ('feed-test-x1y2z3', 'COMPLETED', now() + interval '1 hour')`);
  await pool.query(`INSERT INTO trade_txs (request_key, offer_id, fn, status) VALUES ('rk-feed-test-1', 'feed-test-x1y2z3', 'release', 'ok')`);
  const r = await recentCompleted(pool);
  const item = r.recent[0];
  assert.equal(item.offerId, "feed-test-x1y2z3");
  assert.equal(item.amount, 300);
  assert.equal(item.currency, "USD");
  assert.ok(Math.abs(item.total - 2.82) < 1e-9);
  assert.equal(item.requestKey, "rk-feed-test-1");
  assert.ok(r.week >= 1);
  assert.equal((await completedItem(pool, "feed-test-none", 12)).amount, 12, "no details yet: the chain amount is used");
});

test("v11 trades: amount, currency and the total paid come from the chain; token and giveaway shown as such", async () => {
  await pool.query(`INSERT INTO trade_states (offer_id, state, updated_at) VALUES ('feed-test-v11a', 'COMPLETED', now() + interval '2 hours'), ('feed-test-v11b', 'COMPLETED', now() + interval '3 hours'), ('feed-test-v11c', 'COMPLETED', now() + interval '4 hours')`);
  await pool.query(`INSERT INTO trade_txs (request_key, offer_id, fn, status) VALUES ('rk-feed-test-2', 'feed-test-v11b', 'take-and-settle', 'ok')`);
  const trades = [
    { tradeId: "feed-test-v11a", amount: 100, currency: "USDT", token: "", payAmount: 1, closedAt: "2026-10-15T10:00:00.000Z" },
    { tradeId: "feed-test-v11b", amount: 20, currency: "kb-USDC", token: "n_x.kb-usdc", payAmount: 10, closedAt: "2026-10-15T11:00:00.000Z" },
    { tradeId: "feed-test-v11c", amount: 5, currency: "KDA", token: "", payAmount: 0, closedAt: "2026-10-15T12:00:00.000Z" },
  ];
  const r = await recentCompleted(pool, 5, trades);
  const [give, swap, usdt] = r.recent;
  assert.deepEqual([give.offerId, give.amount, give.total, give.token, give.at], ["feed-test-v11c", 5, 0, null, "2026-10-15T12:00:00.000Z"], "giveaway: total 0");
  assert.deepEqual([swap.amount, swap.currency, swap.total, swap.token, swap.requestKey], [20, "kb-USDC", 10, "n_x.kb-usdc", "rk-feed-test-2"]);
  assert.deepEqual([usdt.amount, usdt.currency, usdt.total, usdt.token], [100, "USDT", 1, null]);
  assert.equal(r.recent[3].offerId, "feed-test-x1y2z3", "v10 rows still there");
  const live = await completedItem(pool, "feed-test-v11a", 100, trades[0]);
  assert.deepEqual([live.currency, live.total, live.code], ["USDT", 1, "V11A"]);
});

test("a v11 instant swap appears COMPLETED straight away and is announced with its trade data", async () => {
  const seen = [];
  onTradeCompleted((x) => seen.push(x));
  await pool.query("INSERT INTO alert_state (key, value) VALUES ('notifications_initialized', 'test') ON CONFLICT (key) DO NOTHING");
  const t = { id: "feed-test-swap", poolId: "feed-test-pool", state: "COMPLETED", side: "SELL", amount: 20, creator: A, buyer: B, currency: "kb-USDC", token: "n_x.kb-usdc", payAmount: 10, price: 0.5, closedAt: Date.parse("2026-10-15T11:00:00Z"), fundedAt: Date.parse("2026-10-15T11:00:00Z") };
  await runNotificationsOnce(pool, { chain: [t], send: async () => "ok" });
  await runNotificationsOnce(pool, { chain: [t], send: async () => "ok" });
  const mine = seen.filter((x) => x.offerId === "feed-test-swap");
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0], { offerId: "feed-test-swap", amount: 20, wallets: [A, B], trade: { currency: "kb-USDC", token: "n_x.kb-usdc", payAmount: 10, price: 0.5, closedAt: t.closedAt } });
  onTradeCompleted(null);
});

test("the watcher announces a trade when it becomes COMPLETED, once", async () => {
  const seen = [];
  onTradeCompleted((x) => seen.push(x));
  // make sure the watcher is past its first (silent) round
  await pool.query("INSERT INTO alert_state (key, value) VALUES ('notifications_initialized', 'test') ON CONFLICT (key) DO NOTHING");
  const offer = (state) => [{ id: "feed-test-live", state, side: "SELL", amount: 50, creator: A, buyer: B }];
  const send = async () => "ok";
  await runNotificationsOnce(pool, { chain: offer("PAID"), send });
  await runNotificationsOnce(pool, { chain: offer("COMPLETED"), send });
  await runNotificationsOnce(pool, { chain: offer("COMPLETED"), send });
  const mine = seen.filter((x) => x.offerId === "feed-test-live");
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0], { offerId: "feed-test-live", amount: 50, wallets: [A, B] });
  onTradeCompleted(null);
});

test("the same trade id on chains 1 and 2: two trades in the watcher and the feed, each with its own data", async () => {
  const seen = [];
  onTradeCompleted((x) => seen.push(x));
  await pool.query("INSERT INTO alert_state (key, value) VALUES ('notifications_initialized', 'test') ON CONFLICT (key) DO NOTHING");
  const at = "2026-10-18T11:00:00Z", time = { time: at }, EPOCH = { time: "1970-01-01T00:00:00Z" };
  const rec = (o) => ({ offer: "feed-test-pool2", seller: A, buyer: B, amount: 20, price: 0.5, currency: "USDT", token: "", "pay-amount": 10, fee: 0, "pay-window": 900, agent: "", state: "COMPLETED", "funded-at": time, "paid-at": time, "closed-at": time, ...o });
  const one = toTrade("feed-test-dup", rec({}), "1");
  const two = toTrade("feed-test-dup", rec({ amount: 7, currency: "kb-ETH", token: "n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-ETH", "pay-amount": 0.0000315, price: 0.0000045 }), "2");
  const pool1 = toPool("feed-test-pool2", { creator: A, side: "SELL" }, "1"), pool2 = toPool("feed-test-pool2", { creator: A, side: "SELL" }, "2");
  const by = poolsById([pool1, pool2]);
  const chain = [one, two].map((t) => tradeAsLegacyEscrow(t, by, "k:arb"));
  await runNotificationsOnce(pool, { chain, send: async () => "ok" });
  const states = (await pool.query("SELECT offer_id FROM trade_states WHERE offer_id IN ('feed-test-dup', '2:feed-test-dup') ORDER BY offer_id")).rows.map((r) => r.offer_id);
  assert.deepEqual(states, ["2:feed-test-dup", "feed-test-dup"], "one row per chain");
  const mine = seen.filter((x) => x.offerId.endsWith("feed-test-dup")).map((x) => [x.offerId, x.amount, x.trade.currency]).sort();
  assert.deepEqual(mine, [["2:feed-test-dup", 7, "kb-ETH"], ["feed-test-dup", 20, "USDT"]], "both announced, each with its own amount");
  const r = await recentCompleted(pool, 50, [one, two]);
  const items = r.recent.filter((i) => i.offerId.endsWith("feed-test-dup")).map((i) => [i.offerId, i.amount, i.currency, i.total]).sort();
  assert.deepEqual(items, [["2:feed-test-dup", 7, "kb-ETH", 0.0000315], ["feed-test-dup", 20, "USDT", 10]]);
  onTradeCompleted(null);
});
