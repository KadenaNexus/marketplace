import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EscrowStatus } from "./EscrowStatus";
import { ProfileSummaryView } from "./ProfileSummary";
import { RatingDisplay } from "./RatingDisplay";
import type { Escrow } from "@/lib/kadena";
import type { RatingSummary } from "@/lib/ratingApi";
import { formatFiat } from "@/lib/utils";
import { ShoppingCart, Store, ArrowRight, CreditCard, MessageCircle, X, Loader2 } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useState } from "react";
import { ChatBox } from "./ChatBox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface OfferCardProps {
  escrow: Escrow;
  profileMap: Record<string, { username: string | null; avatar: string | null; wallet: string }>;
  ratingSummaryMap?: Record<string, RatingSummary>;
  onSelect: (offerId: string) => void;
  onDelete?: (offerId: string) => void;
  isDeletingOfferId?: string | null;
  role: "buyer" | "seller";
  isSelected?: boolean;
  /** When true, show "Disputed" instead of chain state (offer has an open/active dispute) */
  hasOpenDispute?: boolean;
}

export function OfferCard({ escrow, profileMap, ratingSummaryMap, onSelect, onDelete, isDeletingOfferId, role, isSelected = false, hasOpenDispute = false }: OfferCardProps) {
  const { account } = useWallet();
  const [showChat, setShowChat] = useState(false);
  const isMyOffer = escrow.creator === account?.account;
  const canAccept = escrow.state === "CREATED" && !isMyOffer;
  const canChat = account && isMyOffer ? !!escrow.buyer : !isMyOffer;
  const canDelete = isMyOffer && escrow.state === "CREATED" && !!onDelete;
  const isDeleting = isDeletingOfferId === escrow.offerId;

  // Parse payment methods
  let paymentMethods: string[] = [];
  try {
    paymentMethods = JSON.parse(escrow.paymentMethod || "[]");
  } catch {
    paymentMethods = escrow.paymentMethod ? [escrow.paymentMethod] : [];
  }

  const totalPrice = escrow.amount * escrow.price;
  const currencySymbol = escrow.fiatCurrency === "USD" ? "$" : escrow.fiatCurrency === "EUR" ? "€" : escrow.fiatCurrency;

  return (
    <Card 
      className={`transition-all cursor-pointer relative ${
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
