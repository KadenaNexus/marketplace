/**
 * Payout details tests. Needs a Postgres with server/schema.sql applied (CI does this).
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kadena_nexus node --test server/payout.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import express from "express";
import { registerPayoutRoutes, cleanDetails, sidesOf } from "./payout.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/kadena_nexus" });
const SELLER = "k:" + "a".repeat(64), BUYER = "k:" + "b".repeat(64), OTHER = "k:" + "c".repeat(64), ARB = "k:" + "d".repeat(64);
const chain = new Map();
let server, base;

before(async () => {
  await pool.query("DELETE FROM trade_payouts WHERE offer_id LIKE 'offer-test-%'");
  const app = express();
  app.use(express.json());
  // the real server checks a wallet signature; here the wallet in the request is taken as proven
  const requireAuth = (req, from = "body") => { const w = (from === "query" ? req.query : req.body)?.wallet; return w ? { ok: true, wallet: w } : { ok: false, status: 400, error: "Missing wallet" }; };
  registerPayoutRoutes(app, { getPool: () => pool, requireAuth, sendAuthError: (res, a) => res.status(a.status).json({ error: a.error }), readEscrow: async (id) => chain.get(id) ?? null });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await pool.query("DELETE FROM trade_payouts WHERE offer_id LIKE 'offer-test-%'"); await pool.end(); });

const get = (id, wallet) => fetch(`${base}/api/offers/${id}/payout?wallet=${wallet}&publicKey=x&signedCmd=x`).then(async (r) => ({ status: r.status, body: await r.json() }));
const put = (id, wallet, details) => fetch(`${base}/api/offers/${id}/payout`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet, publicKey: "x", signedCmd: "x", details }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const USDT = [{ method: "USDT", value: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", network: "TRC20" }];

test("details are cleaned and limited", () => {
  assert.deepEqual(cleanDetails([{ method: " Wise ", value: " me@x.com " }, { method: "Revolut", value: "" }]), { details: [{ method: "Wise", value: "me@x.com" }] });
  assert.deepEqual(cleanDetails([{ method: "USDT", value: "0x52908400098527886E0F7030069857D2E4169EE7", network: "BEP20" }]).details[0].network, "BEP20");
  assert.match(cleanDetails([{ method: "USDT", value: "0x5290" }]).error, /choose the network/);
  assert.match(cleanDetails([{ method: "USDC", value: "0x52908400098527886E0F7030069857D2E4169EE7", network: "TRC20" }]).error, /does not fit the TRC20/);
  assert.ok(cleanDetails([]).error);
  assert.ok(cleanDetails([{ method: "Bank", value: "x".repeat(301) }]).error);
  assert.deepEqual(sidesOf({ side: "BUY", creator: BUYER, buyer: SELLER }), { holder: SELLER, payer: BUYER });
  // BRO (a Kadena token): paid to a Kadena account on chain 2 or 1
  assert.deepEqual(cleanDetails([{ method: "bro", value: SELLER, network: "2" }]).details[0], { method: "BRO", value: SELLER, network: "2" });
  assert.match(cleanDetails([{ method: "BRO", value: SELLER, network: "5" }]).error, /choose the chain/);
  assert.match(cleanDetails([{ method: "BRO", value: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", network: "2" }]).error, /Kadena account/, "a TRON address is not");
  assert.match(cleanDetails([{ method: "BRO", value: "0x5290 8400", network: "2" }]).error, /Kadena account/);
});

test("sell offer: the creator sets details; the buyer sees them only after accepting; locked once funded", async () => {
  const id = "offer-test-sell";
  chain.set(id, { side: "SELL", creator: SELLER, buyer: "", arbiter: ARB, state: "CREATED" });
  assert.equal((await put(id, OTHER, USDT)).status, 403, "not the KDA holder");
  assert.equal((await put(id, SELLER, USDT)).status, 200);
  assert.equal((await get(id, OTHER)).status, 403, "a stranger before accept");
  const mine = await get(id, SELLER);
  assert.deepEqual([mine.body.details, mine.body.isMine, mine.body.editable], [USDT, true, true]);

  chain.set(id, { side: "SELL", creator: SELLER, buyer: BUYER, arbiter: ARB, state: "ACCEPTED" });
  const b = await get(id, BUYER);
  assert.deepEqual([b.status, b.body.details, b.body.isMine], [200, USDT, false]);
  assert.equal((await get(id, OTHER)).status, 403, "a stranger after accept");
  assert.equal((await get(id, ARB)).status, 200, "the arbiter");

  chain.set(id, { side: "SELL", creator: SELLER, buyer: BUYER, arbiter: ARB, state: "FUNDED" });
  assert.equal((await put(id, SELLER, [{ method: "USDT", value: "0x52908400098527886E0F7030069857D2E4169EE7", network: "ERC20" }])).status, 409, "locked");
  assert.deepEqual((await get(id, BUYER)).body.details, USDT);
  assert.equal((await get(id, SELLER)).body.editable, false);
});

test("buy offer: the person who accepts (KDA holder) sets the details; the creator (payer) sees them", async () => {
  const id = "offer-test-buy";
  chain.set(id, { side: "BUY", creator: BUYER, buyer: "", arbiter: ARB, state: "CREATED" });
  assert.equal((await put(id, BUYER, USDT)).status, 403, "the payer cannot set where the seller is paid");
  chain.set(id, { side: "BUY", creator: BUYER, buyer: SELLER, arbiter: ARB, state: "ACCEPTED" });
  assert.equal((await put(id, SELLER, USDT)).status, 200);
  assert.deepEqual((await get(id, BUYER)).body.details, USDT);
  // trade went back to open and someone else accepted: the old holder's details are not shown to the new trade
  chain.set(id, { side: "BUY", creator: BUYER, buyer: OTHER, arbiter: ARB, state: "ACCEPTED" });
  assert.deepEqual((await get(id, BUYER)).body.details, []);
  assert.equal((await get(id, "k:" + "e".repeat(64))).status, 403);
  chain.delete("offer-test-none");
  assert.equal((await get("offer-test-none", SELLER)).status, 404);
});
