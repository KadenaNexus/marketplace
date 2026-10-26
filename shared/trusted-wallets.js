/**
 * Wallets that skip the new-trader limit (500 KDA per trade until 3 completed trades, src/lib/trust.ts).
 * Add a full k: account (public address, never a key) to let it trade larger amounts from its first trade.
 * The limit is a site guardrail, not a contract rule, so this list only changes what the site allows.
 */
export const TRUSTED_WALLETS = new Set([
]);

/** Completed trades a trusted wallet is reported with, so it is never "new" (NEW_TRADER_TRADES in src/lib/trust.ts). */
export const TRUSTED_MIN_TRADES = 3;
