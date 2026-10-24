import { useState, type ReactNode } from "react";
import { useSignedIn } from "@/lib/session";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWallet } from "@/hooks/useWallet";
import { acceptTerms, getCompletedCounts, getTerms, NEW_TRADER_MAX_KDA, NEW_TRADER_TRADES, type TermsStatus } from "@/lib/trust";

/* ---------------- Completed trades (from the chain) ---------------- */

export function useCompletedCounts(wallets: string[]) {
  const ws = [...new Set(wallets.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["completed-counts", ws.join(",")],
    queryFn: () => getCompletedCounts(ws),
    enabled: ws.length > 0,
    staleTime: 60 * 1000,
  });
}

/** Completed trades of the connected wallet, or undefined while unknown. */
export function useMyCompletedTrades(): number | undefined {
  const { account } = useWallet();
  const { data } = useCompletedCounts(account ? [account.account] : []);
  return account ? data?.[account.account] : undefined;
}

/* ---------------- Terms of use ---------------- */

const SECTIONS: [string, ReactNode][] = [
  ["What the Marketplace is", <>
    Kadena Nexus Marketplace is software. It lists offers and helps two people trade KDA with each other through an
    escrow contract on the Kadena chain (<span className="font-mono">free.p2p-escrow-v10</span>, chain 1). Kadena Nexus
    is not a party to your trade. It is not an exchange, broker, bank or payment service, and it never holds your
    money. Your KDA is held by the contract, not by Kadena Nexus.
  </>],
  ["You follow your local laws", <>
    You are responsible for following the laws where you live, including rules on crypto, payments and taxes. Do not use
    the Marketplace where it is not allowed. You must be at least 18 and trade only for yourself, with your own wallet
    and your own payment accounts.
  </>],
  ["Payments happen between the two traders", <>
    The buyer pays the seller directly with USDT, USDC, Wise, Revolut or the Kadena token BRO. The Marketplace does not move or check that
    money. Pay only the exact amount, only to the details shown in the trade, and from an account in your own name.
    Never pay to other details sent in chat, and never pay outside a trade. Bank transfers are not accepted. A payment
    service can delay, freeze or reverse a payment; that risk stays between the traders.
  </>],
  ["The escrow and its deadlines", <>
    After an offer is accepted the KDA holder has 1 hour to deposit, the buyer then has 4 hours to pay and mark the
    payment, and the seller then has 1 hour to release. Every step is a transaction you sign in your wallet, and
    transactions on the chain cannot be undone. The seller must check the money has really arrived before releasing.
  </>],
  ["Disputes", <>
    If a trade goes wrong, either side can open a dispute. An arbiter account run by Kadena Nexus reviews the evidence
    both sides upload and records a decision on the chain, sending the KDA to the buyer or back to the seller. That
    decision is final for the escrow. Upload only real evidence.
  </>],
  ["Not allowed", <>
    Fraud, fake payment proofs, stolen funds or accounts, money laundering, trading for someone else, and using several
    wallets to get around limits. Offers and accounts involved may be hidden, and evidence may be shared with the other
    trader or the authorities where the law requires it.
  </>],
  ["New traders", <>
    Until a wallet has {NEW_TRADER_TRADES} completed trades, each offer it creates or accepts is limited to {NEW_TRADER_MAX_KDA} KDA.
  </>],
  ["Risks", <>
    The price of KDA can change fast. Smart contracts, wallets and networks can have bugs or outages, and a lost wallet
    or recovery phrase cannot be recovered by anyone. The Marketplace is provided as it is, without warranty. As far as
    the law allows, Kadena Nexus is not responsible for losses from trades, payments, wallets or the network.
  </>],
  ["Changes", <>
    These terms may change. When they do, you will be asked to accept the new version before your next trade.
  </>],
];

export function TermsText({ className = "" }: { className?: string }) {
  return (
    <div className={`space-y-4 text-sm leading-relaxed ${className}`}>
      {SECTIONS.map(([h, body], i) => (
        <section key={h}>
          <h3 className="font-semibold text-foreground">{i + 1}. {h}</h3>
          <p className="mt-1 text-muted-foreground">{body}</p>
        </section>
      ))}
    </div>
  );
}

const KEY_POINTS = [
  "Kadena Nexus is software, not a party to your trade, and never holds your money.",
  "You follow the laws where you live, and trade only for yourself.",
  "Pay only the exact amount, to the details in the trade, from your own account. No bank transfers.",
  "Chain transactions cannot be undone. Release only after the money has really arrived.",
  `New traders: up to ${NEW_TRADER_MAX_KDA} KDA per trade until ${NEW_TRADER_TRADES} completed trades.`,
];

/** Asks once (per terms version) before the first create or accept. */
export function TermsGate({ open, onOpenChange, onAccepted }: { open: boolean; onOpenChange: (o: boolean) => void; onAccepted: () => void }) {
  const { account } = useWallet();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState(false);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    if (!account) return;
    setBusy(true);
    try {
      const cur = queryClient.getQueryData<TermsStatus>(["terms", account.account]) ?? (await getTerms(account));
      await acceptTerms(account, cur.version);
      queryClient.setQueryData<TermsStatus>(["terms", account.account], { version: cur.version, accepted: true });
      onAccepted();
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : "Try again." });
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-md flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl"><ShieldCheck className="h-5 w-5 text-primary" />Terms and risks</DialogTitle>
          <DialogDescription>Read and accept once before your first trade.</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {full ? <TermsText /> : (
            <ul className="list-disc space-y-2 pl-5 text-sm">
              {KEY_POINTS.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <button type="button" className="mt-3 text-sm text-primary underline" onClick={() => setFull((f) => !f)}>
            {full ? "Show the short version" : "Read the full terms"}
          </button>
        </div>
        <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
          <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} className="mt-0.5" aria-label="I accept the terms and risks" />
          <span>I have read and accept the terms and risks of trading on the Marketplace.</span>
        </label>
        <Button className="h-12 text-base" disabled={!checked || busy} onClick={accept}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Accept and continue"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/**
 * `check()` resolves true when the wallet already accepted the current terms; otherwise it opens the
 * dialog and resolves false. After accepting, `onAccepted` runs (to carry on with the action).
 */
export function useTermsGate(onAccepted: () => void) {
  const { account } = useWallet();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // prefetch only with a saved sign-in; otherwise the terms are checked when the person taps the action
  const signedIn = useSignedIn(account?.account);
  useQuery({ queryKey: ["terms", account?.account], queryFn: () => getTerms(account!), enabled: !!account && signedIn, staleTime: 10 * 60 * 1000 });
  const check = async () => {
    if (!account) return false;
    try {
      const s = await queryClient.fetchQuery({ queryKey: ["terms", account.account], queryFn: () => getTerms(account), staleTime: 10 * 60 * 1000 });
      if (s.accepted) return true;
    } catch {
      toast.error("Could not check the terms", { description: "Check your connection and try again." });
      return false;
    }
    setOpen(true);
    return false;
  };
  const gate = <TermsGate open={open} onOpenChange={setOpen} onAccepted={() => { setOpen(false); onAccepted(); }} />;
  return { check, gate };
}
