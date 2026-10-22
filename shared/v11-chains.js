/**
 * Escrow v11 chains and currencies: the one table the site (src/lib/markets.ts, src/lib/v11.ts) and the server
 * (server/chain.js, server/tokens.js) both read, so they can never disagree about which chain a currency lives on.
 *
 * The same contract (free.p2p-escrow-v11, same governance) is deployed on chains 1 and 2. The currency decides the
 * chain of a pool: the Kadena tokens settle on the chain where the token is, and USDT/USDC (paid outside Kadena)
 * stay on chain 1 next to v10. Token modules and precisions were checked on mainnet01 with /local on 2026-10-18
 * (the n_e595….BRO / n_e595….FLUX modules are router adapters, not tokens: never list them).
 *
 * Plain ESM JavaScript (types in v11-chains.d.ts) so Node imports it without a build step.
 */

/** Chains escrow v11 is deployed on. A pool or trade with no chain in its reference is on chain 1. */
export const V11_CHAINS = ["1", "2"];
export const DEFAULT_CHAIN = "1";

/**
 * Every currency a v11 pool can be priced in. `offchain`: paid outside Kadena (networks in markets.ts), the seller
 * releases. `token`: a fungible-v2 module on the pool's chain, swapped for the KDA in one transaction.
 */
export const CURRENCIES = [
  { symbol: "USDT", name: "Tether USD", chain: "1", kind: "offchain" },
  { symbol: "USDC", name: "USD Coin", chain: "1", kind: "offchain" },
  { symbol: "BRO", name: "BRO", chain: "1", kind: "token", module: "n_582fed11af00dc626812cd7890bb88e72067f28c.bro", precision: 12 },
  { symbol: "FLUX", name: "Flux", chain: "1", kind: "token", module: "runonflux.flux", precision: 8 },
  { symbol: "kb-USDC", name: "Kadena-bridged USDC", chain: "2", kind: "token", module: "n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-USDC", precision: 6 },
  { symbol: "kb-ETH", name: "Kadena-bridged ETH", chain: "2", kind: "token", module: "n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-ETH", precision: 18 },
  { symbol: "kb-USDT", name: "Kadena-bridged USDT", chain: "2", kind: "token", module: "n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-USDT", precision: 6 },
];
/** The currency a giveaway stores on chain (price 0, no token). Giveaways are posted on the default chain. */
export const GIVEAWAY_CURRENCY = "FREE";

export const currencyInfo = (symbol) => CURRENCIES.find((c) => c.symbol === symbol);
export const tokenInfo = (symbol) => CURRENCIES.find((c) => c.kind === "token" && c.symbol === symbol);
/** The chain a new pool in this currency goes on (a giveaway: the default chain); undefined for an unknown currency. */
export const chainForCurrency = (symbol) => (symbol === GIVEAWAY_CURRENCY ? DEFAULT_CHAIN : currencyInfo(symbol)?.chain);
/** Currencies of one chain, in table order. */
export const currenciesOn = (chain) => CURRENCIES.filter((c) => c.chain === String(chain));

/**
 * Does a pool read from `chain` fit the table? A token pool must name exactly the module listed for its symbol on
 * that chain (anyone can post a pool with any module and call it "kb-USDC"); an off-chain currency must be on its
 * own chain; a giveaway is fine on any v11 chain.
 */
export function fitsTable(chain, currency, token) {
  const c = String(chain);
  if (!V11_CHAINS.includes(c)) return false;
  if (!token) {
    if (currency === GIVEAWAY_CURRENCY) return true;
    const info = currencyInfo(currency);
    return !!info && info.kind === "offchain" && info.chain === c;
  }
  const info = tokenInfo(currency);
  return !!info && info.chain === c && info.module === token;
}

/* ---------------- (chain, id) references ---------------- */

/**
 * A pool or trade is identified by (chain, id): the same id can exist on both chains. Everywhere off chain (URLs,
 * the server's tables, React keys, caches) it is written as one string: "2:pool-…" on chain 2 and the bare id on
 * chain 1, so links and rows from before chain 2 keep working. A chain-1 id that itself starts with "<digits>:"
 * gets the "1:" prefix so it cannot be mistaken for another chain.
 */
const PREFIXED = /^(\d{1,2}):([\s\S]+)$/;
export function toRef(chain, id) {
  const c = String(chain || DEFAULT_CHAIN), s = String(id);
  return c === "1" && !PREFIXED.test(s) ? s : `${c}:${s}`;
}
/** "2:trade-…" -> { chain: "2", id: "trade-…" }; a bare id is chain 1. */
export function parseRef(ref) {
  const s = String(ref ?? "");
  const m = PREFIXED.exec(s);
  return m ? { chain: String(Number(m[1])), id: m[2] } : { chain: "1", id: s };
}
/** The one way to write a reference ("1:pool-x" -> "pool-x"). */
export const canonicalRef = (ref) => { const r = parseRef(ref); return toRef(r.chain, r.id); };
export const chainOfRef = (ref) => parseRef(ref).chain;
export const idOfRef = (ref) => parseRef(ref).id;

/* ---------------- token amounts ---------------- */

const SCALE = 12; // the contract keeps amount and price to 12 decimals
const toUnits = (n) => {
  const s = Number(n).toFixed(SCALE);
  if (!/^\d+\.\d+$/.test(s)) throw new Error(`Not a positive number: ${n}`);
  return BigInt(s.replace(".", ""));
};
const fromUnits = (u, decimals) => {
  const neg = u < 0n, a = (neg ? -u : u).toString().padStart(decimals + 1, "0");
  const whole = decimals ? a.slice(0, -decimals) : a, frac = decimals ? a.slice(-decimals).replace(/0+$/, "") : "";
  return `${neg ? "-" : ""}${whole}.${frac || "0"}`;
};

/**
 * What a buyer pays in a token for `amount` KDA at `price`: amount × price rounded UP to the token's precision, as a
 * Pact decimal literal ("2.5", "0.000000000123456789"). Exact (BigInt), because take-and-settle rejects a payment
 * with more decimals than the token has or less than amount × price rounded to them; floating point cannot hold 18.
 */
export function tokenPayFor(amount, price, precision) {
  const p = Math.max(0, Math.min(24, Math.floor(Number(precision))));
  const prod = toUnits(amount) * toUnits(price); // scale 10^24
  const div = 10n ** BigInt(2 * SCALE - p);
  return fromUnits((prod + div - 1n) / div, p);
}
