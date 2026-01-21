import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Store, ArrowRight } from "lucide-react";

type UserRole = "buyer" | "seller" | null;

interface RoleSelectionProps {
  onSelectRole: (role: UserRole) => void;
}

export function RoleSelection({ onSelectRole }: RoleSelectionProps) {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Choose Your Role</h2>
        <p className="text-muted-foreground">
          Select whether you want to buy or sell KDA
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Buyer Option */}
        <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => onSelectRole("buyer")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-lg bg-primary/20 flex items-center justify-center">
                <ShoppingCart className="h-6 w-6 text-primary" />
              </div>
              I Want to Buy
            </CardTitle>
            <CardDescription>
              Create buy offers and browse available sell offers
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => onSelectRole("buyer")}>
              Continue as Buyer
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>

        {/* Seller Option */}
        <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => onSelectRole("seller")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-lg bg-primary/20 flex items-center justify-center">
                <Store className="h-6 w-6 text-primary" />
              </div>
              I Want to Sell
            </CardTitle>
            <CardDescription>
              Create sell offers and browse available buy offers
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => onSelectRole("seller")}>
              Continue as Seller
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
