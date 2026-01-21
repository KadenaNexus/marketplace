import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EscrowState } from "@/lib/kadena";

export interface OfferFilters {
  state: EscrowState | "ALL";
  minAmount: string;
  maxAmount: string;
  seller: string;
  buyer: string;
}

interface OfferFiltersProps {
  filters: OfferFilters;
  onFiltersChange: (filters: OfferFilters) => void;
  role: "buyer" | "seller";
}

const ESCROW_STATES: EscrowState[] = ["CREATED", "ACCEPTED", "FUNDED", "PAID", "COMPLETED", "REFUNDED", "CLOSED"];

export function OfferFiltersComponent({ filters, onFiltersChange, role }: OfferFiltersProps) {
  const updateFilter = <K extends keyof OfferFilters>(key: K, value: OfferFilters[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const clearFilters = () => {
    onFiltersChange({
      state: "ALL",
      minAmount: "",
      maxAmount: "",
      seller: "",
      buyer: "",
    });
  };

  const hasActiveFilters = 
    filters.state !== "ALL" ||
    filters.minAmount !== "" ||
    filters.maxAmount !== "" ||
    filters.seller !== "" ||
    filters.buyer !== "";

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">Filters</Label>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-2">
                <X className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
        </div>
      </CardContent>
    </Card>
  );
}
