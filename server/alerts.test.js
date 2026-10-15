/**
 * Offer alerts tests. Needs a Postgres with server/schema.sql applied (CI does this).
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kadena_nexus node --test server/alerts.test.js
 * Uses ALERTS_MAIL_LOG, so no email is sent and no chain is contacted.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import pg from "pg";
import express from "express";
import { matches, runAlertsOnce, registerAlertRoutes, offersEmail } from "./alerts.js";

const MAIL = path.join(os.tmpdir(), `alerts-mail-${process.pid}.jsonl`);
process.env.ALERTS_MAIL_LOG = MAIL;
process.env.ALERTS_PUBLIC_URL = "https://marketplace.example";
process.env.ALERTS_DIGEST_HOUR_UTC = "6";
delete process.env.RESEND_API_KEY;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/kadena_nexus" });
const mails = () => (fs.existsSync(MAIL) ? fs.readFileSync(MAIL, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const clearMail = () => fs.rmSync(MAIL, { force: true });
const offer = (id, side, amount, state = "CREATED") => ({ id, side, amount, state, creator: "k:c" });
const T0 = Date.parse("2026-10-12T03:00:00Z"); // before the 06:00 UTC summary

let server, base;
before(async () => {
  await pool.query("TRUNCATE alert_subscriptions, alert_offers_seen, alert_mail_log, alert_state RESTART IDENTITY");
  await pool.query("DELETE FROM offer_details WHERE offer_id LIKE 'alerttest-%'");
  clearMail();
  const app = express();
  app.use(express.json());
  registerAlertRoutes(app, () => pool);
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.close();
  await pool.query("TRUNCATE alert_subscriptions, alert_offers_seen, alert_mail_log, alert_state RESTART IDENTITY");
  await pool.query("DELETE FROM offer_details WHERE offer_id LIKE 'alerttest-%'");
  await pool.end();
  clearMail();
});

test("matching by side, currency and amount", () => {
  const sub = { want_sell: true, want_buy: false, currencies: "USD,EUR", min_kda: "100", max_kda: null };
  assert.equal(matches(sub, { side: "SELL", amount: 500, currency: "USD" }), true);
  assert.equal(matches(sub, { side: "BUY", amount: 500, currency: "USD" }), false);
  assert.equal(matches(sub, { side: "SELL", amount: 50, currency: "USD" }), false);
  assert.equal(matches(sub, { side: "SELL", amount: 500, currency: "GBP" }), false);
  assert.equal(matches(sub, { side: "SELL", amount: 500, currency: "" }), true, "unknown currency is not filtered out");
  assert.equal(matches({ want_sell: false, want_buy: true, currencies: "" }, { side: "BUY", amount: 1 }), true);
});

test("offer details are escaped in the email", () => {
  const m = offersEmail({ id: 1, token: "t".repeat(32), lang: "en" },
    [{ id: "x", side: "SELL", amount: 10, price: 0.07, currency: "USD", methods: ['<img src=x onerror=alert(1)>'] }]);
  assert.ok(!m.html.includes("<img src=x"));
  assert.ok(m.html.includes("&lt;img src=x"));
  assert.match(m.subject, /New offer: 10 KDA for sale at 0\.07 USD/);
  assert.equal(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

test("sign-up, confirm, manage, unsubscribe over HTTP", async () => {
  const post = (p, body, method = "POST") => fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let r = await post("/api/alerts/subscribe", { email: "Buyer@Example.com", wantSell: true, wantBuy: false, currencies: ["USD"], minKda: 100, frequency: "instant", lang: "en" });
  assert.equal(r.status, 200);
  let m = mails();
  assert.equal(m.length, 1, JSON.stringify(m.map((x) => [x.to, x.kind, x.subject])));
  assert.equal(m[0].kind, "confirm");
  assert.equal(m[0].to, "buyer@example.com");
  const token = m[0].text.match(/confirm=([A-Za-z0-9_-]+)/)[1];

  // nothing goes to an unconfirmed address
  assert.equal((await pool.query("SELECT confirmed_at FROM alert_subscriptions")).rows[0].confirmed_at, null);
  r = await post("/api/alerts/confirm", { token });
  const conf = await r.json();
  assert.equal(conf.settings.confirmed, true);
  assert.equal(conf.settings.email, "b••••@example.com");

  // signing up again with an active address does not change settings; the owner gets a manage link
  clearMail();
  await pool.query("UPDATE alert_subscriptions SET confirm_sent_at = now() - interval '1 hour'"); // outside the 10-minute resend guard
  r = await post("/api/alerts/subscribe", { email: "buyer@example.com", wantSell: false, wantBuy: true, frequency: "daily" });
  assert.equal(r.status, 200);
  const row = (await pool.query("SELECT * FROM alert_subscriptions")).rows[0];
  assert.equal(row.want_sell, true);
  assert.equal(row.frequency, "instant");
  assert.equal(mails()[0].kind, "manage");

  // settings with the token
  r = await post("/api/alerts/settings", { token, wantSell: true, wantBuy: true, currencies: [], minKda: null, maxKda: 1000, frequency: "instant", lang: "ar" }, "PUT");
  assert.equal((await r.json()).settings.lang, "ar");
  r = await post("/api/alerts/settings", { token, wantSell: false, wantBuy: false, frequency: "instant" }, "PUT");
  assert.equal(r.status, 400, "at least one kind of offer");
  r = await post("/api/alerts/settings", { token: "nope" });
  assert.equal(r.status, 400);

  // RFC 8058 one-click: form body, token in the query
  r = await fetch(`${base}/api/alerts/unsubscribe?token=${token}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  assert.equal(r.status, 200);
  assert.ok((await pool.query("SELECT unsubscribed_at FROM alert_subscriptions")).rows[0].unsubscribed_at);
  r = await post("/api/alerts/resubscribe", { token });
  assert.equal((await r.json()).settings.unsubscribed, false);

  // honeypot: bots get the same answer and no email
  clearMail();
  r = await post("/api/alerts/subscribe", { email: "bot@example.com", wantSell: true, wantBuy: false, website: "http://spam" });
  assert.equal(r.status, 200);
  assert.equal(mails().length, 0);
  await pool.query("TRUNCATE alert_subscriptions RESTART IDENTITY");
});

test("watcher: first run is silent, then instant alerts and a daily summary", async () => {
  clearMail();
  await pool.query("TRUNCATE alert_offers_seen, alert_mail_log, alert_state");
  const ins = (email, f, sell, buy, extra = "") => pool.query(
    `INSERT INTO alert_subscriptions (email, token, want_sell, want_buy, frequency, confirmed_at${extra ? ", min_kda" : ""}) VALUES ($1, $2, $3, $4, $5, now()${extra ? ", " + extra : ""})`,
    [email, `tok-${email.replace(/\W/g, "")}-0123456789abcdef`, sell, buy, f]);
  await ins("instant@example.com", "instant", true, false, "100");
  await ins("daily@example.com", "daily", true, true);
  await pool.query("INSERT INTO alert_subscriptions (email, token, want_sell, want_buy, frequency) VALUES ('unconfirmed@example.com', 'tok-unconfirmed-0123456789abcdef', true, true, 'instant')");

  // already-open offers at first run are not announced
  let r = await runAlertsOnce(pool, { now: T0, chain: [offer("alerttest-old", "SELL", 500)] });
  assert.equal(r.initialized, true);
  assert.equal(mails().length, 0);

  // a new SELL offer with details goes out at once; a small one is filtered by min 100
  await pool.query("INSERT INTO offer_details (offer_id, creator, amount, side, price, min_amount, max_amount, payment_method, fiat_currency) VALUES ('alerttest-a','k:c',500,'SELL',0.07,500,500,'[\"Wise\"]','USD'), ('alerttest-s','k:c',5,'SELL',0.07,5,5,'[]','USD')");
  const chain1 = [offer("alerttest-old", "SELL", 500), offer("alerttest-a", "SELL", 500), offer("alerttest-s", "SELL", 5), offer("alerttest-b", "BUY", 200)];
  r = await runAlertsOnce(pool, { now: T0 + 60e3, chain: chain1 });
  assert.deepEqual(r.announced.sort(), ["alerttest-a", "alerttest-s"], "alerttest-b waits for its details");
  let m = mails();
  assert.equal(m.length, 1);
  assert.equal(m[0].to, "instant@example.com");
  assert.match(m[0].subject, /500 KDA for sale at 0\.07 USD/);
  assert.match(m[0].text, /Wise/);

  // same offers again: nothing new
  r = await runAlertsOnce(pool, { now: T0 + 120e3, chain: chain1 });
  assert.equal(r.announced.length, 0);
  assert.equal(mails().length, 1);

  // the BUY offer without details is announced after 3 minutes; the instant subscriber wants SELL only
  r = await runAlertsOnce(pool, { now: T0 + 5 * 60e3, chain: chain1 });
  assert.deepEqual(r.announced, ["alerttest-b"]);
  assert.equal(mails().length, 1);

  // an offer that is accepted before it is announced is skipped
  r = await runAlertsOnce(pool, { now: T0 + 6 * 60e3, chain: [...chain1, offer("alerttest-c", "SELL", 300)] });
  r = await runAlertsOnce(pool, { now: T0 + 7 * 60e3, chain: [...chain1, offer("alerttest-c", "SELL", 300, "ACCEPTED")] });
  assert.equal(r.announced.length, 0);
  assert.equal(mails().length, 1);

  // 06:00 UTC: one summary for the daily subscriber, listing open offers with new ones first
  const at6 = Date.parse("2026-10-12T06:01:00Z");
  r = await runAlertsOnce(pool, { now: at6, chain: chain1 });
  assert.equal(r.digestSent, 1);
  m = mails();
  assert.equal(m.length, 2);
  assert.equal(m[1].to, "daily@example.com");
  assert.equal(m[1].kind, "daily");
  assert.match(m[1].subject, /4 open/);
  assert.ok(m[1].html.indexOf("alerttest-old") > m[1].html.indexOf("alerttest-a"), "new offers listed first");
  r = await runAlertsOnce(pool, { now: at6 + 60e3, chain: chain1 });
  assert.equal(r.digestSent, 0, "once per day");
  assert.ok(!m.some((x) => x.to === "unconfirmed@example.com"));
});

test("daily sending limit", async () => {
  clearMail();
  process.env.ALERTS_DAILY_LIMIT = "27"; // 25 reserved for confirmations and trade emails, so 2 alerts today
  await pool.query("TRUNCATE alert_subscriptions, alert_mail_log RESTART IDENTITY");
  await pool.query("TRUNCATE alert_state");
  await pool.query("INSERT INTO alert_state (key, value) VALUES ('initialized', 'x'), ('digest_date', $1)", [new Date().toISOString().slice(0, 10)]);
  for (let i = 0; i < 5; i++) await pool.query("INSERT INTO alert_subscriptions (email, token, want_sell, want_buy, frequency, confirmed_at) VALUES ($1, $2, true, true, 'instant', now())", [`s${i}@example.com`, `tok-limit-${i}-0123456789abcdef`]);
  await pool.query("INSERT INTO offer_details (offer_id, creator, amount, side, price, min_amount, max_amount, fiat_currency) VALUES ('alerttest-d','k:c',50,'SELL',0.06,50,50,'USD')");
  const r = await runAlertsOnce(pool, { now: Date.now(), chain: [offer("alerttest-d", "SELL", 50)] });
  assert.equal(r.instantSent, 2);
  assert.equal(mails().length, 2);
  delete process.env.ALERTS_DAILY_LIMIT;
});
