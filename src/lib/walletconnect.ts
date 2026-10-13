/**
 * Phone wallets (Ecko app, Linx, Koala and other Kadena wallets) through WalletConnect.
 *
 * Most Kadena wallets are not listed in WalletConnect's wallet directory, so instead of a directory
 * picker we show our own screen: a QR code on a computer; on a phone, "Copy link" (paste it into the
 * wallet's WalletConnect screen). The WalletConnect client loads only when someone chooses a phone wallet.
 *
 * Pinned to @walletconnect/sign-client 2.20.3: from 2.21 on, connect() moves requiredNamespaces into
 * optionalNamespaces, and wallets on older WalletConnect code (as Kadena wallets are) then refuse with
 * "The proposal does not include a list of required chains".
 *
 * Kadena on WalletConnect: namespace "kadena", chain "kadena:mainnet01", accounts reported as
 * "kadena:mainnet01:<public key>", methods kadena_quicksign_v1 / kadena_sign_v1 / kadena_getAccounts_v1.
 */
import type { IUnsignedCommand } from "@kadena/client";
import { addSignatures, createSignWithWalletConnect } from "@kadena/client";
import { CHAIN_ID, NETWORK_ID, type WalletAccount } from "@/lib/kadena";
import { answerLayout, signaturesFromQuicksign } from "@/lib/quicksignAnswer";
import { walletLog } from "@/lib/walletLog";
import { base64UrlDecodeArr, hexToBin, verifySig } from "@kadena/cryptography-utils";

// The Reown project ID is public (it identifies the site to the WalletConnect relay).
// Shared with the Adoption Index; marketplace.kadena.ws is on its domain allowlist.
const DEFAULT_PROJECT_ID = "f4249de4e19f3c57f77d259b691a8d0e";
export const WC_PROJECT_ID = String(import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID || DEFAULT_PROJECT_ID).trim();
export const WC_CHAIN = `kadena:${NETWORK_ID}` as const;
export const walletConnectReady = () => WC_PROJECT_ID.length > 0;
const METHODS = ["kadena_quicksign_v1", "kadena_sign_v1", "kadena_getAccounts_v1"];

type Session = {
  topic: string;
  expiry: number;
  namespaces: Record<string, { accounts: string[]; methods: string[]; events: string[] }>;
  peer: { metadata: { name: string; icons?: string[]; redirect?: { native?: string; universal?: string } } };
};
type Client = {
  connect: (p: { requiredNamespaces?: unknown; optionalNamespaces?: unknown }) => Promise<{ uri?: string; approval: () => Promise<Session> }>;
  request: (p: { topic: string; chainId: string; request: { method: string; params: unknown } }) => Promise<unknown>;
  disconnect: (p: { topic: string; reason: { code: number; message: string } }) => Promise<void>;
  session: { getAll: () => Session[] };
  on: (event: string, fn: (...a: unknown[]) => void) => void;
};

let clientPromise: Promise<Client> | null = null;

export function getClient(): Promise<Client> {
  if (!walletConnectReady()) return Promise.reject(new Error("Phone wallets are not set up on this site yet."));
  if (!clientPromise) {
    clientPromise = (async () => {
      const { SignClient } = await import("@walletconnect/sign-client");
      const origin = window.location.origin;
      const c = await SignClient.init({
        projectId: WC_PROJECT_ID,
        metadata: {
          name: "Kadena P2P Marketplace",
          description: "Trade KDA person to person, with the coins held in a Pact escrow contract.",
          url: origin,
          icons: [`${origin}/icon-192.png`],
        },
      });
      return c as unknown as Client;
    })();
    clientPromise.catch(() => { clientPromise = null; });
  }
  return clientPromise;
}

const currentSession = (c: Client): Session | undefined => {
  const now = Date.now() / 1000;
  const all = c.session.getAll().filter((s) => s.namespaces?.kadena && s.expiry > now);
  return all[all.length - 1];
};

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

/** The connected phone wallet's own details (name, site, return links), for the wallet check page. */
export async function connectedWalletInfo() {
  if (!clientPromise) await getClient().catch(() => null);
  const c = await clientPromise?.catch(() => null);
  const s = c ? currentSession(c) : undefined;
  return s ? { name: s.peer.metadata.name, url: (s.peer.metadata as { url?: string }).url ?? null, redirect: s.peer.metadata.redirect ?? null, methods: s.namespaces.kadena?.methods ?? [] } : null;
}

/** Restore a phone-wallet connection saved by an earlier visit. */
export async function restoreWalletConnect(): Promise<{ account: WalletAccount; name: string } | null> {
  const c = await getClient();
  const s = currentSession(c);
  const account = accountFromSession(s);
  return account ? { account, name: walletName(s) } : null;
}

/**
 * Start a connection. `onUri` receives the wc: link to show as a QR code / copy / open.
 * Resolves when the wallet approves; `cancel` stops waiting.
 */
export async function connectWalletConnect(onUri: (uri: string) => void, cancelled: Promise<never>): Promise<{ account: WalletAccount; name: string }> {
  const c = await getClient();
  const { uri, approval } = await c.connect({
    requiredNamespaces: { kadena: { methods: METHODS, chains: [WC_CHAIN], events: [] } },
  });
  if (uri) onUri(uri);
  walletLog("connect link ready");
  const session = await Promise.race([approval(), cancelled]).catch((e) => { walletLog("connect stopped", e instanceof Error ? e.message : String(e)); throw e; });
  walletLog("connected", { wallet: walletName(session), methods: session.namespaces?.kadena?.methods, redirect: session.peer?.metadata?.redirect });
  const account = accountFromSession(session);
  if (!account) {
    await c.disconnect({ topic: session.topic, reason: { code: 6000, message: "No k: account" } }).catch(() => {});
    throw new Error("This wallet did not share a Kadena k: account. Choose a Kadena account in the wallet and try again.");
  }
  return { account, name: walletName(session) };
}

export async function disconnectWalletConnect() {
  if (!clientPromise) return;
  const c = await clientPromise.catch(() => null);
  if (!c) return;
  for (const s of c.session.getAll()) {
    await c.disconnect({ topic: s.topic, reason: { code: 6000, message: "User disconnected" } }).catch(() => {});
  }
}

export async function onWalletConnectEnded(fn: () => void) {
  const c = await getClient();
  c.on("session_delete", fn);
  c.on("session_expire", fn);
}

/* ---------- signing ---------- */

type Pending = { wallet: string; open: (() => void) | null; href: string | null; cancel: () => void; /** what is being approved, e.g. "Deposit KDA" */ what: string; signIn: boolean };
let pending: Pending | null = null;
const listeners = new Set<(p: Pending | null) => void>();
const emit = () => listeners.forEach((l) => l(pending));
/** For the "Approve in your wallet" banner. */
export function onPendingApproval(fn: (p: Pending | null) => void) {
  listeners.add(fn);
  fn(pending);
  return () => { listeners.delete(fn); };
}

export const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Link that brings the wallet app forward (its own redirect link from the session). */
function walletLink(session: Session): string | null {
  const r = session.peer.metadata.redirect;
  // Only an app link ("linx://…"). Not a bare word or a path (read as a page on this site: 404), and not an
  // https "universal" link: iPhone opens those in Safari when tapped from a web page (Linx's goes to its website).
  const v = r?.native;
  if (!v || !/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  if (/^(https?|javascript|data|vbscript|file|about|blob):/i.test(v)) return null;
  return v;
}

const STEP_NAMES: Record<string, string> = {
  "create-offer": "Create offer",
  "accept-offer": "Accept offer",
  "deposit": "Deposit KDA",
  "mark-paid": "Mark as paid",
  "release": "Release KDA",
  "refund": "Refund",
  "close-offer": "Close offer",
  "delete-offer": "Delete offer",
  "cancel-accepted-offer": "Cancel trade",
  "timeout-accepted-close": "Close trade",
  "timeout-funded-refund": "Refund",
  "timeout-paid-dispute": "Open dispute",
};
/** "Deposit KDA", "Sign in", … for the approval banner. */
function stepName(cmd: string): string {
  const d = describeCmd(cmd);
  if (d === "sign-in") return "Sign in";
  const fn = d.split(".").pop() ?? d;
  return STEP_NAMES[fn] ?? "Transaction";
}

/** "create-offer", "profile sign-in", … from the Pact code, for the log. */
function describeCmd(cmd: string): string {
  try {
    const code = (JSON.parse(cmd) as { payload?: { exec?: { code?: string; data?: Record<string, unknown> } } }).payload?.exec;
    if (code?.data && "profile-auth" in code.data) return "sign-in";
    const m = code?.code?.match(/\(([\w.-]+)/);
    return m ? m[1] : "transaction";
  } catch { return "transaction"; }
}

async function quicksign(c: Client, session: Session, command: IUnsignedCommand): Promise<IUnsignedCommand> {
  const parsed = JSON.parse(command.cmd) as { signers?: { pubKey: string }[] };
  const keys = (parsed.signers ?? []).map((s) => s.pubKey);
  walletLog("quicksign sent", { what: describeCmd(command.cmd) });
  const answer = await c.request({
    topic: session.topic,
    chainId: WC_CHAIN,
    request: {
      method: "kadena_quicksign_v1",
      params: { commandSigDatas: [{ cmd: command.cmd, sigs: keys.map((pubKey, i) => ({ pubKey, sig: command.sigs?.[i]?.sig ?? null })) }] },
    },
  });
  const shape = answerLayout(answer); // field names only, no signatures
  try {
    const sigs = signaturesFromQuicksign(answer, command.hash, keys);
    // Check each signature against this transaction before using it, so a mismatch is caught here
    // (with a clear message and a log line) instead of as a chain error after sending.
    const msg = base64UrlDecodeArr(command.hash);
    const bad = sigs.filter((x) => { try { return !verifySig(msg, hexToBin(x.sig), hexToBin(x.pubKey)); } catch { return true; } });
    if (bad.length) {
      walletLog("quicksign signature does not match", { shape });
      throw new Error("The wallet's signature does not match this transaction. Nothing was sent.");
    }
    walletLog("quicksign answer ok", { shape, sigs: sigs.length });
    return addSignatures(command, ...sigs) as IUnsignedCommand;
  } catch (e) {
    walletLog("quicksign answer not usable", { shape, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** Sign with the connected phone wallet. The approval banner offers a button to open the wallet app. */
export async function signWithWalletConnect(command: IUnsignedCommand): Promise<unknown> {
  const c = await getClient();
  const session = currentSession(c);
  if (!session) throw new Error("The phone wallet is no longer connected. Connect it again.");
  const methods = session.namespaces.kadena?.methods ?? [];
  const useQuicksign = methods.includes("kadena_quicksign_v1") || !methods.includes("kadena_sign_v1");
  const sign = useQuicksign
    ? (cmd: IUnsignedCommand) => quicksign(c, session, cmd)
    // @kadena/client types this with its own (older) WalletConnect client; ours has the same request() shape
    : createSignWithWalletConnect(...([c, session, WC_CHAIN] as unknown as Parameters<typeof createSignWithWalletConnect>));

  const link = walletLink(session);
  const open = link ? () => { window.open(link, "_self", "noreferrer noopener"); } : null;
  let cancel: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { cancel = () => reject(new Error("Cancelled. Nothing was signed.")); });
  pending = { wallet: walletName(session), open, href: link, cancel, what: stepName(command.cmd), signIn: describeCmd(command.cmd) === "sign-in" };
  emit();
  try {
    const result = (sign as (c: IUnsignedCommand) => Promise<unknown>)(command);
    // No automatic jump to the wallet app: the person taps "Open <wallet>" (or switches apps). Opening it
    // by itself left the page, and a reload asked the wallet again.
    return await Promise.race([result, cancelled]);
  } catch (e) {
    walletLog("signing failed", e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    pending = null;
    emit();
  }
}
