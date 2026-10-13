import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWallet } from "@/hooks/useWallet";
import { getTradeEmail, setTradeEmail, turnOffTradeEmail } from "@/lib/tradeEmailApi";

export function useTradeEmail() {
  const { account, isConnected } = useWallet();
  return useQuery({
    queryKey: ["trade-email", account?.account],
    queryFn: () => getTradeEmail(account!),
    enabled: !!account && isConnected,
    staleTime: 60 * 1000,
  });
}

/**
 * "Email me about my trades": the same trade notifications as the bell, by email. Works after the person
 * clicks the confirmation link; every email has a one-click way to stop.
 */
export function TradeEmailForm({ compact = false }: { compact?: boolean }) {
  const { account } = useWallet();
  const { data: s, isLoading } = useTradeEmail();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!account || isLoading || !s?.available) return null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["trade-email", account.account] });
  const lang = (() => { try { return localStorage.getItem("nx-lang") === "ar" ? "ar" : "en"; } catch { return "en"; } })();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setMsg({ ok: false, text: "Enter a valid email address." });
    setBusy(true); setMsg(null);
    try {
      const r = await setTradeEmail(account, email.trim(), lang);
      // not yet confirmed: the "Waiting for you to confirm" line below says what to do
      setMsg(r.confirmed ? { ok: true, text: "Trade emails are on." } : null);
      setEditing(false); refresh();
    } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : "Something went wrong." }); }
    finally { setBusy(false); }
  };
  const off = async () => { setBusy(true); try { await turnOffTradeEmail(account); refresh(); setMsg(null); } finally { setBusy(false); } };

  if (s.on && !editing) {
    return (
      <div className="space-y-1 text-sm">
        <p className="flex items-center gap-2"><MailCheck className="h-4 w-4 text-primary" />Trade emails go to <b className="break-all">{s.email}</b></p>
        <div className="flex gap-3 text-xs">
          <button type="button" className="text-primary underline" onClick={() => { setEmail(s.email ?? ""); setEditing(true); }}>Change</button>
          <button type="button" className="text-muted-foreground underline" disabled={busy} onClick={off}>Turn off</button>
        </div>
      </div>
    );
  }
  const pending = !!s.email && !s.confirmed && !editing;
  return (
    <form onSubmit={submit} className="space-y-2 text-sm" noValidate>
      {!compact && <p className="flex items-center gap-2 font-medium"><Mail className="h-4 w-4 text-primary" />Email me about my trades</p>}
      {pending ? (
        <p className="text-muted-foreground">Waiting for you to confirm <b className="text-foreground">{s.email}</b>: click the link we sent. <button type="button" className="text-primary underline" onClick={() => { setEmail(s.email ?? ""); setEditing(true); }}>Change or send again</button></p>
      ) : (
        <>
          <p className="text-muted-foreground">Offer accepted, KDA locked, payment marked, deadlines: by email too.</p>
          <div className="flex gap-2">
            <Input type="email" inputMode="email" autoComplete="email" dir="ltr" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
            <Button type="submit" className="h-10 shrink-0" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Email me"}</Button>
          </div>
        </>
      )}
      {msg && <p role="status" className={msg.ok ? "text-primary" : "text-destructive"}>{msg.text}</p>}
    </form>
  );
}
