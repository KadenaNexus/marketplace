import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreateOfferForm } from "@/components/CreateOfferForm";
import { EscrowActions } from "@/components/EscrowActions";
import { OfferFiltersComponent, type OfferFilters } from "@/components/OfferFilters";
import { Plus, Store, Activity, Sparkles } from "lucide-react";

interface SellerViewProps {
  refreshTrigger?: number;
}

export function SellerView({ refreshTrigger = 0 }: SellerViewProps) {
  const [activeTab, setActiveTab] = useState("new");
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
    minStars: "",
    onlineNow: false,
  });

  const handleOfferCreated = () => {
    setActiveTab("new");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
          <Store className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Seller Mode</h2>
          <p className="text-sm text-muted-foreground">
            Create sell offers and browse available buy offers
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="new" className="gap-2">
            <Sparkles className="h-4 w-4" />
            New offers - Marketplace
          </TabsTrigger>
          <TabsTrigger value="mypast">All my past offers</TabsTrigger>
          <TabsTrigger value="active" className="gap-2">
            <Activity className="h-4 w-4" />
            Active Trades
          </TabsTrigger>
          <TabsTrigger value="create" className="gap-2">
            <Plus className="h-4 w-4" />
            Create new offer
          </TabsTrigger>
        </TabsList>

        {/* Shared Filters - shown for new, mypast, and active tabs */}
        {(activeTab === "new" || activeTab === "mypast" || activeTab === "active") && (
          <div className="mt-4">
            <OfferFiltersComponent 
              filters={filters} 
              onFiltersChange={setFilters}
              role="seller"
            />
          </div>
        )}

        <TabsContent value="new" className="space-y-4 mt-4">
          <EscrowActions
            refreshTrigger={refreshTrigger}
            filters={filters}
            role="seller"
            viewMode="new"
          />
        </TabsContent>

        <TabsContent value="mypast" className="space-y-4 mt-4">
          <EscrowActions
            refreshTrigger={refreshTrigger}
            filters={filters}
            role="seller"
            viewMode="myPast"
          />
        </TabsContent>

        <TabsContent value="active" className="space-y-4 mt-4">
          <EscrowActions 
            refreshTrigger={refreshTrigger}
            filters={filters}
            role="seller"
            viewMode="active"
          />
        </TabsContent>

        <TabsContent value="create" className="mt-4">
          <CreateOfferForm 
            onSuccess={handleOfferCreated}
            role="seller"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
