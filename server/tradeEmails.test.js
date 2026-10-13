/**
 * Trade email tests. Needs a Postgres with server/schema.sql applied (CI does this). Emails go to a file.
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kadena_nexus node --test server/tradeEmails.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import express from "express";

const LOG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tmail-")), "mail.jsonl");
process.env.ALERTS_MAIL_LOG = LOG;
process.env.ALERTS_PUBLIC_URL = "https://market.test";
const { registerTradeEmailRoutes, emailNotification, emailable } = await import("./tradeEmails.js");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/kadena_nexus" });
const W = "k:" + "7".repeat(64);
let server, base;
const mails = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

before(async () => {
  await pool.query("DELETE FROM trade_emails WHERE wallet = $1", [W]);
  const app = express();
  app.use(express.json());
  const requireAuth = (req, from = "body") => { const w = (from === "query" ? req.query : req.body)?.wallet; return w ? { ok: true, wallet: w } : { ok: false, status: 400, error: "Missing wallet" }; };
  registerTradeEmailRoutes(app, { getPool: () => pool, requireAuth, sendAuthError: (res, a) => res.status(a.status).json({ error: a.error }) });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await pool.query("DELETE FROM trade_emails WHERE wallet = $1", [W]); await pool.end(); });

const post = (p, body) => fetch(`${base}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: W, publicKey: "x", signedCmd: "x", ...body }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const status = () => fetch(`${base}/api/trade-email?wallet=${W}&publicKey=x&signedCmd=x`).then((r) => r.json());
const n = (kind, title = "Your offer was accepted") => ({ wallet: W, offer_id: "offer-1-abcdef", kind, title, body: "Deposit the KDA within 1 hour." });

test("which notifications are emailed", () => {
  for (const k of ["accepted", "funded", "paid", "completed", "refunded", "closed", "disputed", "due-pay", "expired-release", "proof:4"]) assert.ok(emailable(k), k);
  for (const k of ["message:9", "new_offer", ""]) assert.ok(!emailable(k), k);
});

test("sign up, confirm, receive trade emails, turn off with one click", async () => {
  assert.equal((await post("/api/trade-email", { email: "not-an-email" })).status, 400);
  assert.equal((await post("/api/trade-email", { email: "Trader@Example.com" })).status, 200);
  assert.deepEqual(await status(), { available: true, email: "trader@example.com", confirmed: false, on: false });
  const confirm = mails().at(-1);
  assert.equal(confirm.kind, "trade-conf");
  assert.equal(await emailNotification(pool, n("accepted")), false, "nothing before the address is confirmed");

  const token = confirm.text.match(/token=([\w-]+)/)[1];
  const r = await fetch(`${base}/api/trade-email/confirm?token=${token}`, { redirect: "manual" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "https://market.test/?trade-email=on");
  assert.equal((await status()).on, true);

  assert.equal(await emailNotification(pool, n("accepted")), true);
  const m = mails().at(-1);
  assert.equal(m.to, "trader@example.com");
  assert.equal(m.subject, "Your offer was accepted · #ABCDEF");
  assert.match(m.text, /https:\/\/market\.test\/\?offer=offer-1-abcdef/);
  assert.match(m.headers["List-Unsubscribe"], /unsubscribe\?token=/);
  assert.equal(await emailNotification(pool, n("message:5", "New message")), false, "chat is not emailed");
  assert.equal(await emailNotification(pool, { ...n("accepted"), wallet: "*" }), false);

  const off = await fetch(`${base}/api/trade-email/unsubscribe?token=${token}`, { method: "POST" });
  assert.deepEqual(await off.json(), { ok: true });
  assert.equal((await status()).on, false);
  assert.equal(await emailNotification(pool, n("funded")), false, "off after one click");

  // same address again: back on without a new confirmation
  assert.deepEqual((await post("/api/trade-email", { email: "trader@example.com" })).body, { ok: true, confirmed: true });
  assert.equal((await status()).on, true);
});
