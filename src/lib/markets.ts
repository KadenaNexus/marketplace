/**
 * What the Marketplace trades with. Kept small on purpose: payments that cannot be pulled back
 * (stablecoins on-chain; Wise and Revolut transfers), and no bank transfers or PayPal-style methods.
 * Offers made earlier keep whatever methods and currency they were created with.
 */
export const PAYMENT_METHODS = ["USDT", "USDC", "Wise", "Revolut"] as const;
export const FIAT_CURRENCIES = ["USD", "EUR", "SAR", "AED"] as const;

/** "$12.50", "€12.50", "SAR 12.50", "AED 12.50" */
export function currencyPrefix(code: string | null | undefined): string {
  if (code === "USD") return "$";
  if (code === "EUR") return "€";
  return code ? `${code} ` : "";
}
