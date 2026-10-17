/**
 * Offer alerts by email.
 *
 * Anyone can sign up with an email address (no wallet needed) to hear about new offers:
 *  - offers to SELL KDA (for people who want to buy), offers to BUY KDA (for people who want to sell), or both
 *  - optional filters: pricing currency and an amount range in KDA
 *  - instant (checked every minute) or one daily summary
 * Double opt-in: nothing is sent until the address is confirmed. Every email carries a manage link
 * and a one-click unsubscribe (RFC 8058 List-Unsubscribe headers).
 *
 * Trust: side, amount and state come from the chain. Escrow v11: price, currency and the per-trade range are on
 * the chain too (a pool, see chain.js); the payment networks come from pool_details. v10 (`chain` injected):
 * price, currency and payment methods come from offer_details (written by the creator's browser). Either way
 * they are shown escaped and never as links.
 *
 * Off unless RESEND_API_KEY is set (or ALERTS_MAIL_LOG for local testing). Env:
 *   RESEND_API_KEY        Resend key (account where kadena.ws is verified)
 *   ALERTS_FROM           default "Kadena Nexus Alerts <alerts@kadena.ws>"
 *   ALERTS_PUBLIC_URL     default "https://marketplace.kadena.ws"
 *   ALERTS_DAILY_LIMIT    emails per UTC day across all alert mail, default 80 (Resend free plan: 100/day)
 *   ALERTS_DIGEST_HOUR_UTC hour the daily summary goes out, default 6 (09:00 Riyadh)
 *   ALERTS_ENABLED=false  switch everything off without removing the key
 *   ALERTS_MAIL_LOG       write emails to this JSONL file instead of sending (testing)
 *   ALERTS_CHAIN_API      comma-separated Chainweb base URLs (default: community, chaddex, kadena)
 */
import { isToken } from "./tokens.js";
import crypto from "crypto";
import fs from "fs";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { hash as blakeHash } from "@kadena/cryptography-utils";
import { fetchChain } from "./chain.js";

export const ALERT_CURRENCIES = ["USD", "EUR", "SAR", "AED", "BRO", "USDT", "USDC", "kb-USDC", "kb-ETH", "FLUX"];

const env = (k, d) => (process.env[k] && process.env[k].trim() !== "" ? process.env[k].trim() : d);
const cfg = () => ({
  key: env("RESEND_API_KEY", ""),
  mailLog: env("ALERTS_MAIL_LOG", ""),
  from: env("ALERTS_FROM", "Kadena Nexus Alerts <alerts@kadena.ws>"),
  url: env("ALERTS_PUBLIC_URL", "https://marketplace.kadena.ws").replace(/\/$/, ""),
  dailyLimit: Number(env("ALERTS_DAILY_LIMIT", "80")),
  digestHour: Number(env("ALERTS_DIGEST_HOUR_UTC", "6")),
  off: env("ALERTS_ENABLED", "true").toLowerCase() === "false",
  contract: `${env("VITE_CONTRACT_NAMESPACE", "free")}.${env("VITE_CONTRACT_MODULE", "p2p-escrow-v10")}`,
  apis: env("ALERTS_CHAIN_API", "https://api.chainweb-community.org,https://chainweb.chaddex.com,https://api.chainweb.com")
    .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean),
});
export const mailConfig = () => cfg();
export const alertsEnabled = () => { const c = cfg(); return !c.off && !!(c.key || c.mailLog); };

/* ---------------- helpers ---------------- */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const newToken = () => crypto.randomBytes(24).toString("base64url");
const fmtNum = (n, max = 4) => (Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: max }) : "?");
/** Money: 2 decimals from 1 up; small amounts keep 3 significant digits (0.23 KDA × 0.001 = "0.00023", not "0"). */
export const fmtMoney = (n) => (!Number.isFinite(n) ? "?" : Math.abs(n) >= 1 || n === 0 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toLocaleString("en-US", { maximumSignificantDigits: 3 }));
const num = (x) => (x && typeof x === "object" ? Number(x.decimal ?? x.int ?? 0) : Number(x || 0));
/** Pact time as {timep|time: iso} or iso; the contract stores 1970 for "not set". Returns ms or null. */
export const chainTime = (v) => { const s = v && typeof v === "object" ? v.timep || v.time : v; const t = s ? Date.parse(s) : NaN; return t > 86400000 ? t : null; };
function methodsOf(raw) {
  try { const a = JSON.parse(raw || "[]"); return Array.isArray(a) ? a.map((m) => String(m).slice(0, 40)).slice(0, 8) : []; }
  catch { return raw ? [String(raw).slice(0, 60)] : []; }
}

/* ---------------- chain ---------------- */
export async function fetchChainOffers() {
  const c = cfg();
  const code = `(map (lambda (id) (+ {"id":id} (${c.contract}.get-escrow id))) (${c.contract}.list-escrow-ids))`;
  const ct = Math.floor(Date.now() / 1000);
  const cmd = JSON.stringify({ networkId: "mainnet01", payload: { exec: { code, data: {} } }, signers: [], meta: { chainId: "1", sender: "", gasLimit: 1000000, gasPrice: 1e-8, ttl: 600, creationTime: ct }, nonce: `alerts-${ct}` });
  const body = JSON.stringify({ cmd, hash: blakeHash(cmd), sigs: [] });
  let last;
  for (const base of c.apis) {
    try {
      const r = await fetch(`${base}/chainweb/0.0/mainnet01/chain/1/pact/api/v1/local?preflight=false&signatureVerification=false`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status} from ${base}`);
      const d = await r.json();
      if (d.result?.status !== "success") throw new Error(`Pact error: ${d.result?.error?.message || "unknown"}`);
      return (d.result.data || []).map((e) => ({
        id: String(e.id), state: String(e.state || "").toUpperCase(), side: String(e.side || "").toUpperCase() === "BUY" ? "BUY" : "SELL",
        amount: num(e.amount), creator: String(e.creator || ""), buyer: String(e.buyer || ""), arbiter: String(e.arbiter || ""),
        acceptedAt: chainTime(e.acceptedAt), fundedAt: chainTime(e.fundedAt), paidAt: chainTime(e.paidAt),
      }));
    } catch (e) { last = e; if (String(e.message).startsWith("Pact error")) throw e; }
  }
  throw new Error(`All Chainweb nodes failed: ${last?.message}`);
}

/** A v11 pool in the shape the alert watcher and emails use. Open pools are "CREATED" here; price and range come with it. */
export function poolAsAlertOffer(p) {
  return { id: p.poolId, state: p.state === "OPEN" ? "CREATED" : p.state, side: p.side, amount: p.available, creator: p.creator, price: p.price, currency: p.currency, token: p.token, min: p.min, max: p.max };
}
export async function fetchChainPools() { return (await fetchChain()).pools.map(poolAsAlertOffer); }

/* ---------------- matching ---------------- */
/** Does an offer (chain data + optional details) match a subscription? Pure, for tests. */
export function matches(sub, offer) {
  if (offer.side === "SELL" && !sub.want_sell) return false;
  if (offer.side === "BUY" && !sub.want_buy) return false;
  const cur = (sub.currencies || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (cur.length && offer.currency && !cur.includes(offer.currency)) return false;
  if (sub.min_kda != null && offer.amount < Number(sub.min_kda)) return false;
  if (sub.max_kda != null && offer.amount > Number(sub.max_kda)) return false;
  return true;
}

/* ---------------- email text ---------------- */
const T = {
  en: {
    dir: "ltr",
    selling: (a) => `Selling ${a} KDA`, buying: (a) => `Buying ${a} KDA`,
    price: "Price per KDA", total: "Total", perTrade: "Per trade", pay: "Payment", posted: "Posted", view: "View offer", isNew: "New",
    subjOne: (o) => `New offer: ${o.side === "SELL" ? `${fmtNum(o.amount)} KDA for sale` : `buying ${fmtNum(o.amount)} KDA`}${o.price ? ` at ${fmtNum(o.price, isToken(o.currency) ? 12 : 6)} ${o.currency}` : ""}`,
    subjMany: (n) => `${n} new KDA offers on Kadena P2P Marketplace`,
    subjDigest: (n) => `Today's KDA offers: ${n} open on Kadena P2P Marketplace`,
    introOne: "A new offer matching your alerts was just posted.",
    introMany: (n) => `${n} new offers matching your alerts were just posted.`,
    introDigest: "Open offers matching your alerts. New ones in the last 24 hours are marked.",
    firstCome: "Offers go to whoever accepts first. Open the Marketplace in Linx Wallet (Explore → Web3 Apps → Kadena → Kadena P2P Marketplace) to accept; the KDA is held in the on-chain escrow until the trade completes.",
    why: "You get this because you signed up for offer alerts on Kadena P2P Marketplace.",
    manage: "Change alerts", unsub: "Unsubscribe", part: "Part of Kadena Nexus",
    confirmSubj: "Confirm your Kadena Nexus offer alerts",
    confirmIntro: "Please confirm you want email alerts about new offers on Kadena P2P Marketplace. Nothing is sent until you confirm.",
    confirmBtn: "Confirm alerts",
    confirmIgnore: "If you did not ask for this, ignore this email and nothing will be sent.",
    yourSettings: "Your choices",
    sideSell: "Offers to sell KDA (you buy)", sideBuy: "Offers to buy KDA (you sell)",
    anyCur: "any currency", anyAmt: "any amount", inst: "instant", daily: "daily summary",
    manageSubj: "Manage your Kadena Nexus offer alerts",
    manageIntro: "This address already gets offer alerts. Use the button to change or stop them.",
    manageBtn: "Manage alerts",
    more: (n) => `and ${n} more on the Marketplace`,
  },
  ar: {
    dir: "rtl",
    selling: (a) => `بيع ${a} KDA`, buying: (a) => `شراء ${a} KDA`,
    price: "السعر لكل KDA", total: "الإجمالي", perTrade: "لكل صفقة", pay: "طريقة الدفع", posted: "نُشر", view: "عرض العرض", isNew: "جديد",
    subjOne: (o) => `عرض جديد: ${o.side === "SELL" ? `${fmtNum(o.amount)} KDA للبيع` : `شراء ${fmtNum(o.amount)} KDA`}${o.price ? ` بسعر ${fmtNum(o.price, isToken(o.currency) ? 12 : 6)} ${o.currency}` : ""}`,
    subjMany: (n) => `${n} عروض KDA جديدة في سوق Kadena P2P`,
    subjDigest: (n) => `عروض KDA اليوم: ${n} عرض مفتوح في سوق Kadena P2P`,
    introOne: "نُشر للتو عرض جديد يطابق تنبيهاتك.",
    introMany: (n) => `نُشرت للتو ${n} عروض جديدة تطابق تنبيهاتك.`,
    introDigest: "العروض المفتوحة التي تطابق تنبيهاتك. العروض الجديدة خلال آخر 24 ساعة مُعلَّمة.",
    firstCome: "العرض لمن يقبله أولًا. افتح السوق من داخل محفظة Linx ‏(Explore ← Web3 Apps ← Kadena ← Kadena P2P Marketplace) لقبول العرض، وتبقى KDA محفوظة في الضمان على السلسلة حتى تكتمل الصفقة.",
    why: "تصلك هذه الرسالة لأنك اشتركت في تنبيهات العروض في سوق Kadena P2P.",
    manage: "تعديل التنبيهات", unsub: "إلغاء الاشتراك", part: "جزء من Kadena Nexus",
    confirmSubj: "أكّد اشتراكك في تنبيهات عروض Kadena Nexus",
    confirmIntro: "يرجى تأكيد رغبتك في استلام تنبيهات بالبريد عن العروض الجديدة في سوق Kadena P2P. لن نرسل شيئًا قبل التأكيد.",
    confirmBtn: "تأكيد التنبيهات",
    confirmIgnore: "إذا لم تطلب ذلك فتجاهل هذه الرسالة ولن يصلك شيء.",
    yourSettings: "اختياراتك",
    sideSell: "عروض بيع KDA (أنت تشتري)", sideBuy: "عروض شراء KDA (أنت تبيع)",
    anyCur: "أي عملة", anyAmt: "أي كمية", inst: "فوري", daily: "ملخص يومي",
    manageSubj: "إدارة تنبيهات عروض Kadena Nexus",
    manageIntro: "هذا البريد مشترك بالفعل في تنبيهات العروض. استخدم الزر لتعديلها أو إيقافها.",
    manageBtn: "إدارة التنبيهات",
    more: (n) => `و${n} عروض أخرى في السوق`,
  },
};

const TEAL = "#1C637B", ORANGE = "#E2710A", INK = "#123A48", MIST = "#4F6B76", LINE = "#D6E0E4";
export function shell({ lang, title, body, footer }) {
  const t = T[lang] || T.en;
  const html = `<!doctype html><html lang="${lang}" dir="${t.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;background:#F4F7F8;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:${INK}">
<div style="max-width:560px;margin:0 auto;padding:24px 16px" dir="${t.dir}">
<div style="font-weight:700;font-size:17px;margin-bottom:16px"><img src="${cfg().url}/nexus-mark.png" width="24" height="24" alt="" style="vertical-align:middle;margin:0 6px"> <span dir="ltr">Kadena P2P Marketplace</span><br><span style="font-weight:400;font-size:13px;color:${MIST}">${esc(t.part)}</span></div>
<div style="background:#fff;border:1px solid ${LINE};border-radius:12px;padding:20px">${body}</div>
<div style="font-size:12px;color:${MIST};margin-top:16px;line-height:1.6">${footer || ""}</div>
</div></body></html>`;
  return html;
}
export const button = (href, label, color = TEAL) => `<a href="${esc(href)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">${esc(label)}</a>`;
const links = (sub) => ({
  manage: `${cfg().url}/alerts?token=${encodeURIComponent(sub.token)}`,
  unsub: `${cfg().url}/alerts?token=${encodeURIComponent(sub.token)}&unsubscribe=1`,
  oneClick: `${cfg().url}/api/alerts/unsubscribe?token=${encodeURIComponent(sub.token)}`,
});
function footerFor(sub, lang) {
  const t = T[lang] || T.en, l = links(sub);
  return `${esc(t.why)}<br><a href="${esc(l.manage)}" style="color:${MIST}">${esc(t.manage)}</a> · <a href="${esc(l.unsub)}" style="color:${MIST}">${esc(t.unsub)}</a>`;
}
function settingsSummary(sub, lang) {
  const t = T[lang] || T.en;
  const sides = [sub.want_sell && t.sideSell, sub.want_buy && t.sideBuy].filter(Boolean).join(" · ");
  const cur = sub.currencies ? sub.currencies.split(",").join(", ") : t.anyCur;
  const amt = sub.min_kda != null || sub.max_kda != null ? `${sub.min_kda != null ? fmtNum(Number(sub.min_kda)) : "0"}–${sub.max_kda != null ? fmtNum(Number(sub.max_kda)) : "∞"} KDA` : t.anyAmt;
  return `<div style="font-size:13px;color:${MIST};margin-top:14px"><b>${esc(t.yourSettings)}:</b> ${esc(sides)} · ${esc(cur)} · ${esc(amt)} · ${esc(sub.frequency === "daily" ? t.daily : t.inst)}</div>`;
}
function offerCard(o, lang, markNew) {
  const t = T[lang] || T.en;
  const head = o.side === "SELL" ? t.selling(fmtNum(o.amount)) : t.buying(fmtNum(o.amount));
  const rows = [];
  if (o.price) rows.push([t.price, `${fmtNum(o.price, isToken(o.currency) ? 12 : 6)} ${o.currency}`], [t.total, `${(isToken(o.currency) ? fmtNum(o.price * o.amount, 12) : fmtMoney(o.price * o.amount))} ${o.currency}`]);
  if (o.min != null && o.max != null) rows.push([t.perTrade, `${fmtNum(o.min)}–${fmtNum(o.max)} KDA`]);
  if (o.methods?.length) rows.push([t.pay, o.methods.join(", ")]);
  const tag = markNew ? ` <span style="background:${ORANGE};color:#fff;font-size:11px;border-radius:4px;padding:1px 6px">${esc(t.isNew)}</span>` : "";
  return `<div style="border:1px solid ${LINE};border-radius:10px;padding:14px;margin:12px 0">
<div style="font-weight:700;font-size:16px;color:${o.side === "SELL" ? TEAL : ORANGE}">${esc(head)}${tag}</div>
<table style="font-size:14px;margin:8px 0 12px;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="color:${MIST};padding:2px 0;width:1%;white-space:nowrap">${esc(k)}</td><td style="padding:2px 14px"><span dir="ltr">${esc(v)}</span></td></tr>`).join("")}</table>
${button(`${cfg().url}/?offer=${encodeURIComponent(o.id)}`, t.view)}</div>`;
}
function offerText(o, lang) {
  const t = T[lang] || T.en;
  const head = o.side === "SELL" ? t.selling(fmtNum(o.amount)) : t.buying(fmtNum(o.amount));
  return [head, o.price ? `${t.price}: ${fmtNum(o.price, isToken(o.currency) ? 12 : 6)} ${o.currency} · ${t.total}: ${(isToken(o.currency) ? fmtNum(o.price * o.amount, 12) : fmtMoney(o.price * o.amount))} ${o.currency}` : "", o.min != null && o.max != null ? `${t.perTrade}: ${fmtNum(o.min)}–${fmtNum(o.max)} KDA` : "", o.methods?.length ? `${t.pay}: ${o.methods.join(", ")}` : "", `${cfg().url}/?offer=${encodeURIComponent(o.id)}`].filter(Boolean).join("\n");
}

const MAX_IN_EMAIL = 10;
export function offersEmail(sub, offers, { digest = false, newIds = new Set() } = {}) {
  const lang = sub.lang === "ar" ? "ar" : "en", t = T[lang], l = links(sub);
  const shown = offers.slice(0, MAX_IN_EMAIL);
  const subject = digest ? t.subjDigest(offers.length) : offers.length === 1 ? t.subjOne(offers[0]) : t.subjMany(offers.length);
  const intro = digest ? t.introDigest : offers.length === 1 ? t.introOne : t.introMany(offers.length);
  const more = offers.length > shown.length ? `<p style="font-size:14px">${esc(t.more(offers.length - shown.length))}: <a href="${esc(cfg().url)}/" style="color:${TEAL}">marketplace.kadena.ws</a></p>` : "";
  const body = `<p style="margin:0 0 4px;font-size:15px">${esc(intro)}</p>${shown.map((o) => offerCard(o, lang, digest && newIds.has(o.id))).join("")}${more}
<p style="font-size:13px;color:${MIST};margin:14px 0 0">${esc(t.firstCome)}</p>`;
  const text = `${intro}\n\n${shown.map((o) => offerText(o, lang)).join("\n\n")}\n\n${t.firstCome}\n\n${t.why}\n${t.manage}: ${l.manage}\n${t.unsub}: ${l.unsub}`;
  return { subject, html: shell({ lang, title: subject, body, footer: footerFor(sub, lang) }), text, headers: unsubHeaders(sub) };
}
export function confirmEmail(sub) {
  const lang = sub.lang === "ar" ? "ar" : "en", t = T[lang];
  const href = `${cfg().url}/alerts?confirm=${encodeURIComponent(sub.token)}`;
  const body = `<p style="margin:0 0 16px;font-size:15px">${esc(t.confirmIntro)}</p>${button(href, t.confirmBtn)}${settingsSummary(sub, lang)}<p style="font-size:13px;color:${MIST};margin:14px 0 0">${esc(t.confirmIgnore)}</p>`;
  return { subject: t.confirmSubj, html: shell({ lang, title: t.confirmSubj, body, footer: "" }), text: `${t.confirmIntro}\n\n${t.confirmBtn}: ${href}\n\n${t.confirmIgnore}` };
}
export function manageEmail(sub) {
  const lang = sub.lang === "ar" ? "ar" : "en", t = T[lang], l = links(sub);
  const body = `<p style="margin:0 0 16px;font-size:15px">${esc(t.manageIntro)}</p>${button(l.manage, t.manageBtn)}${settingsSummary(sub, lang)}`;
  return { subject: t.manageSubj, html: shell({ lang, title: t.manageSubj, body, footer: "" }), text: `${t.manageIntro}\n\n${t.manageBtn}: ${l.manage}`, headers: unsubHeaders(sub) };
}
const unsubHeaders = (sub) => ({ "List-Unsubscribe": `<${links(sub).oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });

/* ---------------- sending, with a daily cap ---------------- */
async function sentToday(pool) {
  const r = await pool.query("SELECT count(*)::int AS n FROM alert_mail_log WHERE ok AND sent_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'");
  return r.rows[0].n;
}
/**
 * Send one email unless the day's cap is reached. `reserve` keeps the last slots for more important mail:
 * offer alerts leave 25 a day for confirmations and trade emails (server/tradeEmails.js).
 */
export async function sendMail(pool, sub, kind, msg, reserve = 0) {
  const c = cfg();
  if ((await sentToday(pool)) >= c.dailyLimit - reserve) { console.warn(`[alerts] daily limit reached, ${kind} to #${sub.id} not sent`); return false; }
  let ok = false;
  try {
    if (c.mailLog) {
      fs.appendFileSync(c.mailLog, JSON.stringify({ at: new Date().toISOString(), to: sub.email, kind, ...msg }) + "\n");
      ok = true;
    } else {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${c.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: c.from, to: [sub.email], subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers }),
        signal: AbortSignal.timeout(15000),
      });
      ok = r.ok;
      if (!r.ok) console.error(`[alerts] Resend HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    }
  } catch (e) { console.error("[alerts] send failed:", e.message); }
  await pool.query("INSERT INTO alert_mail_log (subscription_id, kind, ok) VALUES ($1, $2, $3)", [sub.id, kind, ok]).catch(() => {});
  return ok;
}

/* ---------------- watcher ---------------- */
const DETAILS_WAIT_MS = 3 * 60 * 1000; // wait up to 3 min for the creator's browser to save price details

async function getState(pool, key) { const r = await pool.query("SELECT value FROM alert_state WHERE key = $1", [key]); return r.rows[0]?.value ?? null; }
async function setState(pool, key, value) { await pool.query("INSERT INTO alert_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, value]); }

/** The payment line of a v11 pool: its networks from pool_details ("USDT (TRC20)"), "instant" for a token, "Giveaway" for price 0. */
export function poolMethods(o, networks = []) {
  if (o.token) return [`${o.currency} (instant)`];
  if (Number(o.price) === 0) return ["Giveaway"];
  return networks.filter((n) => n.startsWith(`${o.currency}:`)).map((n) => `${n.split(":")[0]} (${n.split(":")[1]})`);
}
async function withDetails(pool, chainOffers) {
  if (!chainOffers.length) return [];
  const v10 = chainOffers.filter((o) => o.price == null), pools = chainOffers.filter((o) => o.price != null);
  const r = v10.length ? await pool.query("SELECT offer_id, price, fiat_currency, payment_method FROM offer_details WHERE offer_id = ANY($1)", [v10.map((o) => o.id)]) : { rows: [] };
  const pr = pools.length ? await pool.query("SELECT pool_id, networks FROM pool_details WHERE pool_id = ANY($1)", [pools.map((o) => o.id)]) : { rows: [] };
  const by = new Map(r.rows.map((x) => [x.offer_id, x])), nets = new Map(pr.rows.map((x) => [x.pool_id, x.networks || []]));
  return chainOffers.map((o) => {
    if (o.price != null) {
      // a pool: the price is on the chain; "details" means the creator saved the payment networks (not needed for a token or a giveaway)
      const methods = poolMethods(o, nets.get(o.id));
      return { ...o, hasDetails: methods.length > 0, methods };
    }
    const d = by.get(o.id);
    const currency = d?.fiat_currency ? String(d.fiat_currency).toUpperCase().slice(0, 10) : "";
    return { ...o, hasDetails: !!d, price: d ? Number(d.price) : 0, currency, methods: d ? methodsOf(d.payment_method) : [] };
  });
}

/** One watcher round. `now` and `chain` can be injected for tests. Returns a summary. */
export async function runAlertsOnce(pool, { now = Date.now(), chain } = {}) {
  const c = cfg();
  const offers = chain || await fetchChainPools();
  // offers the arbiter hid from the market (server/offerModeration.js) are not announced either
  const hidden = new Set((await pool.query("SELECT offer_id FROM hidden_offers").catch(() => ({ rows: [] }))).rows.map((r) => r.offer_id));
  const open = offers.filter((o) => o.state === "CREATED" && !hidden.has(o.id));

  // First run: remember what is already open so subscribers are not flooded with old offers.
  if (!(await getState(pool, "initialized"))) {
    // Stamped a day back so the first daily summary does not mark them "new".
    for (const o of offers) await pool.query("INSERT INTO alert_offers_seen (offer_id, first_seen_at, announced_at) VALUES ($1, to_timestamp($2 / 1000.0) - interval '1 day', to_timestamp($2 / 1000.0)) ON CONFLICT DO NOTHING", [o.id, now]);
    await setState(pool, "initialized", new Date(now).toISOString());
    return { initialized: true, seen: offers.length };
  }

  for (const o of open) await pool.query("INSERT INTO alert_offers_seen (offer_id, first_seen_at) VALUES ($1, to_timestamp($2 / 1000.0)) ON CONFLICT DO NOTHING", [o.id, now]);

  const pending = (await pool.query("SELECT offer_id, first_seen_at FROM alert_offers_seen WHERE announced_at IS NULL")).rows;
  const openById = new Map(open.map((o) => [o.id, o]));
  const detailed = new Map((await withDetails(pool, pending.map((p) => openById.get(p.offer_id)).filter(Boolean))).map((o) => [o.id, o]));
  const toAnnounce = [];
  for (const p of pending) {
    const o = detailed.get(p.offer_id);
    if (!o) { await pool.query("UPDATE alert_offers_seen SET announced_at = to_timestamp($2 / 1000.0) WHERE offer_id = $1", [p.offer_id, now]); continue; } // taken already
    if (!o.hasDetails && now - new Date(p.first_seen_at).getTime() < DETAILS_WAIT_MS) continue;
    toAnnounce.push(o);
  }
  let instantSent = 0;
  if (toAnnounce.length) {
    await pool.query("UPDATE alert_offers_seen SET announced_at = to_timestamp($2 / 1000.0) WHERE offer_id = ANY($1)", [toAnnounce.map((o) => o.id), now]);
    const subs = (await pool.query("SELECT * FROM alert_subscriptions WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL AND frequency = 'instant' ORDER BY id")).rows;
    for (const sub of subs) {
      const mine = toAnnounce.filter((o) => matches(sub, o));
      if (mine.length && await sendMail(pool, sub, "instant", offersEmail(sub, mine), 25)) instantSent++;
    }
  }

  // Daily summary, once per UTC day after the configured hour.
  let digestSent = 0;
  const d = new Date(now), today = d.toISOString().slice(0, 10);
  if (d.getUTCHours() >= c.digestHour && (await getState(pool, "digest_date")) !== today) {
    await setState(pool, "digest_date", today);
    const seen = (await pool.query("SELECT offer_id, first_seen_at FROM alert_offers_seen WHERE offer_id = ANY($1)", [open.map((o) => o.id)])).rows;
    const firstSeen = new Map(seen.map((s) => [s.offer_id, new Date(s.first_seen_at).getTime()]));
    const all = await withDetails(pool, open);
    const newIds = new Set(all.filter((o) => now - (firstSeen.get(o.id) ?? 0) < 24 * 3600 * 1000).map((o) => o.id));
    const subs = (await pool.query("SELECT * FROM alert_subscriptions WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL AND frequency = 'daily' ORDER BY id")).rows;
    for (const sub of subs) {
      const mine = all.filter((o) => matches(sub, o)).sort((a, b) => Number(newIds.has(b.id)) - Number(newIds.has(a.id)));
      if (!mine.some((o) => newIds.has(o.id))) continue; // nothing new for them today
      if (await sendMail(pool, sub, "daily", offersEmail(sub, mine, { digest: true, newIds }), 25)) digestSent++;
    }
    // Housekeeping: drop sign-ups never confirmed within 7 days, and old log rows.
    await pool.query("DELETE FROM alert_subscriptions WHERE confirmed_at IS NULL AND created_at < now() - interval '7 days'");
    await pool.query("DELETE FROM alert_mail_log WHERE sent_at < now() - interval '60 days'");
  }
  return { open: open.length, announced: toAnnounce.map((o) => o.id), instantSent, digestSent };
}

export function startAlertWatcher(getPool, everyMs = 60 * 1000) {
  if (!alertsEnabled()) { console.log("[alerts] off (no RESEND_API_KEY)"); return null; }
  let busy = false, fails = 0;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const r = await runAlertsOnce(getPool());
      fails = 0;
      if (r.initialized || r.announced?.length || r.digestSent) console.log("[alerts]", JSON.stringify(r));
    } catch (e) { if (++fails % 10 === 1) console.error("[alerts] round failed:", e.message); }
    finally { busy = false; }
  };
  setTimeout(tick, 5000);
  console.log(`[alerts] on: from ${cfg().from}, limit ${cfg().dailyLimit}/day, summary at ${cfg().digestHour}:00 UTC`);
  return setInterval(tick, everyMs);
}

/* ---------------- HTTP API ---------------- */
const amountField = z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/).transform(Number), z.null()]).optional()
  .refine((v) => v == null || (v >= 0 && v <= 1e9), "Invalid amount");
const settingsSchema = z.object({
  wantSell: z.boolean(), wantBuy: z.boolean(),
  currencies: z.array(z.enum(ALERT_CURRENCIES)).max(ALERT_CURRENCIES.length).default([]),
  minKda: amountField, maxKda: amountField,
  frequency: z.enum(["instant", "daily"]).default("instant"),
  lang: z.enum(["en", "ar"]).default("en"),
}).refine((s) => s.wantSell || s.wantBuy, { message: "Pick at least one kind of offer" })
  .refine((s) => s.minKda == null || s.maxKda == null || s.minKda <= s.maxKda, { message: "Minimum is above maximum" });
const subscribeSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), website: z.string().max(200).optional() }).and(settingsSchema);
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);

const toRow = (s) => [s.wantSell, s.wantBuy, s.currencies.join(","), s.minKda ?? null, s.maxKda ?? null, s.frequency, s.lang];
const publicSettings = (r) => ({
  email: r.email.replace(/^(.)(.*)(@.*)$/, (_, a, b, d) => a + "•".repeat(Math.min(b.length, 6)) + d),
  wantSell: r.want_sell, wantBuy: r.want_buy, currencies: r.currencies ? r.currencies.split(",") : [],
  minKda: r.min_kda == null ? null : Number(r.min_kda), maxKda: r.max_kda == null ? null : Number(r.max_kda),
  frequency: r.frequency, lang: r.lang, confirmed: !!r.confirmed_at, unsubscribed: !!r.unsubscribed_at,
});

export function registerAlertRoutes(app, getPool) {
  const realIp = (req) => {
    const peer = req.socket?.remoteAddress || "";
    const fwd = req.get("X-Real-IP");
    return (fwd && /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(peer)) ? fwd : (req.ip || peer);
  };
  const signupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(realIp(req)),
    message: { error: "Too many sign-ups from this connection. Try again in 15 minutes." },
  });
  const tokenLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => ipKeyGenerator(realIp(req)) });
  const off = (res) => res.status(503).json({ error: "Offer alerts are not switched on yet." });
  const bad = (res, err) => res.status(400).json({ error: err.issues?.[0]?.message || "Invalid request" });

  app.get("/api/alerts/status", (_req, res) => res.json({ enabled: alertsEnabled(), currencies: ALERT_CURRENCIES }));

  app.post("/api/alerts/subscribe", signupLimiter, async (req, res) => {
    if (!alertsEnabled()) return off(res);
    const p = subscribeSchema.safeParse(req.body || {});
    if (!p.success) return bad(res, p.error);
    const s = p.data;
    const done = () => res.json({ ok: true }); // same answer whether or not the address was already signed up
    if (s.website) return done(); // honeypot field filled by a bot
    const pool = getPool();
    try {
      const ex = (await pool.query("SELECT * FROM alert_subscriptions WHERE email = $1", [s.email])).rows[0];
      const recentlyMailed = ex?.confirm_sent_at && Date.now() - new Date(ex.confirm_sent_at).getTime() < 10 * 60 * 1000;
      if (ex && ex.confirmed_at && !ex.unsubscribed_at) {
        // Already active: never change settings from an unauthenticated form; mail the owner a manage link instead.
        if (!recentlyMailed) {
          await pool.query("UPDATE alert_subscriptions SET confirm_sent_at = now() WHERE id = $1", [ex.id]);
          await sendMail(pool, ex, "manage", manageEmail(ex));
        }
        return done();
      }
      let row;
      if (ex) {
        // Unconfirmed or unsubscribed: take the new choices but require a fresh confirmation, with a new token.
        row = (await pool.query(
          `UPDATE alert_subscriptions SET want_sell=$2, want_buy=$3, currencies=$4, min_kda=$5, max_kda=$6, frequency=$7, lang=$8,
             token=$9, confirmed_at=NULL, unsubscribed_at=NULL, updated_at=now() WHERE id=$1 RETURNING *`,
          [ex.id, ...toRow(s), newToken()])).rows[0];
        if (recentlyMailed) return done();
      } else {
        row = (await pool.query(
          `INSERT INTO alert_subscriptions (want_sell, want_buy, currencies, min_kda, max_kda, frequency, lang, email, token)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [...toRow(s), s.email, newToken()])).rows[0];
      }
      await pool.query("UPDATE alert_subscriptions SET confirm_sent_at = now() WHERE id = $1", [row.id]);
      await sendMail(pool, row, "confirm", confirmEmail(row));
      return done();
    } catch (err) {
      console.error("POST /api/alerts/subscribe", err.message);
      return res.status(500).json({ error: "Could not save your alert. Please try again." });
    }
  });

  const byToken = async (token) => (await getPool().query("SELECT * FROM alert_subscriptions WHERE token = $1", [token])).rows[0];
  const withToken = (handler) => async (req, res) => {
    const t = tokenSchema.safeParse(req.body?.token ?? req.query?.token);
    if (!t.success) return res.status(400).json({ error: "This link is not valid." });
    try {
      const row = await byToken(t.data);
      if (!row) return res.status(404).json({ error: "This link has expired or was replaced by a newer one." });
      return await handler(req, res, row);
    } catch (err) {
      console.error(`${req.method} ${req.path}`, err.message);
      return res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  };

  app.post("/api/alerts/confirm", tokenLimiter, withToken(async (_req, res, row) => {
    const r = (await getPool().query("UPDATE alert_subscriptions SET confirmed_at = COALESCE(confirmed_at, now()), unsubscribed_at = NULL, updated_at = now() WHERE id = $1 RETURNING *", [row.id])).rows[0];
    return res.json({ ok: true, settings: publicSettings(r) });
  }));
  app.post("/api/alerts/settings", tokenLimiter, withToken(async (_req, res, row) => res.json({ ok: true, settings: publicSettings(row) })));
  app.put("/api/alerts/settings", tokenLimiter, withToken(async (req, res, row) => {
    const p = settingsSchema.safeParse(req.body || {});
    if (!p.success) return bad(res, p.error);
    const r = (await getPool().query(
      "UPDATE alert_subscriptions SET want_sell=$2, want_buy=$3, currencies=$4, min_kda=$5, max_kda=$6, frequency=$7, lang=$8, updated_at=now() WHERE id=$1 RETURNING *",
      [row.id, ...toRow(p.data)])).rows[0];
    return res.json({ ok: true, settings: publicSettings(r) });
  }));
  // Also the RFC 8058 one-click target: mail apps POST here with ?token= and a form body.
  app.post("/api/alerts/unsubscribe", tokenLimiter, withToken(async (_req, res, row) => {
    const r = (await getPool().query("UPDATE alert_subscriptions SET unsubscribed_at = COALESCE(unsubscribed_at, now()), updated_at = now() WHERE id = $1 RETURNING *", [row.id])).rows[0];
    return res.json({ ok: true, settings: publicSettings(r) });
  }));
  app.post("/api/alerts/resubscribe", tokenLimiter, withToken(async (_req, res, row) => {
    if (!row.confirmed_at) return res.status(400).json({ error: "Please confirm from the email first." });
    const r = (await getPool().query("UPDATE alert_subscriptions SET unsubscribed_at = NULL, updated_at = now() WHERE id = $1 RETURNING *", [row.id])).rows[0];
    return res.json({ ok: true, settings: publicSettings(r) });
  }));
}
