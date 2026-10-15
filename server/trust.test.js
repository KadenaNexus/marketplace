/**
 * Trust and safety tests. Needs a Postgres with server/schema.sql applied (CI does this).
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kadena_nexus node --test server/trust.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import express from "express";
import { completedCounts, createChainCache, recheckCompletedOffers, registerTrustRoutes, TERMS_VERSION } from "./trust.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/kadena_nexus" });
const A = "k:" + "a".repeat(64), B = "k:" + "b".repeat(64), C = "k:" + "c".repeat(64), T = "k:" + "7".repeat(64);
const KEY = "completed_offers_rechecked_test";
let chain = [];
let server, base;

const clean = async () => {
  await pool.query("DELETE FROM ratings WHERE offer_id LIKE 'trust-test-%'");
  await pool.query("DELETE FROM ratings_removed WHERE offer_id LIKE 'trust-test-%'");
  await pool.query("DELETE FROM completed_offers WHERE offer_id LIKE 'trust-test-%'");
  await pool.query("DELETE FROM completed_offers_removed WHERE offer_id LIKE 'trust-test-%'");
  await pool.query("DELETE FROM terms_acceptances WHERE wallet = $1", [T]);
  await pool.query("DELETE FROM alert_state WHERE key = $1", [KEY]);
};

before(async () => {
  await clean();
  const app = express();
  app.use(express.json());
  // the real server checks a wallet signature; here the wallet in the request is taken as proven
  const requireAuth = (req, from = "body") => { const w = (from === "query" ? req.query : req.body)?.wallet; return w ? { ok: true, wallet: w } : { ok: false, status: 400, error: "Missing wallet" }; };
  registerTrustRoutes(app, {
    getPool: () => pool, requireAuth,
    sendAuthError: (res, a) => res.status(a.status).json({ error: a.error }),
    chainOffers: async () => { if (chain === null) throw new Error("down"); return chain; },
  });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await clean(); await pool.end(); });

test("completed trades are counted per wallet, either side", () => {
  const n = completedCounts([
    { state: "COMPLETED", creator: A, buyer: B },
    { state: "COMPLETED", creator: B, buyer: A },
    { state: "COMPLETED", creator: A, buyer: C },
    { state: "FUNDED", creator: A, buyer: B },
    { state: "REFUNDED", creator: C, buyer: "" },
  ]);
  assert.deepEqual([n.get(A), n.get(B), n.get(C)], [3, 2, 1]);
});

test("chain cache reuses a fresh read and keeps the last one if the chain fails", async () => {
  let t = 0, calls = 0, fail = false;
  const read = createChainCache({ fetchOffers: async () => { calls++; if (fail) throw new Error("down"); return [{ id: calls }]; }, freshMs: 1000, now: () => t });
  assert.deepEqual(await read(), [{ id: 1 }]);
  t = 500; assert.deepEqual(await read(), [{ id: 1 }]); assert.equal(calls, 1);
  t = 2000; fail = true; assert.deepEqual(await read(), [{ id: 1 }], "last good read");
  await assert.rejects(createChainCache({ fetchOffers: async () => { throw new Error("down"); } })());
});

test("GET /api/traders/completed returns counts for the wallets asked", async () => {
  chain = [{ state: "COMPLETED", creator: A, buyer: B }, { state: "COMPLETED", creator: A, buyer: C }];
  const r = await fetch(`${base}/api/traders/completed?w=${A},${B},${T},not-a-wallet`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { [A]: 2, [B]: 1, [T]: 0 });
  chain = null;
  assert.equal((await fetch(`${base}/api/traders/completed?w=${A}`)).status, 503);
  chain = [];
});

test("terms: accepted once per version; wallet must match", async () => {
  const get = () => fetch(`${base}/api/terms?wallet=${T}&publicKey=x&signedCmd=x`).then((r) => r.json());
  const accept = (body) => fetch(`${base}/api/terms/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: T, publicKey: "x", signedCmd: "x", ...body }) });
  assert.deepEqual(await get(), { version: TERMS_VERSION, accepted: false });
  assert.equal((await accept({ version: "1999-01-01" })).status, 409, "old version");
  assert.equal((await accept({ version: TERMS_VERSION })).status, 200);
  assert.equal((await accept({ version: TERMS_VERSION })).status, 200, "twice is fine");
  assert.deepEqual(await get(), { version: TERMS_VERSION, accepted: true });
  assert.equal((await fetch(`${base}/api/terms`)).status, 400, "no wallet");
});

test("old rating registrations are checked against the chain once", async () => {
  // SELL: seller = creator, buyer = buyer field. BUY: seller = buyer field, buyer = creator.
  const offers = [
    { id: "trust-test-ok-sell", side: "SELL", creator: A, buyer: B, state: "COMPLETED" },
    { id: "trust-test-ok-buy", side: "BUY", creator: B, buyer: A, state: "COMPLETED" },
    { id: "trust-test-refunded", side: "SELL", creator: A, buyer: "", state: "REFUNDED" },
    { id: "trust-test-wrong", side: "SELL", creator: A, buyer: B, state: "COMPLETED" },
  ];
  const reg = [
    ["trust-test-ok-sell", B, A], ["trust-test-ok-buy", B, A], ["trust-test-refunded", B, A],
    ["trust-test-wrong", C, A], ["trust-test-ghost", B, A],
  ];
  for (const [id, buyer, seller] of reg) await pool.query("INSERT INTO completed_offers (offer_id, buyer_wallet, seller_wallet) VALUES ($1, $2, $3)", [id, buyer, seller]);
  await pool.query("INSERT INTO ratings (offer_id, rater_wallet, rated_wallet, rating, comment) VALUES ('trust-test-ok-sell', $1, $2, 5, 'good'), ('trust-test-ghost', $1, $2, 1, 'fake'), ('trust-test-wrong', $3, $2, 1, 'fake too')", [B, A, C]);

  // judge only this test's rows, so other rows in a shared database are left alone
  const ALL = "SELECT offer_id, buyer_wallet, seller_wallet FROM completed_offers";
  const scopedPool = { query: (q, p) => pool.query(q === ALL ? `${ALL} WHERE offer_id LIKE 'trust-test-%'` : q, p) };
  const res = await recheckCompletedOffers(scopedPool, { fetchOffers: async () => offers, key: KEY });
  assert.deepEqual([res.checked, res.removed, res.ratingsMoved], [5, 3, 2]);

  const kept = (await pool.query("SELECT offer_id FROM completed_offers WHERE offer_id LIKE 'trust-test-%' ORDER BY 1")).rows.map((r) => r.offer_id);
  assert.deepEqual(kept, ["trust-test-ok-buy", "trust-test-ok-sell"]);
  const removed = Object.fromEntries((await pool.query("SELECT offer_id, reason FROM completed_offers_removed WHERE offer_id LIKE 'trust-test-%'")).rows.map((r) => [r.offer_id, r.reason]));
  assert.deepEqual(removed, { "trust-test-refunded": "state REFUNDED", "trust-test-wrong": "wallets differ from chain", "trust-test-ghost": "not on chain" });
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM ratings WHERE offer_id LIKE 'trust-test-%'")).rows[0].n, 1, "the real rating stays");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM ratings_removed WHERE offer_id LIKE 'trust-test-%'")).rows[0].n, 2, "fake ratings kept aside");

  assert.deepEqual(await recheckCompletedOffers(pool, { fetchOffers: async () => { throw new Error("must not read again"); }, key: KEY }), { skipped: true });
});
