import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EscrowStatus } from "./EscrowStatus";
import { ProfileSummaryView } from "./ProfileSummary";
import { useWallet } from "@/hooks/useWallet";
import { fetchProfilesBulk } from "@/lib/profileApi";
import {
  listAllEscrows,
  buildAcceptOfferTx,
  buildDepositTx,
  buildMarkPaidTx,
  buildReleaseTx,
  buildRefundTx,
  buildCloseOfferTx,
  signTransaction,
  submitTransaction,
  pollTransaction,
  type Escrow,
} from "@/lib/kadena";
import { 
  List,
  Loader2, 
  UserPlus, 
  Lock, 
  DollarSign, 
  Unlock,
  RotateCcw,
  XCircle,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface TransactionResult {
  action: string;
  requestKey: string;
  timestamp: Date;
}

interface EscrowActionsProps {
  refreshTrigger?: number;
}

export function EscrowActions({ refreshTrigger = 0 }: EscrowActionsProps) {
  const { account, isConnected } = useWallet();
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionResult[]>([]);

  const selectedEscrow = escrows.find((e) => e.offerId === selectedOfferId) ?? null;

  const allWallets = useMemo(() => {
    const set = new Set<string>();
    escrows.forEach((e) => {
      set.add(e.seller);
      if (e.buyer) set.add(e.buyer);
      set.add(e.arbiter);
    });
    return Array.from(set);
  }, [escrows]);

  const { data: profileMap = {} } = useQuery({
    queryKey: ["profiles-bulk", allWallets.join(",")],
    queryFn: () => fetchProfilesBulk(allWallets),
    enabled: allWallets.length > 0,
  });

  const loadAll = async () => {
    setIsLoading(true);
    try {
      const list = await listAllEscrows();
      setEscrows(list);
      if (selectedOfferId && !list.some((e) => e.offerId === selectedOfferId)) {
        setSelectedOfferId(null);
      }
    } catch (error) {
      toast.error("Failed to load offers", {
        description: error instanceof Error ? error.message : undefined,
      });
      console.error(error);
      setEscrows([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [refreshTrigger]);

  const addTransaction = (action: string, requestKey: string) => {
    setTransactions(prev => [
      { action, requestKey, timestamp: new Date() },
      ...prev,
    ]);
  };

  const executeAction = async (
    actionName: string,
    buildTx: () => any
  ) => {
    if (!account) {
      toast.error("Please connect your wallet");
      return;
    }

    setActionLoading(actionName);

    try {
      const tx = buildTx();
      const signedTx = await signTransaction(tx);
      const requestKey = await submitTransaction(signedTx);

      const txResult = await pollTransaction(requestKey);
      const res = txResult?.result;
      if (res?.status === "failure") {
        let errMsg = "Transaction failed on-chain";
        const e = res.error;
        if (typeof e === "string") errMsg = e;
        else if (e && typeof e === "object") {
          const o = e as Record<string, unknown>;
          errMsg = String(o.message ?? o.msg ?? o.info ?? o.detail ?? errMsg);
        }
        throw new Error(errMsg);
      }

      toast.success(`${actionName} succeeded`, {
        description: `Request Key: ${requestKey.slice(0, 16)}...`,
      });

      addTransaction(actionName, requestKey);
      loadAll();
    } catch (error) {
      console.error(`${actionName} error:`, error);
      toast.error(`${actionName} failed`, {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleAccept = () => {
    if (!account || !selectedEscrow) return;
    executeAction("Accept Offer", () => 
      buildAcceptOfferTx(selectedEscrow.offerId, account.account, account.publicKey)
    );
  };

  const handleDeposit = () => {
    if (!account || !selectedEscrow) return;
    executeAction("Deposit", () => 
      buildDepositTx(selectedEscrow.offerId, selectedEscrow.amount, account.account, account.publicKey, selectedEscrow.seller)
    );
  };

  const handleMarkPaid = () => {
    if (!account || !selectedEscrow) return;
    executeAction("Mark Paid", () => 
      buildMarkPaidTx(selectedEscrow.offerId, account.account, account.publicKey)
    );
  };

  const handleRelease = () => {
    if (!account || !selectedEscrow) return;
    executeAction("Release", () => 
      buildReleaseTx(selectedEscrow.offerId, account.account, account.publicKey, selectedEscrow.buyer!, selectedEscrow.amount)
    );
  };

  const handleRefund = () => {
    if (!account || !selectedEscrow) return;
    executeAction("Refund", () => 
      buildRefundTx(selectedEscrow.offerId, account.account, account.publicKey, selectedEscrow.seller, selectedEscrow.amount)
    );
  };

  const handleCloseOffer = () => {
    if (!account || !selectedEscrow) return;
    executeAction("Close Offer", () => 
      buildCloseOfferTx(selectedEscrow.offerId, account.account, account.publicKey)
    );
  };

  const canAccept = selectedEscrow?.state === "CREATED" && account?.account !== selectedEscrow?.seller;
  const canDeposit = selectedEscrow?.state === "ACCEPTED" && account?.account === selectedEscrow?.seller;
  const canMarkPaid = selectedEscrow?.state === "FUNDED" && account?.account === selectedEscrow?.buyer;
  const canRelease = selectedEscrow?.state === "PAID" && 
    (account?.account === selectedEscrow?.seller || account?.account === selectedEscrow?.arbiter);
  const canRefund = (selectedEscrow?.state === "FUNDED" || selectedEscrow?.state === "PAID") && account?.account === selectedEscrow?.arbiter;
  const canCloseOffer = selectedEscrow?.state === "CREATED" && account?.account === selectedEscrow?.seller;

  const isTerminal = selectedEscrow?.state === "COMPLETED" || selectedEscrow?.state === "REFUNDED" || selectedEscrow?.state === "CLOSED";

  return (
    <div className="space-y-6">
      {/* All Offers List */}
      <Card className="escrow-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <List className="h-5 w-5 text-primary" />
                All Offers
              </CardTitle>
              <CardDescription>
                Select an offer to view details and take action
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={loadAll} disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && escrows.length === 0 ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : escrows.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              No offers yet. Create one in the Create Offer tab.
            </p>
          ) : (
            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {[...escrows].sort((a, b) => b.offerId.localeCompare(a.offerId)).map((e) => (
                <button
                  key={e.offerId}
                  type="button"
                  onClick={() => setSelectedOfferId(e.offerId)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedOfferId === e.offerId
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm truncate">{e.offerId}</span>
                    <EscrowStatus state={e.state} />
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                    <span className="font-mono font-medium text-foreground">{e.amount.toFixed(4)} KDA</span>
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="shrink-0">Seller:</span>
                      <ProfileSummaryView wallet={e.seller} summary={profileMap[e.seller]} size="sm" />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Escrow Details (when one is selected) */}
      {selectedEscrow && (
        <Card className="escrow-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="font-mono text-lg">{selectedEscrow.offerId}</CardTitle>
              <EscrowStatus state={selectedEscrow.state} />
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Details Grid */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-muted-foreground">Amount</Label>
                <p className="font-mono text-2xl font-bold text-primary">
                  {selectedEscrow.amount.toFixed(8)} <span className="text-base">KDA</span>
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Seller</Label>
                <ProfileSummaryView wallet={selectedEscrow.seller} summary={profileMap[selectedEscrow.seller]} />
              </div>
              <div>
                <Label className="text-muted-foreground">Buyer</Label>
                {selectedEscrow.buyer ? (
                  <ProfileSummaryView wallet={selectedEscrow.buyer} summary={profileMap[selectedEscrow.buyer]} />
                ) : (
                  <span className="text-muted-foreground italic text-sm">Not yet accepted</span>
                )}
              </div>
              <div>
                <Label className="text-muted-foreground">Arbiter</Label>
                <ProfileSummaryView wallet={selectedEscrow.arbiter} summary={profileMap[selectedEscrow.arbiter]} />
              </div>
            </div>

            {/* Action Buttons */}
            {!isTerminal && isConnected && (
              <div className="flex flex-wrap gap-3 pt-4 border-t border-border">
                {canCloseOffer && (
                  <Button 
                    onClick={handleCloseOffer}
                    disabled={!!actionLoading}
                    variant="outline"
                    className="gap-2"
                  >
                    {actionLoading === "Close Offer" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                    Close Offer
                  </Button>
                )}

                {canAccept && (
                  <Button 
                    onClick={handleAccept}
                    disabled={!!actionLoading}
                    className="gap-2"
                  >
                    {actionLoading === "Accept Offer" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="h-4 w-4" />
                    )}
                    Accept Offer
                  </Button>
                )}

                {canDeposit && (
                  <Button 
                    onClick={handleDeposit}
                    disabled={!!actionLoading}
                    className="gap-2"
                  >
                    {actionLoading === "Deposit" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Lock className="h-4 w-4" />
                    )}
                    Deposit {selectedEscrow.amount.toFixed(4)} KDA
                  </Button>
                )}

                {canMarkPaid && (
                  <Button 
                    onClick={handleMarkPaid}
                    disabled={!!actionLoading}
                    variant="secondary"
                    className="gap-2"
                  >
                    {actionLoading === "Mark Paid" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <DollarSign className="h-4 w-4" />
                    )}
                    Mark as Paid
                  </Button>
                )}

                {canRelease && (
                  <Button 
                    onClick={handleRelease}
                    disabled={!!actionLoading}
                    className="gap-2 bg-success hover:bg-success/90"
                  >
                    {actionLoading === "Release" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Unlock className="h-4 w-4" />
                    )}
                    Release to Buyer
                  </Button>
                )}

                {canRefund && (
                  <Button 
                    onClick={handleRefund}
                    disabled={!!actionLoading}
                    variant="destructive"
                    className="gap-2"
                  >
                    {actionLoading === "Refund" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                    Refund to Seller
                  </Button>
                )}
              </div>
            )}

            {isTerminal && (
              <div className="pt-4 border-t border-border text-center text-muted-foreground">
                This escrow has been finalized.
              </div>
            )}

            {!isConnected && (
              <div className="pt-4 border-t border-border text-center text-muted-foreground">
                Connect your wallet to interact with this escrow
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Transaction History */}
      {transactions.length > 0 && (
        <Card className="escrow-card">
          <CardHeader>
            <CardTitle className="text-base">Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {transactions.map((tx, i) => (
                <div 
                  key={tx.requestKey + i}
                  className="flex items-center justify-between p-3 bg-muted rounded-md"
                >
                  <div>
                    <p className="font-medium">{tx.action}</p>
                    <p className="tx-hash">{tx.requestKey}</p>
                  </div>
                  <a
                    href={`https://denascan.com/transactions/${tx.requestKey}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
