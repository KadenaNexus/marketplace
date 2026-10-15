import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WalletConnect } from "@/components/WalletConnect";
import { Shield, Zap, Lock, ArrowRight, CheckCircle2, Users, TrendingUp, Globe, X } from "lucide-react";

export function Dashboard() {
  return (
    <div className="max-w-7xl mx-auto space-y-12">
      {/* Hero Section */}
      <div className="text-center space-y-6 py-8">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-semibold mb-4">
          <Globe className="h-4 w-4" />
          Powered by Kadena Blockchain
        </div>
        <h1 className="text-5xl md:text-6xl font-bold bg-gradient-to-r from-primary via-primary/80 to-primary/60 bg-clip-text text-transparent leading-tight">
          Secure P2P Trading
          <br />
          <span className="text-foreground">Made Simple</span>
        </h1>
        <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
          Trustless peer-to-peer trades secured by Pact smart contracts.
          <br />
          Your funds are controlled by contract logic, not private keys.
        </p>
      </div>

      {/* Why We're Better Than CEX & Binance P2P */}
      <Card className="border-2 border-primary/50 bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <CardHeader className="text-center pb-6">
          <CardTitle className="text-3xl md:text-4xl mb-3">
            Why We're Better Than CEX & Binance P2P
          </CardTitle>
          <CardDescription className="text-lg">
            True decentralization vs. centralized control
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-border">
                  <th className="text-left p-4 font-semibold text-lg">Feature</th>
                  <th className="text-center p-4 font-semibold text-lg bg-primary/10">Kadena P2P Escrow</th>
                  <th className="text-center p-4 font-semibold text-lg bg-destructive/10">Binance P2P</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border hover:bg-muted/50 transition-colors">
                  <td className="p-4 font-medium">Custody Model</td>
                  <td className="p-4 text-center">
                    <CheckCircle2 className="h-6 w-6 text-primary mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">Smart-contract escrow</span>
                  </td>
                  <td className="p-4 text-center">
                    <X className="h-6 w-6 text-destructive mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">Binance-controlled escrow</span>
                  </td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/50 transition-colors">
                  <td className="p-4 font-medium">KYC</td>
                  <td className="p-4 text-center">
                    <CheckCircle2 className="h-6 w-6 text-primary mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">Not required</span>
                  </td>
                  <td className="p-4 text-center">
                    <X className="h-6 w-6 text-destructive mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">Required</span>
                  </td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/50 transition-colors">
                  <td className="p-4 font-medium">Trading Fees</td>
                  <td className="p-4 text-center">
                    <CheckCircle2 className="h-6 w-6 text-primary mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">Zero</span>
                  </td>
                  <td className="p-4 text-center">
                    <X className="h-6 w-6 text-destructive mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">Hidden spreads & fees</span>
                  </td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/50 transition-colors">
                  <td className="p-4 font-medium">Withdrawal Fees</td>
                  <td className="p-4 text-center">
                    <CheckCircle2 className="h-6 w-6 text-primary mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">Zero</span>
                  </td>
                  <td className="p-4 text-center">
                    <X className="h-6 w-6 text-destructive mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">Yes</span>
                  </td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/50 transition-colors">
                  <td className="p-4 font-medium">Price Flexibility</td>
                  <td className="p-4 text-center">
                    <CheckCircle2 className="h-6 w-6 text-primary mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">Above & below market</span>
                  </td>
                  <td className="p-4 text-center">
                    <X className="h-6 w-6 text-destructive mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">Limited</span>
                  </td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/50 transition-colors">
                  <td className="p-4 font-medium">Censorship Risk</td>
                  <td className="p-4 text-center">
                    <CheckCircle2 className="h-6 w-6 text-primary mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">None</span>
                  </td>
                  <td className="p-4 text-center">
                    <X className="h-6 w-6 text-destructive mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">High</span>
                  </td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/50 transition-colors">
                  <td className="p-4 font-medium">Account Suspension</td>
                  <td className="p-4 text-center">
                    <CheckCircle2 className="h-6 w-6 text-primary mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">Impossible</span>
                  </td>
                  <td className="p-4 text-center">
                    <X className="h-6 w-6 text-destructive mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">Common</span>
                  </td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/50 transition-colors">
                  <td className="p-4 font-medium">Transparency</td>
                  <td className="p-4 text-center">
                    <CheckCircle2 className="h-6 w-6 text-primary mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">Fully on-chain</span>
                  </td>
                  <td className="p-4 text-center">
                    <X className="h-6 w-6 text-destructive mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">Platform-controlled</span>
                  </td>
                </tr>
                <tr className="border-b-2 border-border hover:bg-muted/50 transition-colors">
                  <td className="p-4 font-medium">Jurisdiction Risk</td>
                  <td className="p-4 text-center">
                    <CheckCircle2 className="h-6 w-6 text-primary mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">None</span>
                  </td>
                  <td className="p-4 text-center">
                    <X className="h-6 w-6 text-destructive mx-auto" />
                    <span className="text-sm text-muted-foreground block mt-1">Subject to regulation</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-6 p-6 bg-muted/50 rounded-lg border border-border">
            <p className="text-center text-muted-foreground mb-2">
              Binance P2P still relies on centralized trust.
            </p>
            <p className="text-center text-lg font-bold text-primary">
              Kadena P2P Escrow is permissionless, trustless, and unstoppable.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Features Grid */}
      <div className="grid md:grid-cols-3 gap-6">
        <Card className="group hover:shadow-lg hover:border-primary/50 transition-all duration-300">
          <CardHeader className="pb-4">
            <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300">
              <Shield className="h-7 w-7 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl mb-2">Non-Custodial</CardTitle>
            <CardDescription className="text-base">
              Your funds stay in your control. Smart contracts manage the escrow process without holding your assets.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="group hover:shadow-lg hover:border-primary/50 transition-all duration-300">
          <CardHeader className="pb-4">
            <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300">
              <Zap className="h-7 w-7 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl mb-2">Instant Settlement</CardTitle>
            <CardDescription className="text-base">
              Fast and efficient transactions on the Kadena blockchain with near-instant finality.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="group hover:shadow-lg hover:border-primary/50 transition-all duration-300">
          <CardHeader className="pb-4">
            <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300">
              <Lock className="h-7 w-7 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl mb-2">Smart Contract Secured</CardTitle>
            <CardDescription className="text-base">
              Automated escrow with dispute resolution through trusted arbiters for complete protection.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      {/* Benefits Section */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Why Choose Us?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <CheckCircle2 className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold">Zero Custody Risk</p>
                <p className="text-sm text-muted-foreground">Funds are locked in smart contracts, not held by us</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <CheckCircle2 className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold">Transparent Pricing</p>
                <p className="text-sm text-muted-foreground">Set your own rates and payment methods</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <CheckCircle2 className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold">Dispute Resolution</p>
                <p className="text-sm text-muted-foreground">Arbiters ensure fair resolution of any issues</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <CheckCircle2 className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold">Global Access</p>
                <p className="text-sm text-muted-foreground">Trade with anyone, anywhere, anytime</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <TrendingUp className="h-5 w-5 text-primary" />
              How It Works
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 font-bold text-primary">
                1
              </div>
              <div>
                <p className="font-semibold">Connect Your Wallet</p>
                <p className="text-sm text-muted-foreground">Link your Kadena wallet to get started</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 font-bold text-primary">
                2
              </div>
              <div>
                <p className="font-semibold">Choose Your Role</p>
                <p className="text-sm text-muted-foreground">Decide if you want to buy or sell KDA</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 font-bold text-primary">
                3
              </div>
              <div>
                <p className="font-semibold">Create or Browse Offers</p>
                <p className="text-sm text-muted-foreground">Set your terms or find the perfect match</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 font-bold text-primary">
                4
              </div>
              <div>
                <p className="font-semibold">Trade Securely</p>
                <p className="text-sm text-muted-foreground">Complete transactions with escrow protection</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Get Started CTA */}
      <Card className="border-2 border-primary/50 bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <CardHeader className="text-center pb-4">
          <CardTitle className="text-3xl mb-2">Ready to Start Trading?</CardTitle>
          <CardDescription className="text-lg">
            Connect your wallet and join the decentralized P2P trading revolution
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <div className="w-full max-w-md">
            <WalletConnect />
          </div>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            By connecting, you agree to use our platform responsibly. All trades are executed on-chain with smart contract security.
          </p>
        </CardContent>
      </Card>

      {/* Flow Diagram */}
      <Card className="border-2">
        <CardHeader>
          <CardTitle className="text-center text-2xl mb-2">Escrow Transaction Flow</CardTitle>
          <CardDescription className="text-center">
            Understand how your trades are protected at every step
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2 text-sm font-medium flex-wrap">
              <span className="px-4 py-2 bg-warning/20 text-warning rounded-lg border border-warning/30">
                CREATED
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="px-4 py-2 bg-warning/20 text-warning rounded-lg border border-warning/30">
                ACCEPTED
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="px-4 py-2 bg-primary/20 text-primary rounded-lg border border-primary/30">
                FUNDED
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="px-4 py-2 bg-primary/20 text-primary rounded-lg border border-primary/30">
                PAID
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="px-4 py-2 bg-success/20 text-success rounded-lg border border-success/30">
                COMPLETED
              </span>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm font-medium flex-wrap pt-2">
              <span className="px-4 py-2 bg-destructive/20 text-destructive rounded-lg border border-destructive/30">
                REFUNDED
              </span>
              <span className="text-muted-foreground">or</span>
              <span className="px-4 py-2 bg-muted text-muted-foreground rounded-lg border">
                CLOSED
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
