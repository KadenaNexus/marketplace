import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/hooks/useWallet";
import { listAllEscrows, PLATFORM_ARBITER } from "@/lib/kadena";
import { listDisputes } from "@/lib/disputeApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Shield, Loader2, AlertCircle, RefreshCw } from "lucide-react";

export default function Admin() {
  const { account, isConnected } = useWallet();

  const { data: escrows = [], isLoading: loadingEscrows } = useQuery({
    queryKey: ["admin-escrows", account?.account],
    queryFn: () => listAllEscrows(),
    enabled: !!account && isConnected,
  });

  const { data: disputes = [], isLoading: loadingDisputes, refetch } = useQuery({
    queryKey: ["admin-disputes"],
    queryFn: () => listDisputes(),
    enabled: !!account,
  });

  const isPlatformArbiter = !!account && account.account === PLATFORM_ARBITER;
  const arbiterOfferIds = new Set(
    escrows.filter((e) => e.arbiter === account?.account).map((e) => e.offerId)
  );
  const myDisputes = disputes.filter((d) => arbiterOfferIds.has(d.offerId));
  const offerMap = Object.fromEntries(escrows.map((e) => [e.offerId, e]));

  if (!isConnected || !account) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Connect your wallet to access the Admin panel.</p>
      </div>
    );
  }

  if (!isPlatformArbiter) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Access denied. This panel is only accessible to the platform arbiter.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <span className="font-medium flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Admin / Arbiter
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={loadingDisputes}>
            {loadingDisputes ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Dispute inbox</CardTitle>
            <CardDescription>
              Disputes for offers where you are the arbiter. Trade ID, parties, amount, status, reason, created time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingDisputes && myDisputes.length === 0 ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : myDisputes.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No disputes assigned to you.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-medium">Trade ID</th>
                      <th className="text-left py-2 font-medium">Parties</th>
                      <th className="text-left py-2 font-medium">Amount</th>
                      <th className="text-left py-2 font-medium">Status</th>
                      <th className="text-left py-2 font-medium">Reason</th>
                      <th className="text-left py-2 font-medium">Created</th>
                      <th className="text-left py-2 font-medium">Timeout?</th>
                      <th className="text-right py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myDisputes.map((d) => {
                      const esc = offerMap[d.offerId];
                      const parties = esc
                        ? `Seller: ${esc.seller.slice(0, 8)}… / Buyer: ${esc.buyer ? esc.buyer.slice(0, 8) + "…" : "—"}`
                        : "—";
                      const amount = esc ? `${esc.amount} KDA` : "—";
                      return (
                        <tr key={d.offerId} className="border-b">
                          <td className="py-2 font-mono text-xs">{d.offerId.slice(0, 16)}…</td>
                          <td className="py-2 text-muted-foreground text-xs">{parties}</td>
                          <td className="py-2">{amount}</td>
                          <td className="py-2">
                            <Badge variant={d.status === "OPEN" ? "destructive" : d.status === "UNDER_REVIEW" ? "secondary" : "outline"}>
                              {d.status}
                            </Badge>
                          </td>
                          <td className="py-2 max-w-[140px] truncate text-muted-foreground" title={d.reason || ""}>
                            {d.reason || "—"}
                          </td>
                          <td className="py-2 text-muted-foreground text-xs">
                            {d.createdAt ? new Date(d.createdAt).toLocaleString() : "—"}
                          </td>
                          <td className="py-2">{d.triggeredByTimeout ? "Yes" : "No"}</td>
                          <td className="py-2 text-right">
                            <Link to={`/admin/disputes/${encodeURIComponent(d.offerId)}`}>
                              <Button variant="ghost" size="sm">View</Button>
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
