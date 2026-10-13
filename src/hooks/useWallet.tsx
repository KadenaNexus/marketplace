import { createContext, useState, useEffect, useCallback, useContext } from "react";
import {
  WalletAccount,
  isEckoWalletAvailable,
  connectEckoWallet,
  disconnectEckoWallet,
  getAccountInfo,
  setActiveSigner,
} from "@/lib/kadena";
import { checkSession, clearSession } from "@/lib/session";
import * as wc from "@/lib/walletconnect";
import { WalletPicker, WalletApprovalBanner } from "@/components/WalletPicker";

export type WalletKind = "ecko" | "walletconnect";

interface WalletContextValue {
  account: WalletAccount | null;
  isConnecting: boolean;
  isConnected: boolean;
  /** Some way to connect exists here (Ecko extension, or phone wallets through WalletConnect). */
  isWalletAvailable: boolean;
  hasEckoExtension: boolean;
  phoneWalletsReady: boolean;
  walletKind: WalletKind | null;
  /** Name of the connected wallet app, e.g. "Linx" (phone wallets) */
  walletName: string | null;
  error: string | null;
  /** Opens the wallet choice (or connects straight away when there is only one way). */
  connect: () => Promise<void>;
  connectEcko: () => Promise<void>;
  connectPhoneWallet: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);
const KIND_KEY = "nx-wallet-kind";
const readKind = (): WalletKind | null => { try { const v = localStorage.getItem(KIND_KEY); return v === "ecko" || v === "walletconnect" ? v : null; } catch { return null; } };
const saveKind = (k: WalletKind | null) => { try { if (k) localStorage.setItem(KIND_KEY, k); else localStorage.removeItem(KIND_KEY); } catch { /* ignore */ } };

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [walletKind, setWalletKind] = useState<WalletKind | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasEcko, setHasEcko] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const phoneWalletsReady = wc.walletConnectReady();

  const reset = useCallback(() => {
    setActiveSigner(null);
    setAccount(null);
    setWalletKind(null);
    setWalletName(null);
    saveKind(null);
  }, []);

  const adoptPhoneWallet = useCallback(async (acc: WalletAccount, name: string) => {
    setActiveSigner(wc.signWithWalletConnect);
    setAccount(acc);
    setWalletKind("walletconnect");
    setWalletName(name);
    saveKind("walletconnect");
    wc.onWalletConnectEnded(reset).catch(() => {});
  }, [reset]);

  useEffect(() => {
    const check = () => setHasEcko(isEckoWalletAvailable());
    check();
    const t = setTimeout(check, 1000);
    return () => clearTimeout(t);
  }, []);

  // Reconnect what this browser used last time
  useEffect(() => {
    const kind = readKind();
    if (kind === "walletconnect") {
      if (!phoneWalletsReady) return;
      wc.restoreWalletConnect()
        .then((r) => { if (r) return adoptPhoneWallet(r.account, r.name); saveKind(null); })
        .catch(() => {});
      return;
    }
    if (!hasEcko) return;
    getAccountInfo()
      .then((info) => { if (info) { setAccount(info); setWalletKind("ecko"); } })
      .catch(() => {});
  }, [hasEcko, phoneWalletsReady, adoptPhoneWallet]);

  // A saved sign-in the server no longer accepts is dropped, so the next request asks once again
  useEffect(() => { if (account) checkSession(account.account); }, [account]);

  const connectEcko = useCallback(async () => {
    setPickerOpen(false);
    if (!isEckoWalletAvailable()) {
      setError("Ecko wallet not detected. Please install the extension.");
      return;
    }
    setIsConnecting(true);
    setError(null);
    try {
      setActiveSigner(null);
      const wallet = await connectEckoWallet();
      setAccount(wallet);
      setWalletKind("ecko");
      setWalletName("Ecko Wallet");
      saveKind("ecko");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const connectPhoneWallet = useCallback(async () => {
    setPickerOpen(false);
    setIsConnecting(true);
    setError(null);
    try {
      const r = await wc.connectWalletConnect();
      await adoptPhoneWallet(r.account, r.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to connect wallet";
      // closing the wallet list is not an error
      if (!/closed|rejected|cancel/i.test(msg)) setError(msg.replace(/^Error connecting to wallet: /, ""));
    } finally {
      setIsConnecting(false);
    }
  }, [adoptPhoneWallet]);

  const connect = useCallback(async () => {
    setError(null);
    if (hasEcko && phoneWalletsReady) setPickerOpen(true);
    else if (hasEcko) await connectEcko();
    else if (phoneWalletsReady) await connectPhoneWallet();
    else setError("Ecko wallet not detected. Please install the extension.");
  }, [hasEcko, phoneWalletsReady, connectEcko, connectPhoneWallet]);

  const disconnect = useCallback(async () => {
    const kind = walletKind;
    if (account) clearSession(account.account);
    reset();
    try {
      if (kind === "walletconnect") await wc.disconnectWalletConnect();
      else await disconnectEckoWallet();
    } catch (err) {
      console.error("Disconnect error:", err);
    }
  }, [account, walletKind, reset]);

  const value: WalletContextValue = {
    account,
    isConnecting,
    isConnected: !!account,
    isWalletAvailable: hasEcko || phoneWalletsReady,
    hasEckoExtension: hasEcko,
    phoneWalletsReady,
    walletKind,
    walletName,
    error,
    connect,
    connectEcko,
    connectPhoneWallet,
    disconnect,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
      <WalletPicker open={pickerOpen} onOpenChange={setPickerOpen} onEcko={connectEcko} onPhone={connectPhoneWallet} />
      <WalletApprovalBanner />
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
