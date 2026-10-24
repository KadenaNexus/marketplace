import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { useV11ChainBalances } from "@/hooks/useAppChainBalance";
import { Wallet, LogOut, AlertCircle } from "lucide-react";
import { linxStoreLink } from "./OpenInLinx";
import { useLang } from "./NexusLanding";
import { SignInButton, useSignIn } from "./SignIn";

/** `inHeader`: on phones the button says just "Connect" so the header fits on one line. */
export function WalletConnect({ inHeader = false }: { inHeader?: boolean } = {}) {
  const { account, isConnecting, isConnected, isWalletAvailable, error, connect, disconnect } = useWallet();
  const { data: chainBalances } = useV11ChainBalances(isConnected ? account?.account : undefined);
  const [lang] = useLang();
  const { canSignIn } = useSignIn(); // on phones the Sign in button takes the address's place until signed in
  const t = lang === "ar"
    ? { short: "ربط", full: "اربط المحفظة", connecting: "جارٍ الربط..." }
    : { short: "Connect", full: "Connect Wallet", connecting: "Connecting..." };

  const shortenAddress = (address: string) => {
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  };

  if (!isWalletAvailable) {
    return (
      <div className="flex items-center gap-2 text-warning">
        <AlertCircle className="h-4 w-4" />
        <a 
          href={linxStoreLink()}
          target="_blank" 
          rel="noopener noreferrer"
          className="underline hover:no-underline"
        >
          Install Linx Wallet
        </a>
      </div>
    );
  }

  if (isConnected && account) {
    return (
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className={`${canSignIn ? "hidden sm:flex" : "flex"} min-w-0 flex-col items-end`}>
          <span className="hidden text-xs text-muted-foreground sm:inline">Connected</span>
          <span className="font-mono text-sm text-primary whitespace-nowrap" title={account.account}>
            <span className="hidden sm:inline">{shortenAddress(account.account)}</span>
            <span className="sm:hidden">{`${account.account.slice(0, 6)}…${account.account.slice(-4)}`}</span>
          </span>
          {chainBalances && (
            <span className="hidden whitespace-nowrap text-[11px] text-muted-foreground tabular-nums sm:inline" title="Offers in USDT, USDC, BRO and FLUX use KDA on chain 1; offers in kb-USDC, kb-ETH and kb-USDT use KDA on chain 2. Your wallet may show a total across all chains.">
              {chainBalances.map((b) => `Chain ${b.chain}: ${b.balance.toLocaleString("en-US", { maximumFractionDigits: 4 })} KDA`).join(" · ")}
            </span>
          )}
        </div>
        <SignInButton />
        <Button 
          variant="outline" 
          size="sm" 
          onClick={disconnect}
          className="shrink-0 gap-2 px-2 sm:px-3"
          aria-label="Disconnect"
          title="Disconnect"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Disconnect</span>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button 
        onClick={connect} 
        disabled={isConnecting}
        className="gap-2"
      >
        <Wallet className="h-4 w-4" />
        {isConnecting ? t.connecting : inHeader ? <><span className="sm:hidden">{t.short}</span><span className="hidden sm:inline">{t.full}</span></> : t.full}
      </Button>
      {error && (
        <span className="text-xs text-destructive">{error}</span>
      )}
    </div>
  );
}
