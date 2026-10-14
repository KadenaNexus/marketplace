import {
  type ChainId,
  IUnsignedCommand,
  Pact,
  createClient,
  createQuicksignWithEckoWallet,
} from "@kadena/client";

/* ============================================================
   NETWORK CONFIG
============================================================ */

export const NETWORK_ID =
  (typeof import.meta.env?.VITE_NETWORK_ID === "string" && import.meta.env.VITE_NETWORK_ID) || "mainnet01";
const CHAIN_ID_RAW =
  (typeof import.meta.env?.VITE_CHAIN_ID === "string" && import.meta.env.VITE_CHAIN_ID) || "1";
export const CHAIN_ID: ChainId = CHAIN_ID_RAW as ChainId;

// VITE_CHAINWEB_API overrides. The mainnet default is the active community Chainweb API.
const DEFAULT_API_BASE =
  NETWORK_ID.startsWith("testnet")
    ? "https://api.testnet.chainweb.com"
    : "https://api.chainweb-community.org";
// Direct Chainweb Pact API (no proxy). Set VITE_CHAINWEB_API to override base URL.
const API_CHAINWEB_PACT =
  typeof import.meta.env?.VITE_CHAINWEB_API === "string" && import.meta.env.VITE_CHAINWEB_API
    ? import.meta.env.VITE_CHAINWEB_API
    : `${DEFAULT_API_BASE}/chainweb/0.0/${NETWORK_ID}/chain/${CHAIN_ID}/pact`;

export const API_HOST = API_CHAINWEB_PACT;

// Must match p2p-escrow.pact. Namespace is optional; allow empty string = root module (no namespace).
const CONTRACT_NAMESPACE_ENV =
  typeof import.meta.env?.VITE_CONTRACT_NAMESPACE === "string" ? import.meta.env.VITE_CONTRACT_NAMESPACE : undefined;
export const CONTRACT_NAMESPACE = (CONTRACT_NAMESPACE_ENV ?? "free").trim();

const CONTRACT_MODULE_RAW =
  (typeof import.meta.env?.VITE_CONTRACT_MODULE === "string" && import.meta.env.VITE_CONTRACT_MODULE.trim()) ||
  "p2p-escrow-v10";
/** Pact under namespace `free` treats bare `fn` as module `free.fn` — never use that as module name. */
const INVALID_MODULE_NAMES = new Set(
  ["fn", "module", "namespace", "defun", "defcap", "deftable", "let", "if", "true", "false"].map((s) =>
    s.toLowerCase()
  )
);
export const CONTRACT_MODULE = INVALID_MODULE_NAMES.has(CONTRACT_MODULE_RAW.toLowerCase())
  ? (console.error(
      `[Kadena-NEXUS] VITE_CONTRACT_MODULE="${CONTRACT_MODULE_RAW}" is invalid (reserved in Pact / breaks as free.${CONTRACT_MODULE_RAW}). Using p2p-escrow-v10. Set VITE_CONTRACT_MODULE to your (module ...) name in p2p-escrow.pact.`
    ),
    "p2p-escrow-v10")
  : CONTRACT_MODULE_RAW;

/** Fully-qualified contract module reference used in pact code. */
export const CONTRACT_FQN = CONTRACT_NAMESPACE ? `${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}` : CONTRACT_MODULE;

/** The platform arbiter wallet address — always has admin access regardless of active escrows. */
export const PLATFORM_ARBITER = "k:eda1ef1f1528f5f72e153fcb9c2c8178317749429bd48aaf34b6b52fa16598e1";

export const kadenaClient = createClient(API_HOST);

/** Gas: lower values = cheaper txs. Mainnet-appropriate defaults. */
export const GAS_PRICE = 0.0000001; // 1e-7 KDA per unit (was 1e-5)
export const GAS_LIMIT = 2500; // sufficient for single Pact calls (create, accept, fund, pay, refund, etc.)
export const GAS_LIMIT_READ = 50000; // list-escrow-ids / get-reputation (list-ids uses ~40k gas)
export const GAS_LIMIT_PROFILE_AUTH = 5000; // profile proof (signed, not executed on chain)

/** Debug: effective Chainweb API base and send URL (for "read-only" troubleshooting). */
export function getChainwebDebugInfo(): { apiHost: string; sendUrl: string; networkId: string; chainId: string } {
  return {
    apiHost: API_HOST,
    sendUrl: `${API_HOST}/api/v1/send`,
    networkId: NETWORK_ID,
    chainId: CHAIN_ID,
  };
}

/* ============================================================
   TYPES
============================================================ */

export type EscrowState =
  | "CREATED"
  | "ACCEPTED"
  | "FUNDED"
  | "PAID"
  | "COMPLETED"
  | "REFUNDED"
  | "CLOSED"
  | "DELETED"
  | "DISPUTED";

export const T1_SECONDS = 3600;
export const T2_SECONDS = 14400;
export const T3_SECONDS = 3600;

export interface Escrow {
  offerId: string;
  /** KDA holder (deposits, receives refund). SELL=creator, BUY=buyer field. */
  seller: string;
  /** Fiat payer (receives KDA on release). SELL=buyer field, BUY=creator. */
  buyer: string | null;
  /** Contract creator (SELL=seller, BUY=buyer; only creator can close offer). */
  creator: string;
  arbiter: string;
  amount: number;
  state: EscrowState;
  createdAt?: string;
  /** When offer was accepted (informational; no pre-fund time limits on-chain). */
  acceptedAt?: string;
  /** ISO timestamp when escrow was funded (for T2 countdown). */
  fundedAt?: string;
  /** ISO timestamp when buyer marked paid (for T3 countdown). */
  paidAt?: string;
  // Binance P2P style fields
  side: "BUY" | "SELL";
  price: number;
  paymentMethod: string; // JSON string array
  fiatCurrency: string;
  /** Open offers: when this listing period ends (from the server, see OFFER_LISTING_DAYS) */
  listedUntil?: string;
}

export interface WalletAccount {
  account: string;
  publicKey: string;
  chainId: string;
}

/** On-chain reputation counters only (score calculation & UI off-chain). */
export interface ChainReputation {
  totalTrades: number;
  successfulTrades: number;
  disputesCount: number;
}

/* ============================================================
   WALLET
============================================================ */

export function isEckoWalletAvailable(): boolean {
  return typeof window !== "undefined" && !!(window as any).kadena?.isKadena;
}

export async function connectEckoWallet(): Promise<WalletAccount> {
  const kadena = (window as any).kadena;

  const res = await kadena.request({
    method: "kda_connect",
    networkId: NETWORK_ID,
  });

  if (res.status !== "success") {
    throw new Error(res.message || "Wallet connection failed");
  }

  return {
    account: res.account.account,
    publicKey: res.account.publicKey,
    chainId: res.account.chainId || CHAIN_ID,
  };
}

/* ============================================================
   SIGN + SUBMIT  (ECKO SAFE)
============================================================ */

/** Signer of the connected wallet when it is not the Ecko extension (a phone wallet through WalletConnect). */
type Signer = (command: IUnsignedCommand) => Promise<unknown>;
let activeSigner: Signer | null = null;
export function setActiveSigner(signer: Signer | null) {
  activeSigner = signer;
}

export async function signTransaction(command: IUnsignedCommand) {
  if (!command?.cmd || !command?.hash) {
    console.error("Invalid command:", command);
    throw new Error("Invalid command passed to wallet");
  }
  if (activeSigner) return (await activeSigner(command)) as Awaited<ReturnType<ReturnType<typeof createQuicksignWithEckoWallet>>>;

  // quickSign supports multi-capability txs (e.g. ACCOUNT_AUTH + coin.TRANSFER) whereas
  // legacy single-sign path rejects txs with >1 scoped capability on some Ecko builds.
  const wallet = createQuicksignWithEckoWallet();
  return wallet(command);
}

/** Run local simulation with signature verification before submit (avoids burning gas on obvious failures). */
export async function preflightSignedTransaction(signedFromWallet: unknown): Promise<unknown> {
  const raw = (signedFromWallet as { signedCmd?: unknown })?.signedCmd ?? signedFromWallet;
  const cmd = raw as { cmd?: string; hash?: string; sigs?: unknown };
  if (!cmd?.cmd) throw new Error("Invalid signed command for preflight");
  const body = { cmd: cmd.cmd, hash: cmd.hash ?? "", sigs: (cmd.sigs ?? []) as [] };
  return kadenaClient.local(body, { preflight: true, signatureVerification: true });
}

/** Walk nested Chainweb /poll and /local shapes until we find `{ status, error? }`. */
function extractPactOutcome(result: unknown): Record<string, unknown> | null {
  let cur: unknown = result;
  for (let depth = 0; depth < 6; depth++) {
    if (!cur || typeof cur !== "object") return null;
    const o = cur as Record<string, unknown>;
    if (o.status === "failure" || o.status === "success") return o;
    cur = o.result;
  }
  return null;
}

/** True if this command result is a failed pact execution. */
export function isPactExecutionFailure(result: unknown): boolean {
  return extractPactOutcome(result)?.status === "failure";
}

/** Human-readable message from local / poll failure result. */
export function describePactFailure(
  result: unknown,
  ctx?: { account?: string; operation?: string }
): string {
  const op = ctx?.operation ?? "Transaction";
  const acct = ctx?.account;
  const res = extractPactOutcome(result);
  if (!res) return `${op} failed: unknown response shape`;
  if (res.status === "success") return `${op} succeeded`;

  const err = res.error;
  let msg = "";
  if (typeof err === "string") msg = err;
  else if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    msg = String(o.message ?? o.msg ?? o.info ?? o.detail ?? JSON.stringify(o));
  }
  if (!msg) msg = JSON.stringify(res);

  if (/Keyset failure.*keys-all/i.test(msg)) {
    const tail =
      "This usually means: (1) your coin account uses a multisig guard with keys-all and not every key signed, " +
      "or (2) the wallet signature is not bound to this account (Ecko needs the signer `address` field — now set). " +
      "Reconnect Ecko on network " +
      NETWORK_ID +
      ", chain " +
      CHAIN_ID +
      ". " +
      (acct ? `Sender account: ${acct}. ` : "") +
      "Multisig accounts need every key to sign; this flow only adds one signer.";
    return `${op} failed: ${msg}. ${tail}`;
  }
  if (/Keyset failure/i.test(msg)) {
    return `${op} failed: ${msg}. Check that your wallet key matches your k: account on this chain.`;
  }
  return `${op} failed: ${msg}`;
}

/** Verify coin account exists on this chain (local read). */
export async function readCoinDetailsLocal(account: string): Promise<{ balance: number } | null> {
  const safe = account.replace(/"/g, '\\"');
  const pactCode = `(coin.details "${safe}")`;
  const command = Pact.builder
    .execution(pactCode)
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: "free",
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
  const result = await kadenaClient.local(
    { cmd: command.cmd, hash: command.hash, sigs: [] },
    { preflight: false }
  );
  if (result.result.status !== "success") return null;
  const d = result.result.data as Record<string, unknown> | null;
  if (!d) return null;
  const bal = d.balance;
  const n = typeof bal === "number" ? bal : typeof bal === "string" ? Number(bal) : NaN;
  return { balance: Number.isFinite(n) ? n : 0 };
}

/* ---------- Balance on chain 1 vs. other chains ----------
 * Wallets such as Ecko show the total KDA across all 20 chains, but this app only uses
 * CHAIN_ID. These helpers explain a shortfall in plain words before anything is signed. */

/** KDA paid in gas by one transaction at our gas settings (limit x price). */
export const TX_GAS_KDA = GAS_LIMIT * GAS_PRICE;

async function balanceOnChain(account: string, chain: string): Promise<number> {
  const safe = account.replace(/"/g, '\\"');
  const command = Pact.builder
    .execution(`(try 0.0 (coin.get-balance "${safe}"))`)
    .setMeta({ chainId: chain as ChainId, senderAccount: "free", gasLimit: GAS_LIMIT_READ, gasPrice: GAS_PRICE, ttl: 600 })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
  const client = chain === CHAIN_ID ? kadenaClient : createClient(API_HOST.replace(`/chain/${CHAIN_ID}/`, `/chain/${chain}/`));
  const result = await client.local({ cmd: command.cmd, hash: command.hash, sigs: [] }, { preflight: false, signatureVerification: false });
  if (result.result.status !== "success") return 0;
  const v = result.result.data as unknown;
  const n = typeof v === "number" ? v : typeof v === "object" && v && "decimal" in (v as object) ? Number((v as { decimal: string }).decimal) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Balance on this app's chain. */
export function readAppChainBalance(account: string): Promise<number> {
  return balanceOnChain(account, CHAIN_ID);
}

/** KDA the account holds on the other 19 chains (only chains with a balance), largest first. */
export async function readOtherChainBalances(account: string): Promise<{ chain: string; balance: number }[]> {
  const chains = Array.from({ length: 20 }, (_, i) => String(i)).filter((c) => c !== CHAIN_ID);
  const settled = await Promise.allSettled(chains.map((c) => balanceOnChain(account, c)));
  return chains
    .map((chain, i) => ({ chain, balance: settled[i].status === "fulfilled" ? (settled[i] as PromiseFulfilledResult<number>).value : 0 }))
    .filter((x) => x.balance > 0)
    .sort((a, b) => b.balance - a.balance);
}

const kda = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

/**
 * Null when the account has `needed` KDA (plus gas) on this app's chain; otherwise a title and a
 * plain explanation naming where the person's KDA actually is and how to move it.
 */
export async function appChainShortfall(account: string, needed: number): Promise<{ title: string; description: string } | null> {
  const need = needed + TX_GAS_KDA;
  const have = await readAppChainBalance(account);
  if (have + 1e-9 >= need) return null;
  const others = await readOtherChainBalances(account).catch(() => []);
  const top = others[0];
  const move = Math.ceil((need - have + 0.005) * 100) / 100;
  const where = others.length
    ? `Your other KDA: ${others.slice(0, 3).map((o) => `${kda(o.balance)} KDA on chain ${o.chain}`).join(", ")}.`
    : `This account has no KDA on any other chain either.`;
  const how = top && top.balance >= move
    ? `In your wallet, send at least ${kda(move)} KDA from chain ${top.chain} to chain ${CHAIN_ID} (to your same account), wait until it completes, then try again.`
    : `Add at least ${kda(move)} KDA to this account on chain ${CHAIN_ID}, then try again.`;
  return {
    title: `Not enough KDA on chain ${CHAIN_ID}`,
    description: `This marketplace only uses chain ${CHAIN_ID}; your wallet may show your total across all chains. On chain ${CHAIN_ID} you have ${kda(have)} KDA, and this needs ${kda(need)} KDA (${kda(needed)} KDA plus gas). ${where} ${how}`,
  };
}

/** True when a chain error is the coin contract's "not enough funds" failure. */
export function isInsufficientFunds(message: string): boolean {
  return /insufficient (funds|balance)/i.test(message);
}

export async function submitTransaction(signedCmd: any): Promise<string> {
  const cmd = signedCmd?.signedCmd ?? signedCmd;
  const body = { cmds: Array.isArray(cmd) ? cmd : [cmd] };
  const url = `${API_HOST}/api/v1/send`;
  if (typeof console !== "undefined" && console.debug) {
    console.debug("[Chainweb] POST", url, getChainwebDebugInfo());
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text || res.statusText;
    try {
      const j = JSON.parse(text) as { error?: string; message?: string; detail?: string; msg?: string };
      msg = j.error ?? j.message ?? j.detail ?? j.msg ?? msg;
    } catch {
      /* use text as-is */
    }
    if (res.status >= 500) {
      console.error("[submitTransaction] 5xx response body:", text.slice(0, 3000));
    }
    throw new Error(`Send failed (${res.status}): ${msg}`);
  }
  const data = JSON.parse(text) as { requestKeys?: string[] };
  const keys = data?.requestKeys;
  if (!keys?.length) throw new Error("No requestKeys in send response");
  if (!Array.isArray(cmd)) recordTradeTx(cmd, keys[0]);
  return keys[0];
}

/**
 * Tell our server about an escrow transaction just sent, so the trade's full transaction list shows for
 * both sides on any device. The server checks the command against the request key and the chain result.
 * Best effort: a failure here never affects the transaction.
 */
function recordTradeTx(cmd: unknown, requestKey: string) {
  const c = (cmd as { cmd?: unknown } | null)?.cmd;
  if (typeof c !== "string" || !c.includes(`${CONTRACT_FQN}.`)) return;
  try {
    fetch("/api/trade-txs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: c, requestKey }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}

export interface TradeTx {
  requestKey: string;
  fn: string;
  action: string;
  sender: string;
  status: "confirmed" | "pending";
  at: string;
}

/** Every recorded on-chain step of a trade, oldest first. */
export async function fetchTradeTxs(offerId: string): Promise<TradeTx[]> {
  const r = await fetch(`/api/trades/${encodeURIComponent(offerId)}/txs`);
  if (!r.ok) throw new Error("Could not load the trade's transactions");
  return r.json();
}

/**
 * Wait for a sent transaction. Kadena makes a block about every 30 s; asking every 1.5 s (the client's
 * default is 5 s) shows the result a few seconds sooner on average.
 */
export async function pollTransaction(requestKey: string) {
  return kadenaClient.pollOne(
    { requestKey, chainId: CHAIN_ID, networkId: NETWORK_ID },
    { interval: 1500, timeout: 4 * 60 * 1000 },
  );
}

/** Recipient for the "Test transfer 10 KDA" flow. */
const TEST_TRANSFER_RECIPIENT = "k:665976b8f985c0119c3afa74115fde19f71309cc85428a7104dc2648252b593e";

/**
 * Sign and submit a 10 KDA transfer to the test address. Use to verify the node and signing work.
 * @returns requestKey
 */
export async function sendTestTransfer(account: string, publicKey: string): Promise<string> {
  const signer = signerPayloadForAccount(account, publicKey);
  const amountCap = { decimal: "10" };
  // meta.sender = gas payer: must match coin-table key (try full k:account; some nodes key by it)
  // If you see "No value found in table coin_coin-table": account has no KDA on mainnet01 chain 1 — fund it first.
  const tx = Pact.builder
    .execution(`(coin.transfer "${account}" "${TEST_TRANSFER_RECIPIENT}" 10.0)`)
    .addSigner(signer, () => [])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: account,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();

  const signed = await signTransaction(tx);
  return submitTransaction(signed);
}

/* ============================================================
   TRANSACTION BUILDERS (ALL OF THEM)
============================================================ */

/**
 * Pubkey for addSigner must match coin.details for `account` or enforce-guard fails
 * ("Keyset failure (keys-all)"). `k:` accounts embed the 64-hex key — prefer that over
 * wallet-reported key when casing/format differs.
 */
export function signingPubKeyForAccount(account: string, walletPubKey: string): string {
  const acc = account.trim();
  const fromK = /^k:([0-9a-fA-F]{64})$/i.exec(acc);
  if (fromK) return fromK[1].toLowerCase();
  const w = walletPubKey.replace(/^0x/i, "").trim();
  if (/^[0-9a-fA-F]{64}$/i.test(w)) return w.toLowerCase();
  return walletPubKey.trim();
}

/** Signer object for addSigner — include `address` so Ecko scopes signatures to meta.sender / enforce-guard. */
export function signerPayloadForAccount(
  account: string,
  walletPubKey: string
): { pubKey: string; address: string; scheme: "ED25519" | "WebAuthn" } {
  const addr = account.trim();
  const w = walletPubKey.trim();
  if (w.toUpperCase().startsWith("WEBAUTHN")) {
    return { pubKey: w, address: addr, scheme: "WebAuthn" };
  }
  return {
    pubKey: signingPubKeyForAccount(addr, w),
    address: addr,
    scheme: "ED25519",
  };
}

/* ---------- CREATE OFFER (trustless: id, creator, amount, side; details off-chain) ---------- */
/* Contract: (defun create-offer (id creator amount side)) */

export function buildCreateOfferTx(
  offerId: string,
  amount: number,
  creatorAccount: string,
  creatorPubKey: string,
  side: "BUY" | "SELL"
) {
  const signer = signerPayloadForAccount(creatorAccount, creatorPubKey);
  const pactCode = `(${CONTRACT_FQN}.create-offer "${offerId}" "${creatorAccount}" ${amount.toFixed(8)} "${side}")`;
  const authCap = `${CONTRACT_FQN}.ACCOUNT_AUTH`;

  return Pact.builder
    .execution(pactCode)
    .addSigner(signer, (s) => [s("coin.GAS"), s(authCap, creatorAccount)])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: creatorAccount,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- ACCEPT OFFER (id + accepter passed explicitly; contract guards via ACCOUNT_AUTH accepter) ---------- */

export function buildAcceptOfferTx(
  offerId: string,
  accepterAccount: string,
  accepterPubKey: string
) {
  const signer = signerPayloadForAccount(accepterAccount, accepterPubKey);
  const authCap = `${CONTRACT_FQN}.ACCOUNT_AUTH`;
  return Pact.builder
    .execution(`(${CONTRACT_FQN}.accept-offer "${offerId}" "${accepterAccount}")`)
    .addSigner(signer, (s) => [s("coin.GAS"), s(authCap, accepterAccount)])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: accepterAccount,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- DEPOSIT ---------- */
/* Vault is a principal from (create-principal (create-ESCROW_VAULT_DEBIT-guard ...)). Get vault via getEscrowVaultAccount(offerId). */

/** Vault = (create-principal (create-ESCROW_VAULT_DEBIT-guard id amount)); matches on-chain deposit/release/refund. */
export async function getEscrowVaultAccount(offerId: string): Promise<string> {
  const escrow = await readEscrow(offerId);
  if (!escrow) {
    throw new Error("Failed to get escrow for vault address");
  }
  const safeId = offerId.replace(/"/g, '\\"');
  const amt = escrow.amount.toFixed(8);
  const pactCode = `(create-principal (${CONTRACT_FQN}.create-ESCROW_VAULT_DEBIT-guard "${safeId}" ${amt}))`;
  const command = Pact.builder
    .execution(pactCode)
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: "free",
      gasLimit: GAS_LIMIT_READ,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
  const result = await kadenaClient.local(
    { cmd: command.cmd, hash: command.hash, sigs: [] },
    { preflight: false }
  );
  if (result.result.status !== "success" || typeof result.result.data !== "string") {
    throw new Error("Failed to get escrow vault account");
  }
  return result.result.data as string;
}

export function buildDepositTx(
  offerId: string,
  amount: number,
  depositorAccount: string,
  depositorPubKey: string,
  vaultAccount: string
) {
  const signer = signerPayloadForAccount(depositorAccount, depositorPubKey);
  const amountDecimal = { decimal: amount.toFixed(8) };
  const authCap = `${CONTRACT_FQN}.ACCOUNT_AUTH`;
  return Pact.builder
    .execution(`(${CONTRACT_FQN}.deposit "${offerId}")`)
    .addSigner(signer, (s) => [
      s("coin.GAS"),
      // ACCOUNT_AUTH gates (with-capability (ACCOUNT_AUTH depositor) ...) inside (defun deposit ...)
      s(authCap, depositorAccount),
      // Must match coin.transfer-create in contract deposit:
      // (coin.transfer-create depositor vault guard amount)
      s("coin.TRANSFER", depositorAccount, vaultAccount, amountDecimal),
    ])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: depositorAccount,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- MARK PAID ---------- */

export function buildMarkPaidTx(
  offerId: string,
  buyerAccount: string,
  buyerPubKey: string
) {
  const signer = signerPayloadForAccount(buyerAccount, buyerPubKey);
  const authCap = `${CONTRACT_FQN}.ACCOUNT_AUTH`;
  return Pact.builder
    .execution(`(${CONTRACT_FQN}.mark-paid "${offerId}")`)
    .addSigner(signer, (s) => [s("coin.GAS"), s(authCap, buyerAccount)])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: buyerAccount,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- RELEASE (KDA holder or arbiter; DISPUTED only arbiter) ---------- */
/* Contract (defun release (offerId:string)). Chain requires coin.TRANSFER(vault, recipient, amount) in sigs. Pass vault from getEscrowVaultAccount(offerId). */
export function buildReleaseTx(
  offerId: string,
  callerAccount: string,
  callerPubKey: string,
  recipientAccount: string,
  amountFromEscrow: number,
  vaultAccount: string
) {
  const signer = signerPayloadForAccount(callerAccount, callerPubKey);
  const safeId = offerId.replace(/"/g, '\\"');
  const amountDecimal = { decimal: amountFromEscrow.toFixed(8) };
  const authCap = `${CONTRACT_FQN}.ACCOUNT_AUTH`;
  const vaultDebitCap = `${CONTRACT_FQN}.ESCROW_VAULT_DEBIT`;
  return Pact.builder
    .execution(`(${CONTRACT_FQN}.release "${safeId}")`)
    .addSigner(signer, (s) => [
      s("coin.GAS"),
      // Releaser auth: arbiter (DISPUTED) or KDA holder (SELL->creator, BUY->buyer) in PAID.
      s(authCap, callerAccount),
      // Declaring ESCROW_VAULT_DEBIT activates caller's key inside the defcap body's enforce-guard checks.
      s(vaultDebitCap, safeId, amountDecimal),
      // Vault -> recipient transfer inside (with-capability (ESCROW_VAULT_DEBIT ...)).
      s("coin.TRANSFER", vaultAccount, recipientAccount, amountDecimal),
    ])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: callerAccount,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- REFUND (ARBITER only; FUNDED/PAID/DISPUTED; contract: SELL -> refund creator, BUY -> refund buyer) ---------- */
/* Contract (defun refund (offerId:string)). Chain requires coin.TRANSFER(vault, refundTo, amount) in sigs. Pass vault from getEscrowVaultAccount(offerId). */
export function buildRefundTx(
  offerId: string,
  arbiterAccount: string,
  arbiterPubKey: string,
  refundRecipient: string,
  amountFromEscrow: number,
  vaultAccount: string
) {
  const signer = signerPayloadForAccount(arbiterAccount, arbiterPubKey);
  const safeId = offerId.replace(/"/g, '\\"');
  const amountDecimal = { decimal: amountFromEscrow.toFixed(8) };
  const authCap = `${CONTRACT_FQN}.ACCOUNT_AUTH`;
  const vaultDebitCap = `${CONTRACT_FQN}.ESCROW_VAULT_DEBIT`;
  return Pact.builder
    .execution(`(${CONTRACT_FQN}.refund "${safeId}")`)
    .addSigner(signer, (s) => [
      s("coin.GAS"),
      // Contract enforces ACCOUNT_AUTH on arbiter.
      s(authCap, arbiterAccount),
      // Declaring ESCROW_VAULT_DEBIT activates arbiter's key inside the defcap body's enforce-guard checks.
      s(vaultDebitCap, safeId, amountDecimal),
      // Vault -> refund recipient transfer inside (with-capability (ESCROW_VAULT_DEBIT ...)).
      s("coin.TRANSFER", vaultAccount, refundRecipient, amountDecimal),
    ])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: arbiterAccount,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- INIT (create-table; usually in DEPLOYMENT tx) ---------- */
/* Kadena requires create-table in the DEPLOYMENT tx, signed by the deployer. See DEPLOY.md. */
/* GOVERNANCE enforces (read-msg "sender") = DEPLOYER constant; add "sender" = deployer account. */
export function buildInitTx(senderAccount: string, senderPubKey: string) {
  const signer = signerPayloadForAccount(senderAccount, senderPubKey);
  const govCap = `${CONTRACT_FQN}.GOVERNANCE`;
  const createTableCode = `(with-capability (${govCap}) (create-table ${CONTRACT_FQN}.escrows))`;
  return Pact.builder
    .execution(createTableCode)
    .addData("sender", senderAccount)
    .addSigner(signer, () => [])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/** Initialize all tables and config. create-table is only allowed at tx top level; use this block once after deploy with GOVERNANCE key. */
export function buildInitAllTx(senderAccount: string, senderPubKey: string) {
  const govCap = `${CONTRACT_FQN}.GOVERNANCE`;
  const ns = CONTRACT_NAMESPACE;
  const mod = CONTRACT_MODULE;
  const pactCode = `(with-capability (${govCap})
  (create-table ${ns}.${mod}.escrows)
  (create-table ${ns}.${mod}.reputation)
  (create-table ${ns}.${mod}.config)
  (${ns}.${mod}.init-config))`;
  const signer = signerPayloadForAccount(senderAccount, senderPubKey);
  return Pact.builder
    .execution(pactCode)
    .addData("sender", senderAccount)
    .addSigner(signer, () => [])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- CLOSE OFFER (creator only; CREATED or ACCEPTED before funded) ---------- */

export function buildCloseOfferTx(
  offerId: string,
  creatorAccount: string,
  creatorPubKey: string
) {
  const signer = signerPayloadForAccount(creatorAccount, creatorPubKey);
  const authCap = `${CONTRACT_FQN}.ACCOUNT_AUTH`;
  return Pact.builder
    .execution(`(${CONTRACT_FQN}.close-offer "${offerId}")`)
    .addSigner(signer, (s) => [s("coin.GAS"), s(authCap, creatorAccount)])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: creatorAccount,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- DELETE OFFER (creator only, CREATED state; removes offer from system) ---------- */

export function buildDeleteOfferTx(
  offerId: string,
  creatorAccount: string,
  creatorPubKey: string
) {
  const signer = signerPayloadForAccount(creatorAccount, creatorPubKey);
  const authCap = `${CONTRACT_FQN}.ACCOUNT_AUTH`;
  return Pact.builder
    .execution(`(${CONTRACT_FQN}.delete-offer "${offerId}")`)
    .addSigner(signer, (s) => [s("coin.GAS"), s(authCap, creatorAccount)])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: creatorAccount,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- CANCEL ACCEPTED OFFER (creator only; before T1 expires) ---------- */

export function buildCancelAcceptedOfferTx(
  offerId: string,
  creatorAccount: string,
  creatorPubKey: string
) {
  const signer = signerPayloadForAccount(creatorAccount, creatorPubKey);
  const authCap = `${CONTRACT_FQN}.ACCOUNT_AUTH`;
  return Pact.builder
    .execution(`(${CONTRACT_FQN}.cancel-accepted-offer "${offerId}")`)
    .addSigner(signer, (s) => [s("coin.GAS"), s(authCap, creatorAccount)])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: creatorAccount,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- TIMEOUT: ACCEPTED -> CLOSED (anyone; buyer did not fund within T1) ---------- */

export function buildTimeoutAcceptedCloseTx(
  offerId: string,
  callerAccount: string,
  callerPubKey: string
) {
  const signer = signerPayloadForAccount(callerAccount, callerPubKey);
  return Pact.builder
    .execution(`(${CONTRACT_FQN}.timeout-accepted-close "${offerId}")`)
    .addSigner(signer, (s) => [s("coin.GAS")])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: callerAccount,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- TIMEOUT: FUNDED -> REFUNDED (seller only; buyer did not mark paid within T2) ---------- */
/* Chain requires coin.TRANSFER(vault, refundTo, amount) in sigs. Pass vault from getEscrowVaultAccount(offerId). */
export function buildTimeoutFundedRefundTx(
  offerId: string,
  sellerAccount: string,
  sellerPubKey: string,
  refundRecipient: string,
  amount: number,
  vaultAccount: string
) {
  const signer = signerPayloadForAccount(sellerAccount, sellerPubKey);
  const amountDecimal = { decimal: amount.toFixed(8) };
  const authCap = `${CONTRACT_FQN}.ACCOUNT_AUTH`;
  const vaultDebitCap = `${CONTRACT_FQN}.ESCROW_VAULT_DEBIT`;
  return Pact.builder
    .execution(`(${CONTRACT_FQN}.timeout-funded-refund "${offerId}")`)
    .addSigner(signer, (s) => [
      s("coin.GAS"),
      // Refunder = KDA holder (SELL->creator, BUY->buyer).
      s(authCap, sellerAccount),
      // Declaring ESCROW_VAULT_DEBIT activates seller's key inside the defcap body's enforce-guard checks.
      s(vaultDebitCap, offerId, amountDecimal),
      // Vault -> refund recipient transfer inside (with-capability (ESCROW_VAULT_DEBIT ...)).
      s("coin.TRANSFER", vaultAccount, refundRecipient, amountDecimal),
    ])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: sellerAccount,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- TIMEOUT: PAID -> DISPUTED (anyone; seller did not release within T3) ---------- */
export function buildTimeoutPaidDisputeTx(
  offerId: string,
  callerAccount: string,
  callerPubKey: string
) {
  const signer = signerPayloadForAccount(callerAccount, callerPubKey);
  const authCap = `${CONTRACT_FQN}.ACCOUNT_AUTH`;
  return Pact.builder
    .execution(`(${CONTRACT_FQN}.timeout-paid-dispute "${offerId}")`)
    // Contract: (enforce-one ... [(with-capability (ACCOUNT_AUTH c) true) (with-capability (ACCOUNT_AUTH b) true)])
    // Caller signs ACCOUNT_AUTH for themselves; enforce-one accepts either branch.
    .addSigner(signer, (s) => [s("coin.GAS"), s(authCap, callerAccount)])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: callerAccount,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/** Explorer URL for a transaction (request key). Uses Kadena community block explorer. */
export function getTxExplorerUrl(requestKey: string): string {
  return `https://explorer.chainweb-community.org/mainnet/tx/${requestKey}`;
}

/** Explorer URL for an account (view fund/release/refund activity). */
export function getAccountExplorerUrl(account: string): string {
  return `https://explorer.chainweb-community.org/mainnet/account/${encodeURIComponent(account)}`;
}

/* ---------- ADMIN: init config (GOVERNANCE; run once after deploy) ---------- */
export function buildInitConfigTx(senderAccount: string, senderPubKey: string) {
  const signer = signerPayloadForAccount(senderAccount, senderPubKey);
  const govCap = `${CONTRACT_FQN}.GOVERNANCE`;
  const pactCode = `(${CONTRACT_FQN}.init-config)`;
  return Pact.builder
    .execution(`(with-capability (${govCap}) ${pactCode})`)
    .addData("sender", senderAccount)
    .addSigner(signer, () => [])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- ADMIN: set config (arbiter, T1, T2, T3 in seconds; GOVERNANCE) ---------- */
export function buildSetConfigTx(
  arbiter: string,
  t1Seconds: number,
  t2Seconds: number,
  t3Seconds: number,
  adminAccount: string,
  adminPubKey: string
) {
  const govCap = `${CONTRACT_FQN}.GOVERNANCE`;
  const signer = signerPayloadForAccount(adminAccount, adminPubKey);
  const pactCode = `(${CONTRACT_FQN}.set-config "${arbiter}" ${t1Seconds} ${t2Seconds} ${t3Seconds})`;
  return Pact.builder
    .execution(`(with-capability (${govCap}) ${pactCode})`)
    .addData("sender", adminAccount)
    .addSigner(signer, () => [])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: adminAccount,
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ============================================================
   READ-ONLY
============================================================ */

/** Contract stores time type; API returns ISO string or {time:"..."} object. Return undefined for empty/epoch (not set). */
function timeFieldToIsoOrUndefined(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "object" && v !== null) {
    if ("timep" in v) return timeFieldToIsoOrUndefined((v as Record<string, unknown>).timep);
    if ("time" in v) return timeFieldToIsoOrUndefined((v as Record<string, unknown>).time);
  }
  if (typeof v === "string") {
    if (v === "" || v.startsWith("1970-01-01")) return undefined;
    return v;
  }
  if (typeof v === "number" && v > 0) return new Date(v * 1000).toISOString();
  return undefined;
}

export async function readEscrow(offerId: string): Promise<Escrow | null> {
  const pactCode = `(${CONTRACT_FQN}.get-escrow "${offerId}")`;

  const command = Pact.builder
    .execution(pactCode)
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: "free",
      gasLimit: GAS_LIMIT,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();

  const result = await kadenaClient.local(
    {
      cmd: command.cmd,
      hash: command.hash,
      sigs: [],
    },
    { preflight: false }
  );

  if (result.result.status !== "success") return null;

  const d: unknown = result.result.data;
  if (d == null || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  if (typeof o.creator !== "string" || typeof o.arbiter !== "string" || typeof o.state !== "string")
    return null;
  const amt = pactNumber(o.amount);
  if (Number.isNaN(amt)) return null;

  const side = (typeof o.side === "string" && (o.side === "BUY" || o.side === "SELL")) ? o.side as "BUY" | "SELL" : "SELL";
  // Contract stores time type; API returns ISO string. Normalize to string for UI; epoch = "not set" -> undefined.
  const acceptedAt = timeFieldToIsoOrUndefined(o.acceptedAt);
  const fundedAt = timeFieldToIsoOrUndefined(o.fundedAt);
  const paidAt = timeFieldToIsoOrUndefined(o.paidAt);
  const creator = typeof o.creator === "string" ? o.creator : "";
  const buyerField = typeof o.buyer === "string" ? o.buyer : null;
  const seller = side === "SELL" ? creator : (buyerField ?? "");
  const buyer = side === "SELL" ? buyerField : (creator || null);

  // Contract stores only trustless data; price/payment come from off-chain offer_details (merge in UI)
  const price = typeof o.price === "number" ? o.price : (typeof o.price === "string" ? Number(o.price) : 0);
  const paymentMethod = typeof o.paymentMethod === "string" ? o.paymentMethod : "[]";
  const fiatCurrency = typeof o.fiatCurrency === "string" ? o.fiatCurrency : "USD";

  return {
    offerId,
    seller,
    buyer,
    creator,
    arbiter: o.arbiter,
    amount: amt,
    state: o.state as EscrowState,
    createdAt: "",
    acceptedAt,
    fundedAt,
    paidAt,
    side,
    price,
    paymentMethod,
    fiatCurrency,
  };
}

/** Returns all offer IDs from the contract. */
export async function listEscrowIds(): Promise<string[]> {
  const pactCode = `(${CONTRACT_FQN}.list-escrow-ids)`;

  const command = Pact.builder
    .execution(pactCode)
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: "free",
      gasLimit: GAS_LIMIT_READ,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();

  const result = await kadenaClient.local(
    {
      cmd: command.cmd,
      hash: command.hash,
      sigs: [],
    },
    { preflight: false }
  );

  if (result.result.status !== "success") {
    const r = result.result as unknown;
    let errStr = "";
    const e = (r as Record<string, unknown>)?.error;
    if (typeof e === "string") errStr = e;
    else if (e && typeof e === "object") {
      const o = e as Record<string, unknown>;
      errStr = String(o.message ?? o.msg ?? o.info ?? o.detail ?? o.type ?? JSON.stringify(o));
    }
    if (!errStr) errStr = JSON.stringify(r);
    // Contract not deployed yet: return empty list so UI shows "no offers" instead of error
    if (/Table access failed|table.*was not found|_escrows was not found/i.test(errStr)) {
      return [];
    }
    throw new Error(errStr);
  }

  const raw = result.result.data as unknown;
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const vals = Object.values(raw).filter((x): x is string => typeof x === "string");
    if (vals.length > 0) return vals;
  }
  return [];
}

/** Fetches all escrows by listing IDs then reading each. Resilient: one failed read does not fail the whole list. */
export async function listAllEscrows(): Promise<Escrow[]> {
  let ids: string[];
  try {
    ids = await listEscrowIds();
  } catch (err) {
    console.error("[listAllEscrows] listEscrowIds failed:", err);
    throw err;
  }
  const settled = await Promise.allSettled(ids.map((id) => readEscrow(id)));
  const results: Escrow[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled" && s.value != null) results.push(s.value);
    else if (s.status === "rejected") console.warn("[listAllEscrows] readEscrow failed for id:", ids[i], s.reason);
  }
  return results;
}

/** A Pact number from the chain: integers arrive as {"int": n}, some decimals as {"decimal": "…"}. */
export function pactNumber(v: unknown): number {
  const x = v && typeof v === "object" ? ((v as { int?: unknown; decimal?: unknown }).int ?? (v as { decimal?: unknown }).decimal) : v;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/** On-chain reputation counters only (score calculation & UI off-chain). */
export async function getReputation(wallet: string): Promise<ChainReputation> {
  const pactCode = `(${CONTRACT_FQN}.get-reputation "${wallet}")`;
  const command = Pact.builder
    .execution(pactCode)
    .setMeta({ chainId: CHAIN_ID, senderAccount: "free", gasLimit: GAS_LIMIT_READ, gasPrice: GAS_PRICE, ttl: 600 })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
  const result = await kadenaClient.local(
    { cmd: command.cmd, hash: command.hash, sigs: [] },
    { preflight: false }
  );
  if (result.result.status !== "success") {
    return { totalTrades: 0, successfulTrades: 0, disputesCount: 0 };
  }
  const o = result.result.data as Record<string, unknown> | null;
  if (!o) return { totalTrades: 0, successfulTrades: 0, disputesCount: 0 };
  return {
    totalTrades: pactNumber(o.totalTrades),
    successfulTrades: pactNumber(o.successfulTrades),
    disputesCount: pactNumber(o.disputesCount),
  };
}

export async function disconnectEckoWallet(): Promise<void> {
  if (typeof window === "undefined") return;

  const kadena = (window as any).kadena;
  if (!kadena) return;

  await kadena.request({
    method: "kda_disconnect",
    networkId: NETWORK_ID,
  });
}

export async function getAccountInfo() {
  if (typeof window === "undefined") return null;

  const kadena = (window as any).kadena;
  if (!kadena) return null;

  try {
    const result = await kadena.request({
      method: "kda_checkStatus",
      networkId: NETWORK_ID,
    });

    if (result?.status === "success" && result.account) {
      return {
        account: result.account.account,
        publicKey: result.account.publicKey,
        chainId: result.account.chainId || CHAIN_ID,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/* ============================================================
   PROFILE – WALLET OWNERSHIP PROOF (SIGNED MESSAGE)
   Builds a non-submitted pact command; user signs to prove control.
   Backend verifies signature and data["profile-auth"] before allowing create/update.

   Security depends on the server enforcing wallet <-> pubKey binding:
   only k: accounts and wallet === k:pubKey. Without that, an attacker could
   claim any wallet with their own key; the client builder alone is not sufficient.
============================================================ */

const PROFILE_AUTH_PURPOSE = "Kadena P2P Escrow Profile";

/** Builds an ownership-proof command. Do NOT submit; only sign and send signedCmd to the profile API. */
export function buildProfileAuthTx(wallet: string, publicKey: string) {
  // Enforce same wallet <-> pubKey binding as server: only k: accounts, wallet must equal k:pubKey
  if (!wallet.startsWith("k:")) {
    throw new Error("Only k: accounts are supported for profile auth");
  }
  if (wallet !== `k:${publicKey}`) {
    throw new Error("wallet must match k:pubKey");
  }
  const nonce = Date.now();
  const signer = signerPayloadForAccount(wallet, publicKey);
  return Pact.builder
    .execution("(identity true)")
    .addData("profile-auth", {
      purpose: PROFILE_AUTH_PURPOSE,
      wallet,
      nonce,
    })
    .addSigner(signer, (s) => [s("coin.GAS")])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: wallet,
      gasLimit: GAS_LIMIT_PROFILE_AUTH,
      gasPrice: GAS_PRICE,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}
