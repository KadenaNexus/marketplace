/**
 * Chain library for escrow v11 (contracts/p2p-escrow-v11.pact). See docs/v11-site-spec.md.
 *
 * A pool is what a creator posts (on chain: "offer"); a trade is a slice someone took. Trades start FUNDED.
 * Every builder below lists exactly the capabilities the signer must grant; the wallet shows them.
 *
 * The contract runs on chains 1 and 2 (shared/v11-chains.js). Outside this file a pool or trade is always named by
 * its reference ("2:pool-…" on chain 2, the bare id on chain 1): `poolId` and `tradeId` below are references, and
 * every reader and builder takes one, so a transaction is always built for (and a read sent to) the right chain.
 */
import { Pact, type ChainId } from "@kadena/client";
import {
  CONTRACT_FQN_V11, GAS_PRICE, NETWORK_ID, PLATFORM_ARBITER,
  clientFor, pactNumber, signerPayloadForAccount, type Escrow,
} from "./kadena";
import { DEFAULT_CHAIN, V11_CHAINS as TABLE_CHAINS, canonicalRef, parseRef, toRef, tokenPayFor as exactTokenPay } from "../../shared/v11-chains.js";

export const V11_FQN = CONTRACT_FQN_V11;
/** Chains read for pools and trades (VITE_V11_CHAINS, default the table's: 1,2). */
export const V11_CHAINS: string[] = (typeof import.meta.env?.VITE_V11_CHAINS === "string" && import.meta.env.VITE_V11_CHAINS.trim()
  ? import.meta.env.VITE_V11_CHAINS.split(",").map((c: string) => c.trim()).filter(Boolean)
  : TABLE_CHAINS);
export { canonicalRef, parseRef, toRef };

/** Gas for v11 calls: a take moves KDA and emits an event, so it needs more than a v10 call. */
export const GAS_V11 = 9000;
export const GAS_V11_READ = 150000;

export type PoolState = "OPEN" | "CLOSED";
export type TradeState = "FUNDED" | "PAID" | "DISPUTED" | "COMPLETED" | "SPLIT" | "REFUNDED" | "CANCELLED";
export const ACTIVE_TRADE_STATES: TradeState[] = ["FUNDED", "PAID", "DISPUTED"];

export interface Pool {
  /** reference: "2:pool-…" on chain 2, the bare id on chain 1 */
  poolId: string;
  chain: string;
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
  /** reference: "2:trade-…" on chain 2, the bare id on chain 1 */
  tradeId: string;
  /** reference of the trade's pool (always on the trade's chain) */
  poolId: string;
  chain: string;
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

/** `agent`: the platform's release agent ("" = none), the only account an offer may name as its agent (auto-release). */
export interface V11Config { arbiter: string; tRelease: number; feeBps: number; feeAccount: string; paused: boolean; agent: string }

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
/** A new pool on `chain` (the currency's chain, see chainForCurrency), as a reference. */
export const newPoolId = (chain: string = DEFAULT_CHAIN) => toRef(chain, `pool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
/** A new trade on `chain` (always its pool's chain), as a reference. */
export const newTradeId = (chain: string = DEFAULT_CHAIN) => toRef(chain, `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
/** What a buyer owes for `amount` KDA at `price`, rounded the way the contract does (6 decimals). */
export const payAmountFor = (amount: number, price: number) => Math.round(amount * price * 1e6) / 1e6;
/**
 * Token payment for an instant trade as a Pact decimal string: amount * price rounded up to the token's precision
 * (the contract accepts >= due, and no more decimals than the token has; kb-ETH has 18, so this is exact, not float).
 */
export const tokenPayFor = (amount: number, price: number, precision: number): string => exactTokenPay(amount, price, precision);

async function local(code: string, chain: string = DEFAULT_CHAIN, gasLimit = GAS_V11_READ): Promise<unknown> {
  const cmd = Pact.builder.execution(code)
    .setMeta({ chainId: chain as ChainId, senderAccount: "free", gasLimit, gasPrice: GAS_PRICE, ttl: 600 })
    .setNetworkId(NETWORK_ID).createTransaction();
  const r = await clientFor(chain).local({ cmd: cmd.cmd, hash: cmd.hash, sigs: [] }, { preflight: false, signatureVerification: false });
  if (r.result.status !== "success") {
    const e = r.result.error as { message?: string } | undefined;
    throw new Error(e?.message || "Pact read failed");
  }
  return r.result.data;
}

/** Every v11 chain at once; a chain that cannot be read is left out (logged) unless none can be read. */
async function eachChain<T>(read: (chain: string) => Promise<T[]>): Promise<T[]> {
  const res = await Promise.allSettled(V11_CHAINS.map(read));
  const ok = res.filter((r): r is PromiseFulfilledResult<T[]> => r.status === "fulfilled");
  res.forEach((r, i) => { if (r.status === "rejected") console.warn(`[v11] chain ${V11_CHAINS[i]} read failed:`, r.reason); });
  if (!ok.length && res.length) throw (res[0] as PromiseRejectedResult).reason;
  return ok.flatMap((r) => r.value);
}

function toPool(chain: string, id: string, o: Record<string, unknown>): Pool {
  return {
    poolId: toRef(chain, id), chain, creator: String(o.creator ?? ""), side: o.side === "BUY" ? "BUY" : "SELL",
    available: pactNumber(o.available), locked: pactNumber(o.locked), min: pactNumber(o.min), max: pactNumber(o.max),
    price: pactNumber(o.price), currency: String(o.currency ?? ""), token: String(o.token ?? ""),
    payWindow: pactNumber(o["pay-window"]), expiresAt: isoOrUndef(o["expires-at"]), agent: String(o.agent ?? ""),
    state: o.state === "CLOSED" ? "CLOSED" : "OPEN", createdAt: isoOrUndef(o["created-at"]), takes: pactNumber(o.takes),
  };
}
function toTrade(chain: string, id: string, t: Record<string, unknown>): Trade {
  return {
    tradeId: toRef(chain, id), poolId: toRef(chain, String(t.offer ?? "")), chain, seller: String(t.seller ?? ""), buyer: String(t.buyer ?? ""),
    amount: pactNumber(t.amount), price: pactNumber(t.price), currency: String(t.currency ?? ""), token: String(t.token ?? ""),
    payAmount: pactNumber(t["pay-amount"]), fee: pactNumber(t.fee), payWindow: pactNumber(t["pay-window"]), agent: String(t.agent ?? ""),
    state: String(t.state ?? "FUNDED") as TradeState, fundedAt: isoOrUndef(t["funded-at"]), paidAt: isoOrUndef(t["paid-at"]), closedAt: isoOrUndef(t["closed-at"]),
  };
}

/* ---------------- reads ---------------- */

/** Open pools on every v11 chain. */
export async function readPools(): Promise<Pool[]> {
  return eachChain(async (chain) => {
    const d = (await local(`(map (lambda (k) { "id": k, "o": (${V11_FQN}.get-offer k) }) (${V11_FQN}.list-offer-ids))`, chain)) as { id: string; o: Record<string, unknown> }[];
    return (d || []).map((x) => toPool(chain, x.id, x.o));
  });
}
export async function readPool(ref: string): Promise<Pool | null> {
  const { chain, id } = parseRef(ref);
  try { return toPool(chain, id, (await local(`(${V11_FQN}.get-offer ${q(id)})`, chain)) as Record<string, unknown>); } catch { return null; }
}
/** Every trade on every v11 chain. */
export async function readTrades(): Promise<Trade[]> {
  return eachChain(async (chain) => {
    const d = (await local(`(map (lambda (k) { "id": k, "t": (${V11_FQN}.get-trade k) }) (${V11_FQN}.list-trade-ids))`, chain)) as { id: string; t: Record<string, unknown> }[];
    return (d || []).map((x) => toTrade(chain, x.id, x.t));
  });
}
export async function readActiveTradeIds(): Promise<string[]> {
  return eachChain(async (chain) => (((await local(`(${V11_FQN}.list-active-trade-ids)`, chain)) as string[]) || []).map((id) => toRef(chain, id)));
}
export async function readTrade(ref: string): Promise<Trade | null> {
  const { chain, id } = parseRef(ref);
  try { return toTrade(chain, id, (await local(`(${V11_FQN}.get-trade ${q(id)})`, chain)) as Record<string, unknown>); } catch { return null; }
}
/** One chain's config (default: the first v11 chain; same governance everywhere, but each chain has its own row). */
export async function readConfig(chain: string = V11_CHAINS[0] ?? DEFAULT_CHAIN): Promise<V11Config> {
  const c = (await local(`(${V11_FQN}.get-config)`, chain)) as Record<string, unknown>;
  return { arbiter: String(c.arbiter ?? PLATFORM_ARBITER), tRelease: pactNumber(c["t-release"]) || 3600, feeBps: pactNumber(c["fee-bps"]), feeAccount: String(c["fee-account"] ?? ""), paused: c.paused === true, agent: String(c.agent ?? "") };
}
/** The config of every v11 chain that answers, by chain. */
export async function readConfigs(): Promise<Record<string, V11Config>> {
  const pairs = await eachChain(async (chain) => [[chain, await readConfig(chain)] as const]);
  return Object.fromEntries(pairs);
}
/** On-chain reputation summed over the v11 chains. */
export async function readReputation(wallet: string): Promise<V11Reputation> {
  const all = await eachChain(async (chain) => [(await local(`(${V11_FQN}.get-reputation ${q(wallet)})`, chain)) as Record<string, unknown>]);
  const sum = (k: string) => all.reduce((n, r) => n + pactNumber(r?.[k]), 0);
  return { totalTrades: sum("totalTrades"), successfulTrades: sum("successfulTrades"), disputesCount: sum("disputesCount"), cancelsCount: sum("cancelsCount"), volumeKda: sum("volumeKda") };
}
export const poolVault = (ref: string) => { const { chain, id } = parseRef(ref); return local(`(${V11_FQN}.offer-vault ${q(id)})`, chain) as Promise<string>; };
export const tradeVault = (ref: string) => { const { chain, id } = parseRef(ref); return local(`(${V11_FQN}.trade-vault ${q(id)})`, chain) as Promise<string>; };
/** Decimal places of a Kadena token (fungible-v2 precision) on `chain`. */
export const tokenPrecision = async (module: string, chain: string = DEFAULT_CHAIN) => pactNumber(await local(`(${module}.precision)`, chain));
export const tokenBalance = async (module: string, account: string, chain: string = DEFAULT_CHAIN) => { try { return pactNumber(await local(`(${module}.get-balance ${q(account)})`, chain)); } catch { return 0; } };

/* ---------------- builders ---------------- */

type Cap = [string, ...unknown[]];
/** Local demo only (VITE_DEMO_TIME=1): the demo Pact server has no block time, so each transaction carries the time. */
const DEMO_TIME = import.meta.env?.VITE_DEMO_TIME === "1";
/** One v11 transaction on `chain` (the chain of the pool or trade it acts on). */
function tx(chain: string, code: string, account: string, pubKey: string, caps: Cap[], gasLimit = GAS_V11) {
  const signer = signerPayloadForAccount(account, pubKey);
  const b = Pact.builder.execution(code);
  if (DEMO_TIME) b.addData("demo-now", new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  return b
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addSigner(signer, (s) => caps.map((c) => (s as any)(c[0], ...c.slice(1))))
    .setMeta({ chainId: chain as ChainId, senderAccount: account, gasLimit, gasPrice: GAS_PRICE, ttl: 600 })
    .setNetworkId(NETWORK_ID).createTransaction();
}
const AUTH = `${V11_FQN}.ACCOUNT_AUTH`;

export interface CreatePoolParams {
  /** reference from newPoolId(chainForCurrency(currency)) */
  poolId: string; creator: string; pubKey: string; side: "SELL" | "BUY"; total: number; min: number; max: number;
  price: number; currency: string; token?: string; payWindow: number; expiresAt?: string | null; agent?: string;
  /** required for SELL: (await poolVault(poolId)) */
  vault?: string;
}
export function buildCreatePoolTx(p: CreatePoolParams) {
  const { chain, id } = parseRef(p.poolId);
  const code = `(${V11_FQN}.create-offer ${q(id)} ${q(p.creator)} ${q(p.side)} ${dec(p.total)} ${dec(p.min)} ${dec(p.max)} ${dec(p.price)} ${q(p.currency)} ${q(p.token ?? "")} ${Math.round(p.payWindow)} ${timeLit(p.expiresAt)} ${q(p.agent ?? "")})`;
  const caps: Cap[] = [["coin.GAS"], [AUTH, p.creator]];
  if (p.side === "SELL") {
    if (!p.vault) throw new Error("vault required for a SELL pool");
    caps.push(["coin.TRANSFER", p.creator, p.vault, { decimal: dec(p.total) }]);
  }
  return tx(chain, code, p.creator, p.pubKey, caps, 12000);
}
export function buildTopUpTx(poolRef: string, creator: string, pubKey: string, amount: number, vault: string) {
  const { chain, id } = parseRef(poolRef);
  return tx(chain, `(${V11_FQN}.top-up ${q(id)} ${dec(amount)})`, creator, pubKey, [["coin.GAS"], [AUTH, creator], ["coin.TRANSFER", creator, vault, { decimal: dec(amount) }]]);
}
export function buildWithdrawTx(poolRef: string, creator: string, pubKey: string, amount: number) {
  const { chain, id } = parseRef(poolRef);
  return tx(chain, `(${V11_FQN}.withdraw ${q(id)} ${dec(amount)})`, creator, pubKey, [["coin.GAS"], [AUTH, creator]]);
}
export function buildUpdatePoolTx(poolRef: string, creator: string, pubKey: string, u: { min: number; max: number; price: number; payWindow: number; expiresAt?: string | null; agent?: string }) {
  const { chain, id } = parseRef(poolRef);
  return tx(chain, `(${V11_FQN}.update-offer ${q(id)} ${dec(u.min)} ${dec(u.max)} ${dec(u.price)} ${Math.round(u.payWindow)} ${timeLit(u.expiresAt)} ${q(u.agent ?? "")})`, creator, pubKey, [["coin.GAS"], [AUTH, creator]]);
}
export function buildClosePoolTx(poolRef: string, creator: string, pubKey: string) {
  const { chain, id } = parseRef(poolRef);
  return tx(chain, `(${V11_FQN}.close-offer ${q(id)})`, creator, pubKey, [["coin.GAS"], [AUTH, creator]]);
}
/** A trade and its pool are always on one chain: the trade reference must come from newTradeId(pool.chain). */
function sameChain(tradeRef: string, poolRef: string) {
  const t = parseRef(tradeRef), o = parseRef(poolRef);
  if (t.chain !== o.chain) throw new Error(`Trade on chain ${t.chain} for a pool on chain ${o.chain}`);
  return { chain: o.chain, tradeId: t.id, poolId: o.id };
}
/** Take a slice. For a BUY pool the taker is the KDA holder and locks `amount` (pass the trade vault). */
export function buildTakeTx(tradeRef: string, poolRef: string, taker: string, pubKey: string, amount: number, side: "SELL" | "BUY", tradeVaultAccount?: string) {
  const { chain, tradeId, poolId } = sameChain(tradeRef, poolRef);
  const caps: Cap[] = [["coin.GAS"], [AUTH, taker]];
  if (side === "BUY") {
    if (!tradeVaultAccount) throw new Error("trade vault required for a BUY pool");
    caps.push(["coin.TRANSFER", taker, tradeVaultAccount, { decimal: dec(amount) }]);
  }
  return tx(chain, `(${V11_FQN}.take-offer ${q(tradeId)} ${q(poolId)} ${q(taker)} ${dec(amount)})`, taker, pubKey, caps, 12000);
}
/** Instant: pay `pay` (a decimal string from tokenPayFor) of `tokenModule` to the seller and receive the KDA in one transaction. */
export function buildTakeAndSettleTx(tradeRef: string, poolRef: string, taker: string, pubKey: string, amount: number, tokenModule: string, seller: string, pay: string) {
  const { chain, tradeId, poolId } = sameChain(tradeRef, poolRef);
  if (!/^\d+\.\d+$/.test(pay)) throw new Error(`Bad payment amount: ${pay}`);
  return tx(chain, `(${V11_FQN}.take-and-settle ${q(tradeId)} ${q(poolId)} ${q(taker)} ${dec(amount)} ${tokenModule} ${pay})`, taker, pubKey,
    [["coin.GAS"], [AUTH, taker], [`${tokenModule}.TRANSFER`, taker, seller, { decimal: pay }]], 15000);
}
/** A step on an existing trade, on the trade's chain. */
const tradeStep = (fn: string, tradeRef: string, caller: string, pubKey: string, extra = "") => {
  const { chain, id } = parseRef(tradeRef);
  return tx(chain, `(${V11_FQN}.${fn} ${q(id)}${extra})`, caller, pubKey, [["coin.GAS"], [AUTH, caller]]);
};
export const buildMarkPaidTx = (tradeRef: string, buyer: string, pubKey: string) => tradeStep("mark-paid", tradeRef, buyer, pubKey);
export const buildCancelTx = (tradeRef: string, buyer: string, pubKey: string) => tradeStep("cancel", tradeRef, buyer, pubKey);
/** The seller, or the pool's agent. */
export const buildReleaseTx = (tradeRef: string, caller: string, pubKey: string) => tradeStep("release", tradeRef, caller, pubKey);
export const buildTimeoutRefundTx = (tradeRef: string, seller: string, pubKey: string) => tradeStep("timeout-refund", tradeRef, seller, pubKey);
export const buildOpenDisputeTx = (tradeRef: string, caller: string, pubKey: string) => tradeStep("open-dispute", tradeRef, caller, pubKey);
export const buildResolveTx = (tradeRef: string, arbiter: string, pubKey: string, toBuyer: number) => tradeStep("resolve", tradeRef, arbiter, pubKey, ` ${dec(toBuyer)}`);

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
