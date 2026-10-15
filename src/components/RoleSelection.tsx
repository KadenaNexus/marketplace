import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Store, ArrowRight, TrendingUp, Shield, Zap, Users } from "lucide-react";

type UserRole = "buyer" | "seller" | null;

interface RoleSelectionProps {
  onSelectRole: (role: UserRole) => void;
}

export function RoleSelection({ onSelectRole }: RoleSelectionProps) {
  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header Section */}
      <div className="text-center space-y-4 mb-12">
        <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
          Welcome to P2P Trading
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Choose your role to start trading KDA securely with escrow protection
        </p>
      </div>

      {/* Role Cards */}
      <div className="grid md:grid-cols-2 gap-8">
        {/* Buyer Option */}
        <Card 
          className="cursor-pointer group hover:shadow-xl hover:shadow-primary/10 transition-all duration-300 border-2 hover:border-primary/50 relative overflow-hidden"
          onClick={() => onSelectRole("buyer")}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between mb-4">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300">
                <ShoppingCart className="h-8 w-8 text-primary-foreground" />
              </div>
              <div className="px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-semibold">
                Buyer
              </div>
            </div>
            <CardTitle className="text-3xl font-bold mb-3">
              I Want to Buy
            </CardTitle>
            <CardDescription className="text-base">
              Purchase KDA from sellers with secure escrow protection
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="h-4 w-4 text-primary" />
                </div>
                <span className="text-muted-foreground">Browse competitive sell offers</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Shield className="h-4 w-4 text-primary" />
                </div>
                <span className="text-muted-foreground">Secure escrow protection for all trades</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Zap className="h-4 w-4 text-primary" />
                </div>
                <span className="text-muted-foreground">Fast and instant transactions</span>
              </div>
            </div>
            <Button 
              size="lg" 
              className="w-full group-hover:scale-105 transition-transform duration-300" 
              onClick={(e) => { e.stopPropagation(); onSelectRole("buyer"); }}
            >
              Continue as Buyer
              <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </CardContent>
        </Card>

        {/* Seller Option */}
        <Card 
          className="cursor-pointer group hover:shadow-xl hover:shadow-primary/10 transition-all duration-300 border-2 hover:border-primary/50 relative overflow-hidden"
          onClick={() => onSelectRole("seller")}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between mb-4">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300">
                <Store className="h-8 w-8 text-primary-foreground" />
              </div>
              <div className="px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-semibold">
                Seller
              </div>
            </div>
            <CardTitle className="text-3xl font-bold mb-3">
              I Want to Sell
            </CardTitle>
            <CardDescription className="text-base">
              Sell your KDA to buyers with guaranteed payment protection
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Users className="h-4 w-4 text-primary" />
                </div>
                <span className="text-muted-foreground">Reach buyers looking for KDA</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Shield className="h-4 w-4 text-primary" />
                </div>
                <span className="text-muted-foreground">Escrow ensures payment before release</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Zap className="h-4 w-4 text-primary" />
                </div>
                <span className="text-muted-foreground">Set your own price and payment methods</span>
              </div>
            </div>
            <Button 
              size="lg" 
              className="w-full group-hover:scale-105 transition-transform duration-300" 
              onClick={(e) => { e.stopPropagation(); onSelectRole("seller"); }}
            >
              Continue as Seller
              <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Info Section */}
      <div className="mt-12 text-center">
        <p className="text-sm text-muted-foreground">
          You can switch between buyer and seller roles at any time
        </p>
      </div>
    </div>
  );
}
