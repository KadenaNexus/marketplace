// Offer alerts API (server/alerts.js). Same-origin /api like the profile API.
const base = (): string => {
  const v = import.meta.env?.VITE_PROFILE_API;
  return typeof v === "string" && v.trim() ? v.trim().replace(/\/$/, "") : "";
};

export type AlertSettings = {
  wantSell: boolean;
  wantBuy: boolean;
  currencies: string[];
  minKda: number | null;
  maxKda: number | null;
  frequency: "instant" | "daily";
  lang: "en" | "ar";
};
export type AlertSettingsView = AlertSettings & { email: string; confirmed: boolean; unsubscribed: boolean };

export class AlertsError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(base() + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: { error?: string } | null = null;
  try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) throw new AlertsError(data?.error || `HTTP ${r.status}`, r.status);
  return data as unknown as T;
}

export const getAlertsStatus = () => call<{ enabled: boolean; currencies: string[] }>("/api/alerts/status", "GET");
export const subscribeAlerts = (email: string, s: AlertSettings, website = "") =>
  call<{ ok: true }>("/api/alerts/subscribe", "POST", { email, website, ...s });
type WithSettings = { ok: true; settings: AlertSettingsView };
export const confirmAlerts = (token: string) => call<WithSettings>("/api/alerts/confirm", "POST", { token });
export const readAlerts = (token: string) => call<WithSettings>("/api/alerts/settings", "POST", { token });
export const saveAlerts = (token: string, s: AlertSettings) => call<WithSettings>("/api/alerts/settings", "PUT", { token, ...s });
export const unsubscribeAlerts = (token: string) => call<WithSettings>("/api/alerts/unsubscribe", "POST", { token });
export const resubscribeAlerts = (token: string) => call<WithSettings>("/api/alerts/resubscribe", "POST", { token });
