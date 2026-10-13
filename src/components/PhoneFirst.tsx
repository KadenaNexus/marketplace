import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bell, MessageCircle, Smartphone, Wallet } from "lucide-react";
import { AppLogo } from "@/components/AppLogo";
import { useLang } from "@/components/NexusLanding";
import { LINX_APP_STORE } from "@/components/WalletPicker";


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
    stay: "Arbiter sign-in",
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
    stay: "دخول المحكّم",
  },
} as const;

const ICONS = [Wallet, Bell, MessageCircle, Smartphone];

/** A computer: a fine pointer (mouse) and a wide screen. Touch screens (phones, tablets) are not. */
function isComputer(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return !coarse && window.innerWidth >= 768;
}

/**
 * The Marketplace is for phones. On a computer, show where to open it instead (a QR code of this very
 * page, so an offer link from an email opens the same offer on the phone). The only computer use left is
 * the arbiter's dispute board (/admin), reached from a small link at the bottom.
 */
export function PhoneFirst({ children }: { children: ReactNode }) {
  const [gate] = useState(isComputer);
  if (!gate) return <>{children}</>;
  return <PhoneOnlyScreen />;
}

function PhoneOnlyScreen() {
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
        <Link to="/admin" className="text-xs text-muted-foreground underline hover:text-foreground">{t.stay}</Link>
      </footer>
    </div>
  );
}
