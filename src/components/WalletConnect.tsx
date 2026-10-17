import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { useAppChainBalance } from "@/hooks/useAppChainBalance";
import { CHAIN_ID } from "@/lib/kadena";
import { sendTestTransfer } from "@/lib/kadena";
import { Wallet, LogOut, AlertCircle, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { linxStoreLink } from "./OpenInLinx";
import { useLang } from "./NexusLanding";

/** `inHeader`: on phones the button says just "Connect" so the header fits on one line. */
export function WalletConnect({ inHeader = false }: { inHeader?: boolean } = {}) {
  const { account, isConnecting, isConnected, isWalletAvailable, error, connect, disconnect } = useWallet();
  const { data: chainBalance } = useAppChainBalance(isConnected ? account?.account : undefined);
  const [lang] = useLang();
  const t = lang === "ar"
    ? { short: "ربط", full: "اربط المحفظة", connecting: "جارٍ الربط..." }
    : { short: "Connect", full: "Connect Wallet", connecting: "Connecting..." };
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
        <div className="flex min-w-0 flex-col items-end">
          <span className="hidden text-xs text-muted-foreground sm:inline">Connected</span>
          <span className="font-mono text-sm text-primary whitespace-nowrap" title={account.account}>
            <span className="hidden sm:inline">{shortenAddress(account.account)}</span>
            <span className="sm:hidden">{`${account.account.slice(0, 6)}…${account.account.slice(-4)}`}</span>
          </span>
          {chainBalance !== undefined && (
            <span className="hidden whitespace-nowrap text-[11px] text-muted-foreground tabular-nums sm:inline" title={`Only KDA on chain ${CHAIN_ID} can be used here; your wallet may show a total across all chains.`}>
              Chain {CHAIN_ID}: {chainBalance.toLocaleString("en-US", { maximumFractionDigits: 4 })} KDA
            </span>
          )}
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
