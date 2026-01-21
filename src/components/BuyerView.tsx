import { useState, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreateOfferForm } from "@/components/CreateOfferForm";
import { EscrowActions } from "@/components/EscrowActions";
import { OfferFiltersComponent, type OfferFilters } from "@/components/OfferFilters";
import { Plus, ShoppingCart } from "lucide-react";

interface BuyerViewProps {
  refreshTrigger?: number;
}

export function BuyerView({ refreshTrigger = 0 }: BuyerViewProps) {
  const [activeTab, setActiveTab] = useState("browse");
  const [filters, setFilters] = useState<OfferFilters>({
    state: "ALL",
    minAmount: "",
    maxAmount: "",
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
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="browse" className="gap-2">
            Browse Sell Offers
          </TabsTrigger>
          <TabsTrigger value="create" className="gap-2">
            <Plus className="h-4 w-4" />
            Create Buy Offer
          </TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="space-y-4">
          <OfferFiltersComponent 
            filters={filters} 
            onFiltersChange={setFilters}
            role="buyer"
          />
          <EscrowActions 
            refreshTrigger={refreshTrigger}
            filters={filters}
            role="buyer"
          />
        </TabsContent>

        <TabsContent value="create">
          <CreateOfferForm 
            onSuccess={handleOfferCreated}
            role="buyer"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
