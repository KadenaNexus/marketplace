import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreateOfferForm } from "@/components/CreateOfferForm";
import { EscrowActions } from "@/components/EscrowActions";
import { OfferFiltersComponent, type OfferFilters } from "@/components/OfferFilters";
import { Plus, Store } from "lucide-react";

interface SellerViewProps {
  refreshTrigger?: number;
}

export function SellerView({ refreshTrigger = 0 }: SellerViewProps) {
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
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="browse">All Buy Offers</TabsTrigger>
          <TabsTrigger value="my">My Offers</TabsTrigger>
          <TabsTrigger value="create" className="gap-2">
            <Plus className="h-4 w-4" />
            Create Offer
          </TabsTrigger>
        </TabsList>

        {/* Shared Filters - shown for browse and my tabs */}
        {(activeTab === "browse" || activeTab === "my") && (
          <div className="mt-4">
            <OfferFiltersComponent 
              filters={filters} 
              onFiltersChange={setFilters}
              role="seller"
            />
          </div>
        )}

        <TabsContent value="browse" className="space-y-4 mt-4">
          <EscrowActions 
            refreshTrigger={refreshTrigger}
            filters={filters}
            role="seller"
            viewMode="all"
          />
        </TabsContent>

        <TabsContent value="my" className="space-y-4 mt-4">
          <EscrowActions 
            refreshTrigger={refreshTrigger}
            filters={filters}
            role="seller"
            viewMode="my"
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
