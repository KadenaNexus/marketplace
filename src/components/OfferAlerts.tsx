import { FormEvent, ReactNode, isValidElement, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { Lang } from "@/components/NexusLanding";
import { ALERTS_COPY } from "@/lib/alertsCopy";
import { AlertsError, AlertSettings, getAlertsStatus, subscribeAlerts } from "@/lib/alertsApi";
import { cn } from "@/lib/utils";

const FALLBACK_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"];

/** Whether alerts are switched on server-side (hidden until the Resend key is set). */
export function useAlertsStatus() {
  return useQuery({ queryKey: ["alerts-status"], queryFn: getAlertsStatus, staleTime: 10 * 60 * 1000, retry: 1 });
}

export const defaultAlertSettings = (lang: Lang): AlertSettings => ({
  wantSell: true, wantBuy: false, currencies: [], minKda: null, maxKda: null, frequency: "instant", lang,
});

const toNum = (s: string): number | null => {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

/** The choices part of the form, shared by the sign-up dialog and the /alerts manage page. */
export function AlertChoices({ lang, value, onChange, currencies }: {
  lang: Lang; value: AlertSettings; onChange: (v: AlertSettings) => void; currencies?: string[];
}) {
  const t = ALERTS_COPY[lang];
  const [min, setMin] = useState(value.minKda == null ? "" : String(value.minKda));
  const [max, setMax] = useState(value.maxKda == null ? "" : String(value.maxKda));
  const set = (patch: Partial<AlertSettings>) => onChange({ ...value, ...patch });
  const cur = currencies?.length ? currencies : FALLBACK_CURRENCIES;
  const toggleCur = (c: string) =>
    set({ currencies: value.currencies.includes(c) ? value.currencies.filter((x) => x !== c) : [...value.currencies, c] });
  const chip = (active: boolean) => cn(
    "h-8 rounded-full border px-3 text-sm font-medium transition-colors",
    active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary hover:text-foreground",
  );
  const side = (key: "wantSell" | "wantBuy", label: string, sub: string) => (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors", value[key] ? "border-primary bg-primary/5" : "border-border")}>
      <Checkbox checked={value[key]} onCheckedChange={(c) => set({ [key]: c === true } as Partial<AlertSettings>)} className="mt-0.5" />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">{sub}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">{t.what}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {side("wantSell", t.sell, t.sellSub)}
          {side("wantBuy", t.buy, t.buySub)}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t.currency}</legend>
        <div className="flex flex-wrap gap-2" dir="ltr">
          <button type="button" className={chip(value.currencies.length === 0)} onClick={() => set({ currencies: [] })} aria-pressed={value.currencies.length === 0}>
            {t.anyCurrency}
          </button>
          {cur.map((c) => (
            <button key={c} type="button" className={chip(value.currencies.includes(c))} onClick={() => toggleCur(c)} aria-pressed={value.currencies.includes(c)}>
              {c}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t.amount}</legend>
        <div className="grid grid-cols-2 gap-2">
          <Input inputMode="decimal" placeholder={t.min} aria-label={t.min} value={min} dir="ltr"
            onChange={(e) => { setMin(e.target.value); set({ minKda: toNum(e.target.value) }); }} />
          <Input inputMode="decimal" placeholder={t.max} aria-label={t.max} value={max} dir="ltr"
            onChange={(e) => { setMax(e.target.value); set({ maxKda: toNum(e.target.value) }); }} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t.amountHint}</p>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t.when}</legend>
        <RadioGroup value={value.frequency} onValueChange={(v) => set({ frequency: v as AlertSettings["frequency"] })} className="grid gap-2 sm:grid-cols-2" dir={lang === "ar" ? "rtl" : "ltr"}>
          {(["instant", "daily"] as const).map((f) => (
            <label key={f} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3", value.frequency === f ? "border-primary bg-primary/5" : "border-border")}>
              <RadioGroupItem value={f} className="mt-0.5" />
              <span>
                <span className="block font-medium">{f === "instant" ? t.instant : t.daily}</span>
                <span className="block text-sm text-muted-foreground">{f === "instant" ? t.instantSub : t.dailySub}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </fieldset>
    </div>
  );
}

/** Client-side checks; returns an error message or null. */
export function checkAlertSettings(lang: Lang, s: AlertSettings): string | null {
  const t = ALERTS_COPY[lang];
  if (!s.wantSell && !s.wantBuy) return t.errPick;
  if (Number.isNaN(s.minKda as number) || Number.isNaN(s.maxKda as number)) return t.errGeneric;
  if (s.minKda != null && s.maxKda != null && s.minKda > s.maxKda) return t.errMinMax;
  return null;
}

export function alertsErrorText(lang: Lang, err: unknown): string {
  const t = ALERTS_COPY[lang];
  if (err instanceof AlertsError) {
    if (err.status === 503) return t.errOff;
    if (err.status === 429 || err.status === 400) return err.message;
  }
  return t.errGeneric;
}

/**
 * "Get offer alerts" button plus the sign-up dialog. Renders nothing while alerts are switched off
 * on the server, so it can be merged before the Resend key is in place.
 */
export function OfferAlertsButton({ lang, children, className, variant = "outline" }: {
  lang: Lang; children?: ReactNode; className?: string; variant?: "outline" | "default" | "secondary";
}) {
  const status = useAlertsStatus();
  const t = ALERTS_COPY[lang];
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot, hidden from people
  const [settings, setSettings] = useState<AlertSettings>(() => defaultAlertSettings(lang));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!status.data?.enabled) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(t.errEmail);
    const bad = checkAlertSettings(lang, settings);
    if (bad) return setError(bad);
    setBusy(true);
    try {
      await subscribeAlerts(email.trim(), { ...settings, lang }, website);
      setDone(true);
    } catch (err) {
      setError(alertsErrorText(lang, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setDone(false); setError(null); } }}>
      <DialogTrigger asChild>
        {isValidElement(children) ? children : (
          // a plain label (e.g. "Alerts") still needs a real button around it, or nothing opens
          <Button type="button" variant={variant} className={cn("gap-2", className)}>
            <Bell className="h-4 w-4" />
            {children ?? t.cta}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg" dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
        {done ? (
          <div className="space-y-4 py-2 text-center">
            <MailCheck className="mx-auto h-12 w-12 text-primary" />
            <DialogHeader className="sm:text-center">
              <DialogTitle className="text-center">{t.checkTitle}</DialogTitle>
              <DialogDescription className="text-center">{t.checkBody}</DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{t.checkSpam}</p>
            <Button type="button" onClick={() => setOpen(false)}>{t.close}</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5" noValidate>
            <DialogHeader className={cn("pr-7", lang === "ar" && "sm:text-right")}>
              <DialogTitle className="flex items-center gap-2"><Bell className="h-5 w-5 text-primary" />{t.title}</DialogTitle>
              <DialogDescription>{t.intro}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="alerts-email">{t.email}</Label>
              <Input id="alerts-email" type="email" autoComplete="email" dir="ltr" placeholder={t.emailPh} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
            </div>
            <AlertChoices lang={lang} value={settings} onChange={setSettings} currencies={status.data?.currencies} />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full gap-2" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {busy ? t.sending : t.submit}
            </Button>
            <p className="text-center text-xs text-muted-foreground">{t.privacy}</p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
