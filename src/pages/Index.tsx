import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { WalletConnect } from "@/components/WalletConnect";
import { Dashboard } from "@/components/Dashboard";
import { RoleSelection } from "@/components/RoleSelection";
import { BuyerView } from "@/components/BuyerView";
import { SellerView } from "@/components/SellerView";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { fetchProfile } from "@/lib/profileApi";
import { CHAIN_ID, NETWORK_ID } from "@/lib/kadena";
import { ShieldCheck, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";

type UserRole = "buyer" | "seller" | null;

const Index = () => {
  const { account, isConnected } = useWallet();
  const [role, setRole] = useState<UserRole>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const { data: profile } = useQuery({
    queryKey: ["profile", account?.account],
    queryFn: () => fetchProfile(account!.account),
    enabled: !!account && isConnected,
  });

  const handleRoleSelect = (selectedRole: UserRole) => {
    setRole(selectedRole);
  };

  const handleRoleChange = () => {
    setRole(null);
  };

  const handleOfferCreated = () => {
    setRefreshTrigger((r) => r + 1);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="font-bold text-lg">Kadena P2P Escrow</h1>
              <p className="text-xs text-muted-foreground font-mono">
                {NETWORK_ID} • Chain {CHAIN_ID}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            {isConnected && account && (
              <Link
                to={`/u/${encodeURIComponent(account.account)}`}
                className="hover:opacity-80 transition-opacity"
                title="View profile"
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage src={profile?.avatar || "/default-avatar.svg"} alt="" />
                  <AvatarFallback className="text-xs bg-muted">
                    {profile?.username?.slice(0, 2).toUpperCase() || account.account.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Link>
            )}
            <WalletConnect />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {!isConnected ? (
          <Dashboard />
        ) : !role ? (
          <RoleSelection onSelectRole={handleRoleSelect} />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-end">
              <Button variant="outline" size="sm" onClick={handleRoleChange} className="gap-2">
                <LogOut className="h-4 w-4" />
                Change Role
              </Button>
            </div>
            {role === "buyer" ? (
              <BuyerView refreshTrigger={refreshTrigger} />
            ) : (
              <SellerView refreshTrigger={refreshTrigger} />
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-16 py-6">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>
            Built on Kadena • Powered by Pact Smart Contracts
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
