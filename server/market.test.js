/** Market price tests (no database or network needed): node --test server/market.test.js */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCoinGecko, createMarket } from "./market.js";

const SAMPLE = { kadena: { usd: 0.00939048, usd_24h_change: -3.4576, eur: 0.00839151, sar: 0.03528067, aed: 0.03449122, aed_24h_change: -3.44, last_updated_at: 1791912282 } };

test("reads CoinGecko's answer", () => {
  const m = parseCoinGecko(SAMPLE);
  assert.deepEqual(m.prices, { USD: 0.00939048, EUR: 0.00839151, SAR: 0.03528067, AED: 0.03449122 });
  assert.equal(m.change24h.USD, -3.46);
  assert.equal(m.updatedAt, new Date(1791912282 * 1000).toISOString());
  assert.equal(parseCoinGecko({}), null);
  assert.equal(parseCoinGecko({ kadena: { eur: 1 } }), null, "needs at least USD");
});

test("asks at most once a minute, keeps the last price for 30 minutes when the source fails", async () => {
  let t = 0, calls = 0, fail = false;
  const fetcher = async () => { calls++; if (fail) throw new Error("down"); return { ok: true, json: async () => SAMPLE }; };
  const get = createMarket({ fetcher, now: () => t });
  assert.equal((await get()).prices.USD, 0.00939048);
  t = 30 * 1000; await get();
  assert.equal(calls, 1, "cached");
  fail = true; t = 5 * 60 * 1000;
  assert.equal((await get()).prices.USD, 0.00939048, "kept while the source is down");
  t = 31 * 60 * 1000;
  assert.equal(await get(), null, "too old: no comparison rather than a wrong one");
});
