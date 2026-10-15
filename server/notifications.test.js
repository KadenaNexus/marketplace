/**
 * Trade notification tests. Needs a Postgres with server/schema.sql applied (CI does this).
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kadena_nexus node --test server/notifications.test.js
 * No chain and no real push: both are injected.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import express from "express";
import { eventsForChange, deadlineEvents, runNotificationsOnce, registerNotificationRoutes, notify, poolOfferText } from "./notifications.js";
import { tradeAsLegacyEscrow } from "./chain.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/kadena_nexus" });
const S = "k:" + "a".repeat(64), B = "k:" + "b".repeat(64), X = "k:" + "c".repeat(64);
const T0 = Date.parse("2026-10-13T08:00:00Z");
const esc = (o) => ({ id: "ntest-1", side: "SELL", amount: 1000, creator: S, buyer: "", state: "CREATED", acceptedAt: null, fundedAt: null, paidAt: null, ...o });
const sent = [];
const send = async (sub, payload) => { sent.push({ to: sub.wallet, endpoint: sub.endpoint, ...payload }); return sub.endpoint.includes("gone") ? "gone" : "ok"; };
const clean = () => pool.query("TRUNCATE trade_states, notifications, push_subscriptions RESTART IDENTITY; DELETE FROM alert_state WHERE key IN ('notifications_initialized', 'vapid'); DELETE FROM offer_details WHERE offer_id LIKE 'ntest-%'");

let server, base;
before(async () => {
  await clean();
  const app = express(); app.use(express.json());
  registerNotificationRoutes(app, () => pool);
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await clean(); await pool.end(); });

test("who is told what, per state change", () => {
  const d = { price: 0.0095, fiat_currency: "USD" };
  let ev = eventsForChange("CREATED", esc({ state: "ACCEPTED", buyer: B }), d);
  assert.deepEqual(ev.map((e) => [e.wallet, e.kind]), [[S, "accepted"], [B, "started"]], "both sides; the seller must act");
  assert.match(ev[0].title, /^Action needed: deposit/);
  assert.match(ev[0].body, /within 1 hour/);
  assert.match(ev[1].body, /Pay only after the trade shows Funded/);
  ev = eventsForChange("ACCEPTED", esc({ state: "FUNDED", buyer: B }), d);
  assert.deepEqual(ev.map((e) => [e.wallet, e.kind]), [[B, "funded"], [S, "locked"]]);
  assert.match(ev[0].title, /^Action needed: send the payment/);
  assert.match(ev[0].body, /9\.5 USD/);
  ev = eventsForChange("FUNDED", esc({ state: "PAID", buyer: B }), d);
  assert.deepEqual(ev.map((e) => [e.wallet, e.kind]), [[S, "paid"], [B, "marked"]]);
  assert.match(ev[0].title, /^Action needed: check the payment and release/);
  ev = eventsForChange("PAID", esc({ state: "COMPLETED", buyer: B }), d);
  assert.deepEqual(ev.map((e) => [e.wallet, e.kind]), [[B, "completed"], [S, "completed"]]);
  ev = eventsForChange("PAID", esc({ state: "DISPUTED", buyer: B }), d);
  assert.equal(ev.length, 2);
  ev = eventsForChange("CREATED", esc({ state: "CLOSED" }), d);
  assert.equal(ev.length, 0, "creator closing their own offer is not news");
  // BUY offer: the creator is the buyer, the accepter is the seller
  ev = eventsForChange("ACCEPTED", esc({ side: "BUY", state: "FUNDED", buyer: X }), d);
  assert.deepEqual(ev.map((e) => e.wallet), [S, X], "creator pays, accepter locked the KDA");
  ev = eventsForChange("CREATED", esc({ side: "BUY", state: "ACCEPTED", buyer: X }), d);
  assert.deepEqual(ev.map((e) => [e.wallet, e.kind]), [[X, "accepted"], [S, "started"]], "BUY offer: the accepter must deposit");
});

test("free giveaway: nothing to pay, no screenshot, one-tap texts", () => {
  const g = { price: 0, fiat_currency: "USD", payment_method: '["Giveaway"]' };
  let ev = eventsForChange("CREATED", esc({ state: "ACCEPTED", buyer: B }), g);
  assert.deepEqual(ev.map((e) => [e.wallet, e.kind]), [[S, "accepted"], [B, "started"]]);
  assert.match(ev[1].body, /nothing to pay/);
  ev = eventsForChange("ACCEPTED", esc({ state: "FUNDED", buyer: B }), g);
  assert.deepEqual(ev.map((e) => [e.wallet, e.kind]), [[B, "funded"], [S, "locked"]]);
  assert.match(ev[0].title, /Mark as Paid/);
  assert.match(ev[0].body, /no screenshot/);
  ev = eventsForChange("FUNDED", esc({ state: "PAID", buyer: B }), g);
  assert.match(ev[0].title, /release the giveaway/);
  assert.doesNotMatch(ev[0].body, /screenshot is not proof/);
  ev = eventsForChange("PAID", esc({ state: "COMPLETED", buyer: B }), g);
  assert.equal(ev.length, 2, "completion as usual");
  // price 0 without the Giveaway method (an offer with no details) is not a giveaway
  ev = eventsForChange("ACCEPTED", esc({ state: "FUNDED", buyer: B }), { price: 0, fiat_currency: "USD", payment_method: '["Bank Transfer"]' });
  assert.match(ev[0].title, /send the payment/);
  const soon = deadlineEvents(esc({ state: "FUNDED", buyer: B, fundedAt: T0 }), T0 + 4 * 3600e3 - 20 * 60e3, g);
  assert.match(soon[0].title, /left to claim your giveaway/);
});

test("deadline reminders and expiry notices", () => {
  const funded = esc({ state: "FUNDED", buyer: B, fundedAt: T0 });
  assert.equal(deadlineEvents(funded, T0 + 60 * 60e3).length, 0, "plenty of time");
  const soon = deadlineEvents(funded, T0 + 4 * 3600e3 - 20 * 60e3);
  assert.deepEqual(soon.map((e) => [e.wallet, e.kind]), [[B, "due-pay"]]);
  assert.match(soon[0].title, /20 min left to pay/);
  const late = deadlineEvents(funded, T0 + 4 * 3600e3 + 60e3);
  assert.deepEqual(late.map((e) => [e.wallet, e.kind]), [[S, "expired-pay"]]);
  const paid = deadlineEvents(esc({ state: "PAID", buyer: B, paidAt: T0 }), T0 + 3600e3 + 60e3);
  assert.equal(paid.length, 2);
});

test("watcher: silent first run, then feed items and pushes", async () => {
  sent.length = 0;
  await pool.query("INSERT INTO push_subscriptions (endpoint, p256dh, auth, wallet, trades, offers) VALUES ('https://push.example/seller', 'p', 'a', $1, true, false), ('https://push.example/buyer', 'p', 'a', $2, true, true), ('https://push.example/gone', 'p', 'a', $2, true, false), ('https://push.example/anon', 'p', 'a', NULL, false, true)", [S, B]);
  let r = await runNotificationsOnce(pool, { chain: [esc({ id: "ntest-old", state: "FUNDED", buyer: X, fundedAt: T0 })], now: T0, send });
  assert.equal(r.first, true);
  assert.equal((await pool.query("SELECT count(*)::int n FROM notifications")).rows[0].n, 0);

  // a new sell offer appears: one shared item; pushed to offer subscribers once its price is saved
  r = await runNotificationsOnce(pool, { chain: [esc({})], now: T0 + 30e3, send });
  assert.equal(r.created, 1);
  assert.equal(sent.length, 0, "waits for the price");
  await pool.query("INSERT INTO offer_details (offer_id, creator, amount, side, price, min_amount, max_amount, payment_method, fiat_currency) VALUES ('ntest-1', $1, 1000, 'SELL', 0.0095, 1000, 1000, '[\"Wise\"]', 'USD')", [S]);
  r = await runNotificationsOnce(pool, { chain: [esc({})], now: T0 + 60e3, send });
  assert.equal(r.offerPushes, 2, "buyer and the anonymous device; not the seller who made it");
  assert.match(sent[0].body, /is selling 1,000 KDA at 0\.0095 USD per KDA, paid by Wise/);
  assert.equal(sent[0].url, "/?offer=ntest-1");

  // accepted -> seller; funded -> buyer (the gone device is removed)
  sent.length = 0;
  await runNotificationsOnce(pool, { chain: [esc({ state: "ACCEPTED", buyer: B, acceptedAt: T0 + 90e3 })], now: T0 + 90e3, send });
  assert.deepEqual(sent.filter((s) => s.to === S).map((s) => s.title), ["Action needed: deposit 1,000 KDA · #NTEST1"], "push titles carry the trade code");
  assert.ok(sent.some((s) => s.to === B && /^Trade started/.test(s.title)), "the buyer hears too");
  sent.length = 0;
  await runNotificationsOnce(pool, { chain: [esc({ state: "FUNDED", buyer: B, acceptedAt: T0 + 90e3, fundedAt: T0 + 120e3 })], now: T0 + 120e3, send });
  // buyer: "send the payment"; seller: "KDA locked". (The gone device was dropped at the previous push.)
  assert.deepEqual(sent.map((s) => s.endpoint).sort(), ["https://push.example/buyer", "https://push.example/seller"]);
  assert.equal((await pool.query("SELECT count(*)::int n FROM push_subscriptions WHERE endpoint LIKE '%gone'")).rows[0].n, 0);

  // same state again: nothing new; close to the deadline: one reminder, once
  sent.length = 0;
  const funded = esc({ state: "FUNDED", buyer: B, acceptedAt: T0 + 90e3, fundedAt: T0 + 120e3 });
  await runNotificationsOnce(pool, { chain: [funded], now: T0 + 180e3, send });
  assert.equal(sent.length, 0);
  await runNotificationsOnce(pool, { chain: [funded], now: T0 + 120e3 + 4 * 3600e3 - 10 * 60e3, send });
  await runNotificationsOnce(pool, { chain: [funded], now: T0 + 120e3 + 4 * 3600e3 - 9 * 60e3, send });
  assert.deepEqual(sent.map((s) => s.title), ["10 min left to pay · #NTEST1"]);
});

/* ---------------- escrow v11: pools and trades ---------------- */
const poolOf = (o) => ({ poolId: "pool-ntest-p1", creator: S, side: "SELL", available: 900, locked: 100, min: 50, max: 500, price: 0.01, currency: "USDT", token: "", payWindow: 1800, agent: "", state: "OPEN", takes: 1, ...o });
const tradeOf = (o) => ({ tradeId: "trade-ntest-t1", poolId: "pool-ntest-p1", seller: S, buyer: B, amount: 100, price: 0.01, currency: "USDT", token: "", payAmount: 1, fee: 0, payWindow: 1800, agent: "", state: "FUNDED", fundedAt: new Date(T0).toISOString(), ...o });
const legacy = (t, p = poolOf()) => tradeAsLegacyEscrow(t, new Map([[p.poolId, p]]), X);

test("v11: a take appears FUNDED; who is told what per state", () => {
  let ev = eventsForChange(undefined, legacy(tradeOf()));
  assert.deepEqual(ev.map((e) => [e.wallet, e.kind]), [[B, "funded"], [S, "taken"]]);
  assert.equal(ev[0].title, "Action needed: send 1 USDT");
  assert.match(ev[0].body, /within 30 min, then press Mark as Paid/);
  assert.match(ev[1].title, /took 100 KDA, waiting for payment$/);
  // with an agent the release is automatic once the payment is seen
  ev = eventsForChange(undefined, legacy(tradeOf({ agent: X })));
  assert.match(ev[0].body, /released to you automatically once the payment is seen/);
  ev = eventsForChange("FUNDED", legacy(tradeOf({ state: "PAID" })), null, { tRelease: 1800 });
  assert.deepEqual(ev.map((e) => [e.wallet, e.kind]), [[S, "paid"], [B, "marked"]]);
  assert.match(ev[0].body, /paid 1 USDT.*within 30 min/);
  ev = eventsForChange("PAID", legacy(tradeOf({ state: "COMPLETED", agent: X })));
  assert.deepEqual(ev.map((e) => [e.wallet, e.kind]), [[B, "completed"], [S, "completed"]]);
  assert.match(ev[1].body, /^100 KDA was released to the buyer/, "the agent may have released: no 'you released'");
  ev = eventsForChange("FUNDED", legacy(tradeOf({ state: "CANCELLED" })));
  assert.deepEqual(ev.map((e) => [e.wallet, e.kind]), [[S, "cancelled"]]);
  assert.match(ev[0].body, /back in your offer/);
  ev = eventsForChange("DISPUTED", legacy(tradeOf({ state: "SPLIT" })));
  assert.deepEqual(ev.map((e) => [e.wallet, e.kind]), [[S, "split"], [B, "split"]]);
  assert.match(ev[0].body, /arbiter divided the 100 KDA/);
  assert.equal(eventsForChange("FUNDED", legacy(tradeOf({ state: "REFUNDED" }))).length, 2);
  assert.equal(eventsForChange("PAID", legacy(tradeOf({ state: "DISPUTED" }))).length, 2);
  // instant swap and giveaway: created COMPLETED, only the completion notice
  ev = eventsForChange(undefined, legacy(tradeOf({ state: "COMPLETED", token: "n_x.kb-usdc", currency: "kb-USDC", payAmount: 1.5 })));
  assert.deepEqual(ev.map((e) => [e.wallet, e.title]), [[B, "Swap complete"], [S, "Swap complete"]]);
  assert.match(ev[0].body, /paid 1\.5 kb-USDC and received 100 KDA/);
  ev = eventsForChange(undefined, legacy(tradeOf({ state: "COMPLETED", price: 0, payAmount: 0, currency: "KDA" })));
  assert.deepEqual(ev.map((e) => [e.wallet, e.title]), [[B, "Giveaway received"], [S, "Giveaway claimed"]]);
  // BUY pool: the creator pays, the taker locked the KDA
  const buyPool = poolOf({ poolId: "pool-ntest-buy", creator: B, side: "BUY" });
  ev = eventsForChange(undefined, legacy(tradeOf({ poolId: "pool-ntest-buy", seller: S, buyer: B }), buyPool));
  assert.deepEqual(ev.map((e) => [e.wallet, e.kind]), [[B, "funded"], [S, "taken"]]);
  assert.match(ev[0].body, /took your offer and locked 100 KDA/);
  assert.match(ev[1].body, /^You took .* offer and your 100 KDA is in escrow/);
  ev = eventsForChange("FUNDED", legacy(tradeOf({ poolId: "pool-ntest-buy", state: "CANCELLED" }), buyPool));
  assert.match(ev[0].body, /back in your wallet/);
});

test("v11: deadlines follow the trade's pay window and the release window", () => {
  const funded = legacy(tradeOf());
  assert.equal(deadlineEvents(funded, T0 + 5 * 60e3).length, 0, "25 min left: not yet");
  let ev = deadlineEvents(funded, T0 + 21 * 60e3);
  assert.deepEqual(ev.map((e) => [e.wallet, e.kind, e.title]), [[B, "due-pay", "9 min left to pay"]], "a 30 min window: reminded at 10 min");
  ev = deadlineEvents(funded, T0 + 31 * 60e3);
  assert.deepEqual(ev.map((e) => [e.wallet, e.kind]), [[S, "expired-pay"]]);
  assert.match(ev[0].body, /within 30 min/);
  const long = legacy(tradeOf({ payWindow: 4 * 3600 }));
  assert.equal(deadlineEvents(long, T0 + 4 * 3600e3 - 40 * 60e3).length, 0);
  assert.equal(deadlineEvents(long, T0 + 4 * 3600e3 - 20 * 60e3)[0].title, "20 min left to pay", "a long window: 30 min before, as before");
  const paid = legacy(tradeOf({ state: "PAID", paidAt: new Date(T0).toISOString() }));
  assert.deepEqual(deadlineEvents(paid, T0 + 50 * 60e3).map((e) => e.kind), ["due-release"], "default release window 1 h");
  assert.equal(deadlineEvents(paid, T0 + 61 * 60e3).length, 2);
  assert.deepEqual(deadlineEvents(paid, T0 + 22 * 60e3, null, 1800).map((e) => e.kind), ["due-release"], "config release window 30 min");
});

test("v11: new pool text", () => {
  assert.deepEqual(poolOfferText({ side: "SELL", amount: 1000, min: 50, max: 500, price: 0.01, currency: "USDT", token: "" }), { title: "New sell offer", body: "Selling 1,000 KDA, 50–500 per trade, 0.01 USDT per KDA." });
  assert.equal(poolOfferText({ side: "BUY", amount: 200, min: 10, max: 200, price: 0.012, currency: "USDC", token: "" }).body, "Buying 200 KDA, 10–200 per trade, 0.012 USDC per KDA.");
  assert.equal(poolOfferText({ side: "SELL", amount: 20, min: 1, max: 20, price: 0.5, currency: "kb-USDC", token: "n_x.kb-usdc" }).body, "Selling 20 KDA, 1–20 per trade, 0.5 kb-USDC per KDA, instant.");
  assert.deepEqual(poolOfferText({ side: "SELL", amount: 10, min: 1, max: 5, price: 0, currency: "KDA", token: "" }), { title: "Free giveaway", body: "Free giveaway: 10 KDA, 1–5 per trade. First come, first served." });
});

test("feed over HTTP, messages, and subscribing", async () => {
  await notify(pool, { wallet: B, offer_id: "ntest-1", kind: "message:77", title: "New message", body: "k:aaaa…aaaa sent you a message about a trade." }, { send });
  let r = await (await fetch(`${base}/api/notifications?wallet=${B}`)).json();
  const kinds = r.items.map((i) => i.kind);
  assert.ok(kinds.includes("funded") && kinds.includes("message") && kinds.includes("new_offer"), kinds.join(","));
  const offer = r.items.find((i) => i.kind === "new_offer");
  assert.equal(offer.scope, "offer");
  assert.match(offer.body, /paid by Wise/);
  r = await (await fetch(`${base}/api/notifications?wallet=${S}`)).json();
  assert.ok(!r.items.some((i) => i.kind === "new_offer"), "your own offer is not news to you");
  r = await (await fetch(`${base}/api/notifications`)).json();
  assert.deepEqual([...new Set(r.items.map((i) => i.scope))], ["offer"], "no wallet: only new offers");

  const key = await (await fetch(`${base}/api/push/key`)).json();
  assert.equal(key.enabled, true);
  assert.ok(key.publicKey.length > 60);
  const sub = { subscription: { endpoint: "https://push.example/new", keys: { p256dh: "x", auth: "y" } }, wallet: X, trades: true, offers: true };
  let res = await fetch(`${base}/api/push/subscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub) });
  assert.equal(res.status, 200);
  res = await fetch(`${base}/api/push/subscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...sub, wallet: "not-a-wallet" }) });
  assert.equal(res.status, 400);
  res = await fetch(`${base}/api/push/unsubscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: "https://push.example/new" }) });
  assert.equal(res.status, 200);
  assert.equal((await pool.query("SELECT count(*)::int n FROM push_subscriptions WHERE endpoint = 'https://push.example/new'")).rows[0].n, 0);
});

test("v11 watcher: pools announce themselves at once, trades notify from FUNDED, closed pools stop being open", async () => {
  sent.length = 0;
  const p = poolOf();
  // the pool appears: one shared item, pushed without waiting for off-chain details (price is on the chain)
  let r = await runNotificationsOnce(pool, { chain: [], pools: [p], now: T0 + 1000e3, send });
  assert.equal(r.created, 1);
  assert.equal(r.offerPushes, 2, "buyer device and the anonymous device");
  assert.equal(sent[0].body, "Selling 900 KDA, 50–500 per trade, 0.01 USDT per KDA.");
  assert.equal(sent[0].url, "/?offer=pool-ntest-p1");
  let feed = await (await fetch(`${base}/api/notifications?wallet=${B}`)).json();
  assert.equal(feed.items.find((i) => i.offerId === "pool-ntest-p1").open, true);
  // a take: the trade appears FUNDED
  sent.length = 0;
  r = await runNotificationsOnce(pool, { chain: [legacy(tradeOf({ fundedAt: new Date(T0 + 1030e3).toISOString() }))], pools: [p], now: T0 + 1030e3, send });
  assert.deepEqual(sent.map((s) => [s.endpoint.split("/").pop(), s.title]).sort(), [["buyer", "Action needed: send 1 USDT · #TESTT1"], ["seller", `${B.slice(0, 6)}…${B.slice(-4)} took 100 KDA, waiting for payment · #TESTT1`]]);
  // the pool is closed: it leaves the open list and the feed item is no longer open
  await runNotificationsOnce(pool, { chain: [legacy(tradeOf({ fundedAt: new Date(T0 + 1030e3).toISOString() }))], pools: [], now: T0 + 1060e3, send });
  assert.equal((await pool.query("SELECT state FROM trade_states WHERE offer_id = 'pool-ntest-p1'")).rows[0].state, "CLOSED");
  feed = await (await fetch(`${base}/api/notifications?wallet=${B}`)).json();
  assert.equal(feed.items.find((i) => i.offerId === "pool-ntest-p1").open, false);
});
