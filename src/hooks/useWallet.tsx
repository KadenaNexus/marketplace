import { createContext, useState, useEffect, useCallback, useContext } from "react";
import {
  WalletAccount,
  isEckoWalletAvailable,
  connectEckoWallet,
  disconnectEckoWallet,
  getAccountInfo,
} from "@/lib/kadena";

interface WalletContextValue {
  account: WalletAccount | null;
  isConnecting: boolean;
  isConnected: boolean;
  isWalletAvailable: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isWalletAvailable, setIsWalletAvailable] = useState(false);

  useEffect(() => {
    const checkWallet = () => setIsWalletAvailable(isEckoWalletAvailable());
    checkWallet();
    const t = setTimeout(checkWallet, 1000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!isWalletAvailable) return;
    getAccountInfo().then((info) => { if (info) setAccount(info); }).catch(() => {});
  }, [isWalletAvailable]);

  const connect = useCallback(async () => {
    if (!isWalletAvailable) {
      setError("Ecko wallet not detected. Please install the extension.");
      return;
    }
    setIsConnecting(true);
    setError(null);
    try {
      const wallet = await connectEckoWallet();
      setAccount(wallet);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setIsConnecting(false);
    }
  }, [isWalletAvailable]);

  const disconnect = useCallback(async () => {
    try {
      await disconnectEckoWallet();
      setAccount(null);
    } catch (err) {
      console.error("Disconnect error:", err);
    }
  }, []);

  const value: WalletContextValue = {
    account,
    isConnecting,
    isConnected: !!account,
    isWalletAvailable,
    error,
    connect,
    disconnect,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
