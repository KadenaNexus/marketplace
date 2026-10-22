import { createContext, useState, useEffect, useCallback, useContext, useRef } from "react";
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
import { WalletPicker, WalletApprovalBanner, PhoneWalletSheet } from "@/components/WalletPicker";

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
const RELAY_TIMEOUT_MS = 20000;
const RELAY_DOWN_MESSAGE = "Could not reach the WalletConnect relay. Check your connection and try again.";
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
  // phone-wallet connection screen: open while waiting; uri once the link is ready; error when the relay never answered
  const [wcSheet, setWcSheet] = useState<{ uri: string | null; cancel: () => void; error?: string; retry?: () => void } | null>(null);
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
    let cancel: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => { cancel = () => reject(new Error("cancelled")); });
    cancelled.catch(() => {});
    setWcSheet({ uri: null, cancel });
    // No link within 20 s means the WalletConnect relay could not be reached (or the client never loaded): stop,
    // drop the half-made client so Retry starts fresh, and say so on the connection screen.
    let gotUri = false;
    let relayDown = false;
    const timer = setTimeout(() => { if (!gotUri) { relayDown = true; wc.resetWalletConnectClient(); cancel(); } }, RELAY_TIMEOUT_MS);
    try {
      const r = await wc.connectWalletConnect((uri) => { gotUri = true; setWcSheet((s) => (s ? { ...s, uri } : s)); }, cancelled);
      await adoptPhoneWallet(r.account, r.name);
      setWcSheet(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to connect wallet";
      if (relayDown) {
        setWcSheet({ uri: null, cancel: () => setWcSheet(null), error: RELAY_DOWN_MESSAGE, retry: () => { void connectPhoneWalletRef.current(); } });
      } else {
        setWcSheet(null);
        // closing the connection screen is not an error
        if (!/cancel|closed/i.test(msg)) setError(/reject/i.test(msg) ? "The wallet declined the connection." : msg);
      }
    } finally {
      clearTimeout(timer);
      setIsConnecting(false);
    }
  }, [adoptPhoneWallet]);
  const connectPhoneWalletRef = useRef(connectPhoneWallet);
  connectPhoneWalletRef.current = connectPhoneWallet;

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
      <PhoneWalletSheet state={wcSheet} />
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
