/**
 * Sign-in once per device.
 *
 * After one wallet signature (the usual profile-auth proof), the server gives the browser a session
 * token. The browser sends it in place of a fresh signature (as `signedCmd`), so phone users are not
 * sent to their wallet app on every page load, chat message or rating.
 *
 * Token: "nxs1.<base64url JSON {w, iat, exp}>.<base64url HMAC-SHA256>". Stateless; valid 30 days.
 * The HMAC key is SESSION_SECRET, or one generated on first start and kept in alert_state.
 * Arbiter actions still need a real signature (requireAuth with { allowSession: false }).
 */
import crypto from "node:crypto";

export const SESSION_PREFIX = "nxs1.";
const TTL_MS = 30 * 24 * 3600 * 1000;
let secret = null;

export async function initSessionSecret(pool) {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 32) {
    secret = Buffer.from(process.env.SESSION_SECRET.trim());
    return;
  }
  if (!pool) return;
  const read = () => pool.query("SELECT value FROM alert_state WHERE key = 'session_secret'");
  let r = await read();
  if (!r.rows[0]) {
    await pool.query("INSERT INTO alert_state (key, value) VALUES ('session_secret', $1) ON CONFLICT (key) DO NOTHING", [crypto.randomBytes(32).toString("hex")]);
    r = await read(); // another process may have won
  }
  secret = Buffer.from(r.rows[0].value, "hex");
}

/** For tests. */
export function setSessionSecretForTests(value) { secret = value ? Buffer.from(value) : null; }

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const mac = (payload) => crypto.createHmac("sha256", secret).update(`${SESSION_PREFIX}${payload}`).digest();

export const isSessionToken = (v) => typeof v === "string" && v.startsWith(SESSION_PREFIX);

export function issueSessionToken(wallet, now = Date.now()) {
  if (!secret) throw new Error("Sessions are not ready yet");
  const payload = b64(JSON.stringify({ w: wallet, iat: now, exp: now + TTL_MS }));
  return { token: `${SESSION_PREFIX}${payload}.${b64(mac(payload))}`, expiresAt: new Date(now + TTL_MS).toISOString() };
}

/** @returns {{ ok: true } | { ok: false, reason: string }} */
export function verifySessionToken(token, wallet, now = Date.now()) {
  if (!secret) return { ok: false, reason: "Sessions are not ready yet" };
  if (!isSessionToken(token)) return { ok: false, reason: "Not a session token" };
  const [payload, sig] = token.slice(SESSION_PREFIX.length).split(".");
  if (!payload || !sig) return { ok: false, reason: "Malformed session token" };
  const expected = mac(payload);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: "Invalid session token" };
  let data;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return { ok: false, reason: "Malformed session token" }; }
  if (data.w !== wallet) return { ok: false, reason: "Session token is for another wallet" };
  if (!(data.exp > now)) return { ok: false, reason: "Session expired" };
  return { ok: true };
}
