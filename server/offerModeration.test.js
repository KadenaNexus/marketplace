/**
 * Hiding forgotten offers. Needs a Postgres with server/schema.sql applied (CI does this).
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kadena_nexus node --test server/offerModeration.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import express from "express";
import { registerOfferModerationRoutes, expireOldOffers, poolExpiryReminders } from "./offerModeration.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/kadena_nexus" });
const ARB = "k:" + "d".repeat(64), MAKER = "k:" + "a".repeat(64), OTHER = "k:" + "c".repeat(64);
const chain = new Map();
const told = [];
let server, base;

const clean = () => pool.query("DELETE FROM hidden_offers WHERE offer_id LIKE 'mod-test-%'");
before(async () => {
  await clean();
  const app = express();
  app.use(express.json());
  // the real server checks a wallet signature; here the wallet in the request is taken as proven
  const requireAuth = (req, from = "body") => { const w = (from === "query" ? req.query : req.body)?.wallet; return w ? { ok: true, wallet: w } : { ok: false, status: 400, error: "Missing wallet" }; };
  registerOfferModerationRoutes(app, {
    getPool: () => pool, requireAuth, sendAuthError: (res, a) => res.status(a.status).json({ error: a.error }),
    readEscrow: async (id) => { const o = chain.get(id); return o ? { ...o } : null; },
    chainOffers: async () => [...chain.values()],
    notifyFn: async (_p, n) => { told.push(n); return { created: true }; },
  });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await clean(); await pool.end(); });

const call = (method, id, wallet, body = {}) => fetch(`${base}/api/offers/${id}/hide`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet, publicKey: "x", signedCmd: "x", ...body }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const hiddenIds = async () => (await (await fetch(`${base}/api/hidden-offers`)).json()).map((x) => x.offerId).filter((id) => id.startsWith("mod-test-"));

test("the arbiter hides an open offer; the creator is told once; it can be shown again", async () => {
  chain.set("mod-test-open", { id: "mod-test-open", state: "CREATED", side: "SELL", amount: 50, creator: MAKER, buyer: "", arbiter: ARB });
  assert.equal((await call("POST", "mod-test-open", OTHER)).status, 403, "not the arbiter");
  assert.equal((await call("POST", "mod-test-open", MAKER)).status, 403, "the creator cannot hide (they can delete)");
  assert.equal((await call("POST", "mod-test-open", ARB, { reason: "inactive" })).status, 200);
  assert.equal((await call("POST", "mod-test-open", ARB)).status, 200, "twice is fine");
  assert.deepEqual(await hiddenIds(), ["mod-test-open"]);
  assert.equal(told.length, 1);
  assert.equal(told[0].wallet, MAKER);
  assert.equal(told[0].kind, "hidden");
  assert.match(told[0].body, /Nothing was locked/);
  assert.equal((await call("DELETE", "mod-test-open", OTHER)).status, 403);
  assert.equal((await call("DELETE", "mod-test-open", ARB)).status, 200);
  assert.deepEqual(await hiddenIds(), []);
});

test("v11 pools: an OPEN pool can be hidden, a CLOSED one not; the admin list shows price, range and expiry from the chain", async () => {
  const p = { id: "mod-test-pool", poolId: "mod-test-pool", state: "OPEN", side: "SELL", amount: 900, available: 900, min: 50, max: 500, price: 0.01, currency: "USDT", creator: MAKER, arbiter: ARB, expiresAt: "2026-11-01T00:00:00.000Z", createdAt: "2026-10-15T10:00:00.000Z" };
  chain.set("mod-test-pool", p);
  assert.equal((await call("POST", "mod-test-pool", OTHER)).status, 403);
  assert.equal((await call("POST", "mod-test-pool", ARB, { reason: "stale" })).status, 200);
  assert.ok((await hiddenIds()).includes("mod-test-pool"));
  assert.match(told.at(-1).body, /Close it from My offers/);
  const rows = (await (await fetch(`${base}/api/admin/open-offers?wallet=${ARB}&publicKey=x&signedCmd=x`)).json()).filter((x) => x.offerId === "mod-test-pool");
  assert.deepEqual([rows[0].price, rows[0].currency, rows[0].min, rows[0].max, rows[0].expiresAt, rows[0].createdAt, rows[0].hidden.reason], [0.01, "USDT", 50, 500, "2026-11-01T00:00:00.000Z", "2026-10-15T10:00:00.000Z", "stale"]);
  assert.equal((await call("DELETE", "mod-test-pool", ARB)).status, 200);
  chain.set("mod-test-pool", { ...p, state: "CLOSED" });
  assert.equal((await call("POST", "mod-test-pool", ARB)).status, 409);
  chain.delete("mod-test-pool");
});

test("a day before a pool's on-chain expiry its creator is told once; a new expiry is reminded again", async () => {
  const now = Date.parse("2026-10-31T12:00:00Z"), DAY = 86400000;
  const pools = [
    { poolId: "mod-test-exp-soon", creator: MAKER, state: "OPEN", expiresAt: new Date(now + 12 * 3600000).toISOString() },
    { poolId: "mod-test-exp-later", creator: MAKER, state: "OPEN", expiresAt: new Date(now + 3 * DAY).toISOString() },
    { poolId: "mod-test-exp-never", creator: MAKER, state: "OPEN" },
    { poolId: "mod-test-exp-past", creator: MAKER, state: "OPEN", expiresAt: new Date(now - 3600000).toISOString() },
    { poolId: "mod-test-exp-closed", creator: MAKER, state: "CLOSED", expiresAt: new Date(now + 3600000).toISOString() },
  ];
  const sent = [];
  const notifyFn = async (_p, n) => { const dup = sent.some((x) => x.kind === n.kind); if (!dup) sent.push(n); return { created: !dup }; };
  let r = await poolExpiryReminders(pool, { pools, now, notifyFn });
  assert.deepEqual(r.warned, ["mod-test-exp-soon"]);
  assert.deepEqual([sent[0].wallet, sent[0].offer_id], [MAKER, "mod-test-exp-soon"]);
  assert.match(sent[0].kind, /^expiring-pool-/);
  assert.match(sent[0].body, /in about 12 hours/);
  assert.match(sent[0].body, /unsold KDA stays in the offer/);
  r = await poolExpiryReminders(pool, { pools, now: now + 3600000, notifyFn });
  assert.deepEqual(r.warned, [], "only once per expiry");
  pools[0].expiresAt = new Date(now + 20 * 3600000).toISOString();
  r = await poolExpiryReminders(pool, { pools, now, notifyFn });
  assert.deepEqual(r.warned, ["mod-test-exp-soon"], "the creator extended it: reminded again before the new expiry");
});

test("only open offers: accepted, funded or unknown offers are refused", async () => {
  for (const state of ["ACCEPTED", "FUNDED", "PAID", "COMPLETED"]) {
    chain.set("mod-test-busy", { id: "mod-test-busy", state, side: "SELL", amount: 5, creator: MAKER, buyer: OTHER, arbiter: ARB });
    assert.equal((await call("POST", "mod-test-busy", ARB)).status, 409, state);
  }
  assert.equal((await call("POST", "mod-test-none", ARB)).status, 404);
});

test("the admin list shows your open offers with age and creator activity", async () => {
  chain.set("mod-test-list", { id: "mod-test-list", state: "CREATED", side: "BUY", amount: 7, creator: MAKER, buyer: "", arbiter: ARB });
  chain.set("mod-test-elsewhere", { id: "mod-test-elsewhere", state: "CREATED", side: "BUY", amount: 7, creator: MAKER, buyer: "", arbiter: OTHER });
  await call("POST", "mod-test-list", ARB);
  const r = await fetch(`${base}/api/admin/open-offers?wallet=${ARB}&publicKey=x&signedCmd=x`);
  const rows = (await r.json()).filter((x) => x.offerId.startsWith("mod-test-"));
  assert.deepEqual(rows.map((x) => x.offerId).sort(), ["mod-test-list", "mod-test-open"]);
  const listed = rows.find((x) => x.offerId === "mod-test-list");
  assert.equal(listed.hidden.reason, "inactive");
  assert.ok(listed.code, "trade code");
  const other = await (await fetch(`${base}/api/admin/open-offers?wallet=${OTHER}&publicKey=x&signedCmd=x`)).json();
  assert.deepEqual(other.filter((x) => x.offerId.startsWith("mod-test-")).map((x) => x.offerId), ["mod-test-elsewhere"]);
});

test("open offers listed longer than the limit expire; the creator can list them again", async () => {
  await pool.query("DELETE FROM offer_details WHERE offer_id LIKE 'mod-test-%'");
  await pool.query("DELETE FROM offer_relists WHERE offer_id LIKE 'mod-test-%'");
  const DAY = 86400000, now = Date.now();
  const offers = [
    { id: "mod-test-old", state: "CREATED", side: "SELL", amount: 9, creator: MAKER, buyer: "", arbiter: ARB },
    { id: "mod-test-new", state: "CREATED", side: "SELL", amount: 9, creator: MAKER, buyer: "", arbiter: ARB },
    { id: "mod-test-taken", state: "ACCEPTED", side: "SELL", amount: 9, creator: MAKER, buyer: OTHER, arbiter: ARB },
  ];
  for (const [id, age] of [["mod-test-old", 8], ["mod-test-new", 2], ["mod-test-taken", 30]]) {
    await pool.query(`INSERT INTO offer_details (offer_id, creator, amount, side, price, min_amount, max_amount, created_at) VALUES ($1, $2, 9, 'SELL', 0.01, 9, 9, to_timestamp($3 / 1000.0))`, [id, MAKER, now - age * DAY]);
  }
  const sent = [];
  const notifyFn = async (_p, n) => { sent.push(n); };
  const r = await expireOldOffers(pool, { offers, now, days: 7, notifyFn });
  assert.deepEqual(r.hidden, ["mod-test-old"], "only the open offer listed 7+ days");
  assert.equal(sent.length, 1);
  assert.match(sent[0].kind, /^expired-offer-/);
  assert.match(sent[0].body, /listed for 7 days/);
  assert.deepEqual((await expireOldOffers(pool, { offers, now, days: 7, notifyFn })).hidden, [], "already hidden: not again");
  assert.deepEqual((await expireOldOffers(pool, { offers, now, days: 0, notifyFn })).hidden, [], "0 turns the rule off");

  // listing again: only the creator, and the clock starts over
  for (const o of offers) chain.set(o.id, o);
  const relist = (wallet) => fetch(`${base}/api/offers/mod-test-old/relist`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet, publicKey: "x", signedCmd: "x" }) });
  assert.equal((await relist(OTHER)).status, 403);
  assert.equal((await relist(MAKER)).status, 200);
  assert.ok(!(await hiddenIds()).includes("mod-test-old"));
  assert.deepEqual((await expireOldOffers(pool, { offers, now: Date.now(), days: 7, notifyFn })).hidden, [], "relisted just now");
  assert.deepEqual((await expireOldOffers(pool, { offers, now: Date.now() + 8 * DAY, days: 7, notifyFn })).hidden.sort(), ["mod-test-new", "mod-test-old"], "both expire a period later");
  await pool.query("DELETE FROM hidden_offers WHERE offer_id = 'mod-test-new'");

  // hidden by the arbiter (not expired): the creator cannot undo that
  await call("POST", "mod-test-new", ARB, { reason: "inactive" });
  assert.equal((await fetch(`${base}/api/offers/mod-test-new/relist`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: MAKER, publicKey: "x", signedCmd: "x" }) })).status, 403);
  await pool.query("DELETE FROM offer_details WHERE offer_id LIKE 'mod-test-%'");
  await pool.query("DELETE FROM offer_relists WHERE offer_id LIKE 'mod-test-%'");
});

test("a day before expiry the creator is told once; keeping it listed restarts the clock", async () => {
  await pool.query("DELETE FROM offer_details WHERE offer_id LIKE 'mod-test-%'");
  await pool.query("DELETE FROM offer_relists WHERE offer_id LIKE 'mod-test-%'");
  await pool.query("DELETE FROM hidden_offers WHERE offer_id LIKE 'mod-test-%'");
  const DAY = 86400000, now = Date.now();
  const offers = [{ id: "mod-test-soon", state: "CREATED", side: "SELL", amount: 9, creator: MAKER, buyer: "", arbiter: ARB }];
  await pool.query(`INSERT INTO offer_details (offer_id, creator, amount, side, price, min_amount, max_amount, created_at) VALUES ('mod-test-soon', $1, 9, 'SELL', 0.01, 9, 9, to_timestamp($2 / 1000.0))`, [MAKER, now - 6.5 * DAY]);
  const sent = [];
  const notifyFn = async (_p, n) => { const dup = sent.some((x) => x.kind === n.kind); if (!dup) sent.push(n); return { created: !dup }; };
  let r = await expireOldOffers(pool, { offers, now, days: 7, notifyFn });
  assert.deepEqual([r.hidden, r.warned], [[], ["mod-test-soon"]], "warned, not hidden");
  assert.match(sent[0].kind, /^expiring-offer-/);
  assert.match(sent[0].body, /in about 12 hours/);
  r = await expireOldOffers(pool, { offers, now: now + 3600000, days: 7, notifyFn });
  assert.deepEqual(r.warned, [], "only once");
  assert.equal(sent.length, 1);
  // keep listed: the creator relists before it expires
  chain.set("mod-test-soon", offers[0]);
  assert.equal((await fetch(`${base}/api/offers/mod-test-soon/relist`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: MAKER, publicKey: "x", signedCmd: "x" }) })).status, 200);
  r = await expireOldOffers(pool, { offers, now: Date.now() + 2 * DAY, days: 7, notifyFn });
  assert.deepEqual([r.hidden, r.warned], [[], []], "a fresh listing period");
  r = await expireOldOffers(pool, { offers, now: Date.now() + 6.5 * DAY, days: 7, notifyFn });
  assert.deepEqual(r.warned, ["mod-test-soon"], "warned again at the end of the new period");
  await pool.query("DELETE FROM offer_details WHERE offer_id LIKE 'mod-test-%'");
  await pool.query("DELETE FROM offer_relists WHERE offer_id LIKE 'mod-test-%'");
});
