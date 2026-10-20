/**
 * UI helpers for escrow v11 trades shown through the legacy trade view (tradeToEscrow): which deadline applies,
 * what the next step is, and one function that signs, sends and waits for a v11 transaction with the
 * "keep this page open" countdown.
 */
import type { IUnsignedCommand } from "@kadena/client";
import { PLATFORM_ARBITER, getTxExplorerUrl, pollTransaction, signTransaction, submitTransaction, type Escrow } from "./kadena";
import { setTxLabel, txFinished } from "./txProgress";
import { readConfigs, readPools, readTrades, tradeToEscrow, type Pool, type Trade, type V11Config } from "./v11";
import { getPoolDetails, getPoolsIndex } from "./poolsApi";
import { isGiveawayPool, isInstant, kadenaToken, networkLabel } from "./markets";

export const FALLBACK_CONFIG: V11Config = { arbiter: PLATFORM_ARBITER, tRelease: 3600, feeBps: 0, feeAccount: "", paused: false, agent: "" };

/** A v11 trade in the legacy shape, with the config's release window attached by the list that loaded it. */
export type V11Escrow = ReturnType<typeof tradeToEscrow> & { tRelease?: number; networks?: string[] };
export const isV11 = (e: Escrow | null | undefined): e is V11Escrow => !!e && !!(e as V11Escrow).trade;

/** Build the legacy shape for the lists and the trade view. */
export function toV11Escrow(t: Trade, pool: Pool | null | undefined, networks: string[] | undefined, tRelease: number, arbiter?: string): V11Escrow {
  const e = tradeToEscrow(t, pool, networks, arbiter) as V11Escrow;
  e.tRelease = tRelease;
  e.networks = networks;
  return e;
}

/**
 * Every v11 trade (all chains) in the legacy shape: one read of the trades and one of the pools per chain, the
 * server's pool details (networks) when it has them, and each chain's release window and arbiter. Pools, trades
 * and details are keyed by reference ("2:pool-…"), so the same id on two chains never mixes.
 */
export async function loadV11Escrows(me: string | undefined): Promise<V11Escrow[]> {
  const [trades, pools, index, cfgs] = await Promise.all([
    readTrades(), readPools(), getPoolsIndex(), readConfigs().catch(() => ({} as Record<string, V11Config>)),
  ]);
  const cfgOf = (chain: string) => cfgs[chain] ?? FALLBACK_CONFIG;
  const poolById = new Map<string, Pool>(pools.map((p) => [p.poolId, p]));
  const networks = new Map<string, string[]>((index ?? []).map((p) => [p.poolId, p.networks]));
  if (!index) {
    // no index on the server: ask for the details of the pools behind my own trades only (404 → none)
    const ids = [...new Set(trades.filter((t) => me && (t.seller === me || t.buyer === me)).map((t) => t.poolId))];
    await Promise.all(ids.map(async (id) => { const d = await getPoolDetails(id); if (d) networks.set(id, d.networks); }));
  }
  return trades.map((t) => toV11Escrow(t, poolById.get(t.poolId), networks.get(t.poolId), cfgOf(t.chain).tRelease, cfgOf(t.chain).arbiter));
}

/** The running clock of a v11 trade: the buyer's payment window, then the seller's release window. */
export function v11Deadline(e: V11Escrow): { iso?: string; limit: number } {
  const t = e.trade;
  if (t.state === "FUNDED") return { iso: t.fundedAt, limit: t.payWindow };
  if (t.state === "PAID") return { iso: t.paidAt, limit: e.tRelease ?? 3600 };
  return { limit: 0 };
}

export const kda = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 4 })} KDA`;
/** "USDT 1.20" for the trade; the pool's token symbol for instant trades (with the token's decimals, kb-ETH up to 18). */
export const payText = (t: Trade) => `${t.currency} ${t.payAmount.toLocaleString("en-US", { maximumFractionDigits: Math.min(20, kadenaToken(t.currency)?.precision ?? 6) })}`;

/**
 * The trade names the platform's release agent (auto-release): it releases on its own once the exact payment arrives.
 * The exact amount (pay-amount plus the identifying digits) comes from the server (useTradeAuto), so the copy below
 * never quotes the bare pay-amount for these trades.
 */
export const hasAgent = (e: V11Escrow) => !!e.trade.agent;

/**
 * One plain sentence for a v11 trade: whose turn it is and what to press. Button names match the trade
 * buttons: I paid, Release, Take KDA back, Cancel, Open dispute.
 */
export function v11NextStep(e: V11Escrow, me: string | undefined, expired: boolean): string {
  const t = e.trade;
  const amount = kda(t.amount);
  const seller = !!me && me === t.seller;
  const buyer = !!me && me === t.buyer;
  const agent = hasAgent(e);
  const pay = payText(t);
  switch (t.state) {
    case "FUNDED":
      if (expired) {
        if (seller) return "The payment window closed. You can take your KDA back with Take KDA back. If the buyer did pay, you can still release instead.";
        if (buyer) return "The payment window closed, so the seller can take the KDA back. If you already paid, message the seller in the chat right away.";
        return "The payment window closed; the seller can take the KDA back.";
      }
      if (buyer) return agent
        ? `Your turn: ${amount} is locked for you. Send the exact amount shown below to the address below. The KDA is released automatically when it arrives.`
        : `Your turn: ${amount} is locked for you. Send exactly ${pay} to the address below, then press I paid before the time runs out.`;
      if (seller) return agent
        ? `${amount} is locked in escrow. Waiting for the buyer's payment; auto-release sends the KDA when the exact amount arrives. You can still release yourself.`
        : `${amount} is locked in escrow. Waiting for the buyer to send ${pay} and press I paid. Do not release before the money has arrived.`;
      return `${amount} is locked in escrow. Waiting for the buyer's payment.`;
    case "PAID":
      if (expired) return "The release window closed. Either side can open a dispute; the arbiter then reviews the trade and decides.";
      if (seller) return `Your turn: the buyer says ${pay} was sent. Check that it arrived in full, then press Release to send the ${amount}.`;
      if (buyer) return `Marked as paid. Waiting for the seller to check the payment and release the ${amount}. If they don't release in time, you can open a dispute.`;
      return "Payment marked as sent. Waiting for the seller to release.";
    case "DISPUTED":
      return "In dispute: the arbiter is reviewing this trade and will send the KDA to the buyer, back to the seller, or split it.";
    case "COMPLETED":
      return isInstant(t) ? `Done: ${amount} swapped for ${pay} in one transaction.` : isGiveawayPool(t) ? `Done: the ${amount} giveaway was claimed.` : `Done: ${amount} was released to the buyer.`;
    case "CANCELLED": return "Cancelled by the buyer before paying. The KDA went back to the pool.";
    case "REFUNDED": return "The KDA went back to the seller.";
    case "SPLIT": return "The arbiter split the KDA between the buyer and the seller.";
  }
  return "";
}

/** "Buying 120 KDA for USDT 1.20 on Tron (TRC20)" */
export function v11Summary(e: V11Escrow, chosenNetwork?: string | null): string {
  const t = e.trade;
  if (isGiveawayPool(t)) return `${kda(t.amount)} for free`;
  const net = chosenNetwork || (e.networks && e.networks.length === 1 ? e.networks[0] : null);
  return `${kda(t.amount)} for ${payText(t)}${isInstant(t) ? " (instant)" : net ? ` by ${networkLabel(net)}` : ""}`;
}

/* ---------------- one transaction, start to end ---------------- */

export class ChainError extends Error { requestKey?: string }

/**
 * Sign, send and wait for one v11 transaction. The countdown overlay covers the page from the send until the chain
 * answers (or until `txFinished()` when `hold` is set, so a save after the chain can finish under it).
 * Resolves with the request key; throws an Error with the chain's message on failure.
 */
export async function sendV11(label: string, build: () => IUnsignedCommand, { hold = false }: { hold?: boolean } = {}): Promise<string> {
  setTxLabel(label, { hold });
  await new Promise((r) => setTimeout(r, 0)); // paint the label before the wallet opens
  let requestKey: string | undefined;
  let ok = false;
  try {
    const signed = await signTransaction(build());
    requestKey = await submitTransaction(signed);
    const res = (await pollTransaction(requestKey))?.result;
    if (res?.status === "failure") {
      let msg = "Transaction failed on chain";
      const err = res.error as unknown;
      if (typeof err === "string") msg = err;
      else if (err && typeof err === "object") {
        const o = err as Record<string, unknown>;
        msg = String(o.message ?? o.msg ?? o.info ?? o.detail ?? msg);
      }
      const e = new ChainError(msg);
      e.requestKey = requestKey;
      throw e;
    }
    ok = true;
    return requestKey;
  } finally {
    // with `hold` and a success, the caller ends the overlay with txFinished() once its save is done
    if (!hold || !ok) txFinished();
  }
}

export const explorerLink = (requestKey: string) => ({ href: getTxExplorerUrl(requestKey), label: "View on Explorer ↗" });
