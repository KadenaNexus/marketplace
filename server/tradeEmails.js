/**
 * Trade emails: the same trade notifications as the bell and phone (offer accepted, KDA locked, payment
 * marked, released, deadlines, proof of payment, disputes), also by email.
 *
 * Required to trade (like an exchange): a wallet needs a confirmed email before it can create or accept
 * offers (checked on the site). These are transactional emails about the person's own trades, so there is
 * no unsubscribe; the address can be changed any time. Chat messages are not emailed (too many).
 *
 *   GET  /api/trade-email                 (wallet, publicKey, signedCmd in the query) -> { email, confirmed, on }
 *   POST /api/trade-email                 { wallet, publicKey, signedCmd, email, lang } -> sends a confirmation
 *   GET  /api/trade-email/confirm?token=  (link in the confirmation email) -> back to the site
 */
import crypto from "crypto";
import { z } from "zod";
import { alertsEnabled, button, esc, mailConfig, sendMail, shell } from "./alerts.js";
import { tradeCode } from "./notifications.js";

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const newToken = () => crypto.randomBytes(24).toString("base64url");

/** Which notifications are emailed: trade steps (v10 and v11: taken, cancelled, split), deadlines, proofs and disputes. Not chat, not new offers. */
export function emailable(kind) {
  return /^(accepted|started|funded|locked|taken|paid|marked|completed|refunded|cancelled|split|closed|disputed|due-|expired-|proof:|hidden$|expiring-)/.test(String(kind || ""));
}

const T = {
  en: {
    open: "Open the trade",
    why: "A trade notice for your wallet on Kadena P2P Marketplace. These come with every trade and can't be turned off; you can change the address in the Marketplace (bell).",
    confirmSubj: "Confirm trade emails – Kadena P2P Marketplace",
    confirmIntro: "Confirm this address to start trading. You'll get an email at every step of your trades: when you must deposit, pay or release, and when time is running out.",
    confirmBtn: "Confirm my email",
    confirmIgnore: "Didn't ask for this? Ignore this email; nothing will be sent.",
    wallet: "Wallet",
  },
  ar: {
    open: "افتح الصفقة",
    why: "إشعار صفقة لمحفظتك في سوق Kadena P2P. تصل هذه الرسائل مع كل صفقة ولا يمكن إيقافها؛ يمكنك تغيير البريد من السوق (الجرس).",
    confirmSubj: "تأكيد رسائل الصفقات – سوق Kadena P2P",
    confirmIntro: "أكّد هذا البريد لتبدأ التداول. ستصلك رسالة في كل خطوة من صفقاتك: عندما يلزمك الإيداع أو الدفع أو التحرير، وعندما يقترب انتهاء الوقت.",
    confirmBtn: "تأكيد بريدي",
    confirmIgnore: "لم تطلب ذلك؟ تجاهل هذه الرسالة ولن يُرسل شيء.",
    wallet: "المحفظة",
  },
};
const shortW = (w) => `${w.slice(0, 8)}…${w.slice(-6)}`;

export function tradeEmail(row, n) {
  const lang = row.lang === "ar" ? "ar" : "en", t = T[lang], url = mailConfig().url;
  const code = tradeCode(n.offer_id);
  const subject = code ? `${n.title} · #${code}` : n.title;
  const open = `${url}/?offer=${encodeURIComponent(n.offer_id || "")}`;
  const body = `<p style="margin:0 0 6px;font-size:17px;font-weight:700">${esc(n.title)}${code ? ` <span style="font-family:monospace;font-size:13px;background:#E6F0F3;border-radius:4px;padding:1px 6px">#${esc(code)}</span>` : ""}</p>
<p style="margin:0 0 16px;font-size:15px">${esc(n.body)}</p>${n.offer_id ? button(open, t.open) : ""}`;
  const footer = `${esc(t.wallet)}: <span dir="ltr">${esc(shortW(row.wallet))}</span><br>${esc(t.why)}`;
  return {
    subject,
    html: shell({ lang, title: subject, body, footer }),
    text: `${n.title}\n\n${n.body}\n\n${n.offer_id ? `${t.open}: ${open}\n\n` : ""}${t.why}`,
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
  const row = (await pool.query("SELECT * FROM trade_emails WHERE wallet = $1 AND confirmed_at IS NOT NULL", [n.wallet])).rows[0];
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
    const row = (await pool().query("SELECT email, pending_email, confirmed_at FROM trade_emails WHERE wallet = $1", [w])).rows[0];
    return res.json({ available: alertsEnabled(), email: row?.email ?? null, pending: row?.confirmed_at ? row.pending_email : row?.email ?? null, confirmed: !!row?.confirmed_at, on: !!row?.confirmed_at });
  });

  app.post("/api/trade-email", async (req, res) => {
    const w = auth(req, res, "body"); if (!w) return;
    if (!alertsEnabled()) return res.status(503).json({ error: "Email is not switched on yet." });
    const e = emailSchema.safeParse(req.body?.email);
    if (!e.success) return res.status(400).json({ error: "Enter a valid email address." });
    const lang = req.body?.lang === "ar" ? "ar" : "en";
    const ex = (await pool().query("SELECT * FROM trade_emails WHERE wallet = $1", [w])).rows[0];
    if (ex && ex.confirmed_at && ex.email === e.data) {
      // the confirmed address again: nothing to confirm (drop a pending change, if any)
      await pool().query("UPDATE trade_emails SET pending_email = NULL, lang = $2, updated_at = now() WHERE wallet = $1", [w, lang]);
      return res.json({ ok: true, confirmed: true });
    }
    const target = ex?.confirmed_at ? ex.pending_email : ex?.email;
    if (ex && target === e.data && ex.confirm_sent_at && Date.now() - new Date(ex.confirm_sent_at).getTime() < 5 * 60 * 1000) {
      return res.json({ ok: true, confirmed: false }); // a confirmation went out a moment ago
    }
    const row = ex?.confirmed_at
      // changing a confirmed address: the old one keeps getting trade emails until the new one is confirmed
      ? (await pool().query(
          `UPDATE trade_emails SET pending_email = $2, token = $3, lang = $4, confirm_sent_at = now(), updated_at = now()
           WHERE wallet = $1 RETURNING *`, [w, e.data, newToken(), lang])).rows[0]
      : (await pool().query(
          `INSERT INTO trade_emails (wallet, email, token, lang, confirm_sent_at) VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (wallet) DO UPDATE SET email = EXCLUDED.email, token = EXCLUDED.token, lang = EXCLUDED.lang,
             confirm_sent_at = now(), updated_at = now()
           RETURNING *`, [w, e.data, newToken(), lang])).rows[0];
    const to = row.pending_email || row.email;
    const sent = await sendMail(pool(), { id: null, email: to }, "trade-conf", confirmTradeEmail(row));
    if (!sent) return res.status(502).json({ error: "Could not send the confirmation email. Try again later." });
    return res.json({ ok: true, confirmed: false });
  });

  const back = (state) => `${mailConfig().url}/?trade-email=${state}`;
  app.get("/api/trade-email/confirm", async (req, res) => {
    const token = String(req.query.token || "");
    const r = token ? await pool().query(
      `UPDATE trade_emails SET email = COALESCE(pending_email, email), pending_email = NULL, confirmed_at = now(),
         token = $2, updated_at = now() WHERE token = $1 RETURNING wallet`, [token, newToken()]) : { rows: [] };
    return res.redirect(302, back(r.rows.length ? "on" : "expired"));
  });
}
