/**
 * Dispute authorization tests (server/authz.js). Needs a Postgres with server/schema.sql applied (CI does this).
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kadena_nexus node --test server/authz.test.js
 * No chain: the escrow is injected. The wallet signature is not checked here (the real requireAuth does that);
 * a request with `session=1` stands for a saved session token instead of a fresh signature.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import express from "express";
import { createDisputeAuthz } from "./authz.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/kadena_nexus" });
const SELLER = "k:" + "a".repeat(64), BUYER = "k:" + "b".repeat(64), OTHER = "k:" + "c".repeat(64), ARB = "k:" + "d".repeat(64);
const escrows = new Map();
let chainDown = false;
const clean = () => pool.query("DELETE FROM disputes WHERE offer_id LIKE 'authztest-%'; DELETE FROM evidence WHERE offer_id LIKE 'authztest-%'; DELETE FROM dispute_messages WHERE offer_id LIKE 'authztest-%'");

let server, base;
before(async () => {
  await clean();
  const app = express();
  app.use(express.json());
  const requireAuth = (req, from = "body", opts = {}) => {
    const d = from === "query" ? req.query : req.body;
    if (!d?.wallet) return { ok: false, status: 400, error: "Missing wallet" };
    if (opts.allowSession === false && d.session === "1") return { ok: false, status: 403, error: "Proof of ownership failed", reason: "This action needs a fresh wallet signature" };
    return { ok: true, wallet: d.wallet };
  };
  const sendAuthError = (res, a) => res.status(a.status).json({ error: a.error, ...(a.reason && { reason: a.reason }) });
  const readEscrow = async (id) => { if (chainDown) throw new Error("down"); return escrows.get(id) ?? null; };
  const { requireDisputeParty, requireArbiter } = createDisputeAuthz({ getPool: () => pool, requireAuth, sendAuthError, readEscrow });
  app.get("/party/:id", async (req, res) => { const p = await requireDisputeParty(req, res, req.params.id, "query"); if (p.ok) res.json({ wallet: p.wallet }); });
  app.post("/party/:id", async (req, res) => { const p = await requireDisputeParty(req, res, req.params.id, "body"); if (p.ok) res.json({ wallet: p.wallet }); });
  app.post("/arbiter/:id", async (req, res) => { const p = await requireArbiter(req, res, req.params.id, "body"); if (p.ok) res.json({ wallet: p.wallet, arbiter: p.escrow.arbiter }); });
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await clean(); await pool.end(); });

const get = (id, wallet) => fetch(`${base}/party/${id}?wallet=${wallet}&publicKey=x&signedCmd=x`).then(async (r) => ({ status: r.status, body: await r.json() }));
const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publicKey: "x", signedCmd: "x", ...body }) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test("a dispute is for the holder, the payer and the arbiter; the wallet in the request must be the signed-in one", async () => {
  escrows.set("authztest-1", { creator: SELLER, buyer: BUYER, arbiter: ARB, side: "SELL", state: "DISPUTED" });
  assert.equal((await get("authztest-1", SELLER)).status, 200);
  assert.equal((await get("authztest-1", BUYER)).status, 200);
  assert.equal((await get("authztest-1", ARB)).status, 200);
  assert.equal((await get("authztest-1", OTHER)).status, 403);
  assert.equal((await fetch(`${base}/party/authztest-1`)).status, 400, "no wallet");
  // a BUY offer: the creator pays, the accepter holds the KDA
  escrows.set("authztest-buy", { creator: BUYER, buyer: SELLER, arbiter: ARB, side: "BUY", state: "DISPUTED" });
  assert.equal((await get("authztest-buy", SELLER)).status, 200);
  assert.equal((await get("authztest-buy", BUYER)).status, 200);
  assert.equal((await get("authztest-buy", OTHER)).status, 403);
  // body form too
  assert.equal((await post("/party/authztest-1", { wallet: BUYER })).status, 200);
  chainDown = true;
  assert.equal((await get("authztest-1", BUYER)).status, 502, "the chain could not be read");
  chainDown = false;
});

test("after a refund (the chain forgot the buyer) whoever opened the dispute or sent evidence keeps access; a past message does not", async () => {
  escrows.set("authztest-2", { creator: SELLER, buyer: "", arbiter: ARB, side: "SELL", state: "REFUNDED" });
  assert.equal((await get("authztest-2", BUYER)).status, 403, "nothing on record yet");
  // a message on record alone (however it got there) does not open the dispute to its sender
  await pool.query("INSERT INTO dispute_messages (offer_id, from_wallet, message) VALUES ('authztest-2', $1, 'hello')", [OTHER]);
  assert.equal((await get("authztest-2", OTHER)).status, 403);
  await pool.query("INSERT INTO disputes (offer_id, opened_by, reason, opened_by_wallet) VALUES ('authztest-2', 'buyer', 'no refund', $1)", [BUYER]);
  assert.equal((await get("authztest-2", BUYER)).status, 200, "opened the dispute");
  await pool.query("INSERT INTO evidence (offer_id, submitted_by, explanation, files) VALUES ('authztest-3', $1, 'receipt', '[]')", [BUYER]);
  escrows.set("authztest-3", { creator: SELLER, buyer: "", arbiter: ARB, side: "SELL", state: "REFUNDED" });
  assert.equal((await get("authztest-3", BUYER)).status, 200, "sent evidence");
  assert.equal((await get("authztest-3", OTHER)).status, 403);
  // no trade on the chain at all: only the record counts
  assert.equal((await get("authztest-none", BUYER)).status, 403);
  assert.equal((await get("authztest-2", SELLER)).status, 200, "the holder is still on the chain");
});

test("arbiter actions: the arbiter of that trade only, with a fresh signature", async () => {
  escrows.set("authztest-4", { creator: SELLER, buyer: BUYER, arbiter: ARB, side: "SELL", state: "DISPUTED" });
  let r = await post("/arbiter/authztest-4", { wallet: ARB });
  assert.deepEqual([r.status, r.body], [200, { wallet: ARB, arbiter: ARB }]);
  assert.equal((await post("/arbiter/authztest-4", { wallet: SELLER })).status, 403, "the seller");
  assert.equal((await post("/arbiter/authztest-4", { wallet: BUYER })).status, 403, "the buyer");
  assert.equal((await post("/arbiter/authztest-4", { wallet: OTHER })).status, 403, "a stranger who signed their own wallet");
  r = await post("/arbiter/authztest-4", { wallet: ARB, session: "1" });
  assert.equal(r.status, 403, "a saved session is not enough for an arbiter action");
  assert.match(r.body.reason, /fresh wallet signature/);
  assert.equal((await post("/arbiter/authztest-4", { wallet: ARB, publicKey: undefined, signedCmd: undefined })).status, 200);
  assert.equal((await post("/arbiter/authztest-none", { wallet: ARB })).status, 404, "no such trade");
  escrows.set("authztest-5", { creator: SELLER, buyer: BUYER, arbiter: "", side: "SELL", state: "DISPUTED" });
  assert.equal((await post("/arbiter/authztest-5", { wallet: ARB })).status, 403, "a trade with no arbiter has nobody who can act");
  assert.equal((await post("/arbiter/authztest-5", { wallet: "" })).status, 400);
  chainDown = true;
  assert.equal((await post("/arbiter/authztest-4", { wallet: ARB })).status, 502);
  chainDown = false;
  // being a party of the dispute does not make a wallet the arbiter, and the other way round
  escrows.set("authztest-6", { creator: SELLER, buyer: BUYER, arbiter: OTHER, side: "SELL", state: "DISPUTED" });
  assert.equal((await post("/arbiter/authztest-6", { wallet: ARB })).status, 403, "another trade's arbiter");
  assert.equal((await post("/arbiter/authztest-6", { wallet: OTHER })).status, 200);
});
