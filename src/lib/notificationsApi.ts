// Trade notifications feed and Web Push (server/notifications.js). Same-origin /api like the other APIs.
const base = (): string => {
  const v = import.meta.env?.VITE_PROFILE_API;
  return typeof v === "string" && v.trim() ? v.trim().replace(/\/$/, "") : "";
};

export type FeedItem = {
  id: number;
  kind: string;                 // accepted | funded | paid | completed | disputed | refunded | closed | due-* | expired-* | message | new_offer
  scope: "trade" | "offer";
  offerId: string | null;
  title: string;
  body: string;
  urgent: boolean;
  createdAt: string;
  open?: boolean;               // new offers: still open to accept
};

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(base() + path, init);
  let data: unknown = null;
  try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) throw new Error((data as { error?: string } | null)?.error || `HTTP ${r.status}`);
  return data as T;
}

export const fetchFeed = (wallet?: string | null) =>
  json<{ enabled: boolean; items: FeedItem[] }>(`/api/notifications${wallet ? `?wallet=${encodeURIComponent(wallet)}` : ""}`);
export const getPushKey = () => json<{ enabled: boolean; publicKey?: string }>("/api/push/key");
export const savePushSubscription = (subscription: PushSubscriptionJSON, wallet: string | null, trades: boolean, offers: boolean) =>
  json<{ ok: true }>("/api/push/subscribe", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription, wallet, trades, offers }),
  });
export const removePushSubscription = (endpoint: string) =>
  json<{ ok: true }>("/api/push/unsubscribe", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint }),
  });
