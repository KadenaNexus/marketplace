import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WalletConnect } from "@/components/WalletConnect";
import { Shield, Zap, Lock } from "lucide-react";

export function Dashboard() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Hero Section */}
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Kadena P2P Escrow</h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Trustless peer-to-peer trades secured by Pact smart contracts on Kadena.
          Your funds are controlled by contract logic, not private keys.
        </p>
      </div>

      {/* Features */}
      <div className="grid md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center mb-2">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <CardTitle>Non-Custodial</CardTitle>
            <CardDescription>
              Your funds stay in your control. Smart contracts manage the escrow process.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center mb-2">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <CardTitle>Instant Settlement</CardTitle>
            <CardDescription>
              Fast and efficient transactions on the Kadena blockchain.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center mb-2">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <CardTitle>Smart Contract Secured</CardTitle>
            <CardDescription>
              Automated escrow with dispute resolution through arbiters.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      {/* Get Started */}
      <Card className="border-primary/50">
        <CardHeader>
          <CardTitle>Get Started</CardTitle>
          <CardDescription>
            Connect your wallet to start trading on Kadena P2P Escrow
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <WalletConnect />
        </CardContent>
      </Card>

      {/* Flow Diagram */}
      <Card>
        <CardHeader>
          <CardTitle className="text-center">Escrow Flow</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}
