import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getSocket } from "@/hooks/useOnlineStatus";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@/hooks/useWallet";
import { FeedItem, Who, fetchFeed, getPushKey, removePushSubscription, savePushSubscription } from "@/lib/notificationsApi";
import { authProof, autoSignIn, getSessionToken, useSignedIn } from "@/lib/session";

/**
 * In-page notifications: polls the server feed (this wallet's trade events plus new offers), counts unread
 * items, shows a banner for anything new while the page is open, and manages Web Push on this device.
 * Read state is kept per wallet in this browser.
 */
const POLL_MS = 30 * 1000;
const seenKey = (w: string | null) => `nx-notif-seen:${w || "anon"}`;
const readSeen = (w: string | null) => { try { return Number(localStorage.getItem(seenKey(w))) || 0; } catch { return 0; } };

export type PushState = "unsupported" | "needs-install" | "default" | "denied" | "on" | "working";

type Ctx = {
  enabled: boolean;
  feed: "loading" | "on" | "off";   // off: server feed disabled or unreachable
  items: FeedItem[];
  unread: number;
  isUnread: (i: FeedItem) => boolean;
  markAllRead: () => void;
  push: PushState;
  pushOffers: boolean;
  turnOnPush: (offers: boolean) => Promise<void>;
  turnOffPush: () => Promise<void>;
  refresh: () => void;
};
const NotificationsContext = createContext<Ctx | null>(null);

export const isIos = () => typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
export const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// navigator.serviceWorker.ready never settles if registration failed; give up after a few seconds
const swReady = () => Promise.race([
  navigator.serviceWorker.ready,
  new Promise<never>((_, no) => setTimeout(() => no(new Error("The notification service did not start. Reload the page and try again.")), 8000)),
]);

function urlBase64ToUint8Array(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Go to an offer or trade inside the app (a full reload would ask the wallet to sign in again). */
export function useOpenOffer() {
  const navigate = useNavigate();
  return useCallback((offerId: string | null) => navigate(offerId ? `/?offer=${encodeURIComponent(offerId)}` : "/"), [navigate]);
}

/**
 * The wallet's proof for the server, without bothering the person: the saved sign-in of this device. Null when
 * there is none yet: the feed then shows new offers only until the person taps Sign in (or a trade step).
 */
async function quietProof(wallet: string, publicKey: string): Promise<Who | null> {
  const signedCmd = getSessionToken(wallet) ?? (await autoSignIn(wallet, publicKey).catch(() => null));
  return signedCmd ? { account: wallet, publicKey, signedCmd } : null;
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { account, isConnected } = useWallet();
  const openOffer = useOpenOffer();
  const wallet = isConnected && account ? account.account : null;
  const publicKey = isConnected && account ? account.publicKey : null;
  const [enabled, setEnabled] = useState(false);
  const [feed, setFeed] = useState<Ctx["feed"]>("loading");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [seen, setSeen] = useState(() => readSeen(wallet));
  const [push, setPush] = useState<PushState>("unsupported");
  const [pushOffers, setPushOffers] = useState(false);
  const known = useRef<Set<number> | null>(null);   // ids already shown, so only new ones get a banner
  const [tick, setTick] = useState(0);
  const signedIn = useSignedIn(wallet); // the feed loads again right after the person signs in

  useEffect(() => { setSeen(readSeen(wallet)); known.current = null; }, [wallet]);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const who = wallet && publicKey ? await quietProof(wallet, publicKey) : null;
        if (stop) return;
        const r = await fetchFeed(who);
        if (stop) return;
        setEnabled(r.enabled);
        setFeed(r.enabled ? "on" : "off");
        setItems(r.items);
        const ids = new Set(r.items.map((i) => i.id));
        if (known.current) {
          const fresh = r.items.filter((i) => !known.current!.has(i.id)).slice(0, 3);
          for (const i of fresh.reverse()) {
            const show = i.urgent ? toast.warning : toast.info;
            show(i.title, { description: i.body, duration: i.urgent ? 20000 : 8000, action: i.offerId ? { label: "Open", onClick: () => openOffer(i.offerId) } : undefined });
          }
        }
        known.current = ids;
      } catch { if (!stop) setFeed((f) => (f === "on" ? f : "off")); /* try again next round */ }
    };
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    const vis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", vis);
    // A trade step was just confirmed somewhere: the server writes the notifications right after, so
    // look again shortly instead of waiting for the next round.
    const socket = getSocket();
    const soon: ReturnType<typeof setTimeout>[] = [];
    const onTrade = () => { soon.push(setTimeout(load, 3000), setTimeout(load, 9000)); };
    socket?.on("trade-changed", onTrade);
    return () => { stop = true; clearInterval(t); document.removeEventListener("visibilitychange", vis); socket?.off("trade-changed", onTrade); soon.forEach(clearTimeout); };
  }, [wallet, publicKey, tick, openOffer, signedIn]);

  // what this device can do about phone notifications
  const checkPush = useCallback(async () => {
    if (!pushSupported()) { setPush(isIos() && !isStandalone() ? "needs-install" : "unsupported"); return; }
    if (Notification.permission === "denied") { setPush("denied"); return; }
    try {
      const reg = await swReady();
      const sub = await reg.pushManager.getSubscription();
      setPush(sub && Notification.permission === "granted" ? "on" : "default");
      try { setPushOffers(localStorage.getItem("nx-push-offers") === "1"); } catch { /* ignore */ }
    } catch { setPush("default"); }
  }, []);
  useEffect(() => { checkPush(); }, [checkPush]);

  // a tapped phone notification while the site is already open: go to the trade in place
  const navigate = useNavigate();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (d?.type !== "open-url" || !d.url) return;
      try { const u = new URL(d.url); if (u.origin === location.origin) navigate(u.pathname + u.search); } catch { /* ignore */ }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [navigate]);

  // keep the device's subscription tied to the connected wallet (with its proof; none yet: left as it is)
  useEffect(() => {
    if (push !== "on") return;
    (async () => {
      try {
        const who = wallet && publicKey ? await quietProof(wallet, publicKey) : null;
        if (wallet && !who) return;
        const reg = await swReady();
        const sub = await reg.pushManager.getSubscription();
        if (sub) await savePushSubscription(sub.toJSON(), who, true, pushOffers);
      } catch { /* ignore */ }
    })();
  }, [wallet, publicKey, push, pushOffers]);

  const turnOnPush = useCallback(async (offers: boolean) => {
    if (!pushSupported()) return;
    setPush("working");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setPush(perm === "denied" ? "denied" : "default"); return; }
      const key = await getPushKey();
      if (!key.enabled || !key.publicKey) throw new Error("Notifications are not available right now.");
      const reg = await swReady();
      const sub = (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key.publicKey) }));
      // the person just asked for this: a sign-in (saved on this device) if there is none yet
      const who: Who | null = wallet && publicKey ? { account: wallet, publicKey, signedCmd: await authProof(wallet, publicKey) } : null;
      await savePushSubscription(sub.toJSON(), who, true, offers);
      try { localStorage.setItem("nx-push-offers", offers ? "1" : "0"); } catch { /* ignore */ }
      setPushOffers(offers);
      setPush("on");
      toast.success("Notifications are on", { description: "You'll get a notification when a trade needs you, even with this page closed." });
    } catch (e) {
      setPush("default");
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Could not turn on notifications", {
        description: /registration failed|push service/i.test(msg)
          ? "This browser could not sign up for notifications. Private windows can't receive them; try a normal window or another browser."
          : msg,
        duration: 10000,
      });
    }
  }, [wallet, publicKey]);

  const turnOffPush = useCallback(async () => {
    try {
      const reg = await swReady();
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await removePushSubscription(sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
    } catch { /* ignore */ }
    setPush("default");
  }, []);

  const isUnread = useCallback((i: FeedItem) => new Date(i.createdAt).getTime() > seen, [seen]);
  const unread = useMemo(() => items.filter(isUnread).length, [items, isUnread]);
  const markAllRead = useCallback(() => {
    const t = Date.now();
    setSeen(t);
    try { localStorage.setItem(seenKey(wallet), String(t)); } catch { /* ignore */ }
  }, [wallet]);

  const value: Ctx = { enabled, feed, items, unread, isUnread, markAllRead, push, pushOffers, turnOnPush, turnOffPush, refresh: () => setTick((x) => x + 1) };
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): Ctx {
  const c = useContext(NotificationsContext);
  if (!c) throw new Error("useNotifications must be used inside NotificationsProvider");
  return c;
}
