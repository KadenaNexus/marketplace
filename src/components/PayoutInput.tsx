import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasNetwork, isTokenMethod, networksFor, payoutHint, stableProblem } from "@/lib/payoutApi";

export type PayoutDraft = { value: string; network?: string };

/**
 * Where the seller is paid for one payment method. USDT/USDC: the network is picked from a list and the
 * address goes in its own field, checked against that network (a wrong-network transfer is usually lost).
 */
export function PayoutInput({ method, draft, onChange, small = false }: { method: string; draft: PayoutDraft; onChange: (d: PayoutDraft) => void; small?: boolean }) {
  const id = `payout-${method}`;
  if (!hasNetwork(method)) {
    return (
      <div className="space-y-1">
        <Label htmlFor={id} className={small ? "text-sm font-normal" : undefined}>{method}</Label>
        <Input id={id} value={draft.value} placeholder={payoutHint(method)} dir="ltr" autoComplete="off" maxLength={300} onChange={(e) => onChange({ ...draft, value: e.target.value })} />
      </div>
    );
  }
  const token = isTokenMethod(method);
  const nets = networksFor(method);
  const net = nets.find((n) => n.id === draft.network);
  const problem = draft.value.trim() && draft.network ? stableProblem({ method, ...draft }) : null;
  return (
    <fieldset className="space-y-2">
      <legend className={small ? "text-sm" : "text-sm font-medium"}>{method}</legend>
      <div className="space-y-1">
        <Label htmlFor={`${id}-network`} className="text-xs text-muted-foreground">{token ? "Chain" : "Network"}</Label>
        <select
          id={`${id}-network`}
          value={draft.network ?? ""}
          onChange={(e) => onChange({ ...draft, network: e.target.value || undefined })}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">{token ? "Choose the chain…" : "Choose the network…"}</option>
          {nets.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={id} className="text-xs text-muted-foreground">{token ? "Kadena account" : "Wallet address"}</Label>
        <Input id={id} value={draft.value} placeholder={net ? net.hint : payoutHint(method)} dir="ltr" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={token ? 260 : 120}
          className="font-mono text-sm" onChange={(e) => onChange({ ...draft, value: e.target.value.trim() })} />
        {problem && <p className="text-xs text-destructive">{problem}</p>}
      </div>
    </fieldset>
  );
}
