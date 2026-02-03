import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EscrowStatus } from "./EscrowStatus";
import { ProfileSummaryView } from "./ProfileSummary";
import { OfferCard } from "./OfferCard";
import { DisputeView } from "./DisputeView";
import { OpenDisputeDialog } from "./OpenDisputeDialog";
import { ChatBox } from "./ChatBox";
import { getDispute } from "@/lib/disputeApi";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWallet } from "@/hooks/useWallet";
import { fetchProfilesBulk, type ProfileSummary } from "@/lib/profileApi";
import { fetchRatingSummariesBulk, registerCompletion, checkCanRate, fetchTradeRatings, type RatingSummary } from "@/lib/ratingApi";
import { initializeOnlineStatus } from "@/hooks/useOnlineStatus";
import { RatingDisplay } from "./RatingDisplay";
import { RatingSubmitDialog } from "./RatingSubmitDialog";
import {
  listAllEscrows,
  buildAcceptOfferTx,
  buildDepositTx,
  buildMarkPaidTx,
  buildReleaseTx,
  buildRefundTx,
  buildCloseOfferTx,
  buildTimeoutAcceptedCloseTx,
  buildTimeoutFundedRefundTx,
  buildTimeoutPaidDisputeTx,
  buildProfileAuthTx,
  getTxExplorerUrl,
  getReputation,
  signTransaction,
  submitTransaction,
  pollTransaction,
  T1_SECONDS,
  T2_SECONDS,
  T3_SECONDS,
  type Escrow,
} from "@/lib/kadena";
import { getOfferDetails } from "@/lib/offerDetailsApi";
import { TradeTimer, isStepExpired } from "./TradeTimer";
import type { OfferFilters } from "./OfferFilters";
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
  AlertTriangle,
  FileText,
  MessageCircle,
  Star,
} from "lucide-react";
import { toast } from "sonner";

interface TransactionResult {
  action: string;
  requestKey: string;
  timestamp: Date;
}

interface EscrowActionsProps {
  refreshTrigger?: number;
  filters?: OfferFilters;
  role?: "buyer" | "seller";
  viewMode?: "all" | "my"; // "all" shows all offers, "my" shows only user's offers
}

export function EscrowActions({ refreshTrigger = 0, filters, role = "seller", viewMode = "all" }: EscrowActionsProps) {
  const { account, isConnected } = useWallet();
  const queryClient = useQueryClient();
  const [allEscrows, setAllEscrows] = useState<Escrow[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionResult[]>([]);
  const [showDisputeDialog, setShowDisputeDialog] = useState(false);
  const [disputeTab, setDisputeTab] = useState("details");
  const [showRatingDialog, setShowRatingDialog] = useState(false);
  const [registeringCompletion, setRegisteringCompletion] = useState(false);

  // Filter escrows based on filters and role
  const escrows = useMemo(() => {
    let filtered = [...allEscrows];

    // View mode and role-based filtering
    if (viewMode === "my") {
      // Show only offers created by the current user
      filtered = filtered.filter((e) => e.seller === account?.account);
    } else {
      // Show all offers based on role
      if (role === "buyer") {
        // Buyers see all sell offers (any state)
        filtered = filtered.filter((e) => e.side === "SELL");
      } else {
        // Sellers see all buy offers (any state)
        filtered = filtered.filter((e) => e.side === "BUY");
      }
    }

    // Apply filters
    if (filters) {
      if (filters.state !== "ALL") {
        filtered = filtered.filter((e) => e.state === filters.state);
      }

      if (filters.side !== "ALL") {
        filtered = filtered.filter((e) => e.side === filters.side);
      }

      if (filters.minAmount) {
        const min = parseFloat(filters.minAmount);
        if (!isNaN(min)) {
          filtered = filtered.filter((e) => e.amount >= min);
        }
      }

      if (filters.maxAmount) {
        const max = parseFloat(filters.maxAmount);
        if (!isNaN(max)) {
          filtered = filtered.filter((e) => e.amount <= max);
        }
      }

      if (filters.minPrice) {
        const min = parseFloat(filters.minPrice);
        if (!isNaN(min)) {
          filtered = filtered.filter((e) => e.price >= min);
        }
      }

      if (filters.maxPrice) {
        const max = parseFloat(filters.maxPrice);
        if (!isNaN(max)) {
          filtered = filtered.filter((e) => e.price <= max);
        }
      }

      if (filters.paymentMethod) {
        const methodLower = filters.paymentMethod.toLowerCase();
        filtered = filtered.filter((e) => {
          try {
            const methods = JSON.parse(e.paymentMethod || "[]");
            return methods.some((m: string) => m.toLowerCase().includes(methodLower));
          } catch {
            return e.paymentMethod.toLowerCase().includes(methodLower);
          }
        });
      }

      if (filters.seller) {
        const sellerLower = filters.seller.toLowerCase();
        filtered = filtered.filter((e) => e.seller.toLowerCase().includes(sellerLower));
      }

      if (filters.buyer) {
        const buyerLower = filters.buyer.toLowerCase();
        filtered = filtered.filter(
          (e) => e.buyer && e.buyer.toLowerCase().includes(buyerLower)
        );
      }
    }

    // Sort by price (ascending for buyers, descending for sellers)
    filtered.sort((a, b) => {
      if (role === "buyer") {
        return a.price - b.price; // Buyers want lowest price
      } else {
        return b.price - a.price; // Sellers want highest price
      }
    });

    return filtered;
  }, [allEscrows, filters, role, account?.account]);

  // Off-chain offer details (price, limits, payment); merge with chain data for display
  const offerIds = useMemo(() => [...new Set(allEscrows.map((e) => e.offerId))], [allEscrows]);
  const { data: offerDetailsMap = {} } = useQuery({
    queryKey: ["offer-details", offerIds.sort().join(",")],
    queryFn: async () => {
      const map: Record<string, Awaited<ReturnType<typeof getOfferDetails>>> = {};
      await Promise.all(
        offerIds.map(async (id) => {
          const d = await getOfferDetails(id);
          if (d) map[id] = d;
        })
      );
      return map;
    },
    enabled: offerIds.length > 0,
  });

  const escrowsWithDetails = useMemo(
    () =>
      escrows.map((e) => {
        const details = offerDetailsMap[e.offerId];
        return details
          ? { ...e, price: details.price, minAmount: details.minAmount, maxAmount: details.maxAmount, paymentMethod: details.paymentMethod, fiatCurrency: details.fiatCurrency }
          : e;
      }),
    [escrows, offerDetailsMap]
  );

  const selectedEscrow = escrowsWithDetails.find((e) => e.offerId === selectedOfferId) ?? null;

  const allWallets = useMemo(() => {
    const set = new Set<string>();
    escrowsWithDetails.forEach((e) => {
      set.add(e.seller);
      if (e.buyer) set.add(e.buyer);
      set.add(e.arbiter);
    });
    return Array.from(set);
  }, [escrowsWithDetails]);

  const { data: profileMap = {} } = useQuery<Record<string, ProfileSummary>>({
    queryKey: ["profiles-bulk", allWallets.join(",")],
    queryFn: () => fetchProfilesBulk(allWallets),
    enabled: allWallets.length > 0,
  });

  useEffect(() => {
    if (Object.keys(profileMap).length > 0) {
      initializeOnlineStatus(profileMap);
    }
  }, [profileMap]);

  // Check if there's an open dispute for the selected escrow
  const { data: existingDispute } = useQuery({
    queryKey: ["dispute-check", selectedEscrow?.offerId],
    queryFn: () => selectedEscrow ? getDispute(selectedEscrow.offerId) : null,
    enabled: !!selectedEscrow,
  });

  // Rating summary for all wallets (offer cards + detail)
  const { data: ratingSummaryMap = {} } = useQuery<Record<string, RatingSummary>>({
    queryKey: ["ratings-summary-bulk", allWallets.join(",")],
    queryFn: () => fetchRatingSummariesBulk(allWallets),
    enabled: allWallets.length > 0,
  });

  // On-chain reputation (minimal counters; score calculation off-chain)
  const { data: sellerRep } = useQuery({
    queryKey: ["reputation", selectedEscrow?.seller ?? ""],
    queryFn: () => getReputation(selectedEscrow!.seller),
    enabled: !!selectedEscrow?.seller,
  });
  const { data: buyerRep } = useQuery({
    queryKey: ["reputation", selectedEscrow?.buyer ?? ""],
    queryFn: () => getReputation(selectedEscrow!.buyer),
    enabled: !!selectedEscrow?.buyer,
  });

  // Can current user rate the selected COMPLETED trade?
  const { data: ratingCheck, refetch: refetchRatingCheck } = useQuery({
    queryKey: ["rating-check", selectedEscrow?.offerId, account?.account],
    queryFn: () =>
      selectedEscrow && account
        ? checkCanRate(selectedEscrow.offerId, account.account)
        : { canRate: false, alreadyRated: false },
    enabled: !!selectedEscrow && !!account && selectedEscrow.state === "COMPLETED",
  });

  // Per-trade ratings for COMPLETED escrow (UI/integrity: who rated whom)
  const { data: tradeRatings } = useQuery({
    queryKey: ["trade-ratings", selectedEscrow?.offerId],
    queryFn: () => (selectedEscrow ? fetchTradeRatings(selectedEscrow.offerId) : null),
    enabled: !!selectedEscrow && selectedEscrow.state === "COMPLETED",
  });

  const loadAll = async () => {
    setIsLoading(true);
    try {
      const list = await listAllEscrows();
      setAllEscrows(list);
      if (selectedOfferId && !list.some((e) => e.offerId === selectedOfferId)) {
        setSelectedOfferId(null);
      }
    } catch (error) {
      toast.error("Failed to load offers", {
        description: error instanceof Error ? error.message : undefined,
      });
      console.error(error);
      setAllEscrows([]);
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
      buildDepositTx(selectedEscrow.offerId, selectedEscrow.amount, account.account, account.publicKey)
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
      buildCloseOfferTx(selectedEscrow.offerId, selectedEscrow.creator, account.publicKey)
    );
  };

  const handleTimeoutAcceptedClose = () => {
    if (!account || !selectedEscrow) return;
    executeAction("Timeout: Close (T1)", () =>
      buildTimeoutAcceptedCloseTx(selectedEscrow.offerId, account.account, account.publicKey)
    );
  };

  const handleTimeoutFundedRefund = () => {
    if (!account || !selectedEscrow) return;
    executeAction("Timeout: Refund (T2)", () =>
      buildTimeoutFundedRefundTx(selectedEscrow.offerId, account.account, account.publicKey, selectedEscrow.amount)
    );
  };

  const handleTimeoutPaidDispute = () => {
    if (!account || !selectedEscrow) return;
    executeAction("Timeout: Dispute (T3)", () =>
      buildTimeoutPaidDisputeTx(selectedEscrow.offerId, account.account, account.publicKey)
    );
  };

  const canAccept = selectedEscrow?.state === "CREATED" && account?.account !== selectedEscrow?.creator;
  const canDeposit = selectedEscrow?.state === "ACCEPTED" && account?.account === selectedEscrow?.seller;
  const canMarkPaid = selectedEscrow?.state === "FUNDED" && account?.account === selectedEscrow?.buyer;
  const canRelease = (selectedEscrow?.state === "PAID" || selectedEscrow?.state === "DISPUTED") &&
    (account?.account === selectedEscrow?.seller || account?.account === selectedEscrow?.arbiter) &&
    (selectedEscrow?.state !== "DISPUTED" || account?.account === selectedEscrow?.arbiter);
  const canRefund = (selectedEscrow?.state === "FUNDED" || selectedEscrow?.state === "PAID" || selectedEscrow?.state === "DISPUTED") && account?.account === selectedEscrow?.arbiter;
  const canCloseOffer = selectedEscrow?.state === "CREATED" && account?.account === selectedEscrow?.creator;
  const canOpenDispute = selectedEscrow?.buyer && 
    (account?.account === selectedEscrow?.buyer || account?.account === selectedEscrow?.seller) &&
    (selectedEscrow?.state === "FUNDED" || selectedEscrow?.state === "PAID") &&
    (!existingDispute || existingDispute.status !== "OPEN");
  const canTimeoutAcceptedClose = selectedEscrow?.state === "ACCEPTED" && !!account?.account && isStepExpired(selectedEscrow.acceptedAt, T1_SECONDS);
  const canTimeoutFundedRefund = selectedEscrow?.state === "FUNDED" && account?.account === selectedEscrow?.seller && isStepExpired(selectedEscrow.fundedAt, T2_SECONDS);
  const canTimeoutPaidDispute = selectedEscrow?.state === "PAID" && !!account?.account && isStepExpired(selectedEscrow.paidAt, T3_SECONDS);

  const isTerminal = selectedEscrow?.state === "COMPLETED" || selectedEscrow?.state === "REFUNDED" || selectedEscrow?.state === "CLOSED";

  const isCompletedTrade = selectedEscrow?.state === "COMPLETED" && selectedEscrow?.buyer;
  const isPartyToTrade = isCompletedTrade && account && (account.account === selectedEscrow.buyer || account.account === selectedEscrow.seller);
  // Show "Register completion to rate" when we're a party, not already rated, and (check still loading OR backend says can't rate yet)
  const needsRegisterCompletion = isPartyToTrade && !ratingCheck?.alreadyRated && (ratingCheck === undefined || !ratingCheck.canRate);
  const canRateTrade = isPartyToTrade && ratingCheck?.canRate === true && !ratingCheck?.alreadyRated;
  const alreadyRated = isPartyToTrade && ratingCheck?.alreadyRated === true;
  const counterpartyWallet = isCompletedTrade && account
    ? (account.account === selectedEscrow.buyer ? selectedEscrow.seller : selectedEscrow.buyer)
    : null;

  const handleRegisterCompletion = async () => {
    if (!account || !selectedEscrow?.buyer) return;
    setRegisteringCompletion(true);
    try {
      const tx = buildProfileAuthTx(account.account, account.publicKey);
      let rawSigned = await signTransaction(tx) as unknown;
      const signedCmd = rawSigned && typeof rawSigned === "object" && "signedCmd" in rawSigned
        ? (rawSigned as { signedCmd: unknown }).signedCmd
        : rawSigned;
      const cmd = signedCmd as { sigs?: Array<{ pubKey?: string; sig?: string; signature?: string }> };
      const sigs = Array.isArray(cmd?.sigs) ? [...cmd.sigs] : [];
      if (sigs[0] && !sigs[0].pubKey) sigs[0] = { ...sigs[0], pubKey: account.publicKey };
      if (sigs[0] && "signature" in sigs[0] && sigs[0].signature && !sigs[0].sig) sigs[0] = { ...sigs[0], sig: sigs[0].signature };
      await registerCompletion({
        offerId: selectedEscrow.offerId,
        buyerWallet: selectedEscrow.buyer,
        sellerWallet: selectedEscrow.seller,
        wallet: account.account,
        publicKey: account.publicKey,
        signedCmd: { ...cmd, sigs },
      });
      toast.success("Trade registered");
      refetchRatingCheck();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to register");
    } finally {
      setRegisteringCompletion(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* All Offers List */}
      <Card className="escrow-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <List className="h-5 w-5 text-primary" />
                {viewMode === "my" 
                  ? "My Offers" 
                  : role === "buyer" 
                    ? "All Sell Offers" 
                    : "All Buy Offers"}
              </CardTitle>
              <CardDescription>
                {viewMode === "my"
                  ? "Manage all offers you've created"
                  : role === "buyer" 
                    ? "Browse available sell offers to accept"
                    : "Browse available buy offers to accept"}
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
              {viewMode === "my"
                ? "You haven't created any offers yet. Create your first offer in the Create Offer tab."
                : role === "buyer" 
                  ? "No sell offers found. Try adjusting your filters or create a new offer."
                  : "No buy offers found. Try adjusting your filters or create a new offer."}
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {escrowsWithDetails.map((e) => (
                <OfferCard
                  key={e.offerId}
                  escrow={e}
                  profileMap={profileMap}
                  ratingSummaryMap={ratingSummaryMap}
                  onSelect={setSelectedOfferId}
                  role={role}
                  isSelected={selectedOfferId === e.offerId}
                />
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
            <Tabs value={disputeTab} onValueChange={setDisputeTab}>
              <TabsList>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="chat" className="gap-2">
                  <MessageCircle className="h-4 w-4" />
                  Chat
                </TabsTrigger>
                <TabsTrigger value="dispute" className="gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Dispute
                </TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="space-y-6 mt-4">
            {/* Timed step countdown (contract is source of truth) */}
            {(selectedEscrow.state === "ACCEPTED" || selectedEscrow.state === "FUNDED" || selectedEscrow.state === "PAID") && (
              <TradeTimer escrow={selectedEscrow} />
            )}

            {/* Details Grid */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-muted-foreground">Side</Label>
                <p className="font-semibold text-lg">
                  {selectedEscrow.side === "SELL" ? "Selling" : "Buying"} KDA
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Price</Label>
                <p className="font-mono text-2xl font-bold text-primary">
                  {selectedEscrow.fiatCurrency === "USD" ? "$" : selectedEscrow.fiatCurrency === "EUR" ? "€" : selectedEscrow.fiatCurrency}
                  {selectedEscrow.price.toFixed(2)} <span className="text-base">per KDA</span>
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Available Amount</Label>
                <p className="font-mono text-xl font-bold">
                  {selectedEscrow.amount.toFixed(8)} <span className="text-base">KDA</span>
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Total Value</Label>
                <p className="font-mono text-xl font-bold">
                  {selectedEscrow.fiatCurrency === "USD" ? "$" : selectedEscrow.fiatCurrency === "EUR" ? "€" : selectedEscrow.fiatCurrency}
                  {(selectedEscrow.amount * selectedEscrow.price).toFixed(2)}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Transaction Limits</Label>
                <p className="text-sm">
                  Min: <span className="font-mono">{selectedEscrow.minAmount.toFixed(4)}</span> KDA
                  <br />
                  Max: <span className="font-mono">{selectedEscrow.maxAmount.toFixed(4)}</span> KDA
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Payment Methods</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {(() => {
                    try {
                      const methods = JSON.parse(selectedEscrow.paymentMethod || "[]");
                      return methods.map((m: string, idx: number) => (
                        <Badge key={idx} variant="outline">{m}</Badge>
                      ));
                    } catch {
                      return <Badge variant="outline">{selectedEscrow.paymentMethod || "N/A"}</Badge>;
                    }
                  })()}
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground">Seller</Label>
                <ProfileSummaryView wallet={selectedEscrow.seller} summary={profileMap[selectedEscrow.seller]} />
                {sellerRep && (
                  <p className="text-xs text-muted-foreground mt-1">
                    On-chain: {sellerRep.successfulTrades}/{sellerRep.totalTrades} completed, {sellerRep.disputesCount} disputes
                  </p>
                )}
                <RatingDisplay summary={ratingSummaryMap[selectedEscrow.seller]} variant="full" className="mt-2" />
              </div>
              <div>
                <Label className="text-muted-foreground">Buyer</Label>
                {selectedEscrow.buyer ? (
                  <>
                    <ProfileSummaryView wallet={selectedEscrow.buyer} summary={profileMap[selectedEscrow.buyer]} />
                    {buyerRep && (
                      <p className="text-xs text-muted-foreground mt-1">
                        On-chain: {buyerRep.successfulTrades}/{buyerRep.totalTrades} completed, {buyerRep.disputesCount} disputes
                      </p>
                    )}
                    <RatingDisplay summary={ratingSummaryMap[selectedEscrow.buyer]} variant="full" className="mt-2" />
                  </>
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

                {canOpenDispute && (
                  <Button 
                    onClick={() => setShowDisputeDialog(true)}
                    disabled={!!actionLoading}
                    variant="outline"
                    className="gap-2 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    Open Dispute
                  </Button>
                )}

                {canTimeoutAcceptedClose && (
                  <Button 
                    onClick={handleTimeoutAcceptedClose}
                    disabled={!!actionLoading}
                    variant="outline"
                    className="gap-2"
                  >
                    {actionLoading === "Timeout: Close (T1)" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                    Close (seller did not fund in time)
                  </Button>
                )}

                {canTimeoutFundedRefund && (
                  <Button 
                    onClick={handleTimeoutFundedRefund}
                    disabled={!!actionLoading}
                    variant="outline"
                    className="gap-2"
                  >
                    {actionLoading === "Timeout: Refund (T2)" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                    Refund (buyer did not mark paid in time)
                  </Button>
                )}

                {canTimeoutPaidDispute && (
                  <Button 
                    onClick={handleTimeoutPaidDispute}
                    disabled={!!actionLoading}
                    variant="outline"
                    className="gap-2 border-amber-500 text-amber-600 hover:bg-amber-500/10"
                  >
                    {actionLoading === "Timeout: Dispute (T3)" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <AlertTriangle className="h-4 w-4" />
                    )}
                    Move to dispute (seller did not release in time)
                  </Button>
                )}
              </div>
            )}

            {isTerminal && (
              <div className="pt-4 border-t border-border space-y-3">
                <p className="text-center text-muted-foreground">This escrow has been finalized.</p>
                {isPartyToTrade && (
                  <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                    <p className="text-sm font-medium text-center">Leave a rating for this trade</p>
                    {needsRegisterCompletion && (
                      <div className="flex flex-col items-center gap-2">
                        <p className="text-xs text-muted-foreground text-center">
                          First register this completed trade (one-time, sign with your wallet). Then you can rate the other party.
                        </p>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={handleRegisterCompletion}
                          disabled={registeringCompletion}
                          className="gap-2"
                        >
                          {registeringCompletion ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />}
                          Register completion to rate
                        </Button>
                      </div>
                    )}
                    {canRateTrade && counterpartyWallet && (
                      <div className="flex justify-center">
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => setShowRatingDialog(true)}
                          className="gap-2"
                        >
                          <Star className="h-4 w-4" />
                          Rate this trade
                        </Button>
                      </div>
                    )}
                    {alreadyRated && (
                      <p className="text-center text-sm text-muted-foreground">You already rated this trade.</p>
                    )}
                  </div>
                )}
                {tradeRatings && tradeRatings.ratingCount > 0 && (
                  <div className="text-sm border rounded-md p-3 bg-muted/50">
                    <p className="font-medium text-muted-foreground mb-2">Ratings for this trade</p>
                    <ul className="space-y-1">
                      {tradeRatings.ratings.map((r, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          <span>
                            {profileMap[r.raterWallet]?.username || `${r.raterWallet.slice(0, 8)}…`} → {r.rating}/5
                            {r.comment && <span className="text-muted-foreground">: &quot;{r.comment.slice(0, 60)}{r.comment.length > 60 ? "…" : ""}&quot;</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {!isConnected && (
              <div className="pt-4 border-t border-border text-center text-muted-foreground">
                Connect your wallet to interact with this escrow
              </div>
            )}
              </TabsContent>

              <TabsContent value="chat" className="mt-4">
                {(() => {
                  const isBuyer = account?.account === selectedEscrow.buyer;
                  const isSeller = account?.account === selectedEscrow.seller;
                  const otherWallet = isBuyer ? selectedEscrow.seller : isSeller ? (selectedEscrow.buyer || selectedEscrow.seller) : selectedEscrow.seller;
                  
                  if (!account || !isConnected) {
                    return (
                      <div className="text-center py-8 text-muted-foreground">
                        Please connect your wallet to use chat
                      </div>
                    );
                  }

                  return (
                    <ChatBox
                      otherWallet={otherWallet}
                      otherProfile={profileMap[otherWallet]}
                      contextOfferId={selectedEscrow.offerId}
                    />
                  );
                })()}
              </TabsContent>

              <TabsContent value="dispute" className="mt-4">
                <DisputeView 
                  escrow={selectedEscrow} 
                  onClose={() => setDisputeTab("details")}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Open Dispute Dialog */}
      {selectedEscrow && (
        <OpenDisputeDialog
          open={showDisputeDialog}
          onOpenChange={setShowDisputeDialog}
          escrow={selectedEscrow}
          onSuccess={() => {
            setDisputeTab("dispute");
            loadAll();
          }}
        />
      )}

      {/* Rate trade dialog (only for completed trades) */}
      {counterpartyWallet && selectedEscrow && (
        <RatingSubmitDialog
          open={showRatingDialog}
          onOpenChange={setShowRatingDialog}
          offerId={selectedEscrow.offerId}
          ratedWallet={counterpartyWallet}
          onSuccess={() => {
            refetchRatingCheck();
            queryClient.invalidateQueries({ queryKey: ["ratings-summary-bulk"] });
            queryClient.invalidateQueries({ queryKey: ["trade-ratings", selectedEscrow?.offerId] });
            loadAll();
          }}
        />
      )}

      {/* Transaction History */}
      {transactions.length > 0 && (
        <Card className="escrow-card">
          <CardHeader>
            <CardTitle className="text-base">On-chain references (recent transactions)</CardTitle>
            <p className="text-sm text-muted-foreground">View transaction status and details on the block explorer.</p>
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
                    href={getTxExplorerUrl(tx.requestKey)}
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
