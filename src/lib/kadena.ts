import { IUnsignedCommand, Pact, createClient, createSignWithEckoWallet } from "@kadena/client";

/* ============================================================
   NETWORK CONFIG
============================================================ */

export const NETWORK_ID = "mainnet01";
export const CHAIN_ID = "1";

// Chaddex blocks CORS from browser. In dev we use a Vite proxy; in prod we use the official API.
const API_CHAINWEB_PACT = `https://api.chainweb.com/chainweb/0.0/${NETWORK_ID}/chain/${CHAIN_ID}/pact`;

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
  | "CLOSED";

export interface Escrow {
  offerId: string;
  seller: string;
  buyer: string | null;
  arbiter: string;
  amount: number;
  state: EscrowState;
  createdAt?: string;
}

export interface WalletAccount {
  account: string;
  publicKey: string;
  chainId: string;
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

const clean = (a: string) => a.replace(/^k:/, "");

/* ---------- CREATE OFFER (id creator amount; platform arbiter is used) ---------- */

export function buildCreateOfferTx(
  offerId: string,
  amount: number,
  sellerAccount: string,
  sellerPubKey: string
) {
  const pactCode = `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.create-offer "${offerId}" "${sellerAccount}" ${amount.toFixed(8)})`;

  return Pact.builder
    .execution(pactCode)
    .addData("sender", sellerAccount)
    .addSigner(sellerPubKey, (signFor) => [signFor("coin.GAS")])
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

export function buildDepositTx(
  offerId: string,
  amount: number,
  sellerAccount: string,
  sellerPubKey: string
) {
  const seller = clean(sellerAccount);

  return Pact.builder
    .execution(`(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.deposit "${offerId}")`)
    .addData("sender", sellerAccount)
    .addSigner(sellerPubKey, (s) => [
      s("coin.GAS"),
      s("coin.TRANSFER", seller, "p2p-escrow-vault", { decimal: amount.toFixed(8) }),
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

/* ---------- RELEASE ---------- */

export function buildReleaseTx(
  offerId: string,
  callerAccount: string,
  callerPubKey: string
) {
  return Pact.builder
    .execution(`(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.release "${offerId}")`)
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

/* ---------- REFUND (ARBITER; from FUNDED or PAID) ---------- */

export function buildRefundTx(
  offerId: string,
  arbiterAccount: string,
  arbiterPubKey: string
) {
  return Pact.builder
    .execution(`(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.refund "${offerId}")`)
    .addData("sender", arbiterAccount)
    .addSigner(arbiterPubKey, (s) => [s("coin.GAS")])
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

/* ---------- INIT (create-table; usually fails with "Module admin" from dApp) ---------- */
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

/* ---------- CLOSE OFFER (seller only, CREATED state) ---------- */

export function buildCloseOfferTx(
  offerId: string,
  sellerAccount: string,
  sellerPubKey: string
) {
  return Pact.builder
    .execution(`(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.close-offer "${offerId}")`)
    .addData("sender", sellerAccount)
    .addSigner(sellerPubKey, (s) => [s("coin.GAS")])
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

  return {
    offerId,
    seller: o.creator,
    buyer: (typeof o.buyer === "string" ? o.buyer : null) as string | null,
    arbiter: o.arbiter,
    amount: amt,
    state: o.state as EscrowState,
    createdAt: "",
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