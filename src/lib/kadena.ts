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
  | "REFUNDED";

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
      const j = JSON.parse(text) as { error?: string; message?: string };
      msg = j.error ?? j.message ?? msg;
    } catch {
      /* use text as-is */
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

/* ---------- CREATE OFFER ---------- */

export function buildCreateOfferTx(
  offerId: string,
  amount: number,
  sellerAccount: string,
  sellerPubKey: string,
  arbiterAccount: string
) {
  const cleanSeller = sellerAccount.replace(/^k:/, "");
  const cleanArbiter = arbiterAccount.replace(/^k:/, "");

  const pactCode = `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.create-offer "${offerId}" "${cleanSeller}" ${amount.toFixed(8)} "${cleanArbiter}")`;

  return Pact.builder
    .execution(pactCode)
    .addSigner(sellerPubKey, (signFor) => [
      signFor("coin.GAS"),
    ])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: cleanSeller,
      gasLimit: 250000,
      gasPrice: 0.00001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- ACCEPT OFFER ---------- */

export function buildAcceptOfferTx(
  offerId: string,
  buyerAccount: string,
  buyerPubKey: string
) {
  return Pact.builder
    .execution(
      `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.accept-offer
        "${offerId}"
        "${clean(buyerAccount)}")`
    )
    .addSigner(buyerPubKey, (s) => [s("coin.GAS")])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: clean(buyerAccount),
      gasLimit: 250000,
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
    .execution(
      `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.deposit "${offerId}")`
    )
    .addSigner(sellerPubKey, (s) => [
      s("coin.GAS"),
      s("coin.TRANSFER", seller, "p2p-escrow-vault", {
        decimal: amount.toFixed(8),
      }),
    ])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: seller,
      gasLimit: 50000,
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
    .execution(
      `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.mark-paid "${offerId}")`
    )
    .addSigner(buyerPubKey, (s) => [s("coin.GAS")])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: clean(buyerAccount),
      gasLimit: 250000,
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
    .execution(
      `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.release "${offerId}")`
    )
    .addSigner(callerPubKey, (s) => [s("coin.GAS")])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: clean(callerAccount),
      gasLimit: 50000,
      gasPrice: 0.00001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ---------- REFUND (ARBITER) ---------- */

export function buildRefundTx(
  offerId: string,
  arbiterAccount: string,
  arbiterPubKey: string
) {
  return Pact.builder
    .execution(
      `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.refund "${offerId}")`
    )
    .addSigner(arbiterPubKey, (s) => [s("coin.GAS")])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: clean(arbiterAccount),
      gasLimit: 50000,
      gasPrice: 0.00001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .createTransaction();
}

/* ============================================================
   READ-ONLY
============================================================ */

export async function readEscrow(offerId: string) {
  const pactCode = `(${CONTRACT_NAMESPACE}.${CONTRACT_MODULE}.get-escrow "${offerId}")`;

  const command = Pact.builder
    .execution(pactCode)
    .setMeta({ chainId: CHAIN_ID })
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

  const d: any = result.result.data;

  return {
    offerId,
    seller: d.creator,
    buyer: d.buyer || null,
    arbiter: d.arbiter,
    amount: Number(d.amount),
    state: d.state,
    createdAt: "",
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