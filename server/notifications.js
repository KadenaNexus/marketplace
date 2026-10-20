/**
 * Trade notifications: an in-page feed per wallet plus Web Push to phones and browsers.
 *
 * A watcher reads every trade from the chain every 30 s (escrow v11, see chain.js), compares each state with
 * the last one it saw (table trade_states) and writes a notification for the party who needs to know or act:
 *   FUNDED (a take)  -> the buyer (pay, then Mark as Paid) and the seller ("taken", waiting for payment)
 *   PAID             -> the seller (check, release)   COMPLETED -> both (KDA released; swap or giveaway done)
 *   DISPUTED / REFUNDED / SPLIT -> both               CANCELLED -> the seller
 * plus deadline reminders before the trade's pay window or the release window runs out and notices when one
 * has, and one shared "new offer" item for everyone when a pool appears. The v10 wording (ACCEPTED, CLOSED,
 * fixed timers) is kept for the old escrows that `chain` may still carry.
 * Chat messages add a "new message" item for the recipient (no message text, only that one arrived).
 *
 * Everything in the feed is already public on chain except that a message exists, which is why the
 * feed shows no message text. Web Push uses VAPID keys generated on first start (stored in alert_state)
 * unless VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are set. NOTIFICATIONS_ENABLED=false switches it off.
 */
import { isToken, tokenSymbol } from "./tokens.js";
import rateLimit from "express-rate-limit";
import { ipKey } from "./clientIp.js";
import { z } from "zod";
import webpush from "web-push";
import { fetchChain, tradeAsLegacyEscrow, poolsById, configFor } from "./chain.js";

const T1 = 3600 * 1000, T2 = 4 * 3600 * 1000, T3 = 3600 * 1000;   // v10 deadlines: deposit, pay, release
const SOON = { ACCEPTED: 15 * 60 * 1000, FUNDED: 30 * 60 * 1000, PAID: 15 * 60 * 1000 };
const SOON_SHORT = 10 * 60 * 1000; // v11: a window shorter than an hour is reminded 10 min before the end
const NEW_OFFER_DAYS = 3;
const DETAILS_WAIT_MS = 3 * 60 * 1000;
const enabled = () => (process.env.NOTIFICATIONS_ENABLED || "true").toLowerCase() !== "false";
const short = (w) => (w && w.length > 14 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w || "someone");
const kda = (n) => `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 })} KDA`;
const money = (n, cur) => isToken(cur) ? `${Number(Number(n).toFixed(12)).toLocaleString("en-US", { maximumFractionDigits: 12 })} ${tokenSymbol(cur)}` : `${Math.abs(Number(n)) >= 1 || Number(n) === 0 ? Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) : Number(n).toLocaleString("en-US", { maximumSignificantDigits: 3 })} ${cur || ""}`.trim();
const parties = (e) => ({
  seller: e.side === "SELL" ? e.creator : e.buyer,
  buyer: e.side === "SELL" ? e.buyer : e.creator,
});

/** A free giveaway: a sell offer at price 0 with the "Giveaway" method. Nothing is paid; the winner only marks it. */
export const isGiveawayDetails = (d) => {
  if (!d || Number(d.price) !== 0 || !d.payment_method) return false;
  try { const m = JSON.parse(d.payment_method); return Array.isArray(m) && m.includes("Giveaway"); } catch (_) { return false; }
};

/** A v11 trade (chain.js tradeAsLegacyEscrow) carries its pool id; a v10 escrow does not. */
const isV11 = (e) => !!e.poolId;
/** v11 giveaway: a SELL pool at price 0 paid outside Kadena. Created COMPLETED on take, nothing to pay. */
const isFreeTrade = (e) => isV11(e) && !e.token && Number(e.price) === 0;
/** 900 -> "15 min", 3600 -> "1 hour", 5400 -> "1 h 30 min" */
const dur = (sec) => { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return !h ? `${m} min` : !m ? `${h} hour${h === 1 ? "" : "s"}` : `${h} h ${m} min`; };

/* ---------------- messages ---------------- */
/**
 * v11: what a trade state produces. A take funds at once, so a trade first appears as FUNDED (no accept,
 * no deposit); instant swaps and giveaways appear as COMPLETED. The seller or the pool's agent can release,
 * and the chain does not say who did, so COMPLETED says "released" and only the FUNDED text mentions the agent.
 */
function tradeEvents(prevState, e, tRelease = 3600) {
  const { seller, buyer } = parties(e);
  const out = [];
  const add = (wallet, kind, title, body, urgent = false) => { if (wallet) out.push({ wallet, kind, title, body, urgent }); };
  const pay = money(e.payAmount, e.currency), window = dur(e.payWindow || 0), release = dur(tRelease), sell = e.side === "SELL";
  switch (e.state) {
    case "FUNDED":
      // Auto-release trades: never quote the contract amount, the buyer must send the exact amount with the
      // identifying digits shown in the trade (a payment of the bare amount does not release anything).
      if (e.agent) add(buyer, "funded", `Action needed: send ${e.currency}`,
        `${sell ? `You took ${kda(e.amount)} from ${short(seller)}` : `${short(seller)} took your offer and locked ${kda(e.amount)} in escrow`}. Open the trade and send the exact ${e.currency} amount it shows (about ${pay}, with extra digits that identify your payment) to the seller's address within ${window}. The KDA is released to you automatically once the payment is seen.`, true);
      else add(buyer, "funded", `Action needed: send ${pay}`,
        `${sell ? `You took ${kda(e.amount)} from ${short(seller)}` : `${short(seller)} took your offer and locked ${kda(e.amount)} in escrow`}. Send ${pay} to the seller's ${e.currency} address shown in the trade within ${window}, then press Mark as Paid.`, true);
      add(seller, "taken", `${short(buyer)} took ${kda(e.amount)}, waiting for payment`,
        `${sell ? `${short(buyer)} took ${kda(e.amount)} from your offer` : `You took ${short(buyer)}'s offer and your ${kda(e.amount)} is in escrow`}. The buyer has ${window} to send ${pay} and mark it paid. Don't release anything until the ${e.currency} is in your wallet.`);
      break;
    case "PAID":
      add(seller, "paid", "Action needed: check the payment and release", `The buyer says they paid ${pay}. Check it arrived in your own wallet (a screenshot is not proof), then press Release to Buyer within ${release}.`, true);
      add(buyer, "marked", "Payment marked as sent", `The seller has ${release} to check your payment and release the ${kda(e.amount)} to you.`);
      break;
    case "COMPLETED":
      if (isFreeTrade(e)) {
        add(buyer, "completed", "Giveaway received", `${kda(e.amount)} from ${short(seller)} is in your wallet.`);
        add(seller, "completed", "Giveaway claimed", `${short(buyer)} claimed ${kda(e.amount)} from your giveaway.`);
      } else if (e.token) {
        add(buyer, "completed", "Swap complete", `You paid ${pay} and received ${kda(e.amount)}.`);
        add(seller, "completed", "Swap complete", `${short(buyer)} bought ${kda(e.amount)} for ${pay}, paid to your wallet.`);
      } else {
        add(buyer, "completed", "Trade complete", `${kda(e.amount)} was released to you.`);
        add(seller, "completed", "Trade complete", `${kda(e.amount)} was released to the buyer. Thanks for trading.`);
      }
      break;
    case "DISPUTED":
      for (const w of [seller, buyer]) add(w, "disputed", "A dispute was opened", "The arbiter will review this trade. Add your evidence in the Dispute tab.", true);
      break;
    case "REFUNDED":
      for (const w of [seller, buyer]) add(w, "refunded", "Trade refunded", `The ${kda(e.amount)} went back to the seller.`);
      break;
    case "CANCELLED":
      add(seller, "cancelled", "The buyer cancelled", `${short(buyer)} cancelled before paying. The ${kda(e.amount)} is back in your ${sell ? "offer" : "wallet"}.`);
      break;
    case "SPLIT":
      // the split amount is only in the chain event, not in the trade record, so the text cannot quote it
      for (const w of [seller, buyer]) add(w, "split", "The arbiter split the trade", `The arbiter divided the ${kda(e.amount)} between the buyer and the seller. Your part is in your wallet.`);
      break;
  }
  return out;
}

/**
 * The notifications a state change produces. Pure, for tests. `d` = offer details (price, currency) or null
 * (v10); `opts.tRelease` = the release window in seconds (v11, from the chain config).
 */
export function eventsForChange(prevState, e, d, { tRelease = 3600 } = {}) {
  if (isV11(e)) return tradeEvents(prevState, e, tRelease);
  const { seller, buyer } = parties(e);
  const out = [];
  const add = (wallet, kind, title, body, urgent = false) => { if (wallet) out.push({ wallet, kind, title, body, urgent }); };
  const total = d && d.price ? ` (${money(d.price * e.amount, d.fiat_currency)})` : "";
  if (isGiveawayDetails(d) && ["ACCEPTED", "FUNDED", "PAID"].includes(e.state)) {
    if (e.state === "ACCEPTED") {
      add(seller, "accepted", `Action needed: deposit ${kda(e.amount)}`, `${short(buyer)} accepted your free giveaway. Deposit the ${kda(e.amount)} into escrow within 1 hour, or the trade closes.`, true);
      add(buyer, "started", "You took a free giveaway", `The giver has 1 hour to lock ${kda(e.amount)} in escrow for you. There is nothing to pay.`);
    } else if (e.state === "FUNDED") {
      add(buyer, "funded", "Action needed: tap Mark as Paid", `${kda(e.amount)} is locked for you. There is nothing to pay: open the trade and press Mark as Paid (no screenshot needed) within 4 hours.`, true);
      add(seller, "locked", "Giveaway locked in escrow", `Your ${kda(e.amount)} is in escrow. The winner has 4 hours to press Mark as Paid.`);
    } else {
      add(seller, "paid", "Action needed: release the giveaway", `The winner confirmed. There is no payment to check: press Release to Buyer within 1 hour to send the ${kda(e.amount)}.`, true);
      add(buyer, "marked", "Confirmed", `The giver has 1 hour to release the ${kda(e.amount)} to you.`);
    }
    return out;
  }
  switch (e.state) {
    case "ACCEPTED":
      // Both sides hear the trade started; the one who must act gets "Action needed".
      // SELL offer: creator = KDA holder, accepter = payer. BUY offer: creator = payer, accepter = KDA holder.
      add(seller, "accepted", `Action needed: deposit ${kda(e.amount)}`,
        e.side === "SELL"
          ? `${short(buyer)} accepted your sell offer${total}. Deposit the ${kda(e.amount)} into escrow within 1 hour, or the trade closes.`
          : `You accepted an offer to sell ${kda(e.amount)}${total}. Deposit the KDA into escrow within 1 hour, or the trade closes.`, true);
      add(buyer, "started", "Trade started: don't pay yet",
        e.side === "SELL"
          ? `You accepted an offer to buy ${kda(e.amount)}${total}. The seller has 1 hour to lock the KDA in escrow. Pay only after the trade shows Funded.`
          : `${short(seller)} accepted your offer to buy ${kda(e.amount)}${total}. They have 1 hour to lock the KDA in escrow. Pay only after the trade shows Funded.`);
      break;
    case "FUNDED":
      add(buyer, "funded", "Action needed: send the payment", `The seller locked ${kda(e.amount)} in escrow. Send the payment${total}, then press Mark as Paid within 4 hours.`, true);
      add(seller, "locked", "KDA locked in escrow", `Your ${kda(e.amount)} is in escrow. The buyer has 4 hours to pay you${total} and mark it as paid. Don't release anything yet.`);
      break;
    case "PAID":
      add(seller, "paid", "Action needed: check the payment and release", `The buyer says they paid${total}. Check it arrived in your own account (a screenshot is not proof), then press Release to Buyer within 1 hour.`, true);
      add(buyer, "marked", "Payment marked as sent", `The seller has 1 hour to check your payment and release the ${kda(e.amount)} to you.`);
      break;
    case "COMPLETED":
      add(buyer, "completed", "Trade complete", `${kda(e.amount)} was released to you.`);
      add(seller, "completed", "Trade complete", `You released ${kda(e.amount)} to the buyer. Thanks for trading.`);
      break;
    case "DISPUTED":
      for (const w of [seller, buyer]) add(w, "disputed", "A dispute was opened", "The arbiter will review this trade. Add your evidence in the Dispute tab.", true);
      break;
    case "REFUNDED":
      for (const w of [seller, buyer]) add(w, "refunded", "Trade refunded", `The ${kda(e.amount)} went back to the seller.`);
      break;
    case "CLOSED":
      if (prevState === "ACCEPTED") for (const w of [seller, buyer]) add(w, "closed", "Trade closed", "The KDA was not deposited within 1 hour, so the trade was closed.");
      break;
  }
  return out;
}

/**
 * Reminders before a deadline and notices after one, from the chain times. Pure, for tests.
 * v10: fixed T1/T2/T3. v11: the trade's own pay window and the config's release window (`tRelease`, seconds);
 * a window shorter than an hour is reminded 10 minutes before the end, a longer one as before.
 */
export function deadlineEvents(e, now, d = null, tRelease = 3600) {
  const { seller, buyer } = parties(e);
  const free = isGiveawayDetails(d);
  const out = [];
  const left = (start, limit) => (start ? start + limit - now : null);
  const mins = (ms) => (ms >= 3600e3 ? `${Math.floor(ms / 3600e3)} h ${Math.round((ms % 3600e3) / 60e3)} min` : `${Math.max(1, Math.round(ms / 60e3))} min`);
  if (isV11(e)) {
    const soonFor = (limit) => (limit < 3600e3 ? SOON_SHORT : null);
    if (e.state === "FUNDED") {
      const limit = (e.payWindow || 0) * 1000, l = left(e.fundedAt, limit);
      if (l != null && l > 0 && l <= (soonFor(limit) ?? SOON.FUNDED)) out.push({ wallet: buyer, kind: "due-pay", title: `${mins(l)} left to pay`, body: e.agent ? "Send the payment before the time runs out; the KDA is released once it is seen." : "Send the payment and press Mark as Paid before the time runs out.", urgent: true });
      if (l != null && l <= 0 && l > -48 * 3600e3) out.push({ wallet: seller, kind: "expired-pay", title: "Payment window ended", body: `The buyer did not mark the payment within ${dur(e.payWindow || 0)}. You can reclaim your KDA: open the trade and press Refund.` });
    }
    if (e.state === "PAID") {
      const limit = tRelease * 1000, l = left(e.paidAt, limit);
      if (l != null && l > 0 && l <= (soonFor(limit) ?? SOON.PAID)) out.push({ wallet: seller, kind: "due-release", title: `${mins(l)} left to release`, body: "If the payment arrived, press Release to Buyer before the time runs out.", urgent: true });
      if (l != null && l <= 0 && l > -48 * 3600e3) for (const w of [seller, buyer]) out.push({ wallet: w, kind: "expired-release", title: "Release deadline passed", body: "Either side can now open a dispute so the arbiter can settle the trade." });
    }
    return out.filter((x) => x.wallet);
  }
  if (e.state === "ACCEPTED") {
    const l = left(e.acceptedAt, T1);
    if (l != null && l > 0 && l <= SOON.ACCEPTED) out.push({ wallet: seller, kind: "due-deposit", title: `${mins(l)} left to deposit`, body: `Deposit ${kda(e.amount)} into escrow before the trade closes.`, urgent: true });
  }
  if (e.state === "FUNDED") {
    const l = left(e.fundedAt, T2);
    if (l != null && l > 0 && l <= SOON.FUNDED) out.push({ wallet: buyer, kind: "due-pay", title: free ? `${mins(l)} left to claim your giveaway` : `${mins(l)} left to pay`, body: free ? "Nothing to pay: press Mark as Paid before the time runs out to receive the giveaway." : "Send the payment and press Mark as Paid before the time runs out.", urgent: true });
    if (l != null && l <= 0 && l > -48 * 3600e3) out.push({ wallet: seller, kind: "expired-pay", title: "Payment window ended", body: "The buyer did not mark the payment within 4 hours. You can reclaim your KDA: open the trade and press Refund." });
  }
  if (e.state === "PAID") {
    const l = left(e.paidAt, T3);
    if (l != null && l > 0 && l <= SOON.PAID) out.push({ wallet: seller, kind: "due-release", title: `${mins(l)} left to release`, body: free ? "Press Release to Buyer to send the giveaway before the time runs out." : "If the payment arrived, press Release to Buyer before the time runs out.", urgent: true });
    if (l != null && l <= 0 && l > -48 * 3600e3) for (const w of [seller, buyer]) out.push({ wallet: w, kind: "expired-release", title: "Release deadline passed", body: "Either side can now press Move to dispute so the arbiter can settle the trade." });
  }
  return out.filter((x) => x.wallet);
}

/** v11 pool: "Selling 1,000 KDA, 50–500 per trade, 0.01 USDT per KDA" (price and range are on the chain). */
export function poolOfferText(d) {
  const num = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 12 });
  const range = `${num(d.min)}–${num(d.max)} per trade`;
  if (!d.token && Number(d.price) === 0) return { title: "Free giveaway", body: `Free giveaway: ${kda(d.amount)}, ${range}. First come, first served.` };
  const body = `${d.side === "BUY" ? "Buying" : "Selling"} ${kda(d.amount)}, ${range}, ${num(d.price)} ${d.currency} per KDA${d.token ? ", instant" : ""}.`;
  return { title: d.side === "BUY" ? "New buy offer" : "New sell offer", body };
}

function newOfferText(n) {
  const d = n.data || {};
  if (d.poolId) return poolOfferText(d);
  const what = d.side === "BUY" ? `wants to buy ${kda(d.amount)}` : `is selling ${kda(d.amount)}`;
  let price = "";
  if (d.side !== "BUY" && isGiveawayDetails(n)) return { title: "Free giveaway", body: `${short(d.creator)} is giving away ${kda(d.amount)} for free. The first to accept gets it.` };
  if (n.price) {
    let methods = [];
    try { methods = JSON.parse(n.payment_method || "[]"); } catch (_) {}
    price = ` at ${Number(n.price).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${n.fiat_currency || ""} per KDA${methods.length ? `, paid by ${methods.slice(0, 3).join(", ")}` : ""}`;
  }
  return { title: d.side === "BUY" ? "New buy offer" : "New sell offer", body: `${short(d.creator)} ${what}${price}.` };
}

/* ---------------- push ---------------- */
let vapid = null;
async function vapidKeys(pool) {
  if (vapid) return vapid;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    const r = await pool.query("SELECT value FROM alert_state WHERE key = 'vapid'");
    if (r.rows[0]) vapid = JSON.parse(r.rows[0].value);
    else {
      vapid = webpush.generateVAPIDKeys();
      await pool.query("INSERT INTO alert_state (key, value) VALUES ('vapid', $1) ON CONFLICT (key) DO NOTHING", [JSON.stringify(vapid)]);
      const again = await pool.query("SELECT value FROM alert_state WHERE key = 'vapid'"); // another process may have won
      vapid = JSON.parse(again.rows[0].value);
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:alerts@kadena.ws", vapid.publicKey, vapid.privateKey);
  return vapid;
}

/** Default sender; tests inject their own. Returns "ok" | "gone" | "error". */
async function webPushSend(sub, payload) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: payload.urgent ? "high" : "normal" });
    return "ok";
  } catch (e) {
    return e.statusCode === 404 || e.statusCode === 410 ? "gone" : "error";
  }
}

async function pushTo(pool, subs, n, send) {
  // phone notifications carry the trade's short code (same as the colored #CODE on the site)
  const code = tradeCode(n.offer_id);
  const payload = { title: code && n.kind !== "new_offer" ? `${n.title} · #${code}` : n.title, body: n.body, url: n.offer_id ? `/?offer=${encodeURIComponent(n.offer_id)}` : "/", tag: `${n.offer_id || "x"}:${n.kind}`, urgent: !!n.urgent };
  let sent = 0;
  for (const s of subs) {
    const r = await send(s, payload);
    if (r === "ok") { sent++; await pool.query("UPDATE push_subscriptions SET last_ok_at = now(), fail_count = 0 WHERE id = $1", [s.id]); }
    else if (r === "gone") await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [s.id]);
    else await pool.query("UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = $1", [s.id]);
  }
  await pool.query("DELETE FROM push_subscriptions WHERE fail_count >= 20");
  return sent;
}

/** Store a notification once (wallet + offer + kind is unique) and push it to that wallet's devices. */
let createdHook = null;
/** Run `fn(row)` for every new notification for a wallet (used to email trade notifications). */
export function onNotificationCreated(fn) { createdHook = fn; }
/** Run `fn({ offerId, amount, wallets })` when a trade becomes COMPLETED (the live "trade completed" feed). */
let completedHook = null;
export function onTradeCompleted(fn) { completedHook = fn; }

export async function notify(pool, n, { send = webPushSend, now = Date.now() } = {}) {
  const r = await pool.query(
    `INSERT INTO notifications (wallet, offer_id, kind, title, body, urgent, data, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))
     ON CONFLICT (wallet, offer_id, kind) DO NOTHING RETURNING *`,
    [n.wallet, n.offer_id || "", n.kind, n.title, n.body, !!n.urgent, n.data ? JSON.stringify(n.data) : null, now]);
  if (!r.rows[0]) return { created: false, pushed: 0 };
  if (n.wallet === "*") return { created: true, pushed: 0 };
  // also by email, when the wallet turned trade emails on (server/tradeEmails.js)
  if (createdHook) Promise.resolve().then(() => createdHook(r.rows[0])).catch((e) => console.warn("[notifications] email:", e.message));
  if (send === webPushSend) await vapidKeys(pool);
  const subs = (await pool.query("SELECT * FROM push_subscriptions WHERE wallet = $1 AND trades", [n.wallet])).rows;
  return { created: true, pushed: subs.length ? await pushTo(pool, subs, r.rows[0], send) : 0 };
}

/** A chat message arrived: tell the recipient (without the text). */
export function notifyMessage(getPool, { id, from, to, offerId }) {
  if (!enabled() || !to) return;
  notify(getPool(), { wallet: to, offer_id: offerId || "", kind: `message:${id}`, title: "New message", body: `${short(from)} sent you a message${offerId ? " about a trade" : ""}.` })
    .catch((e) => console.error("[notifications] message:", e.message));
}

/* ---------------- watcher ---------------- */
async function details(pool, ids) {
  if (!ids.length) return new Map();
  const r = await pool.query("SELECT offer_id, price, fiat_currency, payment_method FROM offer_details WHERE offer_id = ANY($1)", [ids]);
  return new Map(r.rows.map((x) => [x.offer_id, x]));
}

/**
 * One round. By default the v11 chain is read: every trade (as a legacy escrow, see chain.js) and the open
 * pools. For tests `chain` (escrows), `pools`, `tRelease` and `now` can be injected; `send` replaces Web Push.
 * Pool states are kept in trade_states too (OPEN, then CLOSED once the pool leaves the open list).
 */
export async function runNotificationsOnce(pool, { chain, pools, tRelease, now = Date.now(), send = webPushSend } = {}) {
  let offers = chain, openPools = pools || [], release = tRelease ?? 3600;
  if (!offers) {
    const c = await fetchChain();
    const by = poolsById(c.pools);
    // each trade with its own chain's arbiter and release window (chains 1 and 2 each have a config row)
    offers = c.trades.map((t) => tradeAsLegacyEscrow(t, by, configFor(c, t.chain)));
    openPools = pools || c.pools.filter((p) => p.state === "OPEN");
    release = tRelease ?? c.config.tRelease;
  }
  const prev = new Map((await pool.query("SELECT offer_id, state FROM trade_states")).rows.map((r) => [r.offer_id, r.state]));
  const first = prev.size === 0 && !(await pool.query("SELECT 1 FROM alert_state WHERE key = 'notifications_initialized'")).rows[0];
  const d = await details(pool, offers.map((o) => o.id));
  const setState = (id, state) => pool.query("INSERT INTO trade_states (offer_id, state, updated_at) VALUES ($1, $2, now()) ON CONFLICT (offer_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()", [id, state]);
  let created = 0;
  for (const e of offers) {
    const before = prev.get(e.id);
    if (before !== e.state) {
      await setState(e.id, e.state);
      if (first) continue; // first run: remember what is there, announce nothing
      if (!before && e.state === "CREATED") {
        const r = await notify(pool, { wallet: "*", offer_id: e.id, kind: "new_offer", title: "New offer", body: "", data: { side: e.side, amount: e.amount, creator: e.creator } }, { send, now });
        if (r.created) created++;
      }
      // v10 reached COMPLETED only through PAID; a v11 instant swap or giveaway appears COMPLETED straight away
      if ((before || isV11(e)) && e.state === "COMPLETED" && completedHook) {
        const trade = isV11(e) ? { currency: e.currency, token: e.token, payAmount: e.payAmount, price: e.price, closedAt: e.closedAt } : undefined;
        try { completedHook({ offerId: e.id, amount: e.amount, wallets: [e.creator, e.buyer].filter(Boolean), ...(trade && { trade }) }); } catch (err) { console.warn("[notifications] completed hook:", err.message); }
      }
      for (const n of eventsForChange(before, e, d.get(e.id), { tRelease: e.tRelease ?? release })) { if ((await notify(pool, { ...n, offer_id: e.id }, { send, now })).created) created++; }
    }
    if (!first) for (const n of deadlineEvents(e, now, d.get(e.id), e.tRelease ?? release)) { if ((await notify(pool, { ...n, offer_id: e.id }, { send, now })).created) created++; }
  }
  // v11 pools: one shared "new offer" item when a pool appears; a pool that left the open list is CLOSED
  const openIds = new Set(openPools.map((p) => p.poolId));
  for (const p of openPools) {
    if (prev.get(p.poolId) === "OPEN") continue;
    await setState(p.poolId, "OPEN");
    if (first || prev.get(p.poolId)) continue;
    const data = { poolId: p.poolId, side: p.side, amount: p.available, min: p.min, max: p.max, price: p.price, currency: p.currency, token: p.token, creator: p.creator };
    if ((await notify(pool, { wallet: "*", offer_id: p.poolId, kind: "new_offer", title: "New offer", body: "", data }, { send, now })).created) created++;
  }
  for (const [id, state] of prev) if (state === "OPEN" && !openIds.has(id)) await setState(id, "CLOSED");
  if (first) await pool.query("INSERT INTO alert_state (key, value) VALUES ('notifications_initialized', $1) ON CONFLICT (key) DO NOTHING", [new Date(now).toISOString()]);

  // Push new offers to devices that asked for them, once the price is known (or after 3 min), while still open.
  const open = new Map([...offers.filter((o) => o.state === "CREATED").map((o) => [o.id, o]), ...openPools.map((p) => [p.poolId, p])]);
  const pending = (await pool.query(
    `SELECT n.*, od.price, od.fiat_currency, od.payment_method FROM notifications n LEFT JOIN offer_details od ON od.offer_id = n.offer_id
     WHERE n.wallet = '*' AND n.kind = 'new_offer' AND n.pushed_at IS NULL`)).rows;
  let offerPushes = 0;
  for (const n of pending) {
    const o = open.get(n.offer_id);
    const waited = now - new Date(n.created_at).getTime() >= DETAILS_WAIT_MS;
    if (o && n.price == null && !n.data?.poolId && !waited) continue; // a pool's price is on the chain: no wait
    await pool.query("UPDATE notifications SET pushed_at = now() WHERE id = $1", [n.id]);
    if (!o) continue;
    if (send === webPushSend) await vapidKeys(pool);
    const subs = (await pool.query("SELECT * FROM push_subscriptions WHERE offers AND (wallet IS NULL OR wallet <> $1)", [n.data?.creator || ""])).rows;
    if (subs.length) offerPushes += await pushTo(pool, subs, { ...n, ...newOfferText(n) }, send);
  }
  await pool.query("DELETE FROM notifications WHERE created_at < now() - interval '60 days'");
  return { first, created, offerPushes };
}

export function startNotificationWatcher(getPool, everyMs = 30 * 1000) {
  if (!enabled()) { console.log("[notifications] off"); return null; }
  let busy = false, fails = 0;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const r = await runNotificationsOnce(getPool());
      fails = 0;
      if (r.first || r.created || r.offerPushes) console.log("[notifications]", JSON.stringify(r));
    } catch (e) { if (++fails % 20 === 1) console.error("[notifications] round failed:", e.message); }
    finally { busy = false; }
  };
  setTimeout(tick, 8000);
  runSoon = () => {
    // a trade step was just confirmed: one round now (soon after the block), instead of up to 30 s later
    if (soonTimer) return;
    soonTimer = setTimeout(() => { soonTimer = null; void tick(); }, 1500);
  };
  console.log("[notifications] on");
  return setInterval(tick, everyMs);
}
let runSoon = null, soonTimer = null;
/** Ask for a notifications round right away (after a confirmed trade step). */
export function notifyTradeChangeSoon() { runSoon?.(); }

/** "offer-1791905154488-mpamy7" -> "MPAMY7" (same rule as src/components/TradeCode.tsx) */
export function tradeCode(offerId) {
  if (!offerId) return "";
  const last = String(offerId).split("-").pop() || "";
  return (/^[a-z0-9]{4,8}$/i.test(last) ? last : String(offerId).replace(/[^a-z0-9]/gi, "").slice(-6)).toUpperCase();
}

/* ---------------- HTTP API ---------------- */
const walletSchema = z.string().regex(/^k:[0-9a-f]{64}$/);
const subSchema = z.object({
  subscription: z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }),
  wallet: walletSchema.optional().nullable(),
  trades: z.boolean().default(true),
  offers: z.boolean().default(false),
});

export function registerNotificationRoutes(app, getPool) {
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: ipKey });

  // The feed: this wallet's trade items plus recent new offers by others. Newest first.
  app.get("/api/notifications", async (req, res) => {
    if (!enabled()) return res.json({ enabled: false, items: [] });
    const w = walletSchema.safeParse(req.query.wallet);
    const wallet = w.success ? w.data : null;
    try {
      const r = await getPool().query(
        `SELECT n.id, n.wallet, n.offer_id, n.kind, n.title, n.body, n.urgent, n.data, n.created_at, od.price, od.fiat_currency, od.payment_method, ts.state
           FROM notifications n
           LEFT JOIN offer_details od ON od.offer_id = n.offer_id
           LEFT JOIN trade_states ts ON ts.offer_id = n.offer_id
          WHERE (n.wallet = $1)
             OR (n.wallet = '*' AND n.created_at > now() - make_interval(days => $2::int) AND COALESCE(n.data->>'creator', '') <> COALESCE($1, ''))
          ORDER BY n.created_at DESC LIMIT 60`, [wallet, NEW_OFFER_DAYS]);
      const items = r.rows.map((n) => {
        const offer = n.wallet === "*";
        const t = offer ? newOfferText(n) : { title: n.title, body: n.body };
        return { id: n.id, kind: n.kind.startsWith("message:") ? "message" : n.kind.startsWith("proof:") ? "proof" : n.kind, scope: offer ? "offer" : "trade", offerId: n.offer_id || null,
          title: t.title, body: t.body, urgent: n.urgent, createdAt: n.created_at, open: offer ? n.state === "CREATED" || n.state === "OPEN" : undefined };
      });
      return res.json({ enabled: true, items });
    } catch (err) {
      console.error("GET /api/notifications", err.message);
      return res.status(500).json({ error: "Could not load notifications." });
    }
  });

  app.get("/api/push/key", async (_req, res) => {
    if (!enabled()) return res.json({ enabled: false });
    try { const k = await vapidKeys(getPool()); return res.json({ enabled: true, publicKey: k.publicKey }); }
    catch (err) { console.error("GET /api/push/key", err.message); return res.status(500).json({ error: "Push is not available." }); }
  });

  app.post("/api/push/subscribe", limiter, async (req, res) => {
    if (!enabled()) return res.status(503).json({ error: "Notifications are off." });
    const p = subSchema.safeParse(req.body || {});
    if (!p.success) return res.status(400).json({ error: "Invalid subscription" });
    const { subscription: s, wallet, trades, offers } = p.data;
    try {
      await getPool().query(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, wallet, trades, offers) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, wallet = EXCLUDED.wallet,
           trades = EXCLUDED.trades, offers = EXCLUDED.offers, fail_count = 0, updated_at = now()`,
        [s.endpoint, s.keys.p256dh, s.keys.auth, wallet || null, trades, offers]);
      return res.json({ ok: true });
    } catch (err) {
      console.error("POST /api/push/subscribe", err.message);
      return res.status(500).json({ error: "Could not save the subscription." });
    }
  });

  app.post("/api/push/unsubscribe", limiter, async (req, res) => {
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint.slice(0, 1000) : "";
    if (!endpoint) return res.status(400).json({ error: "Missing endpoint" });
    try { await getPool().query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]); return res.json({ ok: true }); }
    catch (err) { console.error("POST /api/push/unsubscribe", err.message); return res.status(500).json({ error: "Could not unsubscribe." }); }
  });
}
