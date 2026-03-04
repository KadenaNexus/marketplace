import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EscrowState } from "@/lib/kadena";

export interface OfferFilters {
  state: EscrowState | "ALL";
  side: "BUY" | "SELL" | "ALL";
  minAmount: string;
  maxAmount: string;
  minPrice: string;
  maxPrice: string;
  paymentMethod: string;
  seller: string;
  buyer: string;
}

interface OfferFiltersProps {
  filters: OfferFilters;
  onFiltersChange: (filters: OfferFilters) => void;
  role: "buyer" | "seller";
}

const ESCROW_STATES: EscrowState[] = ["CREATED", "ACCEPTED", "FUNDED", "PAID", "COMPLETED", "REFUNDED", "CLOSED", "DELETED", "DISPUTED"];

export function OfferFiltersComponent({ filters, onFiltersChange, role }: OfferFiltersProps) {
  const updateFilter = <K extends keyof OfferFilters>(key: K, value: OfferFilters[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const clearFilters = () => {
    onFiltersChange({
      state: "ALL",
      side: "ALL",
      minAmount: "",
      maxAmount: "",
      minPrice: "",
      maxPrice: "",
      paymentMethod: "",
      seller: "",
      buyer: "",
    });
  };

  const hasActiveFilters =
    filters.state !== "ALL" ||
    filters.side !== "ALL" ||
    filters.minAmount !== "" ||
    filters.maxAmount !== "" ||
    filters.minPrice !== "" ||
    filters.maxPrice !== "" ||
    filters.paymentMethod !== "" ||
    filters.seller !== "" ||
    filters.buyer !== "";

  return (
    <div className="sticky top-0 z-20 py-3 pb-4 bg-background border-b rounded-lg">
      <div className="flex flex-wrap items-end gap-3">
        {/* Side */}
        <div className="space-y-1.5 min-w-[100px]">
          <Label htmlFor="filter-side" className="text-xs text-muted-foreground">Side</Label>
          <Select
            value={filters.side}
            onValueChange={(value) => updateFilter("side", value as "BUY" | "SELL" | "ALL")}
          >
            <SelectTrigger id="filter-side" className="h-9 text-sm">
              <SelectValue placeholder="All sides" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="BUY">Buy</SelectItem>
              <SelectItem value="SELL">Sell</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* State */}
        <div className="space-y-1.5 min-w-[110px]">
          <Label htmlFor="filter-state" className="text-xs text-muted-foreground">State</Label>
          <Select
            value={filters.state}
            onValueChange={(value) => updateFilter("state", value as EscrowState | "ALL")}
          >
            <SelectTrigger id="filter-state" className="h-9 text-sm">
              <SelectValue placeholder="All states" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All States</SelectItem>
              {ESCROW_STATES.map((state) => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Amount range */}
        <div className="flex items-end gap-2">
          <div className="space-y-1.5 min-w-[88px]">
            <Label htmlFor="filter-min-amount" className="text-xs text-muted-foreground">Min KDA</Label>
            <Input
              id="filter-min-amount"
              type="number"
              step="0.00000001"
              min="0"
              value={filters.minAmount}
              onChange={(e) => updateFilter("minAmount", e.target.value)}
              placeholder="0"
              className="h-9 text-sm font-mono"
            />
          </div>
          <div className="space-y-1.5 min-w-[88px]">
            <Label htmlFor="filter-max-amount" className="text-xs text-muted-foreground">Max KDA</Label>
            <Input
              id="filter-max-amount"
              type="number"
              step="0.00000001"
              min="0"
              value={filters.maxAmount}
              onChange={(e) => updateFilter("maxAmount", e.target.value)}
              placeholder="Max"
              className="h-9 text-sm font-mono"
            />
          </div>
        </div>

        {/* Price range */}
        <div className="flex items-end gap-2">
          <div className="space-y-1.5 min-w-[80px]">
            <Label htmlFor="filter-min-price" className="text-xs text-muted-foreground">Min Price</Label>
            <Input
              id="filter-min-price"
              type="number"
              step="0.01"
              min="0"
              value={filters.minPrice}
              onChange={(e) => updateFilter("minPrice", e.target.value)}
              placeholder="0"
              className="h-9 text-sm font-mono"
            />
          </div>
          <div className="space-y-1.5 min-w-[80px]">
            <Label htmlFor="filter-max-price" className="text-xs text-muted-foreground">Max Price</Label>
            <Input
              id="filter-max-price"
              type="number"
              step="0.01"
              min="0"
              value={filters.maxPrice}
              onChange={(e) => updateFilter("maxPrice", e.target.value)}
              placeholder="Max"
              className="h-9 text-sm font-mono"
            />
          </div>
        </div>

        {/* Payment */}
        <div className="space-y-1.5 min-w-[130px]">
          <Label htmlFor="filter-payment-method" className="text-xs text-muted-foreground">Payment</Label>
          <Select
            value={filters.paymentMethod || "ALL"}
            onValueChange={(value) => updateFilter("paymentMethod", value === "ALL" ? "" : value)}
          >
            <SelectTrigger id="filter-payment-method" className="h-9 text-sm">
              <SelectValue placeholder="All payment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Payment</SelectItem>
              <SelectItem value="USDT">USDT</SelectItem>
              <SelectItem value="USDC">USDC</SelectItem>
              <SelectItem value="BUSD">BUSD</SelectItem>
              <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
              <SelectItem value="PayPal">PayPal</SelectItem>
              <SelectItem value="Wise">Wise</SelectItem>
              <SelectItem value="Revolut">Revolut</SelectItem>
              <SelectItem value="Cash App">Cash App</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Seller (buyer) / Buyer (seller) */}
        {role === "buyer" && (
          <div className="space-y-1.5 min-w-[140px] flex-1 max-w-[200px]">
            <Label htmlFor="filter-seller" className="text-xs text-muted-foreground">Seller</Label>
            <Input
              id="filter-seller"
              value={filters.seller}
              onChange={(e) => updateFilter("seller", e.target.value)}
              placeholder="k:..."
              className="h-9 text-sm font-mono"
            />
          </div>
        )}
        {role === "seller" && (
          <div className="space-y-1.5 min-w-[140px] flex-1 max-w-[200px]">
            <Label htmlFor="filter-buyer" className="text-xs text-muted-foreground">Buyer</Label>
            <Input
              id="filter-buyer"
              value={filters.buyer}
              onChange={(e) => updateFilter("buyer", e.target.value)}
              placeholder="k:..."
              className="h-9 text-sm font-mono"
            />
          </div>
        )}

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-9 gap-1.5 text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="h-3.5 w-3.5" />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
