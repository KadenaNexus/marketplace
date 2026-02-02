import { IUnsignedCommand, Pact, createClient, createSignWithEckoWallet } from "@kadena/client";

/* ============================================================
   NETWORK CONFIG
============================================================ */

export const NETWORK_ID = "mainnet01";
export const CHAIN_ID = "1";

// Chaddex blocks CORS from browser. In dev we use a Vite proxy; in prod we use the official API.
const API_CHAINWEB_PACT = `https://chainweb.chaddex.com/chainweb/0.0/${NETWORK_ID}/chain/${CHAIN_ID}/pact`;

export const API_HOST =
  import.meta.env.DEV && typeof window !== "undefined"
    ? `${window.location.origin}/chainweb-proxy`
    : API_CHAINWEB_PACT;

// Must match deployment: (describe-module "{ns}.{mod}") or deployment logs.
export const CONTRACT_NAMESPACE = "free";
export const CONTRACT_MODULE = "p2p-escrow";

export const kadenaClient = createClient(API_HOST);

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
  | "DISPUTED";

/** Time limits for timed steps (seconds). Match contract T1/T2/T3. */
export const T1_SECONDS = 600;
export const T2_SECONDS = 600;
export const T3_SECONDS = 600;

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
  /** ISO timestamp when offer was accepted (for T1 countdown). */
  acceptedAt?: string;
  /** ISO timestamp when escrow was funded (for T2 countdown). */
  fundedAt?: string;
  /** ISO timestamp when buyer marked paid (for T3 countdown). */
  paidAt?: string;
  // Binance P2P style fields
  side: "BUY" | "SELL";
  price: number;
  minAmount: number;
  maxAmount: number;
  paymentMethod: string; // JSON string array
  fiatCurrency: string;
}

export interface WalletAccount {
  account: string;
  publicKey: string;
  chainId: string;
}

/** On-chain event for UI / logs (state transitions). */
export interface EscrowEvent {
  txHash: string;
  offerId: string;
  eventType: string;
  fromState: string;
  toState: string;
  actor: string;
  blockTime: string;
}

/** Completed trade (rating enforcement: only these can be rated). */
export interface CompletedTrade {
  offerId: string;
  buyer: string;
  seller: string;
  completedAt: string;
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

export async function signTransaction(command: IUnsignedCommand) {
  const wallet = createSignWithEckoWallet();

  if (!command?.cmd || !command?.hash) {
    console.error("Invalid command:", command);
    throw new Error("Invalid command passed to wallet");
  }

  return wallet(command);
}

export async function submitTransaction(signedCmd: any): Promise<string> {
  const cmd = signedCmd?.signedCmd ?? signedCmd;
  const body = { cmds: Array.isArray(cmd) ? cmd : [cmd] };
  const url = `${API_HOST}/api/v1/send`;
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
  return keys[0];
}

export async function pollTransaction(requestKey: string) {
  return kadenaClient.pollOne({
    requestKey,
    chainId: CHAIN_ID,
    networkId: NETWORK_ID,
  });
}

/** Recipient for the "Test transfer 10 KDA" flow. */
const TEST_TRANSFER_RECIPIENT = "k:665976b8f985c0119c3afa74115fde19f71309cc85428a7104dc2648252b593e";

/**
 * Sign and submit a 10 KDA transfer to the test address. Use to verify the node and signing work.
 * @returns requestKey
 */
export async function sendTestTransfer(account: string, publicKey: string): Promise<string> {
  const amountCap = { decimal: "10" };
  // meta.sender = gas payer: must match coin-table key (try full k:account; some nodes key by it)
  // If you see "No value found in table coin_coin-table": account has no KDA on mainnet01 chain 1 — fund it first.
  const tx = Pact.builder
    .execution(`(coin.transfer "${account}" "${TEST_TRANSFER_RECIPIENT}" 10.0)`)
    .addSigner(publicKey, (s) => [
      s("coin.GAS"),
      s("coin.TRANSFER", account, TEST_TRANSFER_RECIPIENT, amountCap),
    ])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: account,
      gasLimit: 2500,
      gasPrice: 0.00001,
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

/* ---------- CREATE OFFER (Binance P2P style with side, price, limits, payment method) ---------- */

/** Creator is seller for SELL offers, buyer for BUY offers. */
export function buildCreateOfferTx(
  offerId: string,
  amount: number,
  creatorAccount: string,
  creatorPubKey: string,
  side: "BUY" | "SELL",
  price: number,
  minAmount: number,
  maxAmount: number,
  paymentMethod: string, // JSON string array
  fiatCurrency: string
) {
  const pactCode = `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.create-offer "${offerId}" "${creatorAccount}" ${amount.toFixed(8)} "${side}" ${price.toFixed(8)} ${minAmount.toFixed(8)} ${maxAmount.toFixed(8)} "${paymentMethod}" "${fiatCurrency}")`;

  return Pact.builder
    .execution(pactCode)
    .addData("sender", creatorAccount)
    .addSigner(creatorPubKey, (signFor) => [signFor("coin.GAS")])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: creatorAccount,
      gasLimit: 25000,
      gasPrice: 0.00001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- ACCEPT OFFER (id only; caller becomes the buyer) ---------- */

export function buildAcceptOfferTx(
  offerId: string,
  buyerAccount: string,
  buyerPubKey: string
) {
  return Pact.builder
    .execution(`(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.accept-offer "${offerId}")`)
    .addData("sender", buyerAccount)
    .addSigner(buyerPubKey, (s) => [s("coin.GAS")])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: buyerAccount,
      gasLimit: 25000,
      gasPrice: 0.00001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- DEPOSIT ---------- */
/* depositorAccount: KDA holder (SELL=creator, BUY=buyer field). Contract uses coin.transfer-create
   so the vault is created on first deposit. vault-guard: keyset with keys:[] so no one can spend
   from vault except via the contract (release/refund). */

const VAULT_GUARD = { keys: [] as string[], pred: "keys-all" as const };

export function buildDepositTx(
  offerId: string,
  amount: number,
  depositorAccount: string,
  depositorPubKey: string
) {
  const amountDecimal = { decimal: amount.toFixed(8) };
  return Pact.builder
    .execution(`(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.deposit "${offerId}")`)
    .addData("sender", depositorAccount)
    .addData("vault-guard", VAULT_GUARD)
    .addSigner(depositorPubKey, (s) => [
      s("coin.GAS"),
      s("coin.TRANSFER", depositorAccount, "p2p-escrow-vault", amountDecimal),
      s("coin.TRANSFER-CREATE", depositorAccount, "p2p-escrow-vault", VAULT_GUARD, amountDecimal),
    ])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: depositorAccount,
      gasLimit: 25000,
      gasPrice: 0.00001,
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
  return Pact.builder
    .execution(`(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.mark-paid "${offerId}")`)
    .addData("sender", buyerAccount)
    .addSigner(buyerPubKey, (s) => [s("coin.GAS")])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: buyerAccount,
      gasLimit: 25000,
      gasPrice: 0.00001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- RELEASE (seller or arbiter; contract does coin.transfer VAULT_ACCOUNT buyer amt) ---------- */

export function buildReleaseTx(
  offerId: string,
  callerAccount: string,
  callerPubKey: string,
  buyerFromEscrow: string,
  amountFromEscrow: number
) {
  const amt = { decimal: amountFromEscrow.toFixed(8) };
  return Pact.builder
    .execution(`(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.release "${offerId}")`)
    .addData("sender", callerAccount)
    .addSigner(callerPubKey, (s) => [
      s("coin.GAS"),
      s("coin.TRANSFER", "p2p-escrow-vault", buyerFromEscrow, amt),
    ])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: callerAccount,
      gasLimit: 25000,
      gasPrice: 0.00001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- REFUND (ARBITER; from FUNDED or PAID; contract does coin.transfer VAULT_ACCOUNT seller amt) ---------- */

export function buildRefundTx(
  offerId: string,
  arbiterAccount: string,
  arbiterPubKey: string,
  sellerFromEscrow: string,
  amountFromEscrow: number
) {
  const amt = { decimal: amountFromEscrow.toFixed(8) };
  return Pact.builder
    .execution(`(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.refund "${offerId}")`)
    .addData("sender", arbiterAccount)
    .addSigner(arbiterPubKey, (s) => [
      s("coin.GAS"),
      s("coin.TRANSFER", "p2p-escrow-vault", sellerFromEscrow, amt),
    ])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: arbiterAccount,
      gasLimit: 25000,
      gasPrice: 0.00001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- INIT (create-table; usually in DEPLOYMENT tx) ---------- */
/* Kadena requires create-table in the DEPLOYMENT tx, signed by the deployer. See DEPLOY.md. */

export function buildInitTx(senderAccount: string, senderPubKey: string) {
  const govCap = `${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.GOVERNANCE`;
  const createTableCode = `(with-capability (${govCap}) (create-table ${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.escrows))`;
  return Pact.builder
    .execution(createTableCode)
    .addSigner(senderPubKey, (s) => [s("coin.GAS"), s(govCap)])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount,
      gasLimit: 25000,
      gasPrice: 0.00001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/** Initialize all tables (escrows, events, completed-trades, config, offer-event-ids) and run init-config. Run once after deploy. */
export function buildInitAllTx(senderAccount: string, senderPubKey: string) {
  const govCap = `${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.GOVERNANCE`;
  const ns = CONTRACT_NAMESPACE;
  const mod = CONTRACT_MODULE;
  const code = `(with-capability (${govCap})
    (create-table ${ns}.${mod}.escrows)
    (create-table ${ns}.${mod}.events)
    (create-table ${ns}.${mod}.completed-trades)
    (create-table ${ns}.${mod}.config)
    (create-table ${ns}.${mod}.offer-event-ids)
    (${ns}.${mod}.init-config))`;
  return Pact.builder
    .execution(code)
    .addSigner(senderPubKey, (s) => [s("coin.GAS"), s(govCap)])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount,
      gasLimit: 60000,
      gasPrice: 0.00001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- CLOSE OFFER (creator only, CREATED state; SELL=seller, BUY=buyer) ---------- */

export function buildCloseOfferTx(
  offerId: string,
  creatorAccount: string,
  creatorPubKey: string
) {
  return Pact.builder
    .execution(`(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.close-offer "${offerId}")`)
    .addData("sender", creatorAccount)
    .addSigner(creatorPubKey, (s) => [s("coin.GAS")])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: creatorAccount,
      gasLimit: 25000,
      gasPrice: 0.00001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- TIMEOUT: ACCEPTED -> CLOSED (anyone; seller did not fund within T1) ---------- */
export function buildTimeoutAcceptedCloseTx(
  offerId: string,
  callerAccount: string,
  callerPubKey: string
) {
  return Pact.builder
    .execution(`(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.timeout-accepted-close "${offerId}")`)
    .addData("sender", callerAccount)
    .addSigner(callerPubKey, (s) => [s("coin.GAS")])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: callerAccount,
      gasLimit: 25000,
      gasPrice: 0.00001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- TIMEOUT: FUNDED -> REFUNDED (seller only; buyer did not mark paid within T2) ---------- */
export function buildTimeoutFundedRefundTx(
  offerId: string,
  sellerAccount: string,
  sellerPubKey: string,
  amount: number
) {
  const amt = { decimal: amount.toFixed(8) };
  return Pact.builder
    .execution(`(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.timeout-funded-refund "${offerId}")`)
    .addData("sender", sellerAccount)
    .addSigner(sellerPubKey, (s) => [
      s("coin.GAS"),
      s("coin.TRANSFER", "p2p-escrow-vault", sellerAccount, amt),
    ])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: sellerAccount,
      gasLimit: 25000,
      gasPrice: 0.00001,
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
  return Pact.builder
    .execution(`(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.timeout-paid-dispute "${offerId}")`)
    .addData("sender", callerAccount)
    .addSigner(callerPubKey, (s) => [s("coin.GAS")])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: callerAccount,
      gasLimit: 25000,
      gasPrice: 0.00001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/** Explorer URL for a request key (mainnet). */
export function getTxExplorerUrl(requestKey: string): string {
  return `https://explorer.chainweb.com/mainnet/tx/${requestKey}`;
}

/* ---------- ADMIN: init config (GOVERNANCE; run once after deploy) ---------- */
export function buildInitConfigTx(senderAccount: string, senderPubKey: string) {
  const govCap = `${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.GOVERNANCE`;
  const pactCode = `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.init-config)`;
  return Pact.builder
    .execution(pactCode)
    .addSigner(senderPubKey, (s) => [s("coin.GAS"), s(govCap)])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount,
      gasLimit: 25000,
      gasPrice: 0.00001,
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
  const govCap = `${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.GOVERNANCE`;
  const pactCode = `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.set-config "${arbiter}" ${t1Seconds} ${t2Seconds} ${t3Seconds})`;
  return Pact.builder
    .execution(pactCode)
    .addSigner(adminPubKey, (s) => [s("coin.GAS"), s(govCap)])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: adminAccount,
      gasLimit: 25000,
      gasPrice: 0.00001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ============================================================
   READ-ONLY
============================================================ */

export async function readEscrow(offerId: string): Promise<Escrow | null> {
  const pactCode = `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.get-escrow "${offerId}")`;

  const command = Pact.builder
    .execution(pactCode)
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: "free",
      gasLimit: 25000,
      gasPrice: 0.00001,
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
  const amt = Number(o.amount);
  if (Number.isNaN(amt)) return null;

  // Parse new Binance P2P fields (with defaults for backward compatibility)
  const side = (typeof o.side === "string" && (o.side === "BUY" || o.side === "SELL")) ? o.side as "BUY" | "SELL" : "SELL";
  const price = typeof o.price === "number" ? o.price : (typeof o.price === "string" ? Number(o.price) : 0);
  const minAmount = typeof o.minAmount === "number" ? o.minAmount : (typeof o.minAmount === "string" ? Number(o.minAmount) : amt);
  const maxAmount = typeof o.maxAmount === "number" ? o.maxAmount : (typeof o.maxAmount === "string" ? Number(o.maxAmount) : amt);
  const paymentMethod = typeof o.paymentMethod === "string" ? o.paymentMethod : "[]";
  const fiatCurrency = typeof o.fiatCurrency === "string" ? o.fiatCurrency : "USD";

  const acceptedAt = typeof o.acceptedAt === "string" ? o.acceptedAt : undefined;
  const fundedAt = typeof o.fundedAt === "string" ? o.fundedAt : undefined;
  const paidAt = typeof o.paidAt === "string" ? o.paidAt : undefined;

  const creator = typeof o.creator === "string" ? o.creator : "";
  const buyerField = typeof o.buyer === "string" ? o.buyer : null;
  // SELL: creator=seller (KDA holder), buyer field=fiat payer. BUY: creator=fiat payer, buyer field=seller (KDA holder).
  const seller = side === "SELL" ? creator : (buyerField ?? "");
  const buyer = side === "SELL" ? buyerField : (creator || null);

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
    minAmount,
    maxAmount,
    paymentMethod,
    fiatCurrency,
  };
}

/** Returns all offer IDs from the contract. */
export async function listEscrowIds(): Promise<string[]> {
  const pactCode = `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.list-escrow-ids)`;

  const command = Pact.builder
    .execution(pactCode)
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: "free",
      gasLimit: 100000,
      gasPrice: 0.00001,
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
    if (/Table access failed|table.*was not found|_escrows was not found/i.test(errStr)) {
      throw new Error("TABLE_NOT_FOUND");
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

/** Fetches all escrows by listing IDs then reading each. */
export async function listAllEscrows(): Promise<Escrow[]> {
  const ids = await listEscrowIds();
  const results = await Promise.all(ids.map((id) => readEscrow(id)));
  return results.filter((e): e is Escrow => e != null);
}

/** Returns event tx-hash IDs for an offer (newest first). For UI / logs. */
export async function getEventIdsForOffer(offerId: string): Promise<string[]> {
  const pactCode = `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.get-event-ids-for-offer "${offerId}")`;
  const command = Pact.builder
    .execution(pactCode)
    .setMeta({ chainId: CHAIN_ID, senderAccount: "free", gasLimit: 25000, gasPrice: 0.00001, ttl: 600 })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
  const result = await kadenaClient.local(
    { cmd: command.cmd, hash: command.hash, sigs: [] },
    { preflight: false }
  );
  if (result.result.status !== "success") return [];
  const raw = result.result.data as unknown;
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  return [];
}

/** Returns a single event by tx-hash. */
export async function getEventByTxHash(txHash: string): Promise<EscrowEvent | null> {
  const pactCode = `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.get-event-by-tx "${txHash}")`;
  const command = Pact.builder
    .execution(pactCode)
    .setMeta({ chainId: CHAIN_ID, senderAccount: "free", gasLimit: 25000, gasPrice: 0.00001, ttl: 600 })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
  const result = await kadenaClient.local(
    { cmd: command.cmd, hash: command.hash, sigs: [] },
    { preflight: false }
  );
  if (result.result.status !== "success") return null;
  const o = result.result.data as Record<string, unknown> | null;
  if (!o || typeof o.offerId !== "string") return null;
  return {
    txHash,
    offerId: o.offerId as string,
    eventType: (o.eventType as string) ?? "",
    fromState: (o.fromState as string) ?? "",
    toState: (o.toState as string) ?? "",
    actor: (o.actor as string) ?? "",
    blockTime: (o.blockTime as string) ?? "",
  };
}

/** Fetches all events for an offer (for UI updates / activity log). */
export async function getEscrowEvents(offerId: string): Promise<EscrowEvent[]> {
  const ids = await getEventIdsForOffer(offerId);
  const events = await Promise.all(ids.map((txHash) => getEventByTxHash(txHash)));
  return events.filter((e): e is EscrowEvent => e != null);
}

/** Returns completed trade for an offer (rating enforcement: only these can be rated). */
export async function getCompletedTrade(offerId: string): Promise<CompletedTrade | null> {
  const pactCode = `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.get-completed-trade "${offerId}")`;
  const command = Pact.builder
    .execution(pactCode)
    .setMeta({ chainId: CHAIN_ID, senderAccount: "free", gasLimit: 25000, gasPrice: 0.00001, ttl: 600 })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
  const result = await kadenaClient.local(
    { cmd: command.cmd, hash: command.hash, sigs: [] },
    { preflight: false }
  );
  if (result.result.status !== "success") return null;
  const o = result.result.data as Record<string, unknown> | null;
  if (!o || typeof o.buyer !== "string" || typeof o.seller !== "string") return null;
  return {
    offerId,
    buyer: o.buyer as string,
    seller: o.seller as string,
    completedAt: (o.completedAt as string) ?? "",
  };
}

/** Returns all offer IDs that have completed (for rating enforcement / sync). */
export async function listCompletedOfferIds(): Promise<string[]> {
  const pactCode = `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.list-completed-offer-ids)`;
  const command = Pact.builder
    .execution(pactCode)
    .setMeta({ chainId: CHAIN_ID, senderAccount: "free", gasLimit: 100000, gasPrice: 0.00001, ttl: 600 })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
  const result = await kadenaClient.local(
    { cmd: command.cmd, hash: command.hash, sigs: [] },
    { preflight: false }
  );
  if (result.result.status !== "success") return [];
  const raw = result.result.data as unknown;
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    return Object.values(raw).filter((x): x is string => typeof x === "string");
  }
  return [];
}

/** Returns true if the offer is completed on-chain (for rating enforcement). */
export async function isCompletedTradeOnChain(offerId: string): Promise<boolean> {
  const trade = await getCompletedTrade(offerId);
  return trade != null;
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
============================================================ */

const PROFILE_AUTH_PURPOSE = "Kadena P2P Escrow Profile";

/** Builds an ownership-proof command. Do NOT submit; only sign and send signedCmd to the profile API. */
export function buildProfileAuthTx(wallet: string, publicKey: string) {
  const nonce = Date.now();
  return Pact.builder
    .execution("(identity true)")
    .addData("profile-auth", {
      purpose: PROFILE_AUTH_PURPOSE,
      wallet,
      nonce,
    })
    .addSigner(publicKey, (s) => [s("coin.GAS")])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: wallet,
      gasLimit: 5000,
      gasPrice: 0.00001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}