/**
 * Hiding forgotten offers. Needs a Postgres with server/schema.sql applied (CI does this).
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kadena_nexus node --test server/offerModeration.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import express from "express";
import { registerOfferModerationRoutes } from "./offerModeration.js";

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
    readEscrow: async (id) => { const o = chain.get(id); return o ? { creator: o.creator, buyer: o.buyer, arbiter: o.arbiter, side: o.side, state: o.state } : null; },
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
