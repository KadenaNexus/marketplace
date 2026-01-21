import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EscrowStatus } from "./EscrowStatus";
import { ProfileSummaryView } from "./ProfileSummary";
import type { Escrow } from "@/lib/kadena";
import { ShoppingCart, Store, ArrowRight, CreditCard } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";

interface OfferCardProps {
  escrow: Escrow;
  profileMap: Record<string, { username: string | null; avatar: string | null; wallet: string }>;
  onSelect: (offerId: string) => void;
  role: "buyer" | "seller";
  isSelected?: boolean;
}

export function OfferCard({ escrow, profileMap, onSelect, role, isSelected = false }: OfferCardProps) {
  const { account } = useWallet();
  const isMyOffer = escrow.seller === account?.account;
  const canAccept = role === "buyer" && escrow.state === "CREATED" && !isMyOffer;
  
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
      className={`transition-all cursor-pointer ${
        isSelected 
          ? "border-2 border-primary bg-primary/5 shadow-lg shadow-primary/10 ring-2 ring-primary/20" 
          : "hover:border-primary/50 hover:shadow-md"
      }`}
      onClick={() => onSelect(escrow.offerId)}
    >
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Header: Side badge and status */}
          <div className="flex items-center justify-between">
            <Badge variant={escrow.side === "BUY" ? "default" : "secondary"} className="gap-1">
              {escrow.side === "BUY" ? (
                <ShoppingCart className="h-3 w-3" />
              ) : (
                <Store className="h-3 w-3" />
              )}
              {escrow.side === "SELL" ? "Selling" : "Buying"} KDA
            </Badge>
            <EscrowStatus state={escrow.state} />
          </div>

          {/* Price and Amount */}
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-primary">
                {currencySymbol}{escrow.price.toFixed(2)}
              </span>
              <span className="text-sm text-muted-foreground">per KDA</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>Available: <span className="font-medium text-foreground">{escrow.amount.toFixed(4)} KDA</span></span>
              <span>Total: <span className="font-medium text-foreground">{currencySymbol}{totalPrice.toFixed(2)}</span></span>
            </div>
          </div>

          {/* Limits */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Min: {escrow.minAmount.toFixed(4)} KDA</span>
            <span>Max: {escrow.maxAmount.toFixed(4)} KDA</span>
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
            {canAccept && (
              <Button size="sm" onClick={(e) => { e.stopPropagation(); onSelect(escrow.offerId); }}>
                Accept
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
