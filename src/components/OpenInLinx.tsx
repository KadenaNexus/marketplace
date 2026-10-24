import type { Lang } from "@/components/NexusLanding";

export const LINX_IOS = "https://apps.apple.com/app/linx-wallet/id6450412379";
export const LINX_ANDROID = "https://play.google.com/store/apps/details?id=com.thinedgelabs.linx_wallet";

const ua = () => (typeof navigator === "undefined" ? "" : navigator.userAgent);
const isAndroid = () => /Android/i.test(ua());

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
  // a Home Screen web app (added from Safari before) is the browser, not a wallet
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;
  if (standalone) return false;
  const social = /FBAN|FBAV|Instagram|Telegram|Line\/|Twitter|TikTok|Snapchat|WhatsApp/i.test(u);
  const iosWebView = /iPhone|iPad|iPod/i.test(u) && !/Safari\//i.test(u);
  const androidWebView = /Android/i.test(u) && /; wv\)/i.test(u);
  return (iosWebView || androidWebView) && !social;
}

/**
 * A wallet injected into the page on a phone: that is the wallet app's own browser (Linx Explore), since
 * phone browsers have no wallet extensions. On a computer an injected wallet is the Ecko extension instead.
 */
export function phoneWalletBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const injected = !!(window as unknown as { kadena?: { isKadena?: boolean } }).kadena?.isKadena;
  return injected && (/linx/i.test(ua()) || /iPhone|iPad|iPod|Android/i.test(ua()));
}

export const LINX_PATH = {
  en: ["Explore", "Web3 Apps", "Kadena", "Kadena P2P Marketplace"],
  ar: ["Explore", "Web3 Apps", "Kadena", "Kadena P2P Marketplace"],
} as const;

/** "Explore → Web3 Apps → Kadena → Kadena P2P Marketplace" as small chips (always left to right: Linx's own labels). */
export function LinxPath({ lang, className = "" }: { lang: Lang; className?: string }) {
  return (
    <span dir="ltr" className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {LINX_PATH[lang].map((s, i) => (
        <span key={s} className="inline-flex items-center gap-1">
          {i > 0 && <span aria-hidden="true" className="text-muted-foreground">→</span>}
          <b className="rounded-md bg-muted px-1.5 py-0.5 font-semibold text-foreground">{s}</b>
        </span>
      ))}
    </span>
  );
}
