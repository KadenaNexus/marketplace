import { Pact, createClient } from "@kadena/client";

/* ============================================================
   NETWORK CONFIG
============================================================ */

export const NETWORK_ID = "mainnet01";
export const CHAIN_ID = "1";

export const API_HOST =
  `https://chainweb.chaddex.com/chainweb/0.0/${NETWORK_ID}/chain/${CHAIN_ID}/pact`;

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

export async function signTransaction(command: any) {
  const kadena = (window as any).kadena;

  if (!command?.cmd || !command?.hash) {
    console.error("Invalid command:", command);
    throw new Error("Invalid command passed to wallet");
  }

  const result = await kadena.request({
    method: "kda_requestSign",
    data: {
      networkId: NETWORK_ID,
      signingCmd: command,
    },
  });

  if (result.status !== "success") {
    throw new Error(result.message || "Wallet signing failed");
  }

  return result.signedCmd;
}

export async function submitTransaction(signedCmd: any): Promise<string> {
  const res = await kadenaClient.submit(signedCmd);
  return res.requestKey;
}

export async function pollTransaction(requestKey: string) {
  return kadenaClient.pollOne({
    requestKey,
    chainId: CHAIN_ID,
    networkId: NETWORK_ID,
  });
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

  const command = Pact.builder
    .execution(pactCode)
    .addSigner(sellerPubKey, (signFor) => [
      signFor("coin.GAS"),
    ])
    .setMeta({
      chainId: CHAIN_ID,
      senderAccount: cleanSeller,
      gasLimit: 2500,
      gasPrice: 0.00000001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .getCommand(); // ✅ THIS IS THE KEY


  console.log(`command: ------------------------- `)
  console.log(Object.keys(command));
  return command;
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
      gasLimit: 2500,
      gasPrice: 0.00000001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .getCommand();
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
      gasLimit: 5000,
      gasPrice: 0.00000001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .getCommand();
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
      gasLimit: 2500,
      gasPrice: 0.00000001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .getCommand();
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
      gasLimit: 5000,
      gasPrice: 0.00000001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .getCommand();
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
      gasLimit: 5000,
      gasPrice: 0.00000001,
      ttl: 600,
    })
    .setNetworkId(NETWORK_ID)
    .getCommand();
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