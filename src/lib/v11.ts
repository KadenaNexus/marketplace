/**
 * Chain library for escrow v11 (contracts/p2p-escrow-v11.pact). See docs/v11-site-spec.md.
 *
 * A pool is what a creator posts (on chain: "offer"); a trade is a slice someone took. Trades start FUNDED.
 * Every builder below lists exactly the capabilities the signer must grant; the wallet shows them.
 */
import { Pact, createClient, type ChainId } from "@kadena/client";
import {
  API_HOST, CHAIN_ID, CONTRACT_NAMESPACE, GAS_PRICE, NETWORK_ID, PLATFORM_ARBITER,
  pactNumber, signerPayloadForAccount, type Escrow,
} from "./kadena";

const MODULE = (typeof import.meta.env?.VITE_CONTRACT_MODULE_V11 === "string" && import.meta.env.VITE_CONTRACT_MODULE_V11.trim()) || "p2p-escrow-v11";
export const V11_FQN = CONTRACT_NAMESPACE ? `${CONTRACT_NAMESPACE}.${MODULE}` : MODULE;
const client = createClient(API_HOST);

/** Gas for v11 calls: a take moves KDA and emits an event, so it needs more than a v10 call. */
export const GAS_V11 = 9000;
export const GAS_V11_READ = 150000;

export type PoolState = "OPEN" | "CLOSED";
export type TradeState = "FUNDED" | "PAID" | "DISPUTED" | "COMPLETED" | "SPLIT" | "REFUNDED" | "CANCELLED";
export const ACTIVE_TRADE_STATES: TradeState[] = ["FUNDED", "PAID", "DISPUTED"];

export interface Pool {
  poolId: string;
  creator: string;
  side: "SELL" | "BUY";
  available: number;
  locked: number;
  min: number;
  max: number;
  price: number;
  currency: string;
  /** "" = paid outside Kadena; else the token module settled instantly */
  token: string;
  payWindow: number;
  expiresAt?: string;
  agent: string;
  state: PoolState;
  createdAt?: string;
  takes: number;
}

export interface Trade {
  tradeId: string;
  poolId: string;
  seller: string;
  buyer: string;
  amount: number;
  price: number;
  currency: string;
  token: string;
  payAmount: number;
  fee: number;
  payWindow: number;
  agent: string;
  state: TradeState;
  fundedAt?: string;
  paidAt?: string;
  closedAt?: string;
}

export interface V11Config { arbiter: string; tRelease: number; feeBps: number; feeAccount: string; paused: boolean }

export interface V11Reputation { totalTrades: number; successfulTrades: number; disputesCount: number; cancelsCount: number; volumeKda: number }

/* ---------------- helpers ---------------- */

/** A Pact decimal literal with at most 12 decimals (the contract's limit). */
export const dec = (n: number): string => {
  const s = Number(n).toFixed(12).replace(/0+$/, "");
  return s.endsWith(".") ? s + "0" : s;
};
const q = (s: string) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const timeLit = (iso?: string | null) => (iso ? `(time ${q(new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z"))})` : `${V11_FQN}.EPOCH`);
const isoOrUndef = (v: unknown): string | undefined => {
  const s = v && typeof v === "object" ? ((v as { timep?: string; time?: string }).timep ?? (v as { time?: string }).time) : v;
  if (typeof s !== "string" || s.startsWith("1970-01-01")) return undefined;
  return s;
};
export const newPoolId = () => `pool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
export const newTradeId = () => `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
/** What a buyer owes for `amount` KDA at `price`, rounded the way the contract does (6 decimals). */
export const payAmountFor = (amount: number, price: number) => Math.round(amount * price * 1e6) / 1e6;
/** Token payment for an instant trade: amount * price rounded up to the token's precision (the contract accepts >= due). */
export const tokenPayFor = (amount: number, price: number, precision: number) => {
  const f = 10 ** precision;
  return Math.ceil(amount * price * f - 1e-9) / f;
};

async function local(code: string, gasLimit = GAS_V11_READ): Promise<unknown> {
  const cmd = Pact.builder.execution(code)
    .setMeta({ chainId: CHAIN_ID as ChainId, senderAccount: "free", gasLimit, gasPrice: GAS_PRICE, ttl: 600 })
    .setNetworkId(NETWORK_ID).createTransaction();
  const r = await client.local({ cmd: cmd.cmd, hash: cmd.hash, sigs: [] }, { preflight: false, signatureVerification: false });
  if (r.result.status !== "success") {
    const e = r.result.error as { message?: string } | undefined;
    throw new Error(e?.message || "Pact read failed");
  }
  return r.result.data;
}

function toPool(id: string, o: Record<string, unknown>): Pool {
  return {
    poolId: id, creator: String(o.creator ?? ""), side: o.side === "BUY" ? "BUY" : "SELL",
    available: pactNumber(o.available), locked: pactNumber(o.locked), min: pactNumber(o.min), max: pactNumber(o.max),
    price: pactNumber(o.price), currency: String(o.currency ?? ""), token: String(o.token ?? ""),
    payWindow: pactNumber(o["pay-window"]), expiresAt: isoOrUndef(o["expires-at"]), agent: String(o.agent ?? ""),
    state: o.state === "CLOSED" ? "CLOSED" : "OPEN", createdAt: isoOrUndef(o["created-at"]), takes: pactNumber(o.takes),
  };
}
function toTrade(id: string, t: Record<string, unknown>): Trade {
  return {
    tradeId: id, poolId: String(t.offer ?? ""), seller: String(t.seller ?? ""), buyer: String(t.buyer ?? ""),
    amount: pactNumber(t.amount), price: pactNumber(t.price), currency: String(t.currency ?? ""), token: String(t.token ?? ""),
    payAmount: pactNumber(t["pay-amount"]), fee: pactNumber(t.fee), payWindow: pactNumber(t["pay-window"]), agent: String(t.agent ?? ""),
    state: String(t.state ?? "FUNDED") as TradeState, fundedAt: isoOrUndef(t["funded-at"]), paidAt: isoOrUndef(t["paid-at"]), closedAt: isoOrUndef(t["closed-at"]),
  };
}

/* ---------------- reads ---------------- */

export async function readPools(): Promise<Pool[]> {
  const d = (await local(`(map (lambda (k) { "id": k, "o": (${V11_FQN}.get-offer k) }) (${V11_FQN}.list-offer-ids))`)) as { id: string; o: Record<string, unknown> }[];
  return (d || []).map((x) => toPool(x.id, x.o));
}
export async function readPool(id: string): Promise<Pool | null> {
  try { return toPool(id, (await local(`(${V11_FQN}.get-offer ${q(id)})`)) as Record<string, unknown>); } catch { return null; }
}
export async function readTrades(): Promise<Trade[]> {
  const d = (await local(`(map (lambda (k) { "id": k, "t": (${V11_FQN}.get-trade k) }) (${V11_FQN}.list-trade-ids))`)) as { id: string; t: Record<string, unknown> }[];
  return (d || []).map((x) => toTrade(x.id, x.t));
}
export async function readActiveTradeIds(): Promise<string[]> {
  return ((await local(`(${V11_FQN}.list-active-trade-ids)`)) as string[]) || [];
}
export async function readTrade(id: string): Promise<Trade | null> {
  try { return toTrade(id, (await local(`(${V11_FQN}.get-trade ${q(id)})`)) as Record<string, unknown>); } catch { return null; }
}
export async function readConfig(): Promise<V11Config> {
  const c = (await local(`(${V11_FQN}.get-config)`)) as Record<string, unknown>;
  return { arbiter: String(c.arbiter ?? PLATFORM_ARBITER), tRelease: pactNumber(c["t-release"]) || 3600, feeBps: pactNumber(c["fee-bps"]), feeAccount: String(c["fee-account"] ?? ""), paused: c.paused === true };
}
export async function readReputation(wallet: string): Promise<V11Reputation> {
  const r = (await local(`(${V11_FQN}.get-reputation ${q(wallet)})`)) as Record<string, unknown>;
  return { totalTrades: pactNumber(r.totalTrades), successfulTrades: pactNumber(r.successfulTrades), disputesCount: pactNumber(r.disputesCount), cancelsCount: pactNumber(r.cancelsCount), volumeKda: pactNumber(r.volumeKda) };
}
export const poolVault = (id: string) => local(`(${V11_FQN}.offer-vault ${q(id)})`) as Promise<string>;
export const tradeVault = (id: string) => local(`(${V11_FQN}.trade-vault ${q(id)})`) as Promise<string>;
/** Decimal places of a Kadena token (fungible-v2 precision). */
export const tokenPrecision = async (module: string) => pactNumber(await local(`(${module}.precision)`));
export const tokenBalance = async (module: string, account: string) => { try { return pactNumber(await local(`(${module}.get-balance ${q(account)})`)); } catch { return 0; } };

/* ---------------- builders ---------------- */

type Cap = [string, ...unknown[]];
/** Local demo only (VITE_DEMO_TIME=1): the demo Pact server has no block time, so each transaction carries the time. */
const DEMO_TIME = import.meta.env?.VITE_DEMO_TIME === "1";
function tx(code: string, account: string, pubKey: string, caps: Cap[], gasLimit = GAS_V11) {
  const signer = signerPayloadForAccount(account, pubKey);
  const b = Pact.builder.execution(code);
  if (DEMO_TIME) b.addData("demo-now", new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  return b
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addSigner(signer, (s) => caps.map((c) => (s as any)(c[0], ...c.slice(1))))
    .setMeta({ chainId: CHAIN_ID as ChainId, senderAccount: account, gasLimit, gasPrice: GAS_PRICE, ttl: 600 })
    .setNetworkId(NETWORK_ID).createTransaction();
}
const AUTH = `${V11_FQN}.ACCOUNT_AUTH`;

export interface CreatePoolParams {
  poolId: string; creator: string; pubKey: string; side: "SELL" | "BUY"; total: number; min: number; max: number;
  price: number; currency: string; token?: string; payWindow: number; expiresAt?: string | null; agent?: string;
  /** required for SELL: (await poolVault(poolId)) */
  vault?: string;
}
export function buildCreatePoolTx(p: CreatePoolParams) {
  const code = `(${V11_FQN}.create-offer ${q(p.poolId)} ${q(p.creator)} ${q(p.side)} ${dec(p.total)} ${dec(p.min)} ${dec(p.max)} ${dec(p.price)} ${q(p.currency)} ${q(p.token ?? "")} ${Math.round(p.payWindow)} ${timeLit(p.expiresAt)} ${q(p.agent ?? "")})`;
  const caps: Cap[] = [["coin.GAS"], [AUTH, p.creator]];
  if (p.side === "SELL") {
    if (!p.vault) throw new Error("vault required for a SELL pool");
    caps.push(["coin.TRANSFER", p.creator, p.vault, { decimal: dec(p.total) }]);
  }
  return tx(code, p.creator, p.pubKey, caps, 12000);
}
export function buildTopUpTx(poolId: string, creator: string, pubKey: string, amount: number, vault: string) {
  return tx(`(${V11_FQN}.top-up ${q(poolId)} ${dec(amount)})`, creator, pubKey, [["coin.GAS"], [AUTH, creator], ["coin.TRANSFER", creator, vault, { decimal: dec(amount) }]]);
}
export function buildWithdrawTx(poolId: string, creator: string, pubKey: string, amount: number) {
  return tx(`(${V11_FQN}.withdraw ${q(poolId)} ${dec(amount)})`, creator, pubKey, [["coin.GAS"], [AUTH, creator]]);
}
export function buildUpdatePoolTx(poolId: string, creator: string, pubKey: string, u: { min: number; max: number; price: number; payWindow: number; expiresAt?: string | null; agent?: string }) {
  return tx(`(${V11_FQN}.update-offer ${q(poolId)} ${dec(u.min)} ${dec(u.max)} ${dec(u.price)} ${Math.round(u.payWindow)} ${timeLit(u.expiresAt)} ${q(u.agent ?? "")})`, creator, pubKey, [["coin.GAS"], [AUTH, creator]]);
}
export function buildClosePoolTx(poolId: string, creator: string, pubKey: string) {
  return tx(`(${V11_FQN}.close-offer ${q(poolId)})`, creator, pubKey, [["coin.GAS"], [AUTH, creator]]);
}
/** Take a slice. For a BUY pool the taker is the KDA holder and locks `amount` (pass the trade vault). */
export function buildTakeTx(tradeId: string, poolId: string, taker: string, pubKey: string, amount: number, side: "SELL" | "BUY", tradeVaultAccount?: string) {
  const caps: Cap[] = [["coin.GAS"], [AUTH, taker]];
  if (side === "BUY") {
    if (!tradeVaultAccount) throw new Error("trade vault required for a BUY pool");
    caps.push(["coin.TRANSFER", taker, tradeVaultAccount, { decimal: dec(amount) }]);
  }
  return tx(`(${V11_FQN}.take-offer ${q(tradeId)} ${q(poolId)} ${q(taker)} ${dec(amount)})`, taker, pubKey, caps, 12000);
}
/** Instant: pay `pay` of `tokenModule` to the seller and receive the KDA in one transaction. */
export function buildTakeAndSettleTx(tradeId: string, poolId: string, taker: string, pubKey: string, amount: number, tokenModule: string, seller: string, pay: number) {
  return tx(`(${V11_FQN}.take-and-settle ${q(tradeId)} ${q(poolId)} ${q(taker)} ${dec(amount)} ${tokenModule} ${dec(pay)})`, taker, pubKey,
    [["coin.GAS"], [AUTH, taker], [`${tokenModule}.TRANSFER`, taker, seller, { decimal: dec(pay) }]], 15000);
}
export const buildMarkPaidTx = (tradeId: string, buyer: string, pubKey: string) => tx(`(${V11_FQN}.mark-paid ${q(tradeId)})`, buyer, pubKey, [["coin.GAS"], [AUTH, buyer]]);
export const buildCancelTx = (tradeId: string, buyer: string, pubKey: string) => tx(`(${V11_FQN}.cancel ${q(tradeId)})`, buyer, pubKey, [["coin.GAS"], [AUTH, buyer]]);
/** The seller, or the pool's agent. */
export const buildReleaseTx = (tradeId: string, caller: string, pubKey: string) => tx(`(${V11_FQN}.release ${q(tradeId)})`, caller, pubKey, [["coin.GAS"], [AUTH, caller]]);
export const buildTimeoutRefundTx = (tradeId: string, seller: string, pubKey: string) => tx(`(${V11_FQN}.timeout-refund ${q(tradeId)})`, seller, pubKey, [["coin.GAS"], [AUTH, seller]]);
export const buildOpenDisputeTx = (tradeId: string, caller: string, pubKey: string) => tx(`(${V11_FQN}.open-dispute ${q(tradeId)})`, caller, pubKey, [["coin.GAS"], [AUTH, caller]]);
export const buildResolveTx = (tradeId: string, arbiter: string, pubKey: string, toBuyer: number) => tx(`(${V11_FQN}.resolve ${q(tradeId)} ${dec(toBuyer)})`, arbiter, pubKey, [["coin.GAS"], [AUTH, arbiter]]);

/* ---------------- legacy shape ---------------- */

/** The payment-method label the legacy UI expects, e.g. ["USDT (TRC20)"] or ["kb-USDC (instant)"]. */
export function methodLabel(trade: Pick<Trade, "currency" | "token" | "price">, networks?: string[]): string[] {
  if (trade.price === 0 && !trade.token) return ["Giveaway"];
  if (trade.token) return [`${trade.currency} (instant)`];
  const nets = (networks || []).filter((n) => n.startsWith(trade.currency + ":")).map((n) => n.split(":")[1]);
  return nets.length ? nets.map((n) => `${trade.currency} (${n})`) : [trade.currency];
}

/**
 * Map a v11 trade to the legacy Escrow shape so chat, proofs, notifications, emails, timers and the countdown keep
 * working. offerId = tradeId; creator = the pool's creator; acceptedAt = fundedAt (there is no accept step).
 */
export function tradeToEscrow(t: Trade, pool?: Pool | null, networks?: string[], arbiter = PLATFORM_ARBITER): Escrow & { trade: Trade; pool?: Pool | null } {
  const creator = pool?.creator ?? (pool?.side === "BUY" ? t.buyer : t.seller);
  const side: "SELL" | "BUY" = pool ? pool.side : (creator === t.seller ? "SELL" : "BUY");
  return {
    offerId: t.tradeId, seller: t.seller, buyer: t.buyer || null, creator, arbiter,
    amount: t.amount, state: t.state as unknown as Escrow["state"], createdAt: t.fundedAt, acceptedAt: t.fundedAt, fundedAt: t.fundedAt, paidAt: t.paidAt,
    side, price: t.price, paymentMethod: JSON.stringify(methodLabel(t, networks)), fiatCurrency: t.currency,
    trade: t, pool,
  };
}

/** Seconds left in the buyer's payment window (negative = passed). */
export const payWindowLeft = (t: Trade, now = Date.now()) => t.fundedAt ? Math.floor((Date.parse(t.fundedAt) + t.payWindow * 1000 - now) / 1000) : 0;
/** Seconds left for the seller to release after mark-paid (negative = passed). */
export const releaseWindowLeft = (t: Trade, tRelease: number, now = Date.now()) => t.paidAt ? Math.floor((Date.parse(t.paidAt) + tRelease * 1000 - now) / 1000) : 0;
