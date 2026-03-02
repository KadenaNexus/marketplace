import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreateOfferForm } from "@/components/CreateOfferForm";
import { EscrowActions } from "@/components/EscrowActions";
import { OfferFiltersComponent, type OfferFilters } from "@/components/OfferFilters";
import { Plus, ShoppingCart, Activity } from "lucide-react";

interface BuyerViewProps {
  refreshTrigger?: number;
}

export function BuyerView({ refreshTrigger = 0 }: BuyerViewProps) {
  const [activeTab, setActiveTab] = useState("browse");
  const [filters, setFilters] = useState<OfferFilters>({
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

  const handleOfferCreated = () => {
    setActiveTab("browse");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
          <ShoppingCart className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Buyer Mode</h2>
          <p className="text-sm text-muted-foreground">
            Create buy offers and browse available sell offers
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="browse">All Sell Offers</TabsTrigger>
          <TabsTrigger value="active" className="gap-2">
            <Activity className="h-4 w-4" />
            Active Trades
          </TabsTrigger>
          <TabsTrigger value="my">My Offers</TabsTrigger>
          <TabsTrigger value="create" className="gap-2">
            <Plus className="h-4 w-4" />
            Create Offer
          </TabsTrigger>
        </TabsList>

        {/* Shared Filters - shown for browse, active, and my tabs */}
        {(activeTab === "browse" || activeTab === "my" || activeTab === "active") && (
          <div className="mt-4">
            <OfferFiltersComponent 
              filters={filters} 
              onFiltersChange={setFilters}
              role="buyer"
            />
          </div>
        )}

        <TabsContent value="browse" className="space-y-4 mt-4">
          <EscrowActions 
            refreshTrigger={refreshTrigger}
            filters={filters}
            role="buyer"
            viewMode="all"
          />
        </TabsContent>

        <TabsContent value="active" className="space-y-4 mt-4">
          <EscrowActions 
            refreshTrigger={refreshTrigger}
            filters={filters}
            role="buyer"
            viewMode="active"
          />
        </TabsContent>

        <TabsContent value="my" className="space-y-4 mt-4">
          <EscrowActions 
            refreshTrigger={refreshTrigger}
            filters={filters}
            role="buyer"
            viewMode="my"
          />
        </TabsContent>

        <TabsContent value="create" className="mt-4">
          <CreateOfferForm 
            onSuccess={handleOfferCreated}
            role="buyer"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
