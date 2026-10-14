import { Card, CardContent } from "@/components/ui/card";
import { MarketTag } from "./MarketTag";
import { TradeCode } from "./TradeCode";
import { TurnLine } from "./MobileTrade";
import { currencyPrefix } from "@/lib/markets";
import { NEW_TRADER_TRADES, isNewTrader } from "@/lib/trust";
import { OFFER_LISTING_DAYS } from "@/lib/markets";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EscrowStatus } from "./EscrowStatus";
import { ProfileSummaryView } from "./ProfileSummary";
import { RatingDisplay } from "./RatingDisplay";
import type { Escrow } from "@/lib/kadena";
import type { RatingSummary } from "@/lib/ratingApi";
import { formatFiat } from "@/lib/utils";
import { ShoppingCart, Store, ArrowRight, CreditCard, MessageCircle, X, Loader2, RotateCcw } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useState } from "react";
import { ChatBox } from "./ChatBox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { kdaAmount, myTradeSide } from "./MobileTrade";

interface OfferCardProps {
  escrow: Escrow;
  profileMap: Record<string, { username: string | null; avatar: string | null; wallet: string }>;
  ratingSummaryMap?: Record<string, RatingSummary>;
  /** Completed trades per wallet, counted on the chain */
  completedMap?: Record<string, number>;
  onSelect: (offerId: string) => void;
  onDelete?: (offerId: string) => void;
  isDeletingOfferId?: string | null;
  role: "buyer" | "seller";
  isSelected?: boolean;
  /** When true, show "Disputed" instead of chain state (offer has an open/active dispute) */
  hasOpenDispute?: boolean;
  /** Days since the creator of this open offer was last active, when it is long enough to mention */
  inactiveDays?: number | null;
  /** "Post again" for a finished offer you created */
  onRepeat?: (escrow: Escrow) => void;
  /** Your open offer is not shown in the market: "expired" (listed too long) or hidden by the Marketplace */
  hiddenReason?: string | null;
  /** List an expired offer again */
  onRelist?: (escrow: Escrow) => void;
  /** Accepted but never funded for days: filed under Finished */
  unfundedExpired?: boolean;
}

export function OfferCard({ escrow, profileMap, ratingSummaryMap, completedMap, onSelect, onDelete, isDeletingOfferId, role, isSelected = false, hasOpenDispute = false, inactiveDays = null, onRepeat, hiddenReason = null, onRelist, unfundedExpired = false }: OfferCardProps) {
  const { account } = useWallet();
  const isMobile = useIsMobile();
  const [showChat, setShowChat] = useState(false);
  const isMyOffer = escrow.creator === account?.account;
  const canAccept = escrow.state === "CREATED" && !isMyOffer;
  const canChat = account && isMyOffer ? !!escrow.buyer : !isMyOffer;
  const canDelete = isMyOffer && escrow.state === "CREATED" && !!onDelete;
  const isDeleting = isDeletingOfferId === escrow.offerId;
  const canRepeat = isMyOffer && !!onRepeat && ["COMPLETED", "REFUNDED", "CLOSED"].includes(escrow.state);

  // Parse payment methods
  let paymentMethods: string[] = [];
  try {
    paymentMethods = JSON.parse(escrow.paymentMethod || "[]");
  } catch {
    paymentMethods = escrow.paymentMethod ? [escrow.paymentMethod] : [];
  }

  const totalPrice = escrow.amount * escrow.price;
  const currencySymbol = currencyPrefix(escrow.fiatCurrency);

  if (isMobile) {
    // Phone: the amount and price first, then how you pay, then one large button.
    const mySide = myTradeSide(escrow, account?.account);
    const other = mySide === "buyer" ? escrow.seller : mySide === "seller" ? escrow.buyer : escrow.creator;
    const otherLabel = mySide === "buyer" ? "Seller" : mySide === "seller" ? "Buyer" : escrow.side === "SELL" ? "Seller" : "Buyer";
    const otherName = other ? profileMap[other]?.username || `${other.slice(0, 6)}…${other.slice(-4)}` : null;
    const trades = other ? completedMap?.[other] ?? ratingSummaryMap?.[other]?.completedTrades : undefined;
    const otherIsNew = !!other && !isMyOffer && isNewTrader(completedMap?.[other]);
    const showStatus = escrow.state !== "CREATED" || isMyOffer;
    return (
      <div
        id={`offer-card-${escrow.offerId}`}
        className={`relative scroll-mt-28 rounded-2xl border bg-card p-4 ${isSelected ? "border-primary" : "border-border"} ${isDeleting ? "pointer-events-none opacity-70" : ""} ${inactiveDays ? "opacity-60" : ""}`}
      >
        {isDeleting && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-2xl bg-background/80 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />Deleting offer…
          </div>
        )}
        <div className="flex items-baseline justify-between gap-3">
          <p className="flex items-center gap-2 font-display text-2xl font-bold">{kdaAmount(escrow.amount)} KDA <TradeCode offerId={escrow.offerId} className="self-center" /></p>
          <p className="shrink-0 text-right text-sm text-muted-foreground">{currencySymbol}{formatFiat(escrow.price)} / KDA<MarketTag price={escrow.price} currency={escrow.fiatCurrency} className="flex justify-end" /></p>
        </div>
        {showStatus && (
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">{mySide === "buyer" ? "You're buying" : mySide === "seller" ? "You're selling" : escrow.side === "SELL" ? "Sell offer" : "Buy offer"}</span>
            <EscrowStatus state={hasOpenDispute ? "DISPUTED" : escrow.state} />
          </div>
        )}
        <TurnLine escrow={hasOpenDispute ? { ...escrow, state: "DISPUTED" } : escrow} me={account?.account} />
        {hiddenReason === "expired" ? (
          <div className="mt-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-2.5 text-sm">
            <p>Expired: listed {OFFER_LISTING_DAYS} days without a buyer, so it is no longer in the market. Nothing is locked.</p>
            {onRelist && (
              <Button size="sm" className="mt-2 h-10 w-full gap-2" onClick={() => onRelist(escrow)}>
                <RotateCcw className="h-4 w-4" />List again for {OFFER_LISTING_DAYS} days
              </Button>
            )}
          </div>
        ) : hiddenReason ? (
          <p className="mt-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-2.5 text-sm">
            Hidden from the market by the Marketplace because it looked forgotten. Nothing is locked. Delete it with ✕, or delete it and post a new one if you still want to trade.
          </p>
        ) : null}
        {unfundedExpired && (
          <p className="mt-2 rounded-lg bg-muted p-2.5 text-sm text-muted-foreground">
            Never funded: no KDA was locked, and this trade can no longer go ahead.
          </p>
        )}
        {inactiveDays ? (
          <p className="mt-1 text-sm text-muted-foreground">{otherLabel} last active {inactiveDays} days ago. They may be slow to answer.</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
          {paymentMethods.slice(0, 2).map((m) => (
            <span key={m} className="rounded-full bg-muted px-2.5 py-1">{m}</span>
          ))}
          {paymentMethods.length > 2 && <span className="rounded-full bg-muted px-2.5 py-1">+{paymentMethods.length - 2}</span>}
          <span className="rounded-full bg-muted px-2.5 py-1">Total {currencySymbol}{formatFiat(totalPrice)}</span>
          {otherName && !isMyOffer && (
            <span className="rounded-full bg-muted px-2.5 py-1">
              {otherLabel}: {trades ? `${trades} trade${trades === 1 ? "" : "s"}` : otherName}
            </span>
          )}
          {otherIsNew && (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 font-medium text-amber-700 dark:text-amber-300" title={`Fewer than ${NEW_TRADER_TRADES} completed trades`}>New trader</span>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            className="h-12 flex-1 text-base"
            variant={canAccept ? "default" : "outline"}
            onClick={() => !isDeleting && onSelect(escrow.offerId)}
          >
            {canAccept ? "View and accept" : escrow.state === "CREATED" ? "View offer" : "Open trade"}
          </Button>
          {canRepeat && (
            <Button variant="secondary" className="h-12 shrink-0 gap-2 text-base" onClick={() => onRepeat(escrow)}>
              <RotateCcw className="h-4 w-4" />Post again
            </Button>
          )}
          {canDelete && !isDeleting && (
            <Button
              variant="outline"
              className="h-12 w-12 shrink-0 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => { if (window.confirm("Delete this offer? It will be removed from the system.")) onDelete(escrow.offerId); }}
              aria-label="Delete offer"
              title="Delete offer"
            >
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card 
      id={`offer-card-${escrow.offerId}`}
      className={`transition-all cursor-pointer relative scroll-mt-28 ${
        isDeleting ? "opacity-70 pointer-events-none" : ""
      } ${
        isSelected 
          ? "border-2 border-primary bg-primary/5 shadow-lg shadow-primary/10 ring-2 ring-primary/20" 
          : "hover:border-primary/50 hover:shadow-md"
      }`}
      onClick={() => !isDeleting && onSelect(escrow.offerId)}
    >
      {isDeleting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-background/80 z-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-sm font-medium text-muted-foreground">Deleting offer…</span>
        </div>
      )}
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Header: Side badge and status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant={escrow.side === "BUY" ? "default" : "secondary"} className="gap-1">
                {escrow.side === "BUY" ? (
                  <ShoppingCart className="h-3 w-3" />
                ) : (
                  <Store className="h-3 w-3" />
                )}
                {escrow.side === "SELL" ? "Selling" : "Buying"} KDA
              </Badge>
              <TradeCode offerId={escrow.offerId} />
              {canDelete && !isDeleting && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm("Delete this offer? It will be removed from the system.")) {
                      onDelete(escrow.offerId);
                    }
                  }}
                  title="Delete offer"
                  aria-label="Delete offer"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <EscrowStatus state={hasOpenDispute ? "DISPUTED" : escrow.state} />
          </div>

          {/* Price and Amount */}
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-primary">
                {currencySymbol}{formatFiat(escrow.price)}
              </span>
              <span className="text-sm text-muted-foreground">per KDA</span>
              <MarketTag price={escrow.price} currency={escrow.fiatCurrency} />
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>Available: <span className="font-medium text-foreground">{escrow.amount.toFixed(4)} KDA</span></span>
              <span>Total: <span className="font-medium text-foreground">{currencySymbol}{formatFiat(totalPrice)}</span></span>
            </div>
          </div>

          {/* Amount */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Amount: <span className="font-mono">{escrow.amount.toFixed(4)}</span> KDA</span>
          </div>

          {/* Payment Methods */}
          {paymentMethods.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <CreditCard className="h-3 w-3 text-muted-foreground" />
              {paymentMethods.slice(0, 3).map((method, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {method}
                </Badge>
              ))}
              {paymentMethods.length > 3 && (
                <span className="text-xs text-muted-foreground">+{paymentMethods.length - 3} more</span>
              )}
            </div>
          )}

          {/* Seller/Buyer Info */}
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {escrow.side === "SELL" ? "Seller:" : "Buyer:"}
                </span>
                <ProfileSummaryView 
                  wallet={escrow.seller} 
                  summary={profileMap[escrow.seller]} 
                  size="sm"
                />
              </div>
              <RatingDisplay
                summary={ratingSummaryMap?.[escrow.seller]}
                variant="compact"
                className="text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              {canChat && (
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setShowChat(true);
                  }}
                >
                  <MessageCircle className="h-3 w-3" />
                </Button>
              )}
              {canAccept && (
                <Button size="sm" onClick={(e) => { e.stopPropagation(); onSelect(escrow.offerId); }}>
                  Accept
                  <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
      
      {/* Chat Dialog */}
      <Dialog open={showChat} onOpenChange={setShowChat}>
        <DialogContent className="max-w-2xl h-[600px] p-0">
          <DialogTitle className="sr-only">Chat with {isMyOffer && escrow.buyer ? "Counterparty" : "Creator"}</DialogTitle>
          {canChat && (
            <ChatBox
              otherWallet={isMyOffer && escrow.buyer ? escrow.buyer : escrow.creator}
              otherProfile={isMyOffer && escrow.buyer ? profileMap[escrow.buyer] : profileMap[escrow.creator]}
              onClose={() => setShowChat(false)}
              className="border-0 h-full"
              contextOfferId={escrow.offerId}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
