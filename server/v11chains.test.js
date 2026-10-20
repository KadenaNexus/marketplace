/**
 * The escrow v11 chain/currency table (shared/v11-chains.js) and what the site and the server build on it: which
 * chain a currency lives on, the token modules and precisions, (chain, id) references, exact token payments,
 * and token prices read on the right chain. No database, no network.
 *   node --test server/v11chains.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CURRENCIES, V11_CHAINS, chainForCurrency, currenciesOn, fitsTable, tokenInfo, toRef, parseRef, canonicalRef, tokenPayFor,
} from "../shared/v11-chains.js";
import { V11_TOKENS, TOKENS, isToken, tokenSymbol, tokenPricesPerKda, peggedPrices, mercatusCode } from "./tokens.js";
import { createMarket } from "./market.js";

const E595 = "n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff";

test("the currency decides the chain: USDT, USDC, BRO, FLUX on chain 1; kb-USDC, kb-ETH, kb-USDT on chain 2", () => {
  assert.deepEqual(V11_CHAINS, ["1", "2"]);
  assert.deepEqual(currenciesOn("1").map((c) => c.symbol), ["USDT", "USDC", "BRO", "FLUX"]);
  assert.deepEqual(currenciesOn("2").map((c) => c.symbol), ["kb-USDC", "kb-ETH", "kb-USDT"]);
  assert.equal(CURRENCIES.length, 7, "only these seven: no Wise, Revolut or fiat in v11");
  for (const [sym, chain] of [["USDT", "1"], ["USDC", "1"], ["BRO", "1"], ["FLUX", "1"], ["kb-USDC", "2"], ["kb-ETH", "2"], ["kb-USDT", "2"], ["FREE", "1"]]) {
    assert.equal(chainForCurrency(sym), chain, sym);
  }
  assert.equal(chainForCurrency("EUR"), undefined);
  assert.equal(chainForCurrency("kb-usdc"), undefined, "symbols are exact");
});

test("token modules and precisions as verified on mainnet (no TODO placeholders, no router adapters)", () => {
  const t = Object.fromEntries(CURRENCIES.filter((c) => c.kind === "token").map((c) => [c.symbol, [c.module, c.precision, c.chain]]));
  assert.deepEqual(t, {
    BRO: ["n_582fed11af00dc626812cd7890bb88e72067f28c.bro", 12, "1"],
    FLUX: ["runonflux.flux", 8, "1"],
    "kb-USDC": [`${E595}.kb-USDC`, 6, "2"],
    "kb-ETH": [`${E595}.kb-ETH`, 18, "2"],
    "kb-USDT": [`${E595}.kb-USDT`, 6, "2"],
  });
  assert.ok(!CURRENCIES.some((c) => c.module === `${E595}.BRO` || c.module === `${E595}.FLUX`));
  for (const c of CURRENCIES.filter((x) => x.kind === "offchain")) assert.equal(c.module, undefined, c.symbol);
});

test("site and server read the same table: markets.ts and tokens.js take it from shared/v11-chains.js", () => {
  const markets = fs.readFileSync(new URL("../src/lib/markets.ts", import.meta.url), "utf8");
  assert.match(markets, /from "\.\.\/\.\.\/shared\/v11-chains\.js"/);
  assert.doesNotMatch(markets, /TODO-verify/);
  for (const c of CURRENCIES.filter((x) => x.module)) assert.ok(!markets.includes(c.module), `markets.ts must not repeat ${c.module}`);
  const v11 = fs.readFileSync(new URL("../src/lib/v11.ts", import.meta.url), "utf8");
  assert.match(v11, /from "\.\.\/\.\.\/shared\/v11-chains\.js"/);
  // the server's token list is the table's
  assert.deepEqual(Object.keys(V11_TOKENS), ["BRO", "FLUX", "kb-USDC", "kb-ETH", "kb-USDT"]);
  for (const [sym, t] of Object.entries(V11_TOKENS)) assert.deepEqual([t.module, t.precision, t.chain], [tokenInfo(sym).module, tokenInfo(sym).precision, tokenInfo(sym).chain]);
  assert.equal(TOKENS.BRO.module, V11_TOKENS.BRO.module, "the v10 BRO entry is the same module");
  assert.deepEqual([isToken("kb-eth"), tokenSymbol("KB-ETH"), isToken("BRO"), isToken("USDT")], [true, "kb-ETH", true, false]);
});

test("a pool must fit the table: the right module for its symbol, on its chain", () => {
  assert.ok(fitsTable("2", "kb-USDC", `${E595}.kb-USDC`));
  assert.ok(fitsTable("1", "BRO", "n_582fed11af00dc626812cd7890bb88e72067f28c.bro"));
  assert.ok(fitsTable("1", "USDT", ""));
  assert.ok(fitsTable("1", "FREE", "") && fitsTable("2", "FREE", ""), "a giveaway on any v11 chain");
  assert.ok(!fitsTable("1", "kb-USDC", `${E595}.kb-USDC`), "kb-USDC is a chain-2 currency");
  assert.ok(!fitsTable("2", "kb-USDC", "free.fake-usdc"), "another module called kb-USDC");
  assert.ok(!fitsTable("2", "BRO", `${E595}.BRO`), "the router adapter is not BRO");
  assert.ok(!fitsTable("2", "USDT", ""), "USDT paid outside Kadena is on chain 1");
  assert.ok(!fitsTable("3", "USDT", ""));
});

test("(chain, id) references: chain 1 keeps the bare id, chain 2 is '2:<id>', and they never collide", () => {
  assert.equal(toRef("1", "pool-1-abc"), "pool-1-abc");
  assert.equal(toRef("2", "pool-1-abc"), "2:pool-1-abc");
  assert.notEqual(toRef("1", "trade-9"), toRef("2", "trade-9"));
  assert.deepEqual(parseRef("2:trade-9"), { chain: "2", id: "trade-9" });
  assert.deepEqual(parseRef("trade-9"), { chain: "1", id: "trade-9" }, "an old link without a chain is chain 1");
  assert.deepEqual(parseRef("1:trade-9"), { chain: "1", id: "trade-9" });
  assert.equal(canonicalRef("1:trade-9"), "trade-9");
  // a chain-1 id that itself looks like "2:x" is written "1:2:x", so it cannot pass for a chain-2 id
  assert.equal(toRef("1", "2:x"), "1:2:x");
  assert.deepEqual(parseRef(toRef("1", "2:x")), { chain: "1", id: "2:x" });
  for (const [c, id] of [["1", "a"], ["2", "a"], ["1", "1:a"], ["2", "2:a"], ["2", "pool-1776000000000-x1y2z3"]]) assert.deepEqual(parseRef(toRef(c, id)), { chain: c, id });
});

test("token payments are amount × price rounded UP to the token's precision, exactly (kb-ETH: 18 decimals)", () => {
  assert.equal(tokenPayFor(10, 0.0000045, 18), "0.000045");
  assert.equal(tokenPayFor(1.5, 0.000001234567, 18), "0.0000018518505");
  assert.equal(tokenPayFor(3, 0.333333333333, 18), "0.999999999999");
  assert.equal(tokenPayFor(3, 0.3333337, 6), "1.000002", "6 decimals (kb-USDC, kb-USDT): rounded up");
  assert.equal(tokenPayFor(10, 0.1234567, 6), "1.234567", "exact when it fits");
  assert.equal(tokenPayFor(1, 0.000000001, 8), "0.00000001", "FLUX: a dust payment rounds up to one unit, never to 0");
  assert.equal(tokenPayFor(100, 0.000002002, 12), "0.0002002");
  assert.equal(tokenPayFor(2, 1.25, 8), "2.5");
  assert.equal(tokenPayFor(4, 25, 6), "100.0", "a Pact decimal always has a point");
  // never fewer than the contract's due (round(amount*price, prec)), never more decimals than the token has
  for (const [a, p, prec] of [[123.456789, 0.000004567891, 18], [7, 0.0123456789, 6], [0.5, 3.141592653589, 8]]) {
    const pay = tokenPayFor(a, p, prec), [, frac = ""] = pay.split(".");
    assert.ok(frac.length <= prec, `${pay}: at most ${prec} decimals`);
    assert.ok(Number(pay) >= a * p - 1e-9, `${pay} >= ${a * p}`);
  }
});

test("token prices are read from the token's pool on the chain the DEX is on; kb-USDT falls back to the USD peg", async () => {
  const asked = [];
  const reserves = { "kb-USDC": [928394.83, 9968.24], "kb-ETH": [268282.34, 1.2018916], BRO: [403974.15, 0.9139216], FLUX: [1084439.73, 162755.24] };
  const read = async (code, chain) => {
    asked.push([code, chain]);
    const sym = Object.keys(V11_TOKENS).find((s) => code === mercatusCode(V11_TOKENS[s].module));
    if (!reserves[sym]) throw new Error("No value found in table kaddex.exchange_pairs");
    return { kda: { decimal: String(reserves[sym][0]) }, token: reserves[sym][1] };
  };
  const p = await tokenPricesPerKda({ read });
  assert.deepEqual(Object.keys(p).sort(), ["BRO", "FLUX", "kb-ETH", "kb-USDC"]);
  assert.ok(Math.abs(p["kb-USDC"] - 9968.24 / 928394.83) < 1e-15);
  assert.ok(asked.every(([, chain]) => chain === "2"), "Mercatus is on chain 2");
  assert.ok(!asked.some(([code]) => code.includes("kb-USDT")), "kb-USDT has no pool: not asked");
  assert.deepEqual(peggedPrices({ USD: 0.0107 }), { "kb-USDT": 0.0107 });
  assert.deepEqual(peggedPrices({}), {});
  // the market endpoint carries all of them: pools first, the peg as the marked fallback
  const fetcher = async () => ({ ok: true, json: async () => ({ kadena: { usd: 0.0107, eur: 0.0092, sar: 0.04, aed: 0.039, last_updated_at: 1791912282 } }) });
  const m = await createMarket({ fetcher, tokenPrices: async () => p })();
  assert.equal(m.prices["kb-USDT"], 0.0107);
  assert.equal(m.prices["kb-ETH"], p["kb-ETH"]);
});
