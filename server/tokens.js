/**
 * Kadena tokens a pool can be priced in (escrow v11), from the one table the site uses too (shared/v11-chains.js):
 * BRO and FLUX on chain 1; kb-USDC, kb-ETH and kb-USDT on chain 2. Each one is also its own pricing currency: a
 * kb-ETH offer is priced in kb-ETH per KDA, and the market price comes from the token's KDA pool on a DEX.
 *
 * Price sources (checked on mainnet01 on 2026-10-18):
 *   - Mercatus (kaddex.exchange) runs on chain 2 only and has KDA pairs for BRO, FLUX, kb-USDC and kb-ETH. A token
 *     is the same token on every chain (cross-chain transfers), so chain 2's pool prices BRO and FLUX on chain 1 too.
 *   - kb-USDT has no Mercatus pair. FALLBACK, marked as such: it is priced as 1 USD (the CoinGecko KDA/USD price,
 *     see market.js) until a pool for it exists. The BRO DEX (n_f6aa93….bro-dex-*-KDA-kbUSDC-M, chain 2) is an
 *     order book, not a pool with reserves, so it is not read here.
 */
import { hash as blakeHash } from "@kadena/cryptography-utils";
import { CURRENCIES } from "../shared/v11-chains.js";

/** How each v11 token's KDA price is found: a Mercatus pair on `chain`, or (fallback) a peg to a market currency. */
export const PRICE_SOURCES = {
  BRO: { dex: "mercatus", chain: "2" },
  FLUX: { dex: "mercatus", chain: "2" },
  "kb-USDC": { dex: "mercatus", chain: "2" },
  "kb-ETH": { dex: "mercatus", chain: "2" },
  "kb-USDT": { peg: "USD", fallback: true }, // no Mercatus pair: assumed 1 USDT = 1 USD
};

/** v11 tokens by symbol: { symbol, module, precision, chain, price }. */
export const V11_TOKENS = Object.fromEntries(CURRENCIES.filter((c) => c.kind === "token").map((c) => [c.symbol, { ...c, price: PRICE_SOURCES[c.symbol] || null }]));

/**
 * v10 (history): tokens a seller was paid in to a Kadena account, with the chains the payout could name. Only BRO.
 * Kept for the v10 payout details (payout.js); v11 pools never use these.
 */
export const TOKENS = {
  BRO: { module: V11_TOKENS.BRO.module, decimals: V11_TOKENS.BRO.precision, chains: ["2", "1"], poolChain: "2" },
};

/** The token's symbol as the table writes it ("kb-usdc" -> "kb-USDC"), or undefined when it is not a Kadena token. */
export function tokenSymbol(code) {
  const c = String(code || "").toLowerCase();
  return Object.keys(V11_TOKENS).find((s) => s.toLowerCase() === c) || Object.keys(TOKENS).find((s) => s.toLowerCase() === c);
}
export const isToken = (code) => !!tokenSymbol(code);

/** A Kadena principal account: k:<64 hex> (Linx and most wallets), or a w:/r:/c:/u: principal. */
export const KADENA_ACCOUNT = /^(k:[0-9a-f]{64}|[wrcu]:[A-Za-z0-9_\-.:]{3,256})$/;

const apis = () => (process.env.TOKEN_CHAIN_API || process.env.ALERTS_CHAIN_API || "https://api.chainweb-community.org,https://chainweb.chaddex.com,https://api.chainweb.com")
  .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);

async function local(code, chainId) {
  const ct = Math.floor(Date.now() / 1000);
  const cmd = JSON.stringify({ networkId: "mainnet01", payload: { exec: { code, data: {} } }, signers: [], meta: { chainId, sender: "", gasLimit: 150000, gasPrice: 1e-8, ttl: 600, creationTime: ct }, nonce: `token-${ct}-${Math.random()}` });
  const body = JSON.stringify({ cmd, hash: blakeHash(cmd), sigs: [] });
  let last;
  for (const base of apis()) {
    try {
      const r = await fetch(`${base}/chainweb/0.0/mainnet01/chain/${chainId}/pact/api/v1/local?preflight=false&signatureVerification=false`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (d.result?.status !== "success") throw new Error(d.result?.error?.message || "Pact error");
      return d.result.data;
    } catch (e) { last = e; }
  }
  throw last || new Error("No chain API");
}
const num = (x) => (x && typeof x === "object" ? Number(x.decimal ?? x.int) : Number(x));

/** The Mercatus read for one token: its KDA pair's two reserves. */
export const mercatusCode = (module) => `(let ((p (kaddex.exchange.get-pair coin ${module}))) {"kda": (kaddex.exchange.reserve-for p coin), "token": (kaddex.exchange.reserve-for p ${module})})`;

/**
 * Tokens per 1 KDA from each token's pool reserves (spot price), e.g. { BRO: 0.000002002, "kb-ETH": 0.0000045 },
 * read on the chain the pool is on. Tokens that fail, and pegged ones (market.js adds those), are left out.
 */
export async function tokenPricesPerKda({ read = local } = {}) {
  const out = {};
  await Promise.all(Object.values(V11_TOKENS).filter((t) => t.price?.dex === "mercatus").map(async (t) => {
    try {
      const d = await read(mercatusCode(t.module), t.price.chain);
      const kda = num(d?.kda), tok = num(d?.token);
      if (kda > 0 && tok > 0) out[t.symbol] = tok / kda;
    } catch (e) { console.warn(`[market] ${t.symbol} pool read failed:`, e.message); }
  }));
  return out;
}

/** Fallback prices for pegged tokens from the market prices per KDA ({ USD: … }): { "kb-USDT": <USD per KDA> }. */
export function peggedPrices(marketPrices) {
  const out = {};
  for (const t of Object.values(V11_TOKENS)) if (t.price?.peg && marketPrices?.[t.price.peg] > 0) out[t.symbol] = marketPrices[t.price.peg];
  return out;
}
