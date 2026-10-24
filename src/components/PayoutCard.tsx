import { useEffect, useState } from "react";
import { SignInPrompt } from "@/components/SignIn";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Landmark, Loader2, Lock, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWallet } from "@/hooks/useWallet";
import { authProof, useSignedIn } from "@/lib/session";
import type { Escrow } from "@/lib/kadena";
import { getPayout, hasNetwork, isTokenMethod, networkLabel, putPayout, stableProblem, type PayoutItem } from "@/lib/payoutApi";
import { PayoutInput, type PayoutDraft } from "./PayoutInput";

export const offerMethods = (e: Escrow): string[] => {
  try { const m = JSON.parse(e.paymentMethod || "[]"); return Array.isArray(m) ? m.map(String) : []; }
  catch { return e.paymentMethod ? [e.paymentMethod] : []; }
};

export function usePayout(escrow: Escrow | null | undefined) {
  const { account, isConnected } = useWallet();
  const me = account?.account;
  const signedIn = useSignedIn(me);
  const involved = !!escrow && !!me && (me === escrow.seller || me === escrow.buyer || me === escrow.creator || me === escrow.arbiter);
  return useQuery({
    queryKey: ["payout", escrow?.offerId, me, escrow?.state],
    queryFn: async () => {
      const signedCmd = await authProof(account!.account, account!.publicKey);
      return getPayout(escrow!.offerId, { wallet: account!.account, publicKey: account!.publicKey, signedCmd });
    },
    enabled: involved && isConnected && signedIn, // never asks the wallet on its own: see SignInPrompt
    staleTime: 15000,
  });
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ } }}
      className="flex h-9 shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:border-primary"
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{done ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * Where the seller (KDA holder) gets paid. The seller fills it in (SELL offers: already when creating; BUY
 * offers: after accepting) and can change it until the deposit. The buyer sees it from the moment the
 * offer is accepted, with copy buttons, so there is time to check it before the KDA is locked.
 */
export function PayoutCard({ escrow, total }: { escrow: Escrow; total: string }) {
  const { account } = useWallet();
  const me = account?.account;
  const signedIn = useSignedIn(me);
  const { data, isLoading } = usePayout(escrow);
  const queryClient = useQueryClient();
  const methods = offerMethods(escrow);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, PayoutDraft>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setValues(Object.fromEntries(data.details.map((d) => [d.method, { value: d.value, network: d.network }])));
  }, [data]);

  if (!me) return null;
  const isHolder = me === escrow.seller && !!escrow.seller;
  const isPayer = !!escrow.buyer && me === escrow.buyer;

  const isArbiterView = me === escrow.arbiter && !isHolder && !isPayer;
  // Someone looking at an open offer
  if (!isHolder && !isPayer && !isArbiterView) {
    if (escrow.state !== "CREATED" || me === escrow.creator) return null;
    return (
      <div className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
        <Landmark className="mr-1.5 inline h-4 w-4" />
        {escrow.side === "SELL"
          ? "After you accept, you'll see exactly where to send the payment."
          : "After you accept, you'll add where you want to be paid."}
      </div>
    );
  }
  if (isPayer && escrow.state === "CREATED") {
    return <p className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground"><Landmark className="mr-1.5 inline h-4 w-4" />When someone accepts, you'll see here where to send the payment.</p>;
  }
  if (!signedIn) return <SignInPrompt what="the payment details" />;
  if (isLoading) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading payment details…</p>;
  const details = data?.details ?? [];

  if (isHolder) {
    const editable = data?.editable ?? false;
    const save = async () => {
      if (!account) return;
      const items: PayoutItem[] = (methods.length ? methods : Object.keys(values))
        .map((m) => ({ method: m, value: (values[m]?.value ?? "").trim(), ...(hasNetwork(m) ? { network: values[m]?.network } : {}) }))
        .filter((x) => x.value);
      if (!items.length) return toast.error("Add where you want to be paid for at least one payment method.");
      const problem = items.map(stableProblem).find(Boolean);
      if (problem) return toast.error(problem);
      setSaving(true);
      try {
        const signedCmd = await authProof(account.account, account.publicKey);
        await putPayout(escrow.offerId, items, { wallet: account.account, publicKey: account.publicKey, signedCmd });
        await queryClient.invalidateQueries({ queryKey: ["payout", escrow.offerId] });
        setEditing(false);
        toast.success("Payment details saved");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save");
      } finally {
        setSaving(false);
      }
    };
    const showForm = editable && (editing || details.length === 0);
    return (
      <section className={`space-y-3 rounded-xl border-2 p-4 ${details.length ? "border-border" : "border-amber-400 bg-amber-50/60 dark:bg-amber-950/30"}`} aria-label="Where you get paid">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 font-semibold"><Landmark className="h-4 w-4 text-primary" />Where you get paid</h3>
            <p className="text-sm text-muted-foreground">
              {!editable ? "Locked: the KDA is in escrow, so these can no longer change."
                : details.length ? "The buyer sees this after accepting. You can change it until you deposit."
                : "Add it now: the buyer needs it to pay you, and you can't deposit without it."}
            </p>
          </div>
          {editable && details.length > 0 && !editing && (
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" />Edit</Button>
          )}
          {!editable && <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />}
        </div>
        {showForm ? (
          <div className="space-y-3">
            {(methods.length ? methods : ["Payment"]).map((m) => (
              <PayoutInput key={m} method={m} draft={values[m] ?? { value: "" }} onChange={(d) => setValues((v) => ({ ...v, [m]: d }))} />
            ))}
            <Button type="button" className="h-11 w-full" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save payment details
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {details.map((d) => (
              <li key={d.method} className="rounded-lg bg-muted p-3">
                <p className="text-xs text-muted-foreground">{d.method}{d.network ? ` · ${networkLabel(d.network)}` : ""}</p>
                <p className="break-all font-mono text-sm">{d.value}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  if (isArbiterView) {
    return (
      <section className="space-y-2" aria-label="Seller's payment details">
        <p className="text-sm font-medium">Seller's payment details (as the buyer saw them{data?.updatedAt ? `, last changed ${new Date(data.updatedAt).toLocaleString()}` : ""})</p>
        {details.length === 0 ? <p className="text-sm text-muted-foreground">None added.</p> : (
          <ul className="space-y-1">
            {details.map((d) => <li key={d.method} className="rounded bg-muted p-2"><span className="text-xs text-muted-foreground">{d.method}{d.network ? ` (${networkLabel(d.network)})` : ""}: </span><span className="break-all font-mono text-sm">{d.value}</span></li>)}
          </ul>
        )}
      </section>
    );
  }

  // The buyer (payer)
  return (
    <section className="space-y-3 rounded-xl border-2 border-primary/40 p-4" aria-label="Where to send the payment">
      <div>
        <h3 className="flex items-center gap-2 font-semibold"><Landmark className="h-4 w-4 text-primary" />Where to send the payment</h3>
        <p className="text-sm text-muted-foreground">
          {escrow.state === "ACCEPTED"
            ? "Check these now. Pay only after the seller locks the KDA (status Funded)."
            : escrow.state === "FUNDED"
              ? <>The KDA is locked. Send <b className="text-foreground">{total}</b> to one of these, then press Mark as Paid.</>
              : "The seller's payment details for this trade."}
        </p>
      </div>
      {details.length === 0 ? (
        <p className="text-sm text-muted-foreground">The seller hasn't added payment details yet. They must before depositing; you can also ask in the chat.</p>
      ) : (
        <ul className="space-y-2">
          {details.map((d) => (
            <li key={d.method} className="flex items-center gap-3 rounded-lg bg-muted p-3">
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">{d.method}</span>
                {d.network && (
                  <span className="my-1 block rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-950 dark:bg-amber-950 dark:text-amber-100">
                    {isTokenMethod(d.method)
                      ? <>Send {d.method} on {networkLabel(d.network)} only, to this Kadena account.</>
                      : <>Network: {networkLabel(d.network)} only. Sending on another network loses the money.</>}
                  </span>
                )}
                <span className="block break-all font-mono text-sm">{d.value}</span>
              </span>
              <CopyButton text={d.value} />
            </li>
          ))}
        </ul>
      )}
      {details.length > 0 && details.every((d) => isTokenMethod(d.method)) ? (
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Send from <b className="text-foreground">your own</b> Kadena wallet (Linx), on the chain shown.</li>
          <li>Send the exact amount, then add the transfer's request key and a screenshot when you mark it paid.</li>
        </ul>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Pay from an account in <b className="text-foreground">your own name</b>.</li>
          <li>Don't write crypto words (KDA, crypto, Kadena) in the transfer note or reference.</li>
          <li>Send the exact amount, then upload a screenshot of the payment in the chat.</li>
        </ul>
      )}
    </section>
  );
}
