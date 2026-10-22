/**
 * What the Marketplace trades with (escrow v11, see docs/v11-site-spec.md "Payment methods"). The currency decides
 * the chain (one table for the site and the server: shared/v11-chains.js):
 *   - chain 1: USDT on Tron (TRC20) or Ethereum (ERC20), USDC on Ethereum (ERC20), paid outside Kadena and released
 *     by the seller (or the pool's agent) once the money arrived; BRO and FLUX, swapped for the KDA in one transaction.
 *   - chain 2: kb-USDC, kb-ETH, kb-USDT, swapped for the KDA in one transaction (instant).
 *   - A free giveaway: a SELL pool at price 0, claimed with one tap (chain 1).
 * No Wise, Revolut, bank transfers or PayPal-style methods. Offers made on v10 keep whatever they stored.
 */
import { CURRENCIES, currencyInfo, fitsTable, tokenInfo, type TokenInfo } from "../../shared/v11-chains.js";

export { V11_CHAINS, chainForCurrency, fitsTable } from "../../shared/v11-chains.js";

/* ---------------- stablecoins paid outside Kadena ---------------- */

export interface PaymentNetwork {
  /** "USDT:TRC20": the string stored in the pool's off-chain details and in the payout map */
  id: string;
  currency: "USDT" | "USDC";
  /** "TRC20" */
  network: string;
  /** "USDT on Tron (TRC20)" */
  label: string;
  /** "Tron (TRC20)" */
  networkLabel: string;
  /** What a receiving address looks like, and a hint for the input */
  re: RegExp;
  hint: string;
}

const TRON = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const EVM = /^0x[0-9a-fA-F]{40}$/;

export const PAYMENT_NETWORKS: readonly PaymentNetwork[] = [
  { id: "USDT:TRC20", currency: "USDT", network: "TRC20", label: "USDT on Tron (TRC20)", networkLabel: "Tron (TRC20)", re: TRON, hint: "T… (34 characters)" },
  { id: "USDT:ERC20", currency: "USDT", network: "ERC20", label: "USDT on Ethereum (ERC20)", networkLabel: "Ethereum (ERC20)", re: EVM, hint: "0x… (42 characters)" },
  { id: "USDC:ERC20", currency: "USDC", network: "ERC20", label: "USDC on Ethereum (ERC20)", networkLabel: "Ethereum (ERC20)", re: EVM, hint: "0x… (42 characters)" },
] as const;

/** The stablecoins a pool can be priced in (each has one or more networks above). */
export const STABLE_CURRENCIES = ["USDT", "USDC"] as const;
export const isStableCurrency = (c: string | null | undefined): c is "USDT" | "USDC" => c === "USDT" || c === "USDC";
/** Paid outside Kadena (the shared table's "offchain" kind): the seller must give a receiving address and release by hand. */
export const isOffchainCurrency = (c: string | null | undefined): boolean => currencyInfo(c)?.kind === "offchain";
/** The currencies the new-offer form can show for a side: a BUY offer cannot be settled instantly (the contract refuses a token BUY). */
export const currenciesForSide = (choices: readonly string[], side: "SELL" | "BUY"): string[] => choices.filter((c) => side === "SELL" || isOffchainCurrency(c));
/**
 * A SELL pool paid outside Kadena with no receiving address saved on the server: nobody can pay it, so it stays
 * out of the market and cannot be taken (the creator sees it, with a warning, and adds the address from Manage).
 */
export const missingReceivingAddress = (p: { side: "SELL" | "BUY"; currency: string; token: string; networks?: string[] }): boolean =>
  p.side === "SELL" && !p.token && isOffchainCurrency(p.currency) && !(p.networks && p.networks.length > 0);
export const networksFor = (currency: string): readonly PaymentNetwork[] => PAYMENT_NETWORKS.filter((n) => n.currency === currency);
export const paymentNetwork = (id: string | null | undefined): PaymentNetwork | undefined => PAYMENT_NETWORKS.find((n) => n.id === id);
/** "USDT (TRC20)" for a network id; unknown ids are shown as they are. */
export function networkLabel(id: string | null | undefined): string {
  if (!id) return "";
  const n = paymentNetwork(id);
  if (n) return `${n.currency} (${n.network})`;
  const [cur, net] = id.split(":");
  return net ? `${cur} (${net})` : cur;
}
/** Problem with a receiving address for this network, or null when it looks right. */
export function addressProblem(networkId: string, address: string): string | null {
  const n = paymentNetwork(networkId);
  if (!n) return "Choose the network";
  const a = address.trim();
  if (!a) return "Enter the address where you receive the payment";
  if (!n.re.test(a)) return `That doesn't look like a ${n.networkLabel} address (${n.hint})`;
  return null;
}

/* ---------------- Kadena tokens, settled instantly ---------------- */

/**
 * Tokens a pool can be priced in and paid with on Kadena: `module` is the fungible-v2 module the contract transfers
 * and `chain` the chain the pool (and the swap) is on. From the shared table; the UI shows the symbol.
 */
export type KadenaToken = TokenInfo;
export const KADENA_TOKENS: readonly KadenaToken[] = CURRENCIES.filter((c): c is TokenInfo => c.kind === "token");
export const kadenaToken = (symbol: string | null | undefined): KadenaToken | undefined => tokenInfo(symbol);
export const isKadenaToken = (symbol: string | null | undefined): boolean => !!kadenaToken(symbol);
/** All the currencies the new-offer form offers, in table order (chain 1 first). */
export const POOL_CURRENCIES: readonly string[] = CURRENCIES.map((c) => c.symbol);
/** "Chain 2" */
export const chainLabel = (chain: string | null | undefined) => `Chain ${chain || "1"}`;

/* ---------------- pool helpers ---------------- */

type PoolLike = { price: number; token: string; currency?: string };
/** A pool whose chain, currency and token module match the table (see fitsTable); others stay out of the market. */
export const poolFitsTable = (p: { chain: string; currency: string; token: string }): boolean => fitsTable(p.chain, p.currency, p.token);
/** Paid in a Kadena token: the trade settles in the take transaction. */
export const isInstant = (p: PoolLike): boolean => !!p.token;
/** A free giveaway: SELL, price 0, no token. */
export const isGiveawayPool = (p: PoolLike): boolean => p.price === 0 && !p.token;
/** Seconds of the payment window a pool can choose, with labels. */
export const PAY_WINDOWS: readonly { seconds: number; label: string }[] = [
  { seconds: 900, label: "15 minutes" },
  { seconds: 1800, label: "30 minutes" },
  { seconds: 3600, label: "1 hour" },
  { seconds: 7200, label: "2 hours" },
  { seconds: 21600, label: "6 hours" },
  { seconds: 86400, label: "24 hours" },
];
export const DEFAULT_PAY_WINDOW = 1800;
export const windowLabel = (seconds: number): string => PAY_WINDOWS.find((w) => w.seconds === seconds)?.label ?? (seconds >= 3600 ? `${Math.round(seconds / 360) / 10} h` : `${Math.round(seconds / 60)} min`);
/** Optional pool expiry choices (days; 0 = none). */
export const EXPIRY_DAYS: readonly { days: number; label: string }[] = [
  { days: 0, label: "No expiry" },
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days" },
];

/* ---------------- v10 compatibility (history, old forms) ---------------- */

/** Payment methods of the v10 form. Wise and Revolut are gone; old offers may still display them. */
export const PAYMENT_METHODS = ["USDT", "USDC"] as const;
export const FIAT_CURRENCIES = ["USD", "EUR", "SAR", "AED"] as const;

/**
 * Kadena tokens the v10 flow paid to a Kadena account (BRO). Kept for old offers' display and the market price
 * lookups; new pools use KADENA_TOKENS above.
 */
export const TOKEN_CURRENCIES = {
  BRO: { name: "BRO", note: "Kadena token", chains: ["2", "1"] },
} as const;
export type TokenCode = keyof typeof TOKEN_CURRENCIES;
export const isTokenCurrency = (code: string | null | undefined): code is TokenCode => !!code && code in TOKEN_CURRENCIES;
/** Currencies an offer can be priced in: fiat (paid by USDT, USDC) and Kadena tokens (paid in that token). */
export const PAY_CURRENCIES = [...FIAT_CURRENCIES, ...(Object.keys(TOKEN_CURRENCIES) as TokenCode[])];
/** Payment methods that fit a currency: a token offer is paid in that token only. */
export const methodsFor = (currency: string): readonly string[] => (isTokenCurrency(currency) ? [currency] : PAYMENT_METHODS);

/** "$12.50", "€12.50", "SAR 12.50", "USDT 0.0100", "BRO 0.00000200" */
export function currencyPrefix(code: string | null | undefined): string {
  if (code === "USD") return "$";
  if (code === "EUR") return "€";
  return code ? `${code} ` : "";
}

/** An open offer leaves the market after this many days without a buyer (server: OFFER_EXPIRY_DAYS). */
export const OFFER_LISTING_DAYS = 7;
/** An accepted trade nobody funded is filed under Finished after this many days (no KDA was locked). */
export const UNFUNDED_TRADE_DAYS = 5;

/**
 * A free giveaway: a sell offer at price 0 with the payment method "Giveaway". The winner pays nothing:
 * Mark as Paid needs no proof and the seller releases without the payment checks.
 */
export const GIVEAWAY_METHOD = "Giveaway";
export function isGiveaway(e: { price: number; paymentMethod?: string | null }): boolean {
  if (e.price !== 0 || !e.paymentMethod) return false;
  try { const m = JSON.parse(e.paymentMethod); return Array.isArray(m) && m.includes(GIVEAWAY_METHOD); } catch { return false; }
}
