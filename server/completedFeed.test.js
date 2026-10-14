/**
 * Live "trade completed" feed. Needs a Postgres with server/schema.sql applied (CI does this).
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kadena_nexus node --test server/completedFeed.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { recentCompleted, completedItem } from "./completedFeed.js";
import { runNotificationsOnce, onTradeCompleted } from "./notifications.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/kadena_nexus" });
const A = "k:" + "a".repeat(64), B = "k:" + "b".repeat(64);
const clean = async () => {
  for (const t of ["trade_states", "offer_details", "trade_txs", "notifications"]) await pool.query(`DELETE FROM ${t} WHERE offer_id LIKE 'feed-test-%'`);
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
