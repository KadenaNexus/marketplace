/**
 * What the Marketplace trades with. Kept small on purpose: payments that cannot be pulled back
 * (stablecoins on-chain; Wise and Revolut transfers), and no bank transfers or PayPal-style methods.
 * Offers made earlier keep whatever methods and currency they were created with.
 */
export const PAYMENT_METHODS = ["USDT", "USDC", "Wise", "Revolut"] as const;
export const FIAT_CURRENCIES = ["USD", "EUR", "SAR", "AED"] as const;

/**
 * Kadena tokens a seller can be paid in. Each is its own pricing currency (a BRO offer is priced in BRO per KDA),
 * paid by a token transfer on the Kadena chain to the seller's account. See server/tokens.js.
 */
export const TOKEN_CURRENCIES = {
  BRO: { name: "BRO", note: "Kadena token", chains: ["2", "1"] },
} as const;
export type TokenCode = keyof typeof TOKEN_CURRENCIES;
export const isTokenCurrency = (code: string | null | undefined): code is TokenCode => !!code && code in TOKEN_CURRENCIES;
/** Currencies an offer can be priced in: fiat (paid by USDT, USDC, Wise or Revolut) and Kadena tokens (paid in that token). */
export const PAY_CURRENCIES = [...FIAT_CURRENCIES, ...(Object.keys(TOKEN_CURRENCIES) as TokenCode[])];
/** Payment methods that fit a currency: a token offer is paid in that token only. */
export const methodsFor = (currency: string): readonly string[] => (isTokenCurrency(currency) ? [currency] : PAYMENT_METHODS);

/** "$12.50", "€12.50", "SAR 12.50", "AED 12.50", "BRO 0.00000200" */
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
