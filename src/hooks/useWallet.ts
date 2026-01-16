import { useState, useEffect, useCallback } from "react";
import {
  WalletAccount,
  isEckoWalletAvailable,
  connectEckoWallet,
  disconnectEckoWallet,
  getAccountInfo,
} from "@/lib/kadena";

export function useWallet() {
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isWalletAvailable, setIsWalletAvailable] = useState(false);

  // Check wallet availability on mount
  useEffect(() => {
    const checkWallet = () => {
      setIsWalletAvailable(isEckoWalletAvailable());
    };
    
    checkWallet();
    
    // Check again after a short delay (extension might load late)
    const timeout = setTimeout(checkWallet, 1000);
    
    return () => clearTimeout(timeout);
  }, []);

  // Try to restore previous connection
  useEffect(() => {
    const restoreConnection = async () => {
      if (!isWalletAvailable) return;
      
      try {
        const info = await getAccountInfo();
        if (info) {
          setAccount(info);
        }
      } catch (err) {
        console.log("No previous connection to restore");
      }
    };
    
    restoreConnection();
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

  return {
    account,
    isConnecting,
    isConnected: !!account,
    isWalletAvailable,
    error,
    connect,
    disconnect,
  };
}
