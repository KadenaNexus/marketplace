/**
 * Kadena tokens a KDA seller can be paid in (the buyer sends them on the chain). Each one is also its own
 * pricing currency: a BRO offer is priced in BRO per KDA, and the market price comes from the token's
 * KDA pool on Mercatus (kaddex.exchange, chain 2).
 */
import { hash as blakeHash } from "@kadena/cryptography-utils";

export const TOKENS = {
  BRO: { module: "n_582fed11af00dc626812cd7890bb88e72067f28c.bro", decimals: 12, chains: ["2", "1"], poolChain: "2" },
};
export const isToken = (code) => Object.prototype.hasOwnProperty.call(TOKENS, String(code || "").toUpperCase());

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

/** Tokens per 1 KDA from the pool reserves (spot price), e.g. { BRO: 0.000002002 }. Tokens that fail are left out. */
export async function tokenPricesPerKda({ read = local } = {}) {
  const out = {};
  await Promise.all(Object.entries(TOKENS).map(async ([code, t]) => {
    try {
      const d = await read(`(let ((p (kaddex.exchange.get-pair coin ${t.module}))) {"kda": (kaddex.exchange.reserve-for p coin), "token": (kaddex.exchange.reserve-for p ${t.module})})`, t.poolChain);
      const kda = num(d?.kda), tok = num(d?.token);
      if (kda > 0 && tok > 0) out[code] = tok / kda;
    } catch (e) { console.warn(`[market] ${code} pool read failed:`, e.message); }
  }));
  return out;
}
