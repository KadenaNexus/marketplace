import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EyeOff, Eye, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getAdminOpenOffers, hideOffer, unhideOffer, type AdminOpenOffer } from "@/lib/moderationApi";
import { currencyPrefix, OFFER_LISTING_DAYS } from "@/lib/markets";

const DAY = 86400000;
const days = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : null);
const ago = (iso: string | null) => { const d = days(iso); return d === null ? "—" : d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"} ago`; };
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`;
const STALE_DAYS = 7;

/**
 * Open offers (nobody accepted yet) where you are the arbiter. Forgotten ones can be hidden from the
 * market: the contract lets only the creator close an open offer, so this hides it in the Marketplace
 * and tells the creator, who can delete it or post a new one. Nothing is locked in an open offer.
 */
export function OpenOffersAdmin({ account }: { account: { account: string; publicKey: string } }) {
  const queryClient = useQueryClient();
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["admin-open-offers", account.account],
    queryFn: () => getAdminOpenOffers(account),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [onlyStale, setOnlyStale] = useState(false);

  const isStale = (o: AdminOpenOffer) => (days(o.creatorLastActive) ?? Infinity) >= STALE_DAYS;
  const rows = useMemo(() => [...data]
    .filter((o) => !onlyStale || isStale(o))
    .sort((a, b) => (a.creatorLastActive ?? "").localeCompare(b.creatorLastActive ?? "")), [data, onlyStale]);
  const staleVisible = data.filter((o) => isStale(o) && !o.hidden);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-open-offers", account.account] });
    queryClient.invalidateQueries({ queryKey: ["hidden-offers"] });
  };
  async function toggle(o: AdminOpenOffer) {
    setBusy(o.offerId);
    try {
      if (o.hidden) await unhideOffer(o.offerId, account);
      else await hideOffer(o.offerId, isStale(o) ? "inactive" : "stale", account);
      toast.success(o.hidden ? `#${o.code} is back on the market` : `#${o.code} hidden from the market`, { description: o.hidden ? undefined : "The creator was told by notification and email." });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally { setBusy(null); }
  }
  async function hideAllStale() {
    if (!staleVisible.length || !confirm(`Hide ${staleVisible.length} open offer${staleVisible.length === 1 ? "" : "s"} whose creator has not been active for ${STALE_DAYS}+ days? Each creator is told and can delete or post again.`)) return;
    setBusy("all");
    let ok = 0;
    for (const o of staleVisible) { try { await hideOffer(o.offerId, "inactive", account); ok++; } catch { /* counted below */ } }
    setBusy(null);
    toast.success(`${ok} of ${staleVisible.length} hidden`);
    refresh();
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Open offers</CardTitle>
        <CardDescription>
          Offers nobody has accepted yet. Hide the forgotten ones from the market: nothing is locked in them, and
          only the creator can delete them on-chain, so the creator is told and can delete or post again. You can show an offer again at any time.
          Offers listed {OFFER_LISTING_DAYS} days without a buyer expire by themselves (shown as Expired); their creator can list them again.
        </CardDescription>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyStale} onChange={(e) => setOnlyStale(e.target.checked)} />
            Only creators inactive {STALE_DAYS}+ days
          </label>
          <Button size="sm" variant="outline" className="gap-2" disabled={!staleVisible.length || busy !== null} onClick={hideAllStale}>
            {busy === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" />}
            Hide all inactive {STALE_DAYS}+ days ({staleVisible.length})
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <p className="py-6 text-center text-destructive">{error instanceof Error ? error.message : "Could not load"}</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">No open offers{onlyStale ? " from inactive creators" : ""}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left font-medium">Offer</th>
                  <th className="py-2 text-left font-medium">Amount / price</th>
                  <th className="py-2 text-left font-medium">Creator</th>
                  <th className="py-2 text-left font-medium">Posted</th>
                  <th className="py-2 text-left font-medium">Creator last active</th>
                  <th className="py-2 text-left font-medium">Market</th>
                  <th className="py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.offerId} className={`border-b align-middle ${o.hidden ? "text-muted-foreground" : ""}`}>
                    <td className="py-2"><span className="font-mono font-semibold">#{o.code}</span> <span className="text-xs">{o.side === "SELL" ? "Sell" : "Buy"}</span></td>
                    <td className="py-2">{o.amount.toLocaleString("en-US", { maximumFractionDigits: 4 })} KDA{o.price != null && <span className="text-xs text-muted-foreground"> · {currencyPrefix(o.currency)}{o.price}</span>}</td>
                    <td className="py-2 font-mono text-xs" title={o.creator}>{short(o.creator)}</td>
                    <td className="py-2 text-xs">{ago(o.createdAt)}</td>
                    <td className="py-2 text-xs">{isStale(o) ? <Badge variant="secondary">{ago(o.creatorLastActive)}</Badge> : ago(o.creatorLastActive)}</td>
                    <td className="py-2 text-xs">{o.hidden ? <Badge variant="outline">{o.hidden.reason === "expired" ? "Expired" : "Hidden"} {ago(o.hidden.hiddenAt)}</Badge> : "Listed"}</td>
                    <td className="py-2 text-right">
                      <Button size="sm" variant={o.hidden ? "ghost" : "outline"} className="gap-1.5" disabled={busy !== null} onClick={() => toggle(o)}>
                        {busy === o.offerId ? <Loader2 className="h-4 w-4 animate-spin" /> : o.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        {o.hidden ? "Show again" : "Hide"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
