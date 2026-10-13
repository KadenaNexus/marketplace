import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useWallet } from "@/hooks/useWallet";
import { listAllEscrows, T1_SECONDS, T2_SECONDS, T3_SECONDS, type Escrow } from "@/lib/kadena";

/**
 * Reminds the party whose step is due before an on-chain deadline passes, while the site is open:
 * an in-app toast, plus a browser notification when the tab is in the background and permission
 * was granted. Each reminder is shown once per trade and step.
 *
 *  ACCEPTED -> the KDA holder must fund within T1 (1 h)
 *  FUNDED   -> the buyer must send payment and press "Mark paid" within T2 (4 h)
 *  PAID     -> the KDA holder must release within T3 (1 h)
 * Plus one notice when a step expires and the other side gains an option (reclaim or dispute).
 */

export type Reminder = { key: string; title: string; body: string; urgent: boolean };

const FETCH_EVERY_MS = 5 * 60 * 1000;
const CHECK_EVERY_MS = 30 * 1000;
const SOON = { ACCEPTED: 15 * 60, FUNDED: 30 * 60, PAID: 15 * 60 } as const; // seconds before the deadline

const at = (iso?: string) => (iso ? new Date(iso).getTime() : NaN);
const mins = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.max(1, Math.round(s / 60))} min`);

export function remindersFor(escrows: Escrow[], me: string, now = Date.now()): Reminder[] {
  const out: Reminder[] = [];
  for (const e of escrows) {
    const id = e.offerId;
    const tag = `${e.amount} KDA trade ${id.slice(0, 18)}…`;
    let start = NaN, limit = 0, actor: string | null = null, other: string | null = null, step = "";
    if (e.state === "ACCEPTED") { start = at(e.acceptedAt); limit = T1_SECONDS; actor = e.seller; other = e.buyer; step = "fund the escrow"; }
    else if (e.state === "FUNDED") { start = at(e.fundedAt); limit = T2_SECONDS; actor = e.buyer; other = e.seller; step = "send the payment and press Mark paid"; }
    else if (e.state === "PAID") { start = at(e.paidAt); limit = T3_SECONDS; actor = e.seller; other = e.buyer; step = "release the KDA"; }
    else continue;
    if (!Number.isFinite(start)) continue;
    const left = Math.round((start + limit * 1000 - now) / 1000);
    const soon = SOON[e.state as keyof typeof SOON];

    if (left > 0 && left <= soon && actor === me) {
      out.push({ key: `${id}:${e.state}:soon`, urgent: true, title: `${mins(left)} left to ${step}`, body: `${tag}. The deadline is enforced on-chain and cannot be extended.` });
    }
    if (left <= 0 && left > -48 * 3600) {
      if (e.state === "FUNDED" && other === me) {
        out.push({ key: `${id}:FUNDED:expired`, urgent: false, title: "Payment window ended: you can reclaim your KDA", body: `${tag}. The buyer did not mark the payment within 4 hours. Open the trade and press Timeout: Refund (T2).` });
      }
      if (e.state === "PAID" && (actor === me || other === me)) {
        out.push({ key: `${id}:PAID:expired`, urgent: true, title: "Release deadline passed", body: `${tag}. Either side can now press Timeout: Dispute (T3) so the arbiter can settle it.` });
      }
    }
  }
  return out;
}

const seen = new Set<string>();
function alreadyShown(key: string): boolean {
  if (seen.has(key)) return true;
  seen.add(key);
  try {
    const k = "nx-remind:" + key;
    if (localStorage.getItem(k)) return true;
    localStorage.setItem(k, String(Date.now()));
  } catch (_) {}
  return false;
}

function notify(r: Reminder) {
  (r.urgent ? toast.warning : toast.info)(r.title, { description: r.body, duration: 20000 });
  if (typeof document !== "undefined" && document.hidden && "Notification" in window && Notification.permission === "granted") {
    try { new Notification(r.title, { body: r.body, tag: r.key }); } catch (_) {}
  }
}

/** `active` is false when the server sends these reminders instead (the notification feed is on). */
export function useTradeDeadlineReminders(active = true) {
  const { account, isConnected } = useWallet();
  const me = active ? account?.account : undefined;
  const escrowsRef = useRef<Escrow[]>([]);

  useEffect(() => {
    if (!me || !isConnected) return;
    let stop = false;
    const check = () => { for (const r of remindersFor(escrowsRef.current, me)) if (!alreadyShown(r.key)) notify(r); };
    const load = async () => {
      try {
        const all = await listAllEscrows();
        escrowsRef.current = all.filter((e) => e.seller === me || e.buyer === me);
        if (!stop) check();
      } catch (_) { /* chain read failed; try again next round */ }
    };
    load();
    const f = setInterval(load, FETCH_EVERY_MS);
    const c = setInterval(check, CHECK_EVERY_MS);
    return () => { stop = true; clearInterval(f); clearInterval(c); };
  }, [me, isConnected]);
}
