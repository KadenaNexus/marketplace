import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { WalletConnect } from "@/components/WalletConnect";
import { CreateOfferForm } from "@/components/CreateOfferForm";
import { EscrowActions } from "@/components/EscrowActions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWallet } from "@/hooks/useWallet";
import { fetchProfile } from "@/lib/profileApi";
import { CHAIN_ID, NETWORK_ID } from "@/lib/kadena";
import { Shield, Zap, Lock } from "lucide-react";

const Index = () => {
  const { account, isConnected } = useWallet();
  const [activeTab, setActiveTab] = useState("create");
  const [refreshManageTrigger, setRefreshManageTrigger] = useState(0);

  const { data: profile } = useQuery({
    queryKey: ["profile", account?.account],
    queryFn: () => fetchProfile(account!.account),
    enabled: !!account && isConnected,
  });

  const handleOfferCreated = () => {
    setRefreshManageTrigger((r) => r + 1);
    setActiveTab("manage");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="font-bold text-lg">Kadena P2P Escrow</h1>
              <p className="text-xs text-muted-foreground font-mono">
                {NETWORK_ID} • Chain {CHAIN_ID}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
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
        {/* Hero Section */}
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold mb-3">
            Non-Custodial P2P Escrow
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Trustless peer-to-peer trades secured by Pact smart contracts on Kadena.
            Your funds are controlled by contract logic, not private keys.
          </p>
          
          {/* Features */}
          <div className="flex flex-wrap justify-center gap-6 mt-6 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Shield className="h-4 w-4 text-primary" />
              <span>Non-Custodial</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Zap className="h-4 w-4 text-primary" />
              <span>Instant Settlement</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Lock className="h-4 w-4 text-primary" />
              <span>Smart Contract Secured</span>
            </div>
          </div>
        </div>

        {/* Contract Info */}
        {/* <div className="bg-muted/50 rounded-lg p-4 mb-8 max-w-2xl mx-auto">
          <p className="text-sm text-muted-foreground text-center">
            Contract: <code className="font-mono text-foreground">{CONTRACT_NAMESPACE}.{CONTRACT_MODULE}</code>
          </p>
        </div> */}

        {/* Main Content */}
        <div className="max-w-2xl mx-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="create">Create Offer</TabsTrigger>
              <TabsTrigger value="manage">Manage Escrow</TabsTrigger>
            </TabsList>
            
            <TabsContent value="create">
              <CreateOfferForm onSuccess={handleOfferCreated} />
            </TabsContent>
            
            <TabsContent value="manage">
              <EscrowActions refreshTrigger={refreshManageTrigger} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Flow Diagram */}
        <div className="mt-12 max-w-3xl mx-auto">
          <h3 className="text-center text-lg font-semibold mb-4 text-muted-foreground">
            Escrow Flow
          </h3>
          <div className="flex items-center justify-center gap-2 text-xs font-mono flex-wrap">
            <span className="px-3 py-1.5 bg-warning/20 text-warning rounded">CREATED</span>
            <span className="text-muted-foreground">→</span>
            <span className="px-3 py-1.5 bg-warning/20 text-warning rounded">ACCEPTED</span>
            <span className="text-muted-foreground">→</span>
            <span className="px-3 py-1.5 bg-primary/20 text-primary rounded">FUNDED</span>
            <span className="text-muted-foreground">→</span>
            <span className="px-3 py-1.5 bg-primary/20 text-primary rounded">PAID</span>
            <span className="text-muted-foreground">→</span>
            <span className="px-3 py-1.5 bg-success/20 text-success rounded">COMPLETED</span>
            <span className="text-muted-foreground mx-1">|</span>
            <span className="px-3 py-1.5 bg-destructive/20 text-destructive rounded">REFUNDED</span>
            <span className="text-muted-foreground">/</span>
            <span className="px-3 py-1.5 bg-muted text-muted-foreground rounded">CLOSED</span>
          </div>
        </div>
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
