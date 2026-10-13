import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EscrowStatus } from "./EscrowStatus";
import { ProfileSummaryView } from "./ProfileSummary";
import { OfferCard } from "./OfferCard";
import { DisputeView } from "./DisputeView";
import { OfferChat } from "./OfferChat";
import { getDispute, openDispute, putFundTxRequestKey } from "@/lib/disputeApi";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWallet } from "@/hooks/useWallet";
import { useAppChainBalance } from "@/hooks/useAppChainBalance";
import { fetchProfilesBulk, type ProfileSummary } from "@/lib/profileApi";
import { fetchRatingSummariesBulk, registerCompletion, checkCanRate, fetchTradeRatings, type RatingSummary } from "@/lib/ratingApi";
import { initializeOnlineStatus, useOnlineStatusMap } from "@/hooks/useOnlineStatus";
import { RatingDisplay } from "./RatingDisplay";
import { RatingSubmitDialog } from "./RatingSubmitDialog";
import {
  listAllEscrows,
  TX_GAS_KDA,
  CHAIN_ID,
  appChainShortfall,
  isInsufficientFunds,
  buildAcceptOfferTx,
  buildDepositTx,
  buildMarkPaidTx,
  buildReleaseTx,
  buildRefundTx,
  buildDeleteOfferTx,
  buildCancelAcceptedOfferTx,
  buildTimeoutAcceptedCloseTx,
  buildTimeoutFundedRefundTx,
  buildTimeoutPaidDisputeTx,
  getEscrowVaultAccount,
  getTxExplorerUrl,
  getAccountExplorerUrl,
  getReputation,
  signTransaction,
  submitTransaction,
  pollTransaction,
  T1_SECONDS,
  T2_SECONDS,
  T3_SECONDS,
  readEscrow,
  type Escrow,
} from "@/lib/kadena";
import { getOfferDetails } from "@/lib/offerDetailsApi";
import { formatFiat } from "@/lib/utils";
import { TradeTimer, isStepExpired } from "./TradeTimer";
import { TradeSteps, YourTurnCard, kdaAmount, tradeTitle } from "./MobileTrade";
import { useIsMobile } from "@/hooks/use-mobile";
import type { OfferFilters } from "./OfferFilters";
import { 
  List,
  Loader2, 
  UserPlus, 
  Lock, 
  DollarSign, 
  Unlock,
  RotateCcw,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  FileText,
  MessageCircle,
  Star,
  Info,
  XCircle,
  ArrowLeft,
} from "lucide-react";
import { authProof } from "@/lib/session";
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
  viewMode?: "all" | "my" | "myPast" | "active" | "new" | "mine"; // "new" = CREATED only; "myPast" = my offers excluding CREATED; "mine" = everything I created or trade in (phone "My trades")
}

export function EscrowActions({ refreshTrigger = 0, filters, role = "seller", viewMode = "all" }: EscrowActionsProps) {
  const { account, isConnected } = useWallet();
  const isMobile = useIsMobile();
  const { data: appChainBalance, refetch: refetchAppChainBalance } = useAppChainBalance(isConnected ? account?.account : undefined);
  const queryClient = useQueryClient();
  const [allEscrows, setAllEscrows] = useState<Escrow[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deletingOfferId, setDeletingOfferId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionResult[]>([]);
  const [disputeTab, setDisputeTab] = useState("details");
  const [showRatingDialog, setShowRatingDialog] = useState(false);
  const [registeringCompletion, setRegisteringCompletion] = useState(false);

const ACTIVE_STATES = ["ACCEPTED", "FUNDED", "PAID", "DISPUTED"] as const;
const PAST_TERMINAL_STATES = ["COMPLETED", "REFUNDED", "CLOSED"] as const;
const CRITICAL_ACTION_LOADING = ["Accept Offer", "Deposit", "Mark Paid", "Release", "Delete Offer"] as const;
const TX_CONFIRM_MESSAGE = "Transaction in progress… Confirming on the Kadena network. This may take up to 60 seconds.";

  // Filter escrows based on filters and role
  const escrows = useMemo(() => {
    let filtered = [...allEscrows];

    // Only show offers that are not DELETED (on-chain list-escrow-ids already excludes them; this is a safeguard)
    filtered = filtered.filter((e) => e.state !== "DELETED");

    // View mode and role-based filtering
    if (viewMode === "active") {
      // My active trades: I'm seller or buyer, and state is in progress (not CREATED/terminal)
      filtered = filtered.filter(
        (e) =>
          account?.account &&
          (e.seller === account.account || e.buyer === account.account) &&
          ACTIVE_STATES.includes(e.state as (typeof ACTIVE_STATES)[number])
      );
    } else if (viewMode === "new") {
      // New offers only (CREATED), by role
      filtered = filtered.filter((e) => e.state === "CREATED");
      if (role === "buyer") {
        filtered = filtered.filter((e) => e.side === "SELL");
      } else {
        filtered = filtered.filter((e) => e.side === "BUY");
      }
    } else if (viewMode === "mine") {
      // Phone "My trades": in progress, my open offers, and finished trades
      filtered = filtered.filter(
        (e) => account?.account && (e.creator === account.account || e.seller === account.account || e.buyer === account.account),
      );
    } else if (viewMode === "my") {
      // Show only offers created by the current user (creator), not just where they are the seller
      filtered = filtered.filter((e) => e.creator === account?.account);
    } else if (viewMode === "myPast") {
      // All my past offers: I'm creator, seller, or buyer, and state is terminal (Completed, Refunded, Closed)
      filtered = filtered.filter(
        (e) =>
          account?.account &&
          (e.creator === account.account || e.seller === account.account || e.buyer === account.account) &&
          PAST_TERMINAL_STATES.includes(e.state as (typeof PAST_TERMINAL_STATES)[number])
      );
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

    // Sort: active view by state; "new" view by price (buy: lowest first, sell: highest first); else by price
    filtered.sort((a, b) => {
      if (viewMode === "active" || viewMode === "mine") {
        const order = { PAID: 0, FUNDED: 1, DISPUTED: 2, ACCEPTED: 3, CREATED: 4 };
        return (order[a.state as keyof typeof order] ?? 5) - (order[b.state as keyof typeof order] ?? 5);
      }
      if (viewMode === "new" || role === "buyer") {
        return a.price - b.price; // Buy: lowest price first
      } else {
        return b.price - a.price; // Sell: highest price first
      }
    });

    return filtered;
  }, [allEscrows, filters, role, account?.account, viewMode]);

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
          ? { ...e, price: details.price, paymentMethod: details.paymentMethod, fiatCurrency: details.fiatCurrency }
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

  const onlineStatusMap = useOnlineStatusMap(allWallets);

  // Apply reputation (min stars) and online-now filters for display
  const displayedEscrows = useMemo(() => {
    let list = escrowsWithDetails;
    if (!filters) return list;
    const minStars = filters.minStars ? parseInt(filters.minStars, 10) : 0;
    if (minStars >= 1 && minStars <= 5) {
      list = list.filter((e) => {
        const counterparty = role === "buyer" ? e.seller : e.buyer;
        if (!counterparty) return false;
        const summary = ratingSummaryMap[counterparty];
        const avg = summary?.averageRating ?? 0;
        return avg >= minStars;
      });
    }
    if (filters.onlineNow) {
      list = list.filter((e) => {
        const counterparty = role === "buyer" ? e.seller : e.buyer;
        if (!counterparty) return false;
        return onlineStatusMap.get(counterparty) === true;
      });
    }
    return list;
  }, [escrowsWithDetails, filters, role, ratingSummaryMap, onlineStatusMap]);

  // Bulk dispute check for offer cards: which offerIds have an open/active dispute (must be after displayedEscrows)
  const disputeQueries = useQueries({
    queries: displayedEscrows.map((e) => ({
      queryKey: ["dispute-check", e.offerId],
      queryFn: () => getDispute(e.offerId),
      enabled: true,
    })),
  });
  const openDisputeOfferIds = useMemo(() => {
    const set = new Set<string>();
    disputeQueries.forEach((q, i) => {
      const d = q.data;
      if (d && (d.status === "OPEN" || d.status === "UNDER_REVIEW"))
        set.add(displayedEscrows[i]?.offerId ?? "");
    });
    return set;
  }, [disputeQueries, displayedEscrows]);

  // Link to an offer or trade (?offer=ID) from an alert email or a notification: select it once it is in
  // this list and scroll to it. Reacts every time the link changes, not only on first load.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedOffer = searchParams.get("offer");
  const handledLink = useRef<string | null>(null);
  const reloadedFor = useRef<string | null>(null);
  const linkKey = useLocation().key;
  useEffect(() => {
    if (!linkedOffer || handledLink.current === linkKey) return;
    if (viewMode !== "new" && viewMode !== "active" && viewMode !== "mine") return;
    // Load the list fresh first: the link usually comes from a notification about something that just changed
    if (reloadedFor.current !== linkKey) {
      if (!isLoading) { reloadedFor.current = linkKey; loadAll(); }
      return;
    }
    if (isLoading || !displayedEscrows.some((e) => e.offerId === linkedOffer)) return;
    handledLink.current = linkKey;
    setSelectedOfferId(linkedOffer);
    if (!isMobile) setTimeout(() => document.getElementById(`offer-card-${linkedOffer}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
    const next = new URLSearchParams(searchParams);
    next.delete("offer");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadAll is recreated every render
  }, [linkedOffer, linkKey, displayedEscrows, isLoading, viewMode, searchParams, setSearchParams, isMobile]);

  // Phone: a trade opens as a full screen. The phone's Back button closes it, and the page behind does not scroll.
  const openTradeId = isMobile && selectedEscrow ? selectedEscrow.offerId : null;
  useEffect(() => {
    if (!openTradeId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.history.pushState({ ...(window.history.state || {}), nxTrade: openTradeId }, "");
    let popped = false;
    const onPop = () => { popped = true; setSelectedOfferId(null); };
    window.addEventListener("popstate", onPop);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("popstate", onPop);
      if (!popped && window.history.state?.nxTrade === openTradeId) window.history.back();
    };
  }, [openTradeId]);

  // Phone: once an offer you opened from Offers becomes your trade (you accepted it), carry on in My trades.
  const navigate = useNavigate();
  useEffect(() => {
    if (!isMobile || viewMode !== "new" || !selectedOfferId || !account?.account) return;
    const e = allEscrows.find((x) => x.offerId === selectedOfferId);
    if (e && e.state !== "CREATED" && (e.buyer === account.account || e.seller === account.account)) {
      setSelectedOfferId(null);
      setTimeout(() => navigate(`/?offer=${encodeURIComponent(e.offerId)}`), 50);
    }
  }, [isMobile, viewMode, selectedOfferId, allEscrows, account?.account, navigate]);

  // On-chain reputation (minimal counters; score calculation off-chain)
  const { data: sellerRep } = useQuery({
    queryKey: ["reputation", selectedEscrow?.seller ?? "", selectedEscrow?.state],
    queryFn: () => getReputation(selectedEscrow!.seller),
    enabled: !!selectedEscrow?.seller,
  });
  const { data: buyerRep } = useQuery({
    queryKey: ["reputation", selectedEscrow?.buyer ?? "", selectedEscrow?.state],
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
      // Refetch dispute state so "Disputed" shows correctly on cards and detail
      queryClient.invalidateQueries({ queryKey: ["dispute-check"] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[EscrowActions] loadAll failed:", error);
      toast.error("Failed to load offers", {
        description: message.length > 80 ? `${message.slice(0, 80)}…` : message,
      });
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
    // Yield so React paints the "Transaction in progress..." message before wallet/signing
    await new Promise((r) => setTimeout(r, 0));

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
        description: (
          <a
            href={getTxExplorerUrl(requestKey)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: "underline", wordBreak: "break-all" }}
          >
            View on Explorer ↗
          </a>
        ),
      });

      addTransaction(actionName, requestKey);
      if (actionName === "Deposit" && selectedEscrow && account) {
        try {
          const signedCmd = await authProof(account.account, account.publicKey);
          await putFundTxRequestKey({
            offerId: selectedEscrow.offerId,
            requestKey,
            wallet: account.account,
            publicKey: account.publicKey,
            signedCmd,
          });
        } catch (e) {
          toast.error("Deposit saved; fund tx link could not be saved", {
            description: e instanceof Error ? e.message : String(e),
          });
        }
      }
      loadAll();
    } catch (error) {
      console.error(`${actionName} error:`, error);
      let desc = error instanceof Error ? error.message : "Unknown error";
      if (actionName === "Deposit" && /Only KDA holder can deposit/i.test(desc)) {
        desc +=
          " Balance is not checked here — the chain verifies your signature against the coin guard for the KDA holder. Use the exact k: account shown as Seller; fund KDA on this app chain; multisig (keys-all) needs every key to sign. ";
        if (selectedEscrow?.seller) {
          desc += `Account on explorer: ${getAccountExplorerUrl(selectedEscrow.seller)}`;
        }
      }
      if (isInsufficientFunds(desc) && account) {
        const needed = actionName === "Deposit" && selectedEscrow ? selectedEscrow.amount : 0;
        const shortfall = await appChainShortfall(account.account, needed).catch(() => null);
        if (shortfall) {
          toast.error(shortfall.title, { description: shortfall.description, duration: 20000 });
          return;
        }
      }
      toast.error(`${actionName} failed`, { description: desc });
    } finally {
      setActionLoading(null);
    }
  };

  // Clear deleting offer state when any action finishes loading
  useEffect(() => {
    if (!actionLoading) setDeletingOfferId(null);
  }, [actionLoading]);

  const handleAccept = () => {
    if (!account || !selectedEscrow) return;
    executeAction("Accept Offer", () => 
      buildAcceptOfferTx(selectedEscrow.offerId, account.account, account.publicKey)
    );
  };

  const handleDeposit = async () => {
    if (!account || !selectedEscrow) return;
    const fresh = await readEscrow(selectedEscrow.offerId);
    if (!fresh) {
      toast.error("Deposit failed", { description: "Could not read this escrow from chain. Check contract name/network." });
      return;
    }
    if (fresh.state !== "ACCEPTED") {
      toast.error("Deposit failed", { description: `Escrow must be ACCEPTED (now: ${fresh.state}).` });
      return;
    }
    // readEscrow maps the on-chain KDA depositor to `seller` for both SELL and BUY offers.
    const kdaHolder = fresh.seller;
    if (!kdaHolder) {
      toast.error("Deposit failed", { description: "On-chain data has no KDA holder yet; accept the offer first." });
      return;
    }
    if (account.account !== kdaHolder) {
      toast.error("Deposit failed", {
        description: `Deposit must be signed by the KDA holder. On-chain: ${kdaHolder}. Your wallet: ${account.account}.`,
      });
      return;
    }
    // Wallets show the total across all chains; the deposit can only use chain 1. Stop with a
    // clear explanation instead of letting the chain answer "Insufficient funds".
    const shortfall = await appChainShortfall(account.account, fresh.amount).catch(() => null);
    if (shortfall) {
      toast.error(shortfall.title, { description: shortfall.description, duration: 20000 });
      return;
    }
    const vaultAccount = await getEscrowVaultAccount(selectedEscrow.offerId);
    executeAction("Deposit", () =>
      buildDepositTx(selectedEscrow.offerId, fresh.amount, account.account, account.publicKey, vaultAccount)
    );
  };

  const handleMarkPaid = () => {
    if (!account || !selectedEscrow) return;
    executeAction("Mark Paid", () => 
      buildMarkPaidTx(selectedEscrow.offerId, account.account, account.publicKey)
    );
  };

  const handleRelease = async () => {
    if (!account || !selectedEscrow) return;
    const releaseRecipient = selectedEscrow.side === "SELL" ? selectedEscrow.buyer! : selectedEscrow.creator;
    const vaultAccount = await getEscrowVaultAccount(selectedEscrow.offerId);
    executeAction("Release", () =>
      buildReleaseTx(selectedEscrow.offerId, account.account, account.publicKey, releaseRecipient, selectedEscrow.amount, vaultAccount)
    );
  };

  const handleRefund = async () => {
    if (!account || !selectedEscrow) return;
    const refundRecipient = selectedEscrow.side === "SELL" ? selectedEscrow.creator : selectedEscrow.buyer;
    if (!refundRecipient) return;
    const vaultAccount = await getEscrowVaultAccount(selectedEscrow.offerId);
    executeAction("Refund", () =>
      buildRefundTx(selectedEscrow.offerId, account.account, account.publicKey, refundRecipient, selectedEscrow.amount, vaultAccount)
    );
  };


  const handleDeleteOffer = (offerId: string) => {
    if (!account) {
      toast.error("Please connect your wallet");
      return;
    }
    setDeletingOfferId(offerId);
    toast.info("Deleting offer…", { description: "Confirm in your wallet. This may take a moment." });
    executeAction("Delete Offer", () =>
      buildDeleteOfferTx(offerId, account.account, account.publicKey)
    );
    if (selectedOfferId === offerId) setSelectedOfferId(null);
  };

  const handleCancelAcceptedOffer = () => {
    if (!account || !selectedEscrow) return;
    executeAction("Cancel Offer", () =>
      buildCancelAcceptedOfferTx(selectedEscrow.offerId, account.account, account.publicKey)
    );
  };

  const handleTimeoutAcceptedClose = () => {
    if (!account || !selectedEscrow) return;
    executeAction("Close (T1 Expired)", () =>
      buildTimeoutAcceptedCloseTx(selectedEscrow.offerId, account.account, account.publicKey)
    );
  };

  const handleTimeoutFundedRefund = async () => {
    if (!account || !selectedEscrow) return;
    const refundTo = selectedEscrow.side === "SELL" ? selectedEscrow.creator : selectedEscrow.buyer;
    if (!refundTo) return;
    const vaultAccount = await getEscrowVaultAccount(selectedEscrow.offerId);
    executeAction("Timeout: Refund (T2)", () =>
      buildTimeoutFundedRefundTx(selectedEscrow.offerId, account.account, account.publicKey, refundTo, selectedEscrow.amount, vaultAccount)
    );
  };

  const handleTimeoutPaidDispute = async () => {
    if (!account || !selectedEscrow) return;

    setActionLoading("Timeout: Dispute (T3)");
    await new Promise((r) => setTimeout(r, 0));

    try {
      const tx = buildTimeoutPaidDisputeTx(selectedEscrow.offerId, account.account, account.publicKey);
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

      addTransaction("Timeout: Dispute (T3)", requestKey);

      // Atomically create off-chain dispute record so arbiter panel is functional
      try {
        const signedCmd = await authProof(account.account, account.publicKey);

        await openDispute({
          offerId: selectedEscrow.offerId,
          openedBy: account.account === selectedEscrow.buyer ? "buyer" : "seller",
          reason: "Seller did not release within T3 timeout",
          wallet: account.account,
          publicKey: account.publicKey,
          signedCmd,
        });

        toast.success("Dispute opened — arbiter has been notified", {
          description: (
            <a href={getTxExplorerUrl(requestKey)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline", wordBreak: "break-all" }}>
              View on Explorer ↗
            </a>
          ),
        });
        setDisputeTab("dispute");
        queryClient.invalidateQueries({ queryKey: ["dispute-check"] });
      } catch (disputeErr) {
        toast.warning("Moved to dispute on-chain, but arbiter record could not be created", {
          description: `Please contact support with offer ID: ${selectedEscrow.offerId}`,
        });
      }

      loadAll();
    } catch (error) {
      console.error("Timeout: Dispute (T3) error:", error);
      toast.error("Timeout: Dispute (T3) failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const canAccept = selectedEscrow?.state === "CREATED" && account?.account !== selectedEscrow?.creator;
  // KDA depositor (contract): SELL → creator; BUY → on-chain `buyer` (accepter). readEscrow maps that to `seller` always.
  const canDeposit =
    selectedEscrow?.state === "ACCEPTED" &&
    !!selectedEscrow?.seller &&
    account?.account === selectedEscrow.seller;
  const canMarkPaid = selectedEscrow?.state === "FUNDED" &&
    (selectedEscrow?.side === "SELL" ? account?.account === selectedEscrow?.buyer : account?.account === selectedEscrow?.creator);
  const canRelease = (selectedEscrow?.state === "PAID" || selectedEscrow?.state === "DISPUTED") &&
    (account?.account === selectedEscrow?.seller || account?.account === selectedEscrow?.arbiter) &&
    (selectedEscrow?.state !== "DISPUTED" || account?.account === selectedEscrow?.arbiter);
  const canRefund = (selectedEscrow?.state === "FUNDED" || selectedEscrow?.state === "PAID" || selectedEscrow?.state === "DISPUTED") &&
    account?.account === selectedEscrow?.arbiter &&
    (selectedEscrow?.side === "SELL" || !!selectedEscrow?.buyer);
  const canCancelAcceptedOffer = selectedEscrow?.state === "ACCEPTED" && account?.account === selectedEscrow?.creator && !isStepExpired(selectedEscrow.acceptedAt, T1_SECONDS);
  const canTimeoutAcceptedClose = selectedEscrow?.state === "ACCEPTED" && !!account?.account && isStepExpired(selectedEscrow.acceptedAt, T1_SECONDS);
  const canTimeoutFundedRefund = selectedEscrow?.state === "FUNDED" && account?.account === selectedEscrow?.seller && isStepExpired(selectedEscrow.fundedAt, T2_SECONDS);
  const canTimeoutPaidDispute = selectedEscrow?.state === "PAID" && !!account?.account && isStepExpired(selectedEscrow.paidAt, T3_SECONDS);

  // When dispute is open/under review, disable all action buttons for seller and buyer (arbiter can still act)
  const isInDispute =
    !!existingDispute && (existingDispute.status === "OPEN" || existingDispute.status === "UNDER_REVIEW");
  const isSellerOrBuyer =
    !!selectedEscrow && !!account &&
    (account.account === selectedEscrow.seller || account.account === selectedEscrow.buyer);
  const isInDisputeForParty = isInDispute && isSellerOrBuyer;

  const canAcceptFinal = canAccept && !isInDisputeForParty;
  // Deposit is a seller-mode action (KDA holder); hide in buyer-mode marketplace view.
  const canDepositFinal = canDeposit && !isInDisputeForParty && role === "seller";
  const canMarkPaidFinal = canMarkPaid && !isInDisputeForParty;
  const canReleaseFinal = canRelease && !isInDisputeForParty;
  const canTimeoutFundedRefundFinal = canTimeoutFundedRefund && !isInDisputeForParty;
  const canTimeoutPaidDisputeFinal = canTimeoutPaidDispute && !isInDisputeForParty;

  const isTerminal = selectedEscrow?.state === "COMPLETED" || selectedEscrow?.state === "REFUNDED" || selectedEscrow?.state === "CLOSED" || selectedEscrow?.state === "DELETED";

  const isCompletedTrade = selectedEscrow?.state === "COMPLETED" && selectedEscrow?.buyer;
  const isPartyToTrade = isCompletedTrade && account && (account.account === selectedEscrow.buyer || account.account === selectedEscrow.seller);
  // Show "Register completion to rate" when we're a party, not already rated, and (check still loading OR backend says can't rate yet)
  const needsRegisterCompletion = isPartyToTrade && !ratingCheck?.alreadyRated && (ratingCheck === undefined || !ratingCheck.canRate);
  const canRateTrade = isPartyToTrade && ratingCheck?.canRate === true && !ratingCheck?.alreadyRated;
  const alreadyRated = isPartyToTrade && ratingCheck?.alreadyRated === true;
  const counterpartyWallet = isCompletedTrade && account
    ? (account.account === selectedEscrow.buyer ? selectedEscrow.seller : selectedEscrow.buyer)
    : null;

  // One button: records the completed trade with our server first if needed (no separate step), then opens the rating.
  const handleRateTrade = async () => {
    if (!account || !selectedEscrow?.buyer) return;
    if (canRateTrade) { setShowRatingDialog(true); return; }
    setRegisteringCompletion(true);
    try {
      const signedCmd = await authProof(account.account, account.publicKey);
      await registerCompletion({
        offerId: selectedEscrow.offerId,
        buyerWallet: selectedEscrow.buyer,
        sellerWallet: selectedEscrow.seller,
        wallet: account.account,
        publicKey: account.publicKey,
        signedCmd,
      });
      const check = await refetchRatingCheck();
      if (check.data?.alreadyRated) toast.info("You already rated this trade.");
      else setShowRatingDialog(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open the rating");
    } finally {
      setRegisteringCompletion(false);
    }
  };

  // Phone: the one step this person must take sits in a bar at the bottom of the trade screen
  const mobilePrimary = !isMobile || !selectedEscrow || isTerminal || !isConnected ? null
    : canAcceptFinal ? { label: "Accept Offer", busy: "Accept Offer", Icon: UserPlus, run: handleAccept }
    : canDepositFinal ? { label: `Deposit ${kdaAmount(selectedEscrow.amount)} KDA`, busy: "Deposit", Icon: Lock, run: handleDeposit }
    : canMarkPaidFinal ? { label: "Mark as Paid", busy: "Mark Paid", Icon: DollarSign, run: handleMarkPaid }
    : canReleaseFinal ? { label: "Release to Buyer", busy: "Release", Icon: Unlock, run: handleRelease }
    : null;
  const closeTrade = () => setSelectedOfferId(null);
  const shownState = (e: Escrow) =>
    existingDispute && (existingDispute.status === "OPEN" || existingDispute.status === "UNDER_REVIEW") ? "DISPUTED" : e.state;

  const detailTabs = selectedEscrow ? (
            <Tabs value={disputeTab} onValueChange={setDisputeTab}>
              <TabsList className={isMobile ? "grid w-full grid-cols-3" : undefined}>
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
            {!isMobile && (selectedEscrow.state === "ACCEPTED" || selectedEscrow.state === "FUNDED" || selectedEscrow.state === "PAID") && (
              <TradeTimer escrow={selectedEscrow} me={account?.account} />
            )}

            {/* Details Grid */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className={isMobile ? "hidden" : undefined}>
                <Label className="text-muted-foreground">Side</Label>
                <p className="font-semibold text-lg">
                  {selectedEscrow.side === "SELL" ? "Selling" : "Buying"} KDA
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Price</Label>
                <p className="font-mono text-2xl font-bold text-primary">
                  {selectedEscrow.fiatCurrency === "USD" ? "$" : selectedEscrow.fiatCurrency === "EUR" ? "€" : selectedEscrow.fiatCurrency}
                  {formatFiat(selectedEscrow.price)} <span className="text-base">per KDA</span>
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Available Amount</Label>
                <p className="font-mono text-xl font-bold">
                  {isMobile ? kdaAmount(selectedEscrow.amount) : selectedEscrow.amount.toFixed(8)} <span className="text-base">KDA</span>
                </p>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-muted-foreground">Total Value</Label>
                <div className="mt-1 rounded-lg border-2 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-700 px-4 py-3">
                  <p className="font-mono text-2xl font-bold text-emerald-800 dark:text-emerald-200">
                    {selectedEscrow.fiatCurrency === "USD" ? "$" : selectedEscrow.fiatCurrency === "EUR" ? "€" : selectedEscrow.fiatCurrency}
                    {formatFiat(selectedEscrow.amount * selectedEscrow.price)}
                  </p>
                  <p className="mt-3 text-sm text-muted-foreground leading-snug">
                    Kadena buyer must send this exact amount to the seller using the selected payment method. After sending the payment, the buyer must upload a screenshot of the transaction confirmation in the chat.
                  </p>
                </div>
              </div>
              <div className={isMobile ? "hidden" : undefined}>
                <Label className="text-muted-foreground">Amount</Label>
                <p className="text-sm font-mono">{selectedEscrow.amount.toFixed(4)} KDA</p>
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
              <div className="flex flex-col gap-3 pt-4 border-t border-border">
                {CRITICAL_ACTION_LOADING.includes(actionLoading as (typeof CRITICAL_ACTION_LOADING)[number]) && (
                  <Alert className="border-primary/50 bg-primary/5">
                    <Info className="h-4 w-4" />
                    <AlertTitle>Transaction in progress</AlertTitle>
                    <AlertDescription>{TX_CONFIRM_MESSAGE}</AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-wrap gap-3">

{canAcceptFinal && !isMobile && (
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

                {canCancelAcceptedOffer && (
                  <Button
                    onClick={handleCancelAcceptedOffer}
                    disabled={!!actionLoading}
                    variant="outline"
                    className="gap-2 border-destructive text-destructive hover:bg-destructive/10"
                  >
                    {actionLoading === "Cancel Offer" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                    Cancel Offer
                  </Button>
                )}

                {canTimeoutAcceptedClose && (
                  <Button
                    onClick={handleTimeoutAcceptedClose}
                    disabled={!!actionLoading}
                    variant="outline"
                    className="gap-2 border-amber-500 text-amber-600 hover:bg-amber-500/10"
                  >
                    {actionLoading === "Close (T1 Expired)" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                    Close offer (seller did not fund in time)
                  </Button>
                )}

                {canDepositFinal && !isMobile && (
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

                {canDepositFinal && appChainBalance !== undefined && (
                  <p className={`basis-full text-xs ${appChainBalance < selectedEscrow.amount + TX_GAS_KDA ? "text-destructive" : "text-muted-foreground"}`}>
                    Your chain {CHAIN_ID} balance: {appChainBalance.toLocaleString("en-US", { maximumFractionDigits: 4 })} KDA
                    {appChainBalance < selectedEscrow.amount + TX_GAS_KDA
                      ? ` (not enough: this deposit needs ${(selectedEscrow.amount + TX_GAS_KDA).toLocaleString("en-US", { maximumFractionDigits: 4 })} KDA on chain ${CHAIN_ID}. If your KDA is on another chain, move it to chain ${CHAIN_ID} in your wallet first.)`
                      : " (enough for this deposit)"}
                  </p>
                )}

                {canMarkPaidFinal && !isMobile && (
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

                {canReleaseFinal && !isMobile && (
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
                    {selectedEscrow?.side === "SELL" ? "Refund to Seller" : "Refund to Buyer"}
                  </Button>
                )}

                {canTimeoutFundedRefundFinal && (
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

                {canTimeoutPaidDisputeFinal && (
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
              </div>
            )}

            {isTerminal && (
              <div className="pt-4 border-t border-border space-y-3">
                <p className="text-center text-muted-foreground">This escrow has been finalized.</p>
                {isPartyToTrade && (
                  <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                    <p className="text-sm font-medium text-center">Leave a rating for this trade</p>
                    {(needsRegisterCompletion || canRateTrade) && counterpartyWallet && (
                      <div className="flex justify-center">
                        <Button
                          variant="default"
                          size="sm"
                          onClick={handleRateTrade}
                          disabled={registeringCompletion}
                          className="gap-2"
                        >
                          {registeringCompletion ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />}
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
                <OfferChat escrow={selectedEscrow} profileMap={profileMap} />
              </TabsContent>

              <TabsContent value="dispute" className="mt-4">
                <DisputeView 
                  escrow={selectedEscrow} 
                  onClose={() => setDisputeTab("details")}
                />
              </TabsContent>
            </Tabs>
  ) : null;

  const offerCard = (e: Escrow) => (
    <OfferCard
      key={e.offerId}
      escrow={e}
      profileMap={profileMap}
      ratingSummaryMap={ratingSummaryMap}
      onSelect={setSelectedOfferId}
      onDelete={handleDeleteOffer}
      isDeletingOfferId={deletingOfferId}
      role={viewMode === "active" || viewMode === "mine" ? (e.seller === account?.account ? "seller" : "buyer") : role}
      isSelected={selectedOfferId === e.offerId}
      hasOpenDispute={openDisputeOfferIds.has(e.offerId)}
    />
  );
  const mineGroups: [string, Escrow[]][] = viewMode === "mine"
    ? [
        ["In progress", displayedEscrows.filter((e) => ACTIVE_STATES.includes(e.state as (typeof ACTIVE_STATES)[number]))],
        ["Your open offers", displayedEscrows.filter((e) => e.state === "CREATED")],
        ["Finished", displayedEscrows.filter((e) => PAST_TERMINAL_STATES.includes(e.state as (typeof PAST_TERMINAL_STATES)[number]))],
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* All Offers List */}
      <Card className={isMobile ? "border-0 bg-transparent shadow-none" : "escrow-card"}>
        {isMobile ? (
          <div className="flex items-center justify-between pb-2">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {isLoading && escrows.length === 0 ? "Loading…" : `${displayedEscrows.length} ${viewMode === "mine" ? (displayedEscrows.length === 1 ? "item" : "items") : displayedEscrows.length === 1 ? "offer" : "offers"}`}
            </p>
            <Button variant="ghost" size="sm" className="h-10 gap-2" onClick={loadAll} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
          </div>
        ) : (
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <List className="h-5 w-5 text-primary" />
                {viewMode === "active"
                  ? "Active Trades"
                  : viewMode === "new"
                  ? "New offers - Marketplace"
                  : viewMode === "myPast"
                  ? "All my past offers"
                  : viewMode === "my"
                  ? "My Offers"
                  : role === "buyer"
                    ? "All Sell Offers"
                    : "All Buy Offers"}
              </CardTitle>
              <CardDescription>
                {viewMode === "active"
                  ? "Trades in progress (accepted, funded, paid, disputed)"
                  : viewMode === "new"
                  ? "Only new created offers. Nothing else."
                  : viewMode === "myPast"
                  ? "Trades you took part in that ended as Completed, Refunded, or Closed"
                  : viewMode === "my"
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
        )}
        <CardContent className={isMobile ? "p-0" : undefined}>
          {isLoading && escrows.length === 0 ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : displayedEscrows.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              {escrows.length === 0
                ? (viewMode === "mine"
                    ? "No trades yet. Accept an offer in Offers, or post your own in New offer."
                    : viewMode === "active"
                    ? "You have no active trades. Accept an offer as buyer or wait for a buyer as seller to see trades here."
                    : viewMode === "new"
                    ? "No new offers at the moment. Check back later."
                    : viewMode === "myPast"
                    ? "You have no past offers. Past offers are trades you participated in that ended as Completed, Refunded, or Closed."
                    : viewMode === "my"
                    ? "You haven't created any offers yet. Create your first offer in the Create Offer tab."
                    : role === "buyer"
                      ? "No sell offers found. Try adjusting your filters or create a new offer."
                      : "No buy offers found. Try adjusting your filters or create a new offer.")
                : "No offers match your filters (min rating or online now). Try clearing filters."}
            </p>
          ) : (
            viewMode === "mine" ? (
              <div className="space-y-6">
                {mineGroups.filter(([, list]) => list.length > 0).map(([title, list]) => (
                  <section key={title} className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">{list.map(offerCard)}</div>
                  </section>
                ))}
              </div>
            ) : (
            <div className={isMobile ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"}>
              {displayedEscrows.map(offerCard)}
            </div>
            )
          )}
        </CardContent>
      </Card>

      {/* Escrow Details (when one is selected) */}
      {selectedEscrow && isMobile && createPortal(
        <div className="fixed inset-0 z-[60] flex flex-col bg-background" role="dialog" aria-modal="true" aria-label={tradeTitle(selectedEscrow, account?.account)}>
          <header className="flex items-center gap-1 border-b border-border bg-card px-2 py-2">
            <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" onClick={closeTrade} aria-label="Back to the list">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h2 className="min-w-0 flex-1 truncate font-display text-lg font-semibold">{tradeTitle(selectedEscrow, account?.account)}</h2>
            <span className="shrink-0 pr-2"><EscrowStatus state={shownState(selectedEscrow)} /></span>
          </header>
          <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
            <YourTurnCard escrow={selectedEscrow} me={account?.account} canAccept={canAcceptFinal} />
            <TradeSteps escrow={selectedEscrow} me={account?.account} />
            {detailTabs}
          </div>
          {mobilePrimary && (
            <div className="border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Button className="h-14 w-full gap-2 text-lg" onClick={mobilePrimary.run} disabled={!!actionLoading}>
                {actionLoading === mobilePrimary.busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <mobilePrimary.Icon className="h-5 w-5" />}
                {mobilePrimary.label}
              </Button>
              <p className="mt-1.5 text-center text-xs text-muted-foreground">
                {actionLoading ? "Confirming on Kadena. This can take up to a minute." : "You'll approve this in your wallet."}
              </p>
            </div>
          )}
        </div>,
        document.body,
      )}

      {selectedEscrow && !isMobile && (
        <Card className="escrow-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="font-mono text-lg">{selectedEscrow.offerId}</CardTitle>
              <EscrowStatus
                state={
                  existingDispute && (existingDispute.status === "OPEN" || existingDispute.status === "UNDER_REVIEW")
                    ? "DISPUTED"
                    : selectedEscrow.state
                }
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {detailTabs}
          </CardContent>
        </Card>
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
