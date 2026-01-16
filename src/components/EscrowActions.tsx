import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EscrowStatus } from "./EscrowStatus";
import { useWallet } from "@/hooks/useWallet";
import {
  readEscrow,
  buildAcceptOfferTx,
  buildDepositTx,
  buildMarkPaidTx,
  buildReleaseTx,
  buildRefundTx,
  signTransaction,
  submitTransaction,
  type Escrow,
} from "@/lib/kadena";
import { 
  Search, 
  Loader2, 
  UserPlus, 
  Lock, 
  DollarSign, 
  Unlock,
  RotateCcw,
  ExternalLink
} from "lucide-react";
import { toast } from "sonner";

interface TransactionResult {
  action: string;
  requestKey: string;
  timestamp: Date;
}

export function EscrowActions() {
  const { account, isConnected } = useWallet();
  const [offerId, setOfferId] = useState("");
  const [escrow, setEscrow] = useState<Escrow | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionResult[]>([]);

  const handleSearch = async () => {
    if (!offerId.trim()) {
      toast.error("Please enter an Offer ID");
      return;
    }

    setIsLoading(true);
    try {
      const data = await readEscrow(offerId);
      if (data) {
        setEscrow(data);
      } else {
        toast.error("Escrow not found", {
          description: "No escrow exists with this Offer ID",
        });
        setEscrow(null);
      }
    } catch (error) {
      toast.error("Failed to fetch escrow data");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

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

      toast.success(`${actionName} submitted!`, {
        description: `Request Key: ${requestKey.slice(0, 16)}...`,
      });

      addTransaction(actionName, requestKey);

      // Refresh escrow data after a delay
      setTimeout(() => handleSearch(), 3000);
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
    if (!account || !escrow) return;
    executeAction("Accept Offer", () => 
      buildAcceptOfferTx(escrow.offerId, account.account, account.publicKey)
    );
  };

  const handleDeposit = () => {
    if (!account || !escrow) return;
    executeAction("Deposit", () => 
      buildDepositTx(escrow.offerId, escrow.amount, account.account, account.publicKey)
    );
  };

  const handleMarkPaid = () => {
    if (!account || !escrow) return;
    executeAction("Mark Paid", () => 
      buildMarkPaidTx(escrow.offerId, account.account, account.publicKey)
    );
  };

  const handleRelease = () => {
    if (!account || !escrow) return;
    executeAction("Release", () => 
      buildReleaseTx(escrow.offerId, account.account, account.publicKey)
    );
  };

  const handleRefund = () => {
    if (!account || !escrow) return;
    executeAction("Refund", () => 
      buildRefundTx(escrow.offerId, account.account, account.publicKey)
    );
  };

  const canAccept = escrow?.state === "CREATED" && account?.account !== escrow?.seller;
  const canDeposit = escrow?.state === "ACCEPTED" && account?.account === escrow?.seller;
  const canMarkPaid = escrow?.state === "DEPOSITED" && account?.account === escrow?.buyer;
  const canRelease = escrow?.state === "MARKED_PAID" && 
    (account?.account === escrow?.seller || account?.account === escrow?.arbiter);
  const canRefund = escrow?.state === "DEPOSITED" && account?.account === escrow?.arbiter;

  const isTerminal = escrow?.state === "RELEASED" || escrow?.state === "REFUNDED";

  return (
    <div className="space-y-6">
      {/* Search Section */}
      <Card className="escrow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            Lookup Escrow
          </CardTitle>
          <CardDescription>
            Enter an Offer ID to view and interact with an escrow
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={offerId}
              onChange={(e) => setOfferId(e.target.value)}
              placeholder="Enter Offer ID"
              className="font-mono"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Search"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Escrow Details */}
      {escrow && (
        <Card className="escrow-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="font-mono text-lg">{escrow.offerId}</CardTitle>
              <EscrowStatus state={escrow.state} />
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Details Grid */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-muted-foreground">Amount</Label>
                <p className="font-mono text-2xl font-bold text-primary">
                  {escrow.amount.toFixed(8)} <span className="text-base">KDA</span>
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Seller</Label>
                <p className="font-mono text-sm break-all">{escrow.seller}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Buyer</Label>
                <p className="font-mono text-sm break-all">
                  {escrow.buyer || <span className="text-muted-foreground italic">Not yet accepted</span>}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Arbiter</Label>
                <p className="font-mono text-sm break-all">{escrow.arbiter}</p>
              </div>
            </div>

            {/* Action Buttons */}
            {!isTerminal && isConnected && (
              <div className="flex flex-wrap gap-3 pt-4 border-t border-border">
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
                    Deposit {escrow.amount} KDA
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
                    href={`https://explorer.chainweb.com/mainnet/tx/${tx.requestKey}`}
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
