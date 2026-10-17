import { useEffect, useState } from "react";
import { MarketLine } from "@/components/MarketTag";
import { TradeFeed, TradeFeedToasts } from "@/components/TradeFeed";
import { PushPrompt } from "@/components/PushPrompt";
import { OpenInLinxCard } from "@/components/OpenInLinx";
import { Link } from "react-router-dom";
import { Bell, Clock, List, Megaphone, Plus, X } from "lucide-react";
import { EscrowActions } from "@/components/EscrowActions";
import { CreatePoolForm } from "@/components/pools/CreatePoolForm";
import { MyPools, PoolMarket } from "@/components/pools/PoolMarket";
import { OfferAlertsButton } from "@/components/OfferAlerts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { useAppChainBalance } from "@/hooks/useAppChainBalance";
import { useNotifications } from "@/hooks/useNotifications";
import { CHAIN_ID } from "@/lib/kadena";
import { ALERTS_COPY } from "@/lib/alertsCopy";
import { cn } from "@/lib/utils";
import type { Lang } from "@/components/NexusLanding";

export type MobileTab = "offers" | "trades" | "new";
type Side = "buyer" | "seller";

const NOTICE_KEY = "nx-v11-notice-hidden"; // new key: the pools news shows again to people who closed the older notice

/** Buy KDA / Sell KDA switch. "Buy" lists sell offers; "Sell" lists buy offers. */
function SideSwitch({ side, onSide, label }: { side: Side; onSide: (s: Side) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
      {(["buyer", "seller"] as const).map((s) => (
        <button
          key={s}
          type="button"
          role="tab"
          aria-selected={side === s}
          onClick={() => onSide(s)}
          className={cn(
            "h-11 rounded-lg text-base font-medium transition-colors",
            side === s ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {s === "buyer" ? "Buy KDA" : "Sell KDA"}
        </button>
      ))}
    </div>
  );
}

/**
 * The marketplace on a phone: three screens (Offers, My trades, New offer) with tabs at the bottom.
 * Trades open full screen (EscrowActions), with the next action in a bar at the bottom.
 */
export function MobileMarket({
  tab, onTab, side, onSide, refreshTrigger, lang, alertsEnabled, avatar,
}: {
  tab: MobileTab; onTab: (t: MobileTab) => void; side: Side; onSide: (s: Side) => void;
  refreshTrigger: number; lang: Lang; alertsEnabled: boolean; avatar?: string | null;
}) {
  const { account } = useWallet();
  const { data: balance } = useAppChainBalance(account?.account);
  const [noticeHidden, setNoticeHidden] = useState(() => { try { return localStorage.getItem(NOTICE_KEY) === "1"; } catch { return false; } });
  // Reload the lists when a notification says something changed (new offer, trade step)
  const { items } = useNotifications();
  const newest = items.reduce((m, i) => Math.max(m, i.id), 0);
  const [bump, setBump] = useState(0);
  useEffect(() => { if (newest) setBump((b) => b + 1); }, [newest]);
  const refresh = refreshTrigger + bump;
  const hideNotice = () => { setNoticeHidden(true); try { localStorage.setItem(NOTICE_KEY, "1"); } catch { /* ignore */ } };

  const tabs: { id: MobileTab; label: string; Icon: typeof List }[] = [
    { id: "offers", label: "Offers", Icon: List },
    { id: "trades", label: "My trades", Icon: Clock },
    { id: "new", label: "New offer", Icon: Plus },
  ];

  return (
    <div className="pb-24">
      <TradeFeedToasts />
      {tab === "offers" && (
        <div className="space-y-4">
          <OpenInLinxCard lang={lang} />
          {!noticeHidden && (
            <div className="flex items-start gap-3 rounded-xl bg-gradient-to-r from-orange-600 to-orange-500 p-3 text-white">
              <Megaphone className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="flex-1 text-sm leading-snug">New: take any amount from an offer. No accept step, no waiting for a deposit.</p>
              <button type="button" onClick={hideNotice} aria-label="Hide this notice" className="-m-1 rounded p-1 hover:bg-white/20"><X className="h-4 w-4" /></button>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="font-display text-3xl font-bold">Offers</h1>
            {balance !== undefined && (
              <p className="text-sm text-muted-foreground tabular-nums">Chain {CHAIN_ID}: {balance.toLocaleString("en-US", { maximumFractionDigits: 4 })} KDA</p>
            )}
          </div>
          <SideSwitch side={side} onSide={onSide} label="What do you want to do" />
          <MarketLine />
          <TradeFeed />
          <PoolMarket key={side} side={side} refreshTrigger={refresh} />
          {alertsEnabled && (
            // the whole strip opens the sign-up form (email + what to be told about)
            <OfferAlertsButton lang={lang}>
              <button type="button" className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border p-3 text-left hover:border-primary">
                <Bell className="h-4 w-4 shrink-0 text-orange-600" />
                <span className="flex-1 text-sm text-muted-foreground">{ALERTS_COPY[lang].strip}</span>
                <span className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">{ALERTS_COPY[lang].signUp}</span>
              </button>
            </OfferAlertsButton>
          )}
        </div>
      )}

      {tab === "trades" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-display text-3xl font-bold">My trades</h1>
            {account && (
              <Link to={`/u/${encodeURIComponent(account.account)}`} className="flex items-center gap-2 text-sm text-primary">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={avatar || "/default-avatar.svg"} alt="" />
                  <AvatarFallback className="bg-muted text-xs">{account.account.slice(2, 4).toUpperCase()}</AvatarFallback>
                </Avatar>
                Profile
              </Link>
            )}
          </div>
          <PushPrompt />
          <MyPools />
          <EscrowActions refreshTrigger={refresh} role="seller" viewMode="mine" />
        </div>
      )}

      {tab === "new" && (
        <div className="space-y-4">
          <h1 className="font-display text-3xl font-bold">New offer</h1>
          <SideSwitch side={side} onSide={onSide} label="Do you want to buy or sell KDA" />
          <p className="text-sm text-muted-foreground">
            {side === "buyer"
              ? "Post how much you want to buy. Sellers take slices of it and lock their KDA; you pay them and they release."
              : "Post a pool of KDA. It is locked when you post; buyers take slices in your min–max range, pay you, and you release each one."}
          </p>
          <CreatePoolForm key={side} role={side} compact onSuccess={() => onTab("trades")} />
        </div>
      )}

      <nav
        aria-label="Marketplace"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => { onTab(id); window.scrollTo({ top: 0 }); }}
            aria-current={tab === id ? "page" : undefined}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium",
              tab === id ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
