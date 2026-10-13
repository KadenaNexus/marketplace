import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { WalletConnect } from "@/components/WalletConnect";
import { AppLogo } from "@/components/AppLogo";
import NexusLanding, { useLang } from "@/components/NexusLanding";
import { OfferAlertsButton, useAlertsStatus } from "@/components/OfferAlerts";
import { ALERTS_COPY } from "@/lib/alertsCopy";
import { RoleSelection } from "@/components/RoleSelection";
import { EscrowActions } from "@/components/EscrowActions";
import { BuyerView } from "@/components/BuyerView";
import { SellerView } from "@/components/SellerView";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { fetchProfile } from "@/lib/profileApi";
import { CHAIN_ID, NETWORK_ID, PLATFORM_ARBITER, readEscrow } from "@/lib/kadena";
import { LogOut, Shield, Megaphone, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationBell } from "@/components/NotificationBell";
import { toast } from "sonner";

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

  const isArbiter = !!account && account.account === PLATFORM_ARBITER;

  // Offer alerts: sign-up strip, and links from alert emails (?offer=ID)
  const [lang] = useLang();
  const alerts = useAlertsStatus();
  const [params] = useSearchParams();
  const linkedOffer = params.get("offer");
  // Links to an offer or trade (?offer=ID) from alert emails and notifications: an open offer opens on the
  // side that can accept it; a trade you are part of opens in Active Trades on the home view.
  const linkHandled = useRef<string | null>(null);
  useEffect(() => {
    if (!linkedOffer || !isConnected || !account || linkHandled.current === linkedOffer) return;
    linkHandled.current = linkedOffer;
    const me = account.account;
    readEscrow(linkedOffer)
      .then((e) => {
        if (!e) return toast.info(ALERTS_COPY[lang].offerGone);
        if (e.state === "CREATED" && e.creator !== me) setRole(e.side === "SELL" ? "buyer" : "seller");
        else if (e.creator === me || e.buyer === me || e.seller === me) setRole(null);
        else toast.info(ALERTS_COPY[lang].offerGone);
      })
      .catch(() => {});
  }, [linkedOffer, isConnected, account, lang]);

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
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-y-3 px-4 py-4">
          <AppLogo />
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-4">
            <span className="hidden rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground sm:inline-flex">
              {NETWORK_ID === "mainnet01" ? "Mainnet" : NETWORK_ID} · Chain {CHAIN_ID}
            </span>
            <ThemeToggle />
            <NotificationBell />
            {isArbiter && (
              <Link to="/admin" title="Admin / Arbiter panel">
                <Button variant="outline" size="sm" className="gap-1.5 px-2 sm:px-3" aria-label="Admin">
                  <Shield className="h-4 w-4" />
                  <span className="hidden sm:inline">Admin</span>
                </Button>
              </Link>
            )}
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

      <main className={isConnected ? "container mx-auto px-4 py-8" : "w-full"}>
        {!isConnected ? (
          <NexusLanding walletAction={<WalletConnect />} fromAlert={!!linkedOffer} />
        ) : (
          <>
            {/* Top announcement — visible after sign-in (orange theme) */}
            <Card className="mb-8 border-orange-500/40 bg-gradient-to-r from-orange-600 via-orange-500 to-orange-400 dark:from-orange-700 dark:via-orange-600 dark:to-orange-500">
              <CardContent className="flex flex-col sm:flex-row gap-3 sm:items-start pt-6">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/20">
                  <Megaphone className="h-5 w-5 text-white" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-white">Expanding the Marketplace</h2>
                  <p className="text-sm text-white/95 leading-relaxed">
                    We are integrating additional Kadena ecosystem tokens — including $BRO, $HERON, $KISHK, $FLUX, $CHIPSKDA, $KWATT, and $KADPAD — with more tokens coming soon.
                  </p>
                </div>
              </CardContent>
            </Card>

            {alerts.data?.enabled && (
              <div className="mb-8 flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between" dir={lang === "ar" ? "rtl" : "ltr"}>
                <p className="flex items-center gap-2 text-sm">
                  <Bell className="h-4 w-4 shrink-0 text-primary" />
                  {ALERTS_COPY[lang].strip}
                </p>
                <OfferAlertsButton lang={lang} className="shrink-0" />
              </div>
            )}

            {!role ? (
              <div className="space-y-10">
                {/* My active trades: seller or buyer, state in progress */}
                <section>
                  <EscrowActions refreshTrigger={refreshTrigger} viewMode="active" role="seller" />
                </section>
                <RoleSelection onSelectRole={handleRoleSelect} />
              </div>
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
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-16 py-6">
        <div className="container mx-auto flex flex-col items-center gap-3 px-4 text-center text-sm text-muted-foreground">
          <p>Built on Kadena • Powered by Pact Smart Contracts</p>
          <nav aria-label="Kadena Nexus links" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <a className="transition-colors hover:text-foreground" href="https://kadena.ws/">
              Part of Kadena Nexus
            </a>
            <span aria-hidden="true">·</span>
            <a className="transition-colors hover:text-foreground" href="https://github.com/KadenaNexus">
              Kadena Nexus on GitHub
            </a>
            <span aria-hidden="true">·</span>
            <a className="transition-colors hover:text-foreground" href="https://nodes.kadena.ws/">
              Network Monitor
            </a>
            <span aria-hidden="true">·</span>
            <a className="transition-colors hover:text-foreground" href="https://adoption.kadena.ws/">
              Adoption Index
            </a>
            <span aria-hidden="true">·</span>
            <a className="transition-colors hover:text-foreground" href="https://earn.kadena.ws/">
              Kadena Earn
            </a>
            <span aria-hidden="true">·</span>
            <a className="transition-colors hover:text-foreground" href="https://quantum.kadena.ws/">
              Quantum-Safe Kadena
            </a>
            <span aria-hidden="true">·</span>
            <a className="transition-colors hover:text-foreground" href="https://kadenadevs.kadena.ws/">
              Kadena Devs
            </a>
            <span aria-hidden="true">·</span>
            <a className="transition-colors hover:text-foreground" href="https://kadena.ws/community-edition/">
              Kadena Community Edition
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
};

export default Index;
