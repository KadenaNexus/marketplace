import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWallet } from "@/hooks/useWallet";
import { useSignedIn } from "@/lib/session";
import { getTradeEmail, setTradeEmail } from "@/lib/tradeEmailApi";

export function useTradeEmail(pollWhilePending = false) {
  const { account, isConnected } = useWallet();
  const signedIn = useSignedIn(account?.account); // reading it needs a sign-in: never ask the wallet on its own
  return useQuery({
    queryKey: ["trade-email", account?.account],
    queryFn: () => getTradeEmail(account!),
    enabled: !!account && isConnected && signedIn,
    staleTime: 60 * 1000,
    refetchInterval: (q) => (pollWhilePending && q.state.data && !q.state.data.on ? 5000 : false),
  });
}

/**
 * Asked when the person taps create or accept: resolves true when the wallet must still add and confirm an email
 * before trading (only when email is set up on the server). Signs in first if needed, as part of that tap.
 */
export function useNeedsTradeEmail() {
  const { account } = useWallet();
  const queryClient = useQueryClient();
  return async (): Promise<boolean> => {
    if (!account) return false;
    try {
      const data = await queryClient.fetchQuery({ queryKey: ["trade-email", account.account], queryFn: () => getTradeEmail(account), staleTime: 60 * 1000 });
      return !!data?.available && !data.on;
    } catch {
      return false; // offline or sign-in closed: the server still refuses a trade without a confirmed email
    }
  };
}

/**
 * The trader's email for trade notifications. Required to trade, so there is no "turn off"; the address can
 * be changed (the old one keeps getting emails until the new one is confirmed).
 */
export function TradeEmailForm({ compact = false }: { compact?: boolean }) {
  const { account } = useWallet();
  const { data: s, isLoading } = useTradeEmail();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!account || isLoading || !s?.available) return null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["trade-email", account.account] });
  const lang = (() => { try { return localStorage.getItem("nx-lang") === "ar" ? "ar" : "en"; } catch { return "en"; } })();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.");
    setBusy(true); setError(null);
    try { await setTradeEmail(account, email.trim(), lang); setEditing(false); refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); }
    finally { setBusy(false); }
  };
  const change = () => { setEmail(s.pending ?? s.email ?? ""); setEditing(true); };

  const form = (
    <>
      <div className="flex gap-2">
        <Input type="email" inputMode="email" autoComplete="email" dir="ltr" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
        <Button type="submit" className="h-10 shrink-0" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : s.email ? "Send link" : "Confirm email"}</Button>
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </>
  );

  if (s.on && !editing) {
    return (
      <div className="space-y-1 text-sm">
        <p className="flex items-center gap-2"><MailCheck className="h-4 w-4 shrink-0 text-primary" /><span>Trade emails go to <b className="break-all">{s.email}</b></span></p>
        {s.pending && <p className="text-muted-foreground">Confirm <b className="text-foreground">{s.pending}</b> with the link we sent to switch to it.</p>}
        <button type="button" className="text-xs text-primary underline" onClick={change}>Change email</button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-2 text-sm" noValidate>
      {!compact && <p className="flex items-center gap-2 font-medium"><Mail className="h-4 w-4 text-primary" />Your email for trade notices</p>}
      {s.pending && !s.on && !editing ? (
        <p className="text-muted-foreground">We sent a link to <b className="text-foreground">{s.pending}</b>. Open it to confirm. <button type="button" className="text-primary underline" onClick={change}>Change or send again</button></p>
      ) : (
        <>
          <p className="text-muted-foreground">Every step of your trades by email: when you must deposit, pay or release, and when time runs short.</p>
          {form}
        </>
      )}
    </form>
  );
}

/**
 * Shown when someone without a confirmed email tries to create or accept an offer. While open it checks every
 * few seconds, so confirming in the mail app is enough: the dialog closes by itself.
 */
export function TradeEmailGate({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data } = useTradeEmail(open);
  useEffect(() => {
    if (open && data?.on) {
      toast.success("Email confirmed", { description: "You can trade now." });
      onOpenChange(false);
    }
  }, [open, data?.on, onOpenChange]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl"><Mail className="h-5 w-5 text-primary" />Add your email to trade</DialogTitle>
          <DialogDescription>
            Like an exchange, the Marketplace emails you at every step of a trade: when you must deposit, pay or release,
            and before time runs out. A confirmed email is needed to create or accept offers.
          </DialogDescription>
        </DialogHeader>
        <TradeEmailForm compact />
        <p className="text-xs text-muted-foreground">Only you and the Marketplace see it. The other trader never does.</p>
      </DialogContent>
    </Dialog>
  );
}
