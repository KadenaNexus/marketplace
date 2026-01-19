import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { sendTestTransfer } from "@/lib/kadena";
import { Wallet, LogOut, AlertCircle, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

export function WalletConnect() {
  const { account, isConnecting, isConnected, isWalletAvailable, error, connect, disconnect } = useWallet();
  const [isSending, setIsSending] = useState(false);

  const handleTestTransfer = async () => {
    if (!account) return;
    setIsSending(true);
    try {
      const requestKey = await sendTestTransfer(account.account, account.publicKey);
      toast.success("10 KDA sent!", { description: `Request key: ${requestKey.slice(0, 16)}...` });
    } catch (e) {
      toast.error("Transfer failed", { description: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setIsSending(false);
    }
  };

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
          onClick={handleTestTransfer}
          disabled={isSending}
          className="gap-2 hidden"
          title="Send 10 KDA to test address to verify node and signing"
        >
          {isSending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Test 10 KDA
        </Button>
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
