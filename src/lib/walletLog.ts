/**
 * A short log of wallet events on this device (phone wallets are hard to debug from a distance).
 * Kept in this browser only; shown on /wallet-check so it can be copied and sent. No keys or signatures.
 */
const KEY = "nx-wallet-log";
const MAX = 40;

export type WalletLogEntry = { t: string; event: string; detail?: string };

export function walletLog(event: string, detail?: unknown) {
  try {
    const list = readWalletLog();
    const d = detail === undefined ? undefined : typeof detail === "string" ? detail : JSON.stringify(detail);
    list.push({ t: new Date().toISOString().slice(11, 19), event, ...(d ? { detail: d.slice(0, 300) } : {}) });
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch { /* storage blocked */ }
}

export function readWalletLog(): WalletLogEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}

export function clearWalletLog() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
