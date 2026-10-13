/**
 * Trade emails: the same trade notifications as the bell and phone (offer accepted, KDA locked, payment
 * marked, released, deadlines, proof of payment, disputes), also by email.
 *
 * A trader adds an email for their wallet (signed in). It works once they click the confirmation link.
 * Every email has a one-click "turn off" link. Chat messages are not emailed (too many).
 *
 *   GET  /api/trade-email                 (wallet, publicKey, signedCmd in the query) -> { email, confirmed, on }
 *   POST /api/trade-email                 { wallet, publicKey, signedCmd, email, lang } -> sends a confirmation
 *   POST /api/trade-email/off             { wallet, publicKey, signedCmd }
 *   GET  /api/trade-email/confirm?token=  (link in the confirmation email) -> back to the site
 *   GET|POST /api/trade-email/unsubscribe?token=  (link in every trade email; POST = one-click)
 */
import crypto from "crypto";
import { z } from "zod";
import { alertsEnabled, button, esc, mailConfig, sendMail, shell } from "./alerts.js";
import { tradeCode } from "./notifications.js";

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const newToken = () => crypto.randomBytes(24).toString("base64url");

/** Which notifications are emailed: trade steps, deadlines, proofs and disputes. Not chat, not new offers. */
export function emailable(kind) {
  return /^(accepted|funded|paid|completed|refunded|closed|disputed|due-|expired-|proof:)/.test(String(kind || ""));
}

const T = {
  en: {
    open: "Open the trade",
    why: "You get this because you turned on trade emails for your wallet on Kadena P2P Marketplace.",
    off: "Turn off trade emails",
    confirmSubj: "Confirm trade emails – Kadena P2P Marketplace",
    confirmIntro: "Click to get an email when one of your trades needs you (offer accepted, KDA locked, payment marked, deadlines).",
    confirmBtn: "Turn on trade emails",
    confirmIgnore: "Didn't ask for this? Ignore this email; nothing will be sent.",
    wallet: "Wallet",
  },
  ar: {
    open: "افتح الصفقة",
    why: "تصلك هذه الرسالة لأنك فعّلت رسائل الصفقات لمحفظتك في سوق Kadena P2P.",
    off: "إيقاف رسائل الصفقات",
    confirmSubj: "تأكيد رسائل الصفقات – سوق Kadena P2P",
    confirmIntro: "اضغط لتصلك رسالة عندما تحتاجك إحدى صفقاتك (قبول العرض، قفل KDA، تأكيد الدفع، المهل).",
    confirmBtn: "تفعيل رسائل الصفقات",
    confirmIgnore: "لم تطلب ذلك؟ تجاهل هذه الرسالة ولن يُرسل شيء.",
    wallet: "المحفظة",
  },
};
const shortW = (w) => `${w.slice(0, 8)}…${w.slice(-6)}`;

export function tradeEmail(row, n) {
  const lang = row.lang === "ar" ? "ar" : "en", t = T[lang], url = mailConfig().url;
  const code = tradeCode(n.offer_id);
  const subject = code ? `${n.title} · #${code}` : n.title;
  const off = `${url}/api/trade-email/unsubscribe?token=${encodeURIComponent(row.token)}`;
  const open = `${url}/?offer=${encodeURIComponent(n.offer_id || "")}`;
  const body = `<p style="margin:0 0 6px;font-size:17px;font-weight:700">${esc(n.title)}${code ? ` <span style="font-family:monospace;font-size:13px;background:#E6F0F3;border-radius:4px;padding:1px 6px">#${esc(code)}</span>` : ""}</p>
<p style="margin:0 0 16px;font-size:15px">${esc(n.body)}</p>${n.offer_id ? button(open, t.open) : ""}`;
  const footer = `${esc(t.why)} ${esc(t.wallet)}: <span dir="ltr">${esc(shortW(row.wallet))}</span><br><a href="${esc(off)}" style="color:#4F6B76">${esc(t.off)}</a>`;
  return {
    subject,
    html: shell({ lang, title: subject, body, footer }),
    text: `${n.title}\n\n${n.body}\n\n${n.offer_id ? `${t.open}: ${open}\n\n` : ""}${t.why}\n${t.off}: ${off}`,
    headers: { "List-Unsubscribe": `<${off}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

export function confirmTradeEmail(row) {
  const lang = row.lang === "ar" ? "ar" : "en", t = T[lang];
  const href = `${mailConfig().url}/api/trade-email/confirm?token=${encodeURIComponent(row.token)}`;
  const body = `<p style="margin:0 0 16px;font-size:15px">${esc(t.confirmIntro)}</p>${button(href, t.confirmBtn)}
<p style="font-size:13px;color:#4F6B76;margin:14px 0 0">${esc(t.wallet)}: <span dir="ltr">${esc(shortW(row.wallet))}</span><br>${esc(t.confirmIgnore)}</p>`;
  return { subject: t.confirmSubj, html: shell({ lang, title: t.confirmSubj, body, footer: "" }), text: `${t.confirmIntro}\n\n${t.confirmBtn}: ${href}\n\n${t.confirmIgnore}` };
}

/** Called for every new notification: email it when the wallet has trade emails on. */
export async function emailNotification(pool, n) {
  if (!n || !n.wallet || n.wallet === "*" || !emailable(n.kind) || !alertsEnabled()) return false;
  const row = (await pool.query("SELECT * FROM trade_emails WHERE wallet = $1 AND confirmed_at IS NOT NULL AND off_at IS NULL", [n.wallet])).rows[0];
  if (!row) return false;
  return sendMail(pool, { id: null, email: row.email }, "trade", tradeEmail(row, n));
}

export function registerTradeEmailRoutes(app, { getPool, requireAuth, sendAuthError }) {
  const pool = () => getPool();
  const auth = (req, res, from) => {
    const a = requireAuth(req, from);
    if (!a.ok) { sendAuthError(res, a); return null; }
    const w = (from === "query" ? req.query : req.body)?.wallet;
    if (w !== a.wallet) { res.status(400).json({ error: "Wallet must match authenticated wallet" }); return null; }
    return a.wallet;
  };

  app.get("/api/trade-email", async (req, res) => {
    const w = auth(req, res, "query"); if (!w) return;
    const row = (await pool().query("SELECT email, confirmed_at, off_at FROM trade_emails WHERE wallet = $1", [w])).rows[0];
    return res.json({ available: alertsEnabled(), email: row?.email ?? null, confirmed: !!row?.confirmed_at, on: !!row?.confirmed_at && !row?.off_at });
  });

  app.post("/api/trade-email", async (req, res) => {
    const w = auth(req, res, "body"); if (!w) return;
    if (!alertsEnabled()) return res.status(503).json({ error: "Email is not switched on yet." });
    const e = emailSchema.safeParse(req.body?.email);
    if (!e.success) return res.status(400).json({ error: "Enter a valid email address." });
    const lang = req.body?.lang === "ar" ? "ar" : "en";
    const ex = (await pool().query("SELECT * FROM trade_emails WHERE wallet = $1", [w])).rows[0];
    if (ex && ex.email === e.data && ex.confirmed_at) {
      // same address, already confirmed: just switch it back on
      await pool().query("UPDATE trade_emails SET off_at = NULL, lang = $2, updated_at = now() WHERE wallet = $1", [w, lang]);
      return res.json({ ok: true, confirmed: true });
    }
    if (ex && ex.email === e.data && ex.confirm_sent_at && Date.now() - new Date(ex.confirm_sent_at).getTime() < 5 * 60 * 1000) {
      return res.json({ ok: true, confirmed: false }); // a confirmation went out a moment ago
    }
    const row = (await pool().query(
      `INSERT INTO trade_emails (wallet, email, token, lang, confirm_sent_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (wallet) DO UPDATE SET email = EXCLUDED.email, token = EXCLUDED.token, lang = EXCLUDED.lang,
         confirmed_at = NULL, off_at = NULL, confirm_sent_at = now(), updated_at = now()
       RETURNING *`, [w, e.data, newToken(), lang])).rows[0];
    const sent = await sendMail(pool(), { id: null, email: row.email }, "trade-conf", confirmTradeEmail(row));
    if (!sent) return res.status(502).json({ error: "Could not send the confirmation email. Try again later." });
    return res.json({ ok: true, confirmed: false });
  });

  app.post("/api/trade-email/off", async (req, res) => {
    const w = auth(req, res, "body"); if (!w) return;
    await pool().query("UPDATE trade_emails SET off_at = now(), updated_at = now() WHERE wallet = $1", [w]);
    return res.json({ ok: true });
  });

  const back = (state) => `${mailConfig().url}/?trade-email=${state}`;
  app.get("/api/trade-email/confirm", async (req, res) => {
    const token = String(req.query.token || "");
    const r = token ? await pool().query("UPDATE trade_emails SET confirmed_at = COALESCE(confirmed_at, now()), off_at = NULL, updated_at = now() WHERE token = $1 RETURNING wallet", [token]) : { rows: [] };
    return res.redirect(302, back(r.rows.length ? "on" : "expired"));
  });
  const unsubscribe = async (req, res) => {
    const token = String(req.query.token || req.body?.token || "");
    const r = token ? await pool().query("UPDATE trade_emails SET off_at = now(), updated_at = now() WHERE token = $1 RETURNING wallet", [token]) : { rows: [] };
    if (req.method === "POST") return res.json({ ok: r.rows.length > 0 });
    return res.redirect(302, back(r.rows.length ? "off" : "expired"));
  };
  app.get("/api/trade-email/unsubscribe", unsubscribe);
  app.post("/api/trade-email/unsubscribe", unsubscribe);
}
