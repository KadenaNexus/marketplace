import { useEffect, useState, type ReactNode } from "react";
import { Bell, MessageCircle, Smartphone, Wallet } from "lucide-react";
import { AppLogo } from "@/components/AppLogo";
import { useLang } from "@/components/NexusLanding";
import { LINX_APP_STORE } from "@/components/WalletPicker";

const OK_KEY = "nx-desktop-ok";

const COPY = {
  en: {
    title: "The Marketplace is now on your phone",
    lead: "Trading happens where your wallet, alerts and chat are: on your phone. Scan this code with your phone's camera to open it.",
    works: "Works on iPhone and Android, in the browser. No app store needed for the Marketplace itself.",
    orType: "Or type",
    why: [
      ["Linx wallet on the same phone", "Approve each step in Linx and come straight back."],
      ["Alerts and notifications", "New offers, your turn in a trade, deadlines. Add it to your Home Screen for push notifications."],
      ["Live chat", "Talk to the other side before and during a trade."],
      ["Made for one hand", "One clear button for the step that is yours."],
    ],
    getLinx: "Get Linx Wallet",
    stay: "Arbiter, or need this computer? Continue here",
  },
  ar: {
    title: "السوق الآن على جوالك",
    lead: "التداول يتم حيث توجد محفظتك وتنبيهاتك والمحادثة: على جوالك. امسح هذا الرمز بكاميرا الجوال لفتحه.",
    works: "يعمل على iPhone وAndroid من المتصفح. لا حاجة لتحميل تطبيق للسوق نفسه.",
    orType: "أو اكتب",
    why: [
      ["محفظة Linx على نفس الجوال", "وافق على كل خطوة في Linx ثم عد مباشرة."],
      ["تنبيهات وإشعارات", "عروض جديدة، دورك في الصفقة، المهل. أضفه إلى الشاشة الرئيسية لتصلك الإشعارات."],
      ["محادثة مباشرة", "تواصل مع الطرف الآخر قبل الصفقة وأثناءها."],
      ["مصمم لليد الواحدة", "زر واضح واحد للخطوة المطلوبة منك."],
    ],
    getLinx: "احصل على محفظة Linx",
    stay: "محكّم أو تحتاج هذا الكمبيوتر؟ تابع هنا",
  },
} as const;

const ICONS = [Wallet, Bell, MessageCircle, Smartphone];

/** A computer: a fine pointer (mouse) and a wide screen. Touch screens (phones, tablets) are not. */
function isComputer(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return !coarse && window.innerWidth >= 768;
}
function desktopAllowed(): boolean {
  try { return window.localStorage.getItem(OK_KEY) === "1"; } catch { return false; }
}

/**
 * The Marketplace is for phones. On a computer, show where to open it instead (a QR code of this very
 * page, so an offer link from an email opens the same offer on the phone). Arbiters and anyone who needs
 * the computer can continue; that choice is remembered in this browser.
 */
export function PhoneFirst({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState(() => isComputer() && !desktopAllowed());
  if (!gate) return <>{children}</>;
  return <PhoneOnlyScreen onContinue={() => { try { window.localStorage.setItem(OK_KEY, "1"); } catch { /* ignore */ } setGate(false); }} />;
}

function PhoneOnlyScreen({ onContinue }: { onContinue: () => void }) {
  const [lang] = useLang();
  const t = COPY[lang];
  const [qr, setQr] = useState<string | null>(null);
  const url = typeof window !== "undefined" ? window.location.href : "https://marketplace.kadena.ws";
  const host = typeof window !== "undefined" ? window.location.host : "marketplace.kadena.ws";

  useEffect(() => {
    import("qrcode")
      .then((QRCode) => QRCode.toDataURL(url, { margin: 1, width: 520, errorCorrectionLevel: "M", color: { dark: "#123A48", light: "#FFFFFF" } }))
      .then(setQr).catch(() => setQr(null));
  }, [url]);

  return (
    <div className="min-h-screen bg-background" dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
      <header className="border-b border-border bg-card/50" dir="ltr">
        <div className="container mx-auto px-4 py-4"><AppLogo /></div>
      </header>
      <main className="container mx-auto grid max-w-5xl items-center gap-10 px-4 py-12 md:grid-cols-[1fr_auto]">
        <div className="space-y-6">
          <div className="space-y-3">
            <h1 className="font-display text-4xl font-bold leading-tight">{t.title}</h1>
            <p className="text-lg text-muted-foreground">{t.lead}</p>
            <p className="text-sm text-muted-foreground">{t.works}</p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {t.why.map(([title, body], i) => {
              const Icon = ICONS[i];
              return (
                <li key={title} className="flex gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
                  <span>
                    <span className="block font-semibold">{title}</span>
                    <span className="block text-sm text-muted-foreground">{body}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <a href={LINX_APP_STORE} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center rounded-full border border-border px-5 font-semibold hover:border-primary">
            {t.getLinx}
          </a>
        </div>
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-72 w-72 items-center justify-center rounded-3xl border border-border bg-white p-4 shadow-sm">
            {qr ? <img src={qr} alt={t.title} className="h-full w-full" /> : <Smartphone className="h-10 w-10 text-muted-foreground" />}
          </div>
          <p className="text-sm text-muted-foreground">{t.orType} <span className="font-mono font-semibold text-foreground" dir="ltr">{host}</span></p>
        </div>
      </main>
      <footer className="container mx-auto px-4 pb-10 text-center">
        <button type="button" onClick={onContinue} className="text-sm text-muted-foreground underline hover:text-foreground">{t.stay}</button>
      </footer>
    </div>
  );
}
