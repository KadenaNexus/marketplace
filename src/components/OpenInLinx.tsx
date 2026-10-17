import { useState } from "react";
import { ExternalLink, Wallet, X } from "lucide-react";
import type { Lang } from "@/components/NexusLanding";

export const LINX_IOS = "https://apps.apple.com/app/linx-wallet/id6450412379";
export const LINX_ANDROID = "https://play.google.com/store/apps/details?id=com.thinedgelabs.linx_wallet";

const ua = () => (typeof navigator === "undefined" ? "" : navigator.userAgent);
const isAndroid = () => /Android/i.test(ua());
const isPhoneUA = () => /Android|iPhone|iPad|iPod/i.test(ua());

/** The store page for this phone (App Store on iPhone and computers, Google Play on Android). Opens Linx if installed. */
export const linxStoreLink = () => (isAndroid() ? LINX_ANDROID : LINX_IOS);

/**
 * Already inside a wallet's own browser (Linx Explore)? Then there's nothing to send people to.
 * Linx's browser connects in-app; we recognise it by name in the user agent, by an injected Kadena wallet,
 * or as an app web view (iPhone without "Safari/", Android "; wv)") that isn't a social app's browser.
 */
export function inWalletBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const u = ua();
  if (/linx/i.test(u) || (window as unknown as { kadena?: { isKadena?: boolean } }).kadena?.isKadena) return true;
  const social = /FBAN|FBAV|Instagram|Telegram|Line\/|Twitter|TikTok|Snapchat|WhatsApp/i.test(u);
  const iosWebView = /iPhone|iPad|iPod/i.test(u) && !/Safari\//i.test(u);
  const androidWebView = /Android/i.test(u) && /; wv\)/i.test(u);
  return (iosWebView || androidWebView) && !social;
}

export const LINX_PATH = {
  en: ["Explore", "Web3 Apps", "Kadena", "Kadena P2P Marketplace"],
  ar: ["Explore", "Web3 Apps", "Kadena", "Kadena P2P Marketplace"],
} as const;

const COPY = {
  en: {
    title: "Trade inside Linx Wallet",
    body: "The Marketplace is now in Linx. Open it there and approve every step without leaving the app.",
    inLinx: "In Linx:",
    open: "Open Linx Wallet",
    stay: "Stay in browser",
  },
  ar: {
    title: "تداول من داخل محفظة Linx",
    body: "السوق الآن داخل Linx. افتحه من هناك ووافق على كل خطوة دون مغادرة التطبيق.",
    inLinx: "في Linx:",
    open: "افتح محفظة Linx",
    stay: "البقاء في المتصفح",
  },
} as const;

/** "Explore → Web3 Apps → Kadena → Kadena P2P Marketplace" as small chips (always left to right: Linx's own labels). */
export function LinxPath({ lang, className = "" }: { lang: Lang; className?: string }) {
  return (
    <span dir="ltr" className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {LINX_PATH[lang].map((s, i) => (
        <span key={s} className="inline-flex items-center gap-1">
          {i > 0 && <span aria-hidden="true" className="text-muted-foreground">→</span>}
          <b className="rounded-md bg-background/70 px-1.5 py-0.5 font-semibold text-foreground">{s}</b>
        </span>
      ))}
    </span>
  );
}

const HIDE_KEY = "nx-linx-card-hidden-until";
const hiddenNow = () => { try { return Number(localStorage.getItem(HIDE_KEY) || 0) > Date.now(); } catch { return false; } };

/**
 * On a phone in an ordinary browser: point people to the Marketplace inside Linx Wallet, where approvals
 * happen in the same app. "Stay in browser" hides it for 30 days; the website keeps working as before.
 */
export function OpenInLinxCard({ lang, className = "" }: { lang: Lang; className?: string }) {
  const [hidden, setHidden] = useState(() => hiddenNow() || !isPhoneUA() || inWalletBrowser());
  if (hidden) return null;
  const t = COPY[lang];
  const hide = () => { try { localStorage.setItem(HIDE_KEY, String(Date.now() + 30 * 86400e3)); } catch { /* ignore */ } setHidden(true); };
  return (
    <section aria-label={t.title} className={`relative rounded-2xl border-2 border-primary/30 bg-primary/5 p-4 ${className}`}>
      <button type="button" onClick={hide} aria-label={t.stay} className="absolute end-2 top-2 rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      <p className="flex items-center gap-2 pe-6 font-semibold">
        <Wallet className="h-5 w-5 text-primary" />
        {t.title}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{t.body}</p>
      <p className="mt-2 text-sm">
        <span className="me-1 text-muted-foreground">{t.inLinx}</span>
        <LinxPath lang={lang} className="text-xs" />
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a href={linxStoreLink()} target="_blank" rel="noopener noreferrer"
          className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">
          {t.open}<ExternalLink className="h-4 w-4" />
        </a>
        <button type="button" onClick={hide} className="text-sm text-muted-foreground underline hover:text-foreground">{t.stay}</button>
      </div>
    </section>
  );
}
