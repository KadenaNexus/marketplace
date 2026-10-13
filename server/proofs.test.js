/**
 * Proof of payment tests. Needs a Postgres with server/schema.sql applied (CI does this).
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kadena_nexus node --test server/proofs.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import express from "express";
import multer from "multer";
import { registerProofRoutes, cleanReference } from "./proofs.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/kadena_nexus" });
const SELLER = "k:" + "a".repeat(64), BUYER = "k:" + "b".repeat(64), OTHER = "k:" + "c".repeat(64), ARB = "k:" + "d".repeat(64);
const chain = new Map();
const added = [];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proofs-"));
let server, base;
const clean = () => pool.query("DELETE FROM payment_proofs WHERE offer_id LIKE 'offer-test-%'");

before(async () => {
  await clean();
  const app = express();
  app.use(express.json());
  const requireAuth = (req, from = "body") => { const w = (from === "query" ? req.query : req.body)?.wallet; return w ? { ok: true, wallet: w } : { ok: false, status: 400, error: "Missing wallet" }; };
  registerProofRoutes(app, {
    getPool: () => pool, requireAuth, sendAuthError: (res, a) => res.status(a.status).json({ error: a.error }),
    upload: multer({ dest: dir }), isAllowedFile: () => true,
    readEscrow: async (id) => chain.get(id) ?? null, onAdded: (x) => added.push(x),
  });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await clean(); await pool.end(); fs.rmSync(dir, { recursive: true, force: true }); });

const post = (id, wallet, { reference, file } = {}) => {
  const fd = new FormData();
  fd.append("wallet", wallet); fd.append("publicKey", "x"); fd.append("signedCmd", "x");
  if (reference) fd.append("reference", reference);
  if (file) fd.append("file", new Blob([file], { type: "image/png" }), "pay.png");
  return fetch(`${base}/api/offers/${id}/proof`, { method: "POST", body: fd }).then(async (r) => ({ status: r.status, body: await r.json() }));
};
const get = (id, wallet) => fetch(`${base}/api/offers/${id}/proof?wallet=${wallet}&publicKey=x&signedCmd=x`).then(async (r) => ({ status: r.status, body: await r.json() }));

test("references are cleaned", () => {
  assert.equal(cleanReference(" 0xabc\n123 "), "0xabc 123");
  assert.equal(cleanReference("x".repeat(400)).length, 300);
});

test("the buyer adds proof; the seller is told; both sides and the arbiter can read it", async () => {
  const id = "offer-test-proof";
  chain.set(id, { side: "SELL", creator: SELLER, buyer: BUYER, arbiter: ARB, state: "FUNDED" });
  assert.equal((await post(id, BUYER)).status, 400, "needs a file or a reference");
  assert.equal((await post(id, SELLER, { reference: "x" })).status, 403, "the seller cannot add the buyer's proof");
  const r = await post(id, BUYER, { reference: "TRC20 tx 9f3a…", file: "PNGDATA" });
  assert.equal(r.status, 200);
  assert.deepEqual(added.map((a) => [a.offerId, a.to]), [[id, SELLER]]);
  for (const w of [BUYER, SELLER, ARB]) {
    const g = await get(id, w);
    assert.equal(g.status, 200, w);
    assert.equal(g.body[0].reference, "TRC20 tx 9f3a…");
    assert.match(g.body[0].fileUrl, /^\/uploads\/chat\//);
  }
  assert.equal((await get(id, OTHER)).status, 403);
  chain.set(id, { side: "SELL", creator: SELLER, buyer: BUYER, arbiter: ARB, state: "COMPLETED" });
  assert.equal((await post(id, BUYER, { reference: "late" })).status, 409, "finished trades take no new proof");
});

test("buy offer: the creator is the payer", async () => {
  const id = "offer-test-proof-buy";
  chain.set(id, { side: "BUY", creator: BUYER, buyer: SELLER, arbiter: ARB, state: "FUNDED" });
  assert.equal((await post(id, BUYER, { reference: "Wise ref 77" })).status, 200);
  assert.equal((await get(id, SELLER)).body[0].reference, "Wise ref 77");
});
