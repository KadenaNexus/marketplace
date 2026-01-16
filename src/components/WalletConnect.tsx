import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { Wallet, LogOut, AlertCircle } from "lucide-react";

export function WalletConnect() {
  const { account, isConnecting, isConnected, isWalletAvailable, error, connect, disconnect } = useWallet();

  const shortenAddress = (address: string) => {
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  };

  if (!isWalletAvailable) {
    return (
      <div className="flex items-center gap-2 text-warning">
        <AlertCircle className="h-4 w-4" />
        <a 
          href="https://www.ecko.finance/wallet" 
          target="_blank" 
          rel="noopener noreferrer"
          className="underline hover:no-underline"
        >
          Install Ecko Wallet
        </a>
      </div>
    );
  }

  if (isConnected && account) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end">
          <span className="text-xs text-muted-foreground">Connected</span>
          <span className="font-mono text-sm text-primary">
            {shortenAddress(account.account)}
          </span>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={disconnect}
          className="gap-2"
        >
          <LogOut className="h-4 w-4" />
          Disconnect
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
        {isConnecting ? "Connecting..." : "Connect Wallet"}
      </Button>
      {error && (
        <span className="text-xs text-destructive">{error}</span>
      )}
    </div>
  );
}
