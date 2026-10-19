import { useLang } from "@/components/NexusLanding";

/** Shown only on the preview site (built with VITE_STAGING=1), so nobody mistakes it for marketplace.kadena.ws. */
export const IS_STAGING = import.meta.env?.VITE_STAGING === "1";

export function PreviewBanner() {
  const [lang] = useLang();
  if (!IS_STAGING) return null;
  const ar = lang === "ar";
  return (
    <div
      dir={ar ? "rtl" : "ltr"}
      className="sticky top-0 z-[60] bg-amber-400 px-3 py-1.5 text-center text-xs font-medium text-black"
      role="note"
    >
      {ar
        ? "نسخة تجريبية من السوق الجديد (v11). الصفقات هنا حقيقية على الشبكة الرئيسية، فجرّب بمبالغ صغيرة."
        : "Preview of the new Marketplace (v11). Trades here are real on mainnet, so test with small amounts."}
    </div>
  );
}
