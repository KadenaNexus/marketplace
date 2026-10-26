/**
 * Wording shared by the share message (src/lib/share.ts) and the link preview card (server/share.js).
 *
 * A pool's price is fixed when it is posted; the market moves. So a shared message says how the price compared
 * with the market on the day it was shared ("market price on Oct 26"), which stays true as the market moves.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "market price on Oct 26", "2.1% below market on Oct 26", or "" without a market price. */
export function marketNote(price, marketPrice, when = new Date()) {
  if (!(price > 0) || !(marketPrice > 0)) return "";
  const pct = ((price - marketPrice) / marketPrice) * 100;
  const a = Math.abs(pct);
  const day = `${MONTHS[when.getUTCMonth()]} ${when.getUTCDate()}`;
  if (a < 0.5) return `market price on ${day}`;
  return `${a >= 100 ? Math.round(a) : a.toFixed(1)}% ${pct > 0 ? "above" : "below"} market on ${day}`;
}

/** KDA's market price in a pool's currency: USDT and USDC (paid outside Kadena) follow the USD price. */
export function marketPriceFor(prices, currency) {
  const own = prices?.[currency];
  if (own > 0) return own;
  return currency === "USDT" || currency === "USDC" ? prices?.USD ?? null : null;
}

/**
 * Who has what in escrow. A SELL pool's KDA is locked when it is posted. A BUY pool locks nothing: each seller's KDA
 * is locked when they take a slice and released to the buyer once they are paid.
 */
export function escrowNote(side) {
  return side === "BUY" ? "Sellers' KDA is held in escrow until the buyer pays" : "The seller's KDA is already held in escrow";
}
