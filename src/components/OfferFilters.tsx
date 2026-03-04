import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { X, ChevronDown, Filter } from "lucide-react";
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
  const [isOpen, setIsOpen] = useState(false);
  
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
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-0 h-auto hover:bg-transparent">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-primary" />
                <span className="font-semibold">Filters</span>
                {hasActiveFilters && (
                  <span className="px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary">
                    Active
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {hasActiveFilters && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={(e) => {
                      e.stopPropagation();
                      clearFilters();
                    }} 
                    className="gap-1 h-7"
                  >
                    <X className="h-3 w-3" />
                    Clear
                  </Button>
                )}
                <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </div>
            </Button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent className="overflow-hidden">
          <CardContent className="pt-0 pb-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Side Filter */}
            <div className="space-y-2">
              <Label htmlFor="filter-side">Side</Label>
              <Select
                value={filters.side}
                onValueChange={(value) => updateFilter("side", value as "BUY" | "SELL" | "ALL")}
              >
                <SelectTrigger id="filter-side">
                  <SelectValue placeholder="All sides" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Sides</SelectItem>
                  <SelectItem value="BUY">Buy</SelectItem>
                  <SelectItem value="SELL">Sell</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* State Filter */}
            <div className="space-y-2">
              <Label htmlFor="filter-state">State</Label>
              <Select
                value={filters.state}
                onValueChange={(value) => updateFilter("state", value as EscrowState | "ALL")}
              >
                <SelectTrigger id="filter-state">
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

            {/* Min Amount */}
            <div className="space-y-2">
              <Label htmlFor="filter-min-amount">Min Amount (KDA)</Label>
              <Input
                id="filter-min-amount"
                type="number"
                step="0.00000001"
                min="0"
                value={filters.minAmount}
                onChange={(e) => updateFilter("minAmount", e.target.value)}
                placeholder="0.00"
                className="font-mono"
              />
            </div>

            {/* Max Amount */}
            <div className="space-y-2">
              <Label htmlFor="filter-max-amount">Max Amount (KDA)</Label>
              <Input
                id="filter-max-amount"
                type="number"
                step="0.00000001"
                min="0"
                value={filters.maxAmount}
                onChange={(e) => updateFilter("maxAmount", e.target.value)}
                placeholder="No limit"
                className="font-mono"
              />
            </div>

            {/* Min Price */}
            <div className="space-y-2">
              <Label htmlFor="filter-min-price">Min Price</Label>
              <Input
                id="filter-min-price"
                type="number"
                step="0.01"
                min="0"
                value={filters.minPrice}
                onChange={(e) => updateFilter("minPrice", e.target.value)}
                placeholder="0.00"
                className="font-mono"
              />
            </div>

            {/* Max Price */}
            <div className="space-y-2">
              <Label htmlFor="filter-max-price">Max Price</Label>
              <Input
                id="filter-max-price"
                type="number"
                step="0.01"
                min="0"
                value={filters.maxPrice}
                onChange={(e) => updateFilter("maxPrice", e.target.value)}
                placeholder="No limit"
                className="font-mono"
              />
            </div>

            {/* Payment Method */}
            <div className="space-y-2">
              <Label htmlFor="filter-payment-method">Payment Method</Label>
              <Select
                value={filters.paymentMethod || "ALL"}
                onValueChange={(value) => updateFilter("paymentMethod", value === "ALL" ? "" : value)}
              >
                <SelectTrigger id="filter-payment-method">
                  <SelectValue placeholder="All payment methods" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Payment Methods</SelectItem>
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

            {/* Seller Filter (for buyers) */}
            {role === "buyer" && (
              <div className="space-y-2">
                <Label htmlFor="filter-seller">Seller Address</Label>
                <Input
                  id="filter-seller"
                  value={filters.seller}
                  onChange={(e) => updateFilter("seller", e.target.value)}
                  placeholder="k:..."
                  className="font-mono text-sm"
                />
              </div>
            )}

            {/* Buyer Filter (for sellers) */}
            {role === "seller" && (
              <div className="space-y-2">
                <Label htmlFor="filter-buyer">Buyer Address</Label>
                <Input
                  id="filter-buyer"
                  value={filters.buyer}
                  onChange={(e) => updateFilter("buyer", e.target.value)}
                  placeholder="k:..."
                  className="font-mono text-sm"
                />
              </div>
            )}
          </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
