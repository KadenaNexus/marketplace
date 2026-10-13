import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BellOff, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AppLogo } from "@/components/AppLogo";
import { useLang } from "@/components/NexusLanding";
import { AlertChoices, alertsErrorText, checkAlertSettings, useAlertsStatus } from "@/components/OfferAlerts";
import { ALERTS_COPY } from "@/lib/alertsCopy";
import {
  AlertSettings, AlertSettingsView, confirmAlerts, readAlerts, resubscribeAlerts, saveAlerts, unsubscribeAlerts,
} from "@/lib/alertsApi";

type Phase = "loading" | "confirmed" | "manage" | "unsubscribed" | "bad";

/**
 * Landing page for links in alert emails:
 *   /alerts?confirm=TOKEN            confirm a sign-up (done by script so mail scanners that open links don't confirm)
 *   /alerts?token=TOKEN              change choices
 *   /alerts?token=TOKEN&unsubscribe=1 stop all alerts
 */
export default function Alerts() {
  const [params] = useSearchParams();
  const confirmToken = params.get("confirm");
  const token = confirmToken || params.get("token") || "";
  const wantsUnsub = params.get("unsubscribe") === "1";

  const [lang, setLang] = useLang();
  const t = ALERTS_COPY[lang];
  const status = useAlertsStatus();
  const [phase, setPhase] = useState<Phase>("loading");
  const [view, setView] = useState<AlertSettingsView | null>(null);
  const [draft, setDraft] = useState<AlertSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const started = useRef(false);

  const take = (s: AlertSettingsView) => {
    setView(s);
    setDraft({ wantSell: s.wantSell, wantBuy: s.wantBuy, currencies: s.currencies.filter((c) => (status.data?.currencies ?? ["USD", "EUR", "SAR", "AED"]).includes(c)), minKda: s.minKda, maxKda: s.maxKda, frequency: s.frequency, lang: s.lang });
    if (s.lang !== lang) setLang(s.lang);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) { setPhase("bad"); return; }
    (async () => {
      try {
        if (confirmToken) { const r = await confirmAlerts(token); take(r.settings); setPhase("confirmed"); }
        else if (wantsUnsub) { const r = await unsubscribeAlerts(token); take(r.settings); setPhase("unsubscribed"); }
        else { const r = await readAlerts(token); take(r.settings); setPhase(r.settings.unsubscribed ? "unsubscribed" : "manage"); }
      } catch {
        setPhase("bad");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!draft) return;
    const bad = checkAlertSettings(lang, draft);
    if (bad) return setMsg({ ok: false, text: bad });
    setBusy(true); setMsg(null);
    try { const r = await saveAlerts(token, { ...draft, lang }); take(r.settings); setMsg({ ok: true, text: t.saved }); }
    catch (err) { setMsg({ ok: false, text: alertsErrorText(lang, err) }); }
    finally { setBusy(false); }
  };
  const unsub = async () => {
    setBusy(true); setMsg(null);
    try { const r = await unsubscribeAlerts(token); take(r.settings); setPhase("unsubscribed"); }
    catch (err) { setMsg({ ok: false, text: alertsErrorText(lang, err) }); }
    finally { setBusy(false); }
  };
  const resub = async () => {
    setBusy(true); setMsg(null);
    try { const r = await resubscribeAlerts(token); take(r.settings); setPhase("manage"); }
    catch (err) { setMsg({ ok: false, text: alertsErrorText(lang, err) }); }
    finally { setBusy(false); }
  };

  const rtl = lang === "ar";
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50">
        <div className="container mx-auto flex items-center justify-between gap-3 px-4 py-4">
          <AppLogo />
          <button type="button" onClick={() => setLang(rtl ? "en" : "ar")}
            className="inline-flex h-8 items-center rounded-full border border-border px-3 text-xs font-semibold text-muted-foreground hover:border-primary hover:text-foreground">
            {rtl ? "English" : "العربية"}
          </button>
        </div>
      </header>

      <main className="container mx-auto max-w-xl px-4 py-10" dir={rtl ? "rtl" : "ltr"} lang={lang}>
        <h1 className="mb-6 font-display text-3xl font-bold">{t.pageTitle}</h1>
        <Card>
          <CardContent className="space-y-5 pt-6">
            {phase === "loading" && (
              <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t.confirming}</p>
            )}

            {phase === "bad" && (
              <div className="space-y-4">
                <p>{t.badLink}</p>
                <Button asChild><Link to="/">{t.backToMarket}</Link></Button>
              </div>
            )}

            {phase === "unsubscribed" && (
              <div className="space-y-4">
                <BellOff className="h-10 w-10 text-muted-foreground" />
                <h2 className="text-xl font-semibold">{t.unsubscribedTitle}</h2>
                <p className="text-muted-foreground">{t.unsubscribedBody}</p>
                <div className="flex flex-wrap gap-2">
                  {view?.confirmed && <Button onClick={resub} disabled={busy}>{busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t.resubscribe}</Button>}
                  <Button variant="outline" asChild><Link to="/">{t.backToMarket}</Link></Button>
                </div>
              </div>
            )}

            {(phase === "confirmed" || phase === "manage") && view && draft && (
              <>
                {phase === "confirmed" ? (
                  <div className="flex gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
                    <CheckCircle2 className="h-6 w-6 shrink-0 text-primary" />
                    <div>
                      <h2 className="font-semibold">{t.confirmedTitle}</h2>
                      <p className="text-sm text-muted-foreground">{t.confirmedBody}</p>
                    </div>
                  </div>
                ) : (
                  <h2 className="text-xl font-semibold">{t.manageTitle}</h2>
                )}
                <p className="text-sm text-muted-foreground">{t.manageFor} <span dir="ltr" className="font-medium text-foreground">{view.email}</span></p>
                <AlertChoices key={view.email + view.frequency} lang={lang} value={draft} onChange={setDraft} currencies={status.data?.currencies} />
                {msg && <p role="status" className={msg.ok ? "text-sm text-primary" : "text-sm text-destructive"}>{msg.text}</p>}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <Button onClick={save} disabled={busy}>{busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{busy ? t.saving : t.save}</Button>
                  <Button variant="ghost" onClick={unsub} disabled={busy} className="text-muted-foreground">{t.unsubscribe}</Button>
                </div>
                <div><Link to="/" className="text-sm font-semibold text-primary hover:underline">{t.backToMarket}</Link></div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
