import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@/hooks/useWallet";
import { listAllEscrows } from "@/lib/kadena";
import {
  getDispute,
  getEvidence,
  getMessages,
  getDisputeActions,
  setDisputeUnderReview,
  requestDisputeInfo,
  closeDispute,
} from "@/lib/disputeApi";
import { buildProfileAuthTx, signTransaction, buildReleaseTx, buildRefundTx, submitTransaction, pollTransaction } from "@/lib/kadena";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Shield,
  Loader2,
  AlertCircle,
  FileText,
  MessageSquare,
  ExternalLink,
  Send,
  CheckCircle,
  Eye,
  Unlock,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import type { Escrow } from "@/lib/kadena";

export default function AdminDisputeDetail() {
  const { offerId } = useParams<{ offerId: string }>();
  const { account, isConnected } = useWallet();
  const queryClient = useQueryClient();
  const [requestInfoMessage, setRequestInfoMessage] = useState("");
  const [isRequestingInfo, setIsRequestingInfo] = useState(false);
  const [isSettingReview, setIsSettingReview] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [releaseToBuyerLoading, setReleaseToBuyerLoading] = useState(false);
  const [releaseToSellerLoading, setReleaseToSellerLoading] = useState(false);

  const { data: escrows = [] } = useQuery({
    queryKey: ["admin-escrows"],
    queryFn: () => listAllEscrows(),
    enabled: !!offerId,
  });
  const escrow = escrows.find((e) => e.offerId === offerId) ?? null;

  const { data: dispute, refetch: refetchDispute } = useQuery({
    queryKey: ["dispute", offerId],
    queryFn: () => getDispute(offerId!),
    enabled: !!offerId,
  });

  const { data: evidence = [], refetch: refetchEvidence } = useQuery({
    queryKey: ["evidence", offerId, account?.account],
    queryFn: () => getEvidence(offerId!, account?.account),
    enabled: !!offerId && !!dispute,
  });

  const { data: messages = [], refetch: refetchMessages } = useQuery({
    queryKey: ["dispute-messages", offerId],
    queryFn: () => getMessages(offerId!),
    enabled: !!offerId && !!dispute,
    refetchInterval: 5000,
  });

  const { data: actions = [], refetch: refetchActions } = useQuery({
    queryKey: ["dispute-actions", offerId],
    queryFn: () => getDisputeActions(offerId!),
    enabled: !!offerId && !!dispute,
  });

  const isArbiter = !!escrow && account?.account === escrow.arbiter;
  const canAct = isArbiter && dispute && (dispute.status === "OPEN" || dispute.status === "UNDER_REVIEW");

  const refetchAll = () => {
    refetchDispute();
    refetchEvidence();
    refetchMessages();
    refetchActions();
    queryClient.invalidateQueries({ queryKey: ["admin-disputes"] });
    queryClient.invalidateQueries({ queryKey: ["admin-escrows"] });
  };

  const handleRequestInfo = async () => {
    if (!account || !offerId) return;
    setIsRequestingInfo(true);
    try {
      const tx = buildProfileAuthTx(account.account, account.publicKey);
      let signedCmd = await signTransaction(tx);
      if (signedCmd?.signedCmd && !signedCmd.cmd) signedCmd = signedCmd.signedCmd;
      const sigs = Array.isArray(signedCmd?.sigs) ? signedCmd.sigs : [];
      if (sigs[0] && !sigs[0].pubKey) sigs[0] = { ...sigs[0], pubKey: account.publicKey };
      if (sigs[0]?.signature && !sigs[0].sig) sigs[0] = { ...sigs[0], sig: sigs[0].signature };
      await requestDisputeInfo({
        offerId,
        message: requestInfoMessage.trim() || undefined,
        wallet: account.account,
        publicKey: account.publicKey,
        signedCmd,
      });
      toast.success("Request sent");
      setRequestInfoMessage("");
      refetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to request info");
    } finally {
      setIsRequestingInfo(false);
    }
  };

  const handleMarkUnderReview = async () => {
    if (!account || !offerId) return;
    setIsSettingReview(true);
    try {
      const tx = buildProfileAuthTx(account.account, account.publicKey);
      let signedCmd = await signTransaction(tx);
      if (signedCmd?.signedCmd && !signedCmd.cmd) signedCmd = signedCmd.signedCmd;
      const sigs = Array.isArray(signedCmd?.sigs) ? signedCmd.sigs : [];
      if (sigs[0] && !sigs[0].pubKey) sigs[0] = { ...sigs[0], pubKey: account.publicKey };
      if (sigs[0]?.signature && !sigs[0].sig) sigs[0] = { ...sigs[0], sig: sigs[0].signature };
      await setDisputeUnderReview({ offerId, wallet: account.account, publicKey: account.publicKey, signedCmd });
      toast.success("Marked under review");
      refetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set under review");
    } finally {
      setIsSettingReview(false);
    }
  };

  const handleResolve = async () => {
    if (!account || !offerId) return;
    if (!confirm("Resolve (close) this dispute? This action cannot be undone.")) return;
    setIsClosing(true);
    try {
      const tx = buildProfileAuthTx(account.account, account.publicKey);
      let signedCmd = await signTransaction(tx);
      if (signedCmd?.signedCmd && !signedCmd.cmd) signedCmd = signedCmd.signedCmd;
      const sigs = Array.isArray(signedCmd?.sigs) ? signedCmd.sigs : [];
      if (sigs[0] && !sigs[0].pubKey) sigs[0] = { ...sigs[0], pubKey: account.publicKey };
      if (sigs[0]?.signature && !sigs[0].sig) sigs[0] = { ...sigs[0], sig: sigs[0].signature };
      await closeDispute({ offerId, wallet: account.account, publicKey: account.publicKey, signedCmd });
      toast.success("Dispute resolved");
      refetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resolve");
    } finally {
      setIsClosing(false);
    }
  };

  /** Release escrow to the buyer (fiat payer). Contract: SELL -> buyer, BUY -> creator. Only PAID or DISPUTED. */
  const handleReleaseToBuyer = async () => {
    if (!account || !escrow || !offerId) return;
    const recipient = escrow.side === "SELL" ? escrow.buyer : escrow.creator;
    if (!recipient) {
      toast.error("No buyer set for this offer");
      return;
    }
    if (!confirm(`Release ${escrow.amount} KDA to the buyer (${recipient.slice(0, 12)}…)? This will complete the escrow on-chain.`)) return;
    setReleaseToBuyerLoading(true);
    try {
      const tx = buildReleaseTx(offerId, account.account, account.publicKey, recipient, escrow.amount);
      const signedTx = await signTransaction(tx);
      const requestKey = await submitTransaction(signedTx);
      const result = await pollTransaction(requestKey);
      const res = result?.result;
      if (res?.status === "failure") {
        const errMsg = typeof res.error === "string" ? res.error : (res.error as any)?.message ?? "Transaction failed";
        throw new Error(errMsg);
      }
      toast.success("Released to buyer", { description: `Request Key: ${requestKey.slice(0, 16)}…` });
      refetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Release to buyer failed");
    } finally {
      setReleaseToBuyerLoading(false);
    }
  };

  /** Refund escrow to the seller (KDA holder). Contract: SELL -> creator, BUY -> buyer. FUNDED, PAID, or DISPUTED. */
  const handleReleaseToSeller = async () => {
    if (!account || !escrow || !offerId) return;
    const refundTo = escrow.side === "SELL" ? escrow.creator : escrow.buyer;
    if (!refundTo) {
      toast.error("Cannot determine refund recipient");
      return;
    }
    if (!confirm(`Refund ${escrow.amount} KDA to the seller (${refundTo.slice(0, 12)}…)? This will refund the escrow on-chain.`)) return;
    setReleaseToSellerLoading(true);
    try {
      const tx = buildRefundTx(offerId, account.account, account.publicKey, refundTo, escrow.amount);
      const signedTx = await signTransaction(tx);
      const requestKey = await submitTransaction(signedTx);
      const result = await pollTransaction(requestKey);
      const res = result?.result;
      if (res?.status === "failure") {
        const errMsg = typeof res.error === "string" ? res.error : (res.error as any)?.message ?? "Transaction failed";
        throw new Error(errMsg);
      }
      toast.success("Refunded to seller", { description: `Request Key: ${requestKey.slice(0, 16)}…` });
      refetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Release to seller failed");
    } finally {
      setReleaseToSellerLoading(false);
    }
  };

  if (!offerId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Invalid dispute</p>
      </div>
    );
  }

  if (!escrow) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
          <div className="container mx-auto px-4 py-4 flex items-center gap-4">
            <Link to="/admin" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <span className="font-medium">Admin / Dispute</span>
          </div>
        </header>
        <main className="container mx-auto px-4 py-8">
          <p className="text-muted-foreground">Offer not found. It may have been closed or not yet synced.</p>
        </main>
      </div>
    );
  }

  if (!dispute) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
          <div className="container mx-auto px-4 py-4 flex items-center gap-4">
            <Link to="/admin" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <span className="font-medium">Admin / Dispute</span>
          </div>
        </header>
        <main className="container mx-auto px-4 py-8">
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </main>
      </div>
    );
  }

  const getRoleLabel = (wallet: string) => {
    if (wallet === escrow.buyer) return "Buyer";
    if (wallet === escrow.seller) return "Seller";
    if (wallet === escrow.arbiter) return "Arbiter";
    return "User";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/admin" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <span className="font-medium flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Dispute: {offerId.slice(0, 16)}…
            </span>
          </div>
          <Badge variant={dispute.status === "OPEN" ? "destructive" : dispute.status === "UNDER_REVIEW" ? "secondary" : "outline"}>
            {dispute.status}
          </Badge>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6 max-w-4xl">
        {/* Trade summary */}
        <Card>
          <CardHeader>
            <CardTitle>Trade</CardTitle>
            <CardDescription>Offer ID, parties, amount, tx reference</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><Label className="text-muted-foreground">Offer ID</Label> <span className="font-mono break-all">{offerId}</span></p>
            <p><Label className="text-muted-foreground">Seller</Label> {escrow.seller}</p>
            <p><Label className="text-muted-foreground">Buyer</Label> {escrow.buyer || "—"}</p>
            <p><Label className="text-muted-foreground">Arbiter</Label> {escrow.arbiter}</p>
            <p><Label className="text-muted-foreground">Amount</Label> {escrow.amount} KDA • Price {escrow.fiatCurrency} {escrow.price}</p>
            <p><Label className="text-muted-foreground">State</Label> {escrow.state}</p>
            <a
              href={`https://denascan.com/chain/${escrow.chainId}/account/${escrow.seller}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              View on explorer <ExternalLink className="h-3 w-3" />
            </a>
          </CardContent>
        </Card>

        {/* Dispute header */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Dispute
            </CardTitle>
            <CardDescription>
              Opened by {dispute.openedBy} ({dispute.openedByWallet.slice(0, 10)}…) on {new Date(dispute.createdAt).toLocaleString()}
              {dispute.triggeredByTimeout && " • Triggered by timeout"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Label className="text-muted-foreground">Reason</Label>
            <p className="mt-1">{dispute.reason || "No reason provided"}</p>
          </CardContent>
        </Card>

        {/* Admin actions */}
        {canAct && (
          <Card>
            <CardHeader>
              <CardTitle>Admin actions</CardTitle>
              <CardDescription>Request more info, mark under review, or resolve the dispute.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Request more info (sends message to parties)</Label>
                <Textarea
                  value={requestInfoMessage}
                  onChange={(e) => setRequestInfoMessage(e.target.value)}
                  placeholder="Optional message to parties..."
                  rows={2}
                  className="resize-none"
                />
                <Button onClick={handleRequestInfo} disabled={isRequestingInfo} size="sm" className="gap-2">
                  {isRequestingInfo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Request more info
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {dispute.status === "OPEN" && (
                  <Button variant="outline" size="sm" onClick={handleMarkUnderReview} disabled={isSettingReview} className="gap-2">
                    {isSettingReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                    Mark under review
                  </Button>
                )}
                <Button variant="default" size="sm" onClick={handleResolve} disabled={isClosing} className="gap-2">
                  {isClosing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  Resolve (close) dispute
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Release escrow funds — arbiter can send KDA to buyer or seller from admin */}
        {isArbiter && escrow && ["FUNDED", "PAID", "DISPUTED"].includes(escrow.state) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Unlock className="h-5 w-5 text-primary" />
                Release escrow funds
              </CardTitle>
              <CardDescription>
                Send the funded escrow amount ({escrow.amount} KDA) to either the buyer or the seller. This executes on-chain and finalizes the escrow.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                <strong>Seller (KDA holder):</strong> {escrow.seller.slice(0, 16)}… — <strong>Buyer (fiat payer):</strong> {escrow.buyer ? `${escrow.buyer.slice(0, 16)}…` : "—"}
              </p>
              <div className="flex flex-wrap gap-2">
                {["PAID", "DISPUTED"].includes(escrow.state) && escrow.buyer && (
                  <Button
                    variant="default"
                    className="gap-2 bg-success hover:bg-success/90"
                    onClick={handleReleaseToBuyer}
                    disabled={releaseToBuyerLoading || releaseToSellerLoading}
                  >
                    {releaseToBuyerLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
                    Release to Buyer
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleReleaseToSeller}
                  disabled={releaseToBuyerLoading || releaseToSellerLoading}
                >
                  {releaseToSellerLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  Release to Seller (refund)
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action log */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Action log
            </CardTitle>
            <CardDescription>Admin/arbiter actions on this dispute.</CardDescription>
          </CardHeader>
          <CardContent>
            {actions.length === 0 ? (
              <p className="text-muted-foreground text-sm">No actions yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {actions.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 p-2 rounded bg-muted/50">
                    <Badge variant="outline">{a.actionType}</Badge>
                    <span className="text-muted-foreground">{a.byWallet.slice(0, 10)}…</span>
                    <span className="text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
                    {a.payload?.message && <span className="truncate">"{a.payload.message}"</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Messages */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Messages ({messages.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {messages.length === 0 ? (
              <p className="text-muted-foreground text-sm">No messages yet.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {messages.map((msg) => (
                  <div key={msg.createdAt + msg.from} className="p-3 rounded-lg bg-muted">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{getRoleLabel(msg.from)} {msg.from.slice(0, 8)}…</span>
                      <span>{new Date(msg.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm">{msg.message}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Evidence */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Evidence ({evidence.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {evidence.length === 0 ? (
              <p className="text-muted-foreground text-sm">No evidence submitted yet.</p>
            ) : (
              <ul className="space-y-4">
                {evidence.map((e, i) => (
                  <li key={i} className="p-3 rounded-lg border">
                    <p className="text-xs text-muted-foreground">By {getRoleLabel(e.submittedBy)} • {new Date(e.submittedAt).toLocaleString()}</p>
                    {e.explanation && <p className="mt-1 text-sm">{e.explanation}</p>}
                    {e.files?.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {e.files.map((f, j) => (
                          <li key={j}>
                            <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-sm flex items-center gap-1">
                              {f.originalName || f.filename} <ExternalLink className="h-3 w-3" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
