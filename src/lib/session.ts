import { buildProfileAuthTx, signTransaction } from "@/lib/kadena";
import type { IUnsignedCommand } from "@kadena/client";

/**
 * Sign in once per device (server/session.js).
 *
 * authProof() returns what the API expects as `signedCmd`: a saved session token when this device is
 * signed in, otherwise a fresh wallet signature, which is also exchanged for a token for next time.
 * Use { fresh: true } for arbiter actions, which always need a new signature.
 */
const base = (): string => {
  const v = import.meta.env?.VITE_PROFILE_API;
  return typeof v === "string" && v.trim() ? v.trim().replace(/\/$/, "") : "";
};
const key = (wallet: string) => `nx-session:${wallet}`;

function tokenExpiry(token: string): number {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return Number(json.exp) || 0;
  } catch {
    return 0;
  }
}

export function getSessionToken(wallet: string): string | null {
  try {
    const t = localStorage.getItem(key(wallet));
    if (t && tokenExpiry(t) > Date.now() + 60_000) return t;
    if (t) localStorage.removeItem(key(wallet));
  } catch { /* storage blocked */ }
  return null;
}

export function clearSession(wallet: string) {
  try { localStorage.removeItem(key(wallet)); } catch { /* ignore */ }
}

/** Drop a saved token the server no longer accepts (new server secret, expired). */
export async function checkSession(wallet: string): Promise<void> {
  const t = getSessionToken(wallet);
  if (!t) return;
  try {
    const r = await fetch(`${base()}/api/session/check?wallet=${encodeURIComponent(wallet)}&token=${encodeURIComponent(t)}`);
    if (r.status === 404) return; // server without sessions yet: keep it for later
    const d = await r.json();
    if (!d.ok) clearSession(wallet);
  } catch { /* offline: try next time */ }
}

type Sig = { pubKey?: string; sig?: string | null; signature?: string };
function normalize(raw: unknown, publicKey: string) {
  let s = raw as { signedCmd?: unknown; cmd?: unknown; hash?: string; sigs?: Sig[] };
  if (s?.signedCmd && !s.cmd) s = s.signedCmd as typeof s;
  const sigs = Array.isArray(s?.sigs) ? [...s.sigs] : [];
  if (sigs[0] && !sigs[0].pubKey) sigs[0] = { ...sigs[0], pubKey: publicKey };
  if (sigs[0]?.signature && !sigs[0].sig) sigs[0] = { ...sigs[0], sig: sigs[0].signature };
  return { ...s, sigs };
}

let pending: Promise<unknown> | null = null; // several parts of the page asking at once share one signature

export async function authProof(wallet: string, publicKey: string, opts: { fresh?: boolean } = {}): Promise<unknown> {
  if (!opts.fresh) {
    const t = getSessionToken(wallet);
    if (t) return t;
    if (pending) return pending;
  }
  const run = (async () => {
    const tx = buildProfileAuthTx(wallet, publicKey) as IUnsignedCommand;
    const signedCmd = normalize(await signTransaction(tx), publicKey);
    if (opts.fresh) return signedCmd;
    try {
      const r = await fetch(`${base()}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, publicKey, signedCmd }),
      });
      if (r.ok) {
        const { token } = (await r.json()) as { token?: string };
        if (token) {
          try { localStorage.setItem(key(wallet), token); } catch { /* ignore */ }
          return token;
        }
      }
    } catch { /* fall back to the signature itself */ }
    return signedCmd;
  })();
  if (!opts.fresh) {
    pending = run;
    run.finally(() => { if (pending === run) pending = null; }).catch(() => {});
  }
  return run;
}
