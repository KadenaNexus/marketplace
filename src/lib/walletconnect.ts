/**
 * Phone wallets (Ecko app, Linx, Koala and other Kadena wallets) through WalletConnect, using Reown's
 * Universal Connector. Everything here loads only when someone chooses a phone wallet, so the page
 * stays small for everyone else.
 *
 * Kadena on WalletConnect: namespace "kadena", chain "kadena:mainnet01", accounts reported as
 * "kadena:mainnet01:<public key>", methods kadena_quicksign_v1 / kadena_sign_v1 / kadena_getAccounts_v1.
 */
import type { IUnsignedCommand } from "@kadena/client";
import { createQuicksignWithWalletConnect, createSignWithWalletConnect } from "@kadena/client";
import { API_HOST, CHAIN_ID, NETWORK_ID, type WalletAccount } from "@/lib/kadena";

// The Reown project ID is public (it identifies the site to the WalletConnect relay); set it here or in VITE_WALLETCONNECT_PROJECT_ID.
const DEFAULT_PROJECT_ID = "";
export const WC_PROJECT_ID = String(import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID || DEFAULT_PROJECT_ID).trim();
export const WC_CHAIN = `kadena:${NETWORK_ID}` as const;
export const walletConnectReady = () => WC_PROJECT_ID.length > 0;

type Session = {
  topic: string;
  namespaces: Record<string, { accounts: string[]; methods: string[]; events: string[] }>;
  peer: { metadata: { name: string; icons?: string[]; redirect?: { native?: string; universal?: string } } };
};
type Connector = {
  provider: {
    session?: Session;
    request: (args: { method: string; params: unknown }, chain?: string) => Promise<unknown>;
    on: (event: string, fn: (...a: unknown[]) => void) => void;
  };
  connect: () => Promise<{ session: Session }>;
  disconnect: () => Promise<void>;
  /** The Reown modal (a private field of the connector, used to notice when it is closed) */
  appKit?: { subscribeState?: (fn: (s: { open: boolean }) => void) => () => void };
};

let connectorPromise: Promise<Connector> | null = null;

export function getConnector(): Promise<Connector> {
  if (!walletConnectReady()) return Promise.reject(new Error("Phone wallets are not set up on this site yet."));
  if (!connectorPromise) {
    connectorPromise = (async () => {
      const { UniversalConnector } = await import("@reown/appkit-universal-connector");
      const dark = document.documentElement.classList.contains("dark");
      const kadena = {
        id: NETWORK_ID,
        chainNamespace: "kadena",
        caipNetworkId: WC_CHAIN,
        name: "Kadena",
        nativeCurrency: { name: "Kadena", symbol: "KDA", decimals: 12 },
        rpcUrls: { default: { http: [API_HOST] } },
      };
      const origin = window.location.origin;
      const c = await UniversalConnector.init({
        projectId: WC_PROJECT_ID,
        metadata: {
          name: "Kadena P2P Marketplace",
          description: "Trade KDA person to person, with the coins held in a Pact escrow contract.",
          url: origin,
          icons: [`${origin}/icon-192.png`],
        },
        networks: [
          {
            namespace: "kadena",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            chains: [kadena as any],
            methods: ["kadena_quicksign_v1", "kadena_sign_v1", "kadena_getAccounts_v1"],
            events: [],
          },
        ],
        modalConfig: {
          themeMode: dark ? "dark" : "light",
          themeVariables: { "--w3m-accent": "#1C637B", "--w3m-border-radius-master": "2px", "--w3m-z-index": 1000 },
          features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, history: false, send: false },
          allWallets: "SHOW",
        },
      });
      return c as unknown as Connector;
    })();
    connectorPromise.catch(() => { connectorPromise = null; });
  }
  return connectorPromise;
}

/** "kadena:mainnet01:<pubkey>" (or a bare key / k:key from some wallets) -> account */
export function accountFromSession(session: Session | undefined): WalletAccount | null {
  const raw = session?.namespaces?.kadena?.accounts?.[0];
  if (!raw) return null;
  const parts = raw.split(":");
  let pubKey = parts[parts.length - 1];
  if (pubKey.startsWith("k:")) pubKey = pubKey.slice(2);
  if (!/^[0-9a-f]{64}$/i.test(pubKey)) return null;
  pubKey = pubKey.toLowerCase();
  return { account: `k:${pubKey}`, publicKey: pubKey, chainId: CHAIN_ID };
}

export const walletName = (session?: Session) => session?.peer?.metadata?.name || "your wallet";

/** Restore a phone-wallet connection saved by an earlier visit. */
export async function restoreWalletConnect(): Promise<{ account: WalletAccount; name: string } | null> {
  const c = await getConnector();
  const account = accountFromSession(c.provider.session);
  return account ? { account, name: walletName(c.provider.session) } : null;
}

export async function connectWalletConnect(): Promise<{ account: WalletAccount; name: string }> {
  const c = await getConnector();
  // The connector waits for a wallet even after the person closes the list; stop waiting when it closes.
  const { session } = await new Promise<{ session: Session }>((resolve, reject) => {
    let opened = false;
    let settled = false;
    const unsubscribe = c.appKit?.subscribeState?.((st) => {
      if (st.open) opened = true;
      else if (opened && !settled) { settled = true; reject(new Error("closed")); }
    });
    c.connect().then(
      (r) => { if (!settled) { settled = true; resolve(r); } },
      (e) => { if (!settled) { settled = true; reject(e); } },
    ).finally(() => unsubscribe?.());
  });
  const account = accountFromSession(session);
  if (!account) {
    await c.disconnect().catch(() => {});
    throw new Error("This wallet did not share a Kadena k: account. Choose a Kadena account in the wallet and try again.");
  }
  return { account, name: walletName(session) };
}

export async function disconnectWalletConnect() {
  if (!connectorPromise) return;
  const c = await connectorPromise.catch(() => null);
  await c?.disconnect().catch(() => {});
}

export async function onWalletConnectEnded(fn: () => void) {
  const c = await getConnector();
  c.provider.on("session_delete", fn);
  c.provider.on("session_expire", fn);
}

/* ---------- signing ---------- */

type Pending = { wallet: string; open: (() => void) | null; cancel: () => void };
let pending: Pending | null = null;
const listeners = new Set<(p: Pending | null) => void>();
const emit = () => listeners.forEach((l) => l(pending));
/** For the "Approve in your wallet" banner. */
export function onPendingApproval(fn: (p: Pending | null) => void) {
  listeners.add(fn);
  fn(pending);
  return () => { listeners.delete(fn); };
}

const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Link that brings the wallet app forward (its own redirect link from the session). */
function walletLink(session: Session): string | null {
  const r = session.peer.metadata.redirect;
  return r?.native || r?.universal || null;
}

/** Sign with the connected phone wallet; on a phone, the wallet app is opened for the approval. */
export async function signWithWalletConnect(command: IUnsignedCommand): Promise<unknown> {
  const c = await getConnector();
  const session = c.provider.session;
  if (!session) throw new Error("The phone wallet is no longer connected. Connect it again.");
  const client = {
    request: ({ request, chainId }: { request: { method: string; params: unknown }; chainId: string }) =>
      c.provider.request({ method: request.method, params: request.params }, chainId),
  };
  const methods = session.namespaces.kadena?.methods ?? [];
  // @kadena/client types these with its own (older) WalletConnect client; ours has the same request() shape
  const args = [client, session, WC_CHAIN] as unknown as Parameters<typeof createQuicksignWithWalletConnect>;
  const sign = methods.includes("kadena_quicksign_v1") || !methods.includes("kadena_sign_v1")
    ? createQuicksignWithWalletConnect(...args)
    : createSignWithWalletConnect(...args);

  const link = walletLink(session);
  const open = link ? () => { window.open(link, "_self", "noreferrer noopener"); } : null;
  let cancel: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { cancel = () => reject(new Error("Cancelled. Nothing was signed.")); });
  pending = { wallet: walletName(session), open, cancel };
  emit();
  try {
    const result = (sign as (c: IUnsignedCommand) => Promise<unknown>)(command);
    if (isPhone() && open) setTimeout(open, 300); // let the request reach the relay first
    return await Promise.race([result, cancelled]);
  } finally {
    pending = null;
    emit();
  }
}
