/**
 * Auto-release tests. Needs a Postgres with server/schema.sql applied (CI does this).
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kadena_nexus node --test server/autoRelease.test.js
 * No network: TronGrid, Etherscan and Chainweb (/local, /send, /poll) are one mocked fetch; the cached chain read is injected.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import express from "express";
import { base64UrlDecodeArr, genKeyPair, hexToBin, verifySig } from "@kadena/cryptography-utils";
import { AUTO_NETWORKS, CONTRACT_GRACE_S, tradeDeadline, autoReleaseConfig, createAutoRelease, registerAutoReleaseRoutes, transferMatches, addressKey, inWindow } from "./autoRelease.js";
import { toPool, toTrade } from "./chain.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/kadena_nexus" });
const SELLER = "k:" + "a".repeat(64), BUYER = "k:" + "b".repeat(64), OTHER = "k:" + "c".repeat(64), ARB = "k:" + "d".repeat(64);
const TRON = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", TRON2 = "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7", EVM = "0x52908400098527886E0F7030069857D2E4169EE7";
const USDT_TRON = AUTO_NETWORKS["USDT:TRC20"].contract, USDT_ETH = AUTO_NETWORKS["USDT:ERC20"].contract;
const FAKE_TRON = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";
const keys = genKeyPair();
const AGENT = `k:${keys.publicKey}`;
const T0 = Date.parse("2026-10-18T10:00:00Z");
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const EPOCH = { timep: "1970-01-01T00:00:00Z" };

/* ---------------- the mocked outside world ---------------- */
let NOW = T0;
const pools = new Map(), trades = new Map();      // on-chain id -> raw Pact record (chain 1, so id = reference)
let CFG = { arbiter: ARB, "t-release": 3600, "fee-bps": 0, "fee-account": "", paused: false, agent: AGENT };
let tron = [], eth = [], sent = [], polls = {}, sendStatus = 200, calls = [];
const rawPool = (o = {}) => ({ creator: SELLER, side: "SELL", available: 900, locked: 100, min: 10, max: 500, price: 0.01066, currency: "USDT", token: "", "pay-window": 1800, "expires-at": EPOCH, agent: AGENT, state: "OPEN", "created-at": { timep: iso(T0 - 3600e3) }, takes: 1, ...o });
const rawTrade = (o = {}) => ({ offer: "arttest-pool", seller: SELLER, buyer: BUYER, amount: 50, price: 0.01066, currency: "USDT", token: "", "pay-amount": 0.533, fee: 0, "pay-window": 1800, agent: AGENT, state: "FUNDED", "funded-at": { timep: iso(T0) }, "paid-at": EPOCH, "closed-at": EPOCH, ...o });
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

async function fetchMock(url, opts = {}) {
  const u = new URL(url);
  calls.push(u.host + u.pathname);
  if (u.host === "tron.test") {
    const addr = decodeURIComponent(u.pathname.split("/")[3]);
    assert.equal(u.searchParams.get("only_confirmed"), "true");
    assert.equal(u.searchParams.get("only_to"), "true");
    const min = Number(u.searchParams.get("min_timestamp"));
    return json({ success: true, data: tron.filter((x) => x.to === addr && x.block_timestamp >= min), meta: {} });
  }
  if (u.host === "eth.test") {
    assert.equal(u.searchParams.get("chainid"), "1");
    assert.equal(u.searchParams.get("apikey"), "eth-key");
    const addr = u.searchParams.get("address").toLowerCase(), c = u.searchParams.get("contractaddress").toLowerCase();
    const rows = eth.filter((x) => (x.to.toLowerCase() === addr || x.from?.toLowerCase() === addr) && x.contractAddress.toLowerCase() === c);
    return json(rows.length ? { status: "1", message: "OK", result: rows } : { status: "0", message: "No transactions found", result: [] });
  }
  if (u.host === "chain.test") {
    const body = JSON.parse(opts.body);
    if (u.pathname.endsWith("/local")) {
      const code = JSON.parse(body.cmd).payload.exec.code;
      const id = /get-trade "([^"]+)"/.exec(code)?.[1];
      const t = trades.get(id);
      if (!t) return json({ result: { status: "failure", error: { message: `read: row not found: ${id}` } } });
      return json({ result: { status: "success", data: { t, o: pools.get(t.offer) ?? rawPool(), c: CFG } } });
    }
    if (u.pathname.endsWith("/send")) {
      sent.push(body.cmds[0]);
      return sendStatus === 200 ? json({ requestKeys: [body.cmds[0].hash] }) : json({ error: "validation failed" }, sendStatus);
    }
    if (u.pathname.endsWith("/poll")) {
      const k = body.requestKeys[0];
      return json(polls[k] ? { [k]: { reqKey: k, result: polls[k] } } : {});
    }
  }
  throw new Error(`unexpected fetch ${url}`);
}
const snapshot = async () => ({
  pools: [...pools].map(([id, o]) => toPool(id, o, "1")),
  trades: [...trades].map(([id, t]) => toTrade(id, t, "1")),
  config: { arbiter: ARB, tRelease: 3600, agent: AGENT }, configs: { "1": { arbiter: ARB, tRelease: 3600, agent: AGENT } },
});
const ENV = { AUTO_RELEASE_SECRET: keys.secretKey, TRONGRID_API: "http://tron.test", ETHERSCAN_API: "http://eth.test/v2/api", ETHERSCAN_API_KEY: "eth-key" };
const quiet = { log() {}, warn() {} };
const make = (env = ENV) => createAutoRelease({ getPool: () => pool, config: autoReleaseConfig(env), fetchFn: fetchMock, now: () => NOW, chain: snapshot, apis: ["http://chain.test"], contract: "free.p2p-escrow-v11", log: quiet });

const tronTx = (o) => ({ transaction_id: `tx-${Math.random().toString(36).slice(2)}`, token_info: { symbol: "USDT", address: USDT_TRON, decimals: 6 }, block_timestamp: T0 + 60e3, from: "TFromXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", to: TRON, type: "Transfer", value: "533017", ...o });
const ethTx = (o) => ({ hash: `0x${Math.random().toString(16).slice(2)}`, contractAddress: USDT_ETH.toLowerCase(), to: EVM.toLowerCase(), from: "0x1111111111111111111111111111111111111111", value: "533017", timeStamp: String((T0 + 60e3) / 1000), confirmations: "20", ...o });

/* ---------------- DB and the API ---------------- */
const clean = async () => {
  await pool.query("DELETE FROM auto_release WHERE trade_ref LIKE 'arttest-%'");
  await pool.query("DELETE FROM pool_details WHERE pool_id LIKE 'arttest-%'");
  await pool.query("DELETE FROM trade_payouts WHERE offer_id LIKE 'arttest-%'");
};
const sellDetails = (payout = { "USDT:TRC20": TRON, "USDT:ERC20": EVM }, id = "arttest-pool", creator = SELLER) =>
  pool.query("INSERT INTO pool_details (pool_id, creator, networks, payout) VALUES ($1, $2, $3, $4) ON CONFLICT (pool_id) DO UPDATE SET networks = EXCLUDED.networks, payout = EXCLUDED.payout",
    [id, creator, JSON.stringify(Object.keys(payout)), JSON.stringify(payout)]);
const row = async (ref) => (await pool.query("SELECT * FROM auto_release WHERE trade_ref = $1", [ref])).rows[0];
/** Make the row's expected amount 0.533017 (the offset is random): moves the row and its watches. */
const pin = async (ref, units = "533017") => {
  await pool.query("UPDATE auto_release SET expected_units = $2, amount_offset = $3 WHERE trade_ref = $1", [ref, units, Number(BigInt(units) % 1000n) || 1]);
  await pool.query("UPDATE auto_release_watch SET expected_units = $2, amount_offset = $3 WHERE trade_ref = $1", [ref, units, Number(BigInt(units) % 1000n) || 1]);
};

let server, base, auto;
before(async () => {
  await clean();
  auto = make();
  const app = express();
  app.use(express.json());
  // the real server checks a wallet signature; here the wallet in the request is taken as proven
  const requireAuth = (req, from = "body") => { const w = (from === "query" ? req.query : req.body)?.wallet; return w ? { ok: true, wallet: w } : { ok: false, status: 400, error: "Missing wallet" }; };
  registerAutoReleaseRoutes(app, { getPool: () => pool, requireAuth, sendAuthError: (res, a) => res.status(a.status).json({ error: a.error }), auto });
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await clean(); await pool.end(); });
beforeEach(async () => {
  await clean();
  NOW = T0 + 5 * 60e3;
  pools.clear(); trades.clear(); tron = []; eth = []; sent = []; polls = {}; sendStatus = 200; calls = [];
  CFG = { ...CFG, agent: AGENT };
  pools.set("arttest-pool", rawPool());
});
const getAuto = (ref, wallet) => fetch(`${base}/api/v11/trades/${encodeURIComponent(ref)}/auto?wallet=${wallet}&publicKey=x&signedCmd=x`).then(async (r) => ({ status: r.status, body: await r.json() }));

/* ---------------- tests ---------------- */

test("config: off without a secret, the secret never in the config, Ethereum only with an Etherscan key", () => {
  const off = autoReleaseConfig({});
  assert.equal(off.enabled, false);
  assert.deepEqual(off.networks, []);
  assert.equal(autoReleaseConfig({ AUTO_RELEASE_SECRET: "xyz" }).enabled, false);
  const on = autoReleaseConfig({ AUTO_RELEASE_SECRET: keys.secretKey });
  assert.equal(on.agent, AGENT);
  assert.deepEqual(on.networks, ["USDT:TRC20"], "no Etherscan key: Tron only");
  assert.deepEqual(on.notWatched, ["USDT:ERC20", "USDC:ERC20"]);
  assert.ok(!JSON.stringify(on).includes(keys.secretKey), "the secret is not in anything that could be logged");
  assert.deepEqual(autoReleaseConfig(ENV).networks, ["USDT:TRC20", "USDT:ERC20", "USDC:ERC20"]);
});

test("a transfer matches only with the official token, the snapshot address, the exact amount, in the window, confirmed", () => {
  const r = { funded_at: new Date(T0), deadline: new Date(T0 + 1800e3) };
  const w = { network: "USDT:TRC20", address_key: TRON, expected_units: "533017" };
  const tr = { network: "USDT:TRC20", txid: "t1", contract: USDT_TRON, to: TRON, value: "533017", timeMs: T0 + 60e3, confirmed: true };
  assert.equal(transferMatches(r, w, tr), true);
  assert.equal(transferMatches(r, w, { ...tr, value: "533000" }), false, "the bare pay-amount");
  assert.equal(transferMatches(r, w, { ...tr, value: "533018" }), false, "one micro-unit more");
  assert.equal(transferMatches(r, w, { ...tr, contract: FAKE_TRON }), false, "a token called USDT that is not Tether's");
  assert.equal(transferMatches(r, w, { ...tr, to: TRON2 }), false, "another address");
  assert.equal(transferMatches(r, w, { ...tr, timeMs: T0 - 3 * 60e3 }), false, "before the take");
  assert.equal(transferMatches(r, w, { ...tr, timeMs: T0 - 60e3 }), true, "a minute before is clock skew");
  assert.equal(transferMatches(r, w, { ...tr, timeMs: T0 + 1800e3 + 16 * 60e3 }), false, "after deadline + grace");
  assert.equal(transferMatches(r, w, { ...tr, timeMs: T0 + 1800e3 + 14 * 60e3 }), true, "inside the grace");
  assert.equal(transferMatches(r, w, { ...tr, confirmed: false }), false);
  assert.equal(transferMatches(r, w, { ...tr, network: "USDT:ERC20" }), false);
  const we = { network: "USDT:ERC20", address_key: addressKey("USDT:ERC20", EVM), expected_units: "533017" };
  const te = { network: "USDT:ERC20", txid: "0x1", contract: USDT_ETH.toLowerCase(), to: EVM.toLowerCase(), value: "533017", timeMs: T0 + 60e3, confirmations: 12 };
  assert.equal(transferMatches(r, we, te), true, "Ethereum addresses compare without case");
  assert.equal(transferMatches(r, we, { ...te, confirmations: 11 }), false, "fewer than 12 confirmations");
  assert.equal(transferMatches(r, we, { ...te, contract: AUTO_NETWORKS["USDC:ERC20"].contract }), false, "USDC is not USDT");
});

test("the endpoint: the two sides and the arbiter only; the row is made on first request with pay-amount + offset", async () => {
  await sellDetails();
  trades.set("arttest-t1", rawTrade());
  assert.equal((await getAuto("arttest-t1", OTHER)).status, 403, "a stranger");
  assert.equal(await row("arttest-t1"), undefined, "a stranger's request makes no row");
  const b = await getAuto("arttest-t1", BUYER);
  assert.equal(b.status, 200);
  assert.equal(b.body.enabled, true);
  assert.equal(b.body.status, "watching");
  assert.equal(b.body.currency, "USDT");
  assert.match(b.body.amount, /^0\.533\d{3}$/);
  const off = Number(b.body.amount.slice(-3));
  assert.ok(off >= 1 && off <= 999);
  assert.deepEqual(b.body.networks, [{ id: "USDT:ERC20", address: EVM }, { id: "USDT:TRC20", address: TRON }]);
  const s = await getAuto("arttest-t1", SELLER);
  assert.deepEqual([s.status, s.body.amount], [200, b.body.amount], "same row for the seller");
  assert.equal((await getAuto("arttest-t1", ARB)).status, 200, "the arbiter");
  assert.equal((await getAuto("arttest-nope", BUYER)).status, 404);
  assert.equal((await fetch(`${base}/api/v11/trades/arttest-t1/auto`)).status, 400, "no wallet");
  // later edits of the pool's addresses do not move where the agent looks: the network is dropped, not changed
  await sellDetails({ "USDT:TRC20": TRON2, "USDT:ERC20": EVM });
  const after = await getAuto("arttest-t1", BUYER);
  assert.deepEqual(after.body.networks, [{ id: "USDT:ERC20", address: EVM }]);
  const info = await fetch(`${base}/api/v11/auto-release`).then((r) => r.json());
  assert.deepEqual([info.enabled, info.agent, info.networks], [true, AGENT, ["USDT:TRC20", "USDT:ERC20", "USDC:ERC20"]]);
});

test("not auto: another agent, no agent, a token trade, a closed trade, or the feature off", async () => {
  await sellDetails();
  trades.set("arttest-other", rawTrade({ agent: OTHER }));
  trades.set("arttest-none", rawTrade({ agent: "" }));
  trades.set("arttest-token", rawTrade({ currency: "kb-USDC", token: "n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-USDC" }));
  trades.set("arttest-done", rawTrade({ state: "COMPLETED" }));
  for (const id of ["arttest-other", "arttest-none", "arttest-token", "arttest-done"]) {
    const r = await getAuto(id, BUYER);
    assert.deepEqual([r.status, r.body.enabled], [200, false], id);
    assert.equal(await row(id), undefined, id);
  }
  const offApp = make({});
  const f = await offApp.forTrade("arttest-none");
  assert.deepEqual(f.body.enabled, false);
  assert.deepEqual(await offApp.tick(), { skipped: true });
  // the watcher ignores them too
  await auto.tick();
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM auto_release WHERE trade_ref LIKE 'arttest-%'")).rows[0].n, 0);
});

test("offsets are unique per address and network among open trades, and the database enforces it", async () => {
  await sellDetails({ "USDT:TRC20": TRON });
  await sellDetails({ "USDT:TRC20": TRON2 }, "arttest-pool2");
  pools.set("arttest-pool2", rawPool());
  const amounts = new Set();
  for (let i = 0; i < 40; i++) {
    const id = `arttest-u${i}`;
    // different pay-amounts too: 0.533 + offset must not equal 0.53301 + another offset
    trades.set(id, rawTrade({ "pay-amount": i % 2 ? 0.533 : 0.53301 }));
    const r = await auto.ensureRow(toTrade(id, trades.get(id), "1"), toPool("arttest-pool", pools.get("arttest-pool"), "1"), { tRelease: 3600 });
    assert.ok(r.row, r.reason);
    amounts.add(r.row.expected_units);
  }
  assert.equal(amounts.size, 40, "every open trade on one address has its own amount");
  const offsets = (await pool.query("SELECT amount_offset FROM auto_release_watch WHERE trade_ref LIKE 'arttest-u%' AND open")).rows.map((x) => x.amount_offset);
  assert.equal(new Set(offsets).size, 40);
  const w = (await pool.query("SELECT * FROM auto_release_watch WHERE trade_ref = 'arttest-u0'")).rows[0];
  await pool.query("INSERT INTO auto_release (trade_ref, chain, pool_ref, agent, currency, pay_units, amount_offset, expected_units, funded_at, deadline) VALUES ('arttest-x', '1', 'arttest-pool', $1, 'USDT', '533000', 5, '533005', now(), now())", [AGENT]);
  await assert.rejects(pool.query("INSERT INTO auto_release_watch (trade_ref, network, address, address_key, amount_offset, expected_units) VALUES ('arttest-x', $1, $2, $2, $3, '1')", [w.network, w.address, w.amount_offset]), { code: "23505" }, "same offset");
  await assert.rejects(pool.query("INSERT INTO auto_release_watch (trade_ref, network, address, address_key, amount_offset, expected_units) VALUES ('arttest-x', $1, $2, $2, 1000, $3)", [w.network, w.address, w.expected_units]), { code: "23505" }, "same amount");
  // another address may use the same offset; a closed row frees it
  await pool.query("INSERT INTO auto_release_watch (trade_ref, network, address, address_key, amount_offset, expected_units) VALUES ('arttest-x', $1, $2, $2, $3, $4)", [w.network, TRON2, w.amount_offset, w.expected_units]);
  await pool.query("INSERT INTO auto_release (trade_ref, chain, pool_ref, agent, currency, pay_units, amount_offset, expected_units, funded_at, deadline) VALUES ('arttest-y', '1', 'arttest-pool', $1, 'USDT', '533000', 5, '533005', now(), now())", [AGENT]);
  await pool.query("UPDATE auto_release_watch SET open = false WHERE trade_ref = 'arttest-u0'");
  await pool.query("INSERT INTO auto_release_watch (trade_ref, network, address, address_key, amount_offset, expected_units) VALUES ('arttest-y', $1, $2, $2, $3, $4)", [w.network, w.address, w.amount_offset, w.expected_units]);
});

test("the exact payment on Tron releases once: signed by the agent, not resent while pending, done when it lands", async () => {
  await sellDetails();
  trades.set("arttest-t1", rawTrade());
  let r = await auto.tick();
  assert.equal(r.created, 1, "made by the watcher, nobody opened the page");
  await pin("arttest-t1");
  tron = [tronTx({ transaction_id: "tron-pay-1" })];
  r = await auto.tick();
  assert.deepEqual(r.matched, ["arttest-t1"]);
  assert.equal(sent.length, 1);
  const c = sent[0], cmd = JSON.parse(c.cmd);
  assert.equal(cmd.payload.exec.code, '(free.p2p-escrow-v11.release "arttest-t1")');
  assert.equal(cmd.meta.sender, AGENT);
  assert.equal(cmd.meta.chainId, "1");
  assert.deepEqual(cmd.signers, [{ pubKey: keys.publicKey, clist: [{ name: "coin.GAS", args: [] }, { name: "free.p2p-escrow-v11.ACCOUNT_AUTH", args: [AGENT] }] }]);
  assert.ok(verifySig(base64UrlDecodeArr(c.hash), hexToBin(c.sigs[0].sig), hexToBin(keys.publicKey)), "signed by the agent key");
  let x = await row("arttest-t1");
  assert.deepEqual([x.status, x.matched_tx, x.matched_network, x.release_request_key], ["releasing", "tron-pay-1", "USDT:TRC20", c.hash]);
  // pending: not sent again, round after round
  await auto.tick(); NOW += 60e3; await auto.tick();
  assert.equal(sent.length, 1, "no second send while the first may land");
  // lands
  polls[c.hash] = { status: "success" };
  r = await auto.tick();
  assert.deepEqual(r.released, ["arttest-t1"]);
  x = await row("arttest-t1");
  assert.equal(x.status, "released");
  assert.equal(sent.length, 1);
  const v = await getAuto("arttest-t1", SELLER);
  assert.deepEqual([v.body.status, v.body.matchedTx, v.body.releaseRequestKey], ["released", "tron-pay-1", c.hash]);
});

test("a release that never lands is sent again only after its TTL and only if the trade is still open", async () => {
  await sellDetails();
  trades.set("arttest-t1", rawTrade());
  await auto.tick(); await pin("arttest-t1");
  tron = [tronTx({ transaction_id: "tron-pay-ttl" })];
  await auto.tick();
  assert.equal(sent.length, 1);
  NOW += 9 * 60e3; await auto.tick();
  assert.equal(sent.length, 1, "inside the TTL");
  NOW += 3 * 60e3; await auto.tick();
  assert.equal(sent.length, 2, "TTL passed without landing: a new release");
  assert.notEqual(sent[1].hash, sent[0].hash);
  // a release that failed on chain while the trade got disputed: nothing more is sent
  polls[sent[1].hash] = { status: "failure", error: { message: "boom" } };
  trades.set("arttest-t1", rawTrade({ state: "DISPUTED" }));
  await auto.tick();
  assert.equal(sent.length, 2);
  assert.equal((await row("arttest-t1")).status, "manual");
});

test("wrong amount, fake token, wrong recipient, too early, too late: nothing is released", async () => {
  await sellDetails();
  trades.set("arttest-t1", rawTrade());
  await auto.tick(); await pin("arttest-t1");
  tron = [
    tronTx({ value: "533000" }), tronTx({ value: "533018" }),
    tronTx({ token_info: { symbol: "USDT", address: FAKE_TRON } }),
    tronTx({ to: TRON2 }),
    tronTx({ block_timestamp: T0 - 10 * 60e3 }),
    tronTx({ block_timestamp: T0 + 3600e3 + 20 * 60e3 }),
  ];
  NOW = T0 + 3600e3 + 10 * 60e3; // after the window and the contract's grace, inside our 15 minutes, so the row is still watched
  const r = await auto.tick();
  assert.deepEqual(r.matched, []);
  assert.equal(sent.length, 0);
  assert.equal((await row("arttest-t1")).status, "watching");
  NOW = T0 + 3600e3 + 16 * 60e3;
  await auto.tick();
  assert.equal((await row("arttest-t1")).status, "expired", "the window passed with no exact payment");
});

test("a transaction hash pays one trade only", async () => {
  await sellDetails({ "USDT:TRC20": TRON });
  await sellDetails({ "USDT:TRC20": TRON2 }, "arttest-pool2");
  pools.set("arttest-pool2", rawPool());
  trades.set("arttest-a", rawTrade());
  trades.set("arttest-b", rawTrade({ offer: "arttest-pool2" }));
  await auto.tick(); await pin("arttest-a"); await pin("arttest-b");
  tron = [tronTx({ transaction_id: "same-tx" }), tronTx({ transaction_id: "same-tx", to: TRON2 })]; // the same hash reported to both addresses
  const r = await auto.tick();
  assert.equal(r.matched.length, 1);
  assert.equal(sent.length, 1);
  const statuses = [(await row("arttest-a")).status, (await row("arttest-b")).status].sort();
  assert.deepEqual(statuses, ["releasing", "watching"]);
});

test("Ethereum: only with 12 confirmations", async () => {
  await sellDetails({ "USDT:ERC20": EVM });
  trades.set("arttest-e", rawTrade());
  await auto.tick(); await pin("arttest-e");
  eth = [ethTx({ hash: "0xpay", confirmations: "5" })];
  let r = await auto.tick();
  assert.deepEqual(r.matched, []);
  assert.equal(sent.length, 0);
  eth = [ethTx({ hash: "0xpay", confirmations: "12", to: EVM })]; // checksummed address: still the same
  r = await auto.tick();
  assert.deepEqual(r.matched, ["arttest-e"]);
  assert.equal(sent.length, 1);
  assert.ok(calls.some((c) => c === "eth.test/v2/api"));
});

test("Ethereum is not watched without an Etherscan key, and the endpoint says so", async () => {
  const noEth = make({ ...ENV, ETHERSCAN_API_KEY: "" });
  await sellDetails({ "USDT:ERC20": EVM });
  trades.set("arttest-e", rawTrade());
  const r = await noEth.ensureRow(toTrade("arttest-e", trades.get("arttest-e"), "1"), toPool("arttest-pool", pools.get("arttest-pool"), "1"), { tRelease: 3600 });
  assert.equal(r.row, undefined);
  assert.match(r.reason, /No receiving address on a network auto-release watches/);
  await noEth.tick();
  assert.equal(calls.filter((c) => c.startsWith("eth.test")).length, 0);
});

test("a disputed or closed trade is never released, even with a matching payment", async () => {
  await sellDetails({ "USDT:TRC20": TRON });
  trades.set("arttest-d", rawTrade());
  trades.set("arttest-c", rawTrade());
  await auto.tick(); await pin("arttest-d"); await pin("arttest-c", "533018");
  // the trade is disputed after the payment was matched but before the release went out
  tron = [tronTx({ transaction_id: "pay-d" })];
  const realTick = auto.tick;
  trades.set("arttest-d", rawTrade({ state: "DISPUTED" })); // the fresh read before sending sees it
  const snap = await snapshot();
  snap.trades = snap.trades.map((t) => (t.tradeId === "arttest-d" ? { ...t, state: "FUNDED" } : t)); // the cached read is a little behind
  const a2 = createAutoRelease({ getPool: () => pool, config: autoReleaseConfig(ENV), fetchFn: fetchMock, now: () => NOW, chain: async () => snap, apis: ["http://chain.test"], contract: "free.p2p-escrow-v11", log: quiet });
  await a2.tick();
  assert.equal(sent.length, 0, "re-read on chain before sending: disputed");
  assert.equal((await row("arttest-d")).status, "manual");
  // a refunded trade stops being watched, a payment arriving later changes nothing
  trades.set("arttest-c", rawTrade({ state: "REFUNDED" }));
  tron = [tronTx({ transaction_id: "pay-c", value: "533018" })];
  await realTick();
  assert.equal(sent.length, 0);
  assert.equal((await row("arttest-c")).status, "expired");
});

test("a row whose trade's agent is not ours is never released", async () => {
  await sellDetails({ "USDT:TRC20": TRON });
  trades.set("arttest-g", rawTrade());
  await auto.tick(); await pin("arttest-g");
  await pool.query("UPDATE auto_release SET status = 'matched', matched_tx = 'pay-g' WHERE trade_ref = 'arttest-g'");
  trades.set("arttest-g", rawTrade({ agent: OTHER }));
  await auto.releaseStep("arttest-g");
  assert.equal(sent.length, 0);
  assert.equal((await row("arttest-g")).status, "manual");
});

test("a BUY pool: the agent watches the address the taker (KDA holder) set for the trade", async () => {
  pools.set("arttest-buy", rawPool({ creator: BUYER, side: "BUY" }));
  trades.set("arttest-bt", rawTrade({ offer: "arttest-buy" }));
  let r = await getAuto("arttest-bt", BUYER);
  assert.deepEqual([r.body.enabled, r.body.reason], [false, "The seller has not said where to be paid yet"]);
  await pool.query("INSERT INTO trade_payouts (offer_id, wallet, details) VALUES ('arttest-bt', $1, $2)", [SELLER, JSON.stringify([{ method: "USDT", value: TRON2, network: "TRC20" }])]);
  r = await getAuto("arttest-bt", BUYER);
  assert.equal(r.body.enabled, true);
  assert.deepEqual(r.body.networks, [{ id: "USDT:TRC20", address: TRON2 }]);
  // details saved by someone else (not the trade's seller) are ignored
  await pool.query("DELETE FROM auto_release WHERE trade_ref = 'arttest-bt'");
  await pool.query("UPDATE trade_payouts SET wallet = $1 WHERE offer_id = 'arttest-bt'", [OTHER]);
  r = await getAuto("arttest-bt", BUYER);
  assert.equal(r.body.enabled, false);
});

test("a send every node rejects is tried again next round, at most a few times", async () => {
  await sellDetails({ "USDT:TRC20": TRON });
  trades.set("arttest-r", rawTrade());
  await auto.tick(); await pin("arttest-r");
  tron = [tronTx({ transaction_id: "pay-r" })];
  sendStatus = 400;
  for (let i = 0; i < 7; i++) await auto.tick();
  assert.equal(sent.length, 5);
  const x = await row("arttest-r");
  assert.equal(x.status, "manual");
  assert.match(x.last_error, /Gave up/);
});

test("a closed trade's offset is not drawn again on that address for 48 hours; with none free the trade is manual", async () => {
  await sellDetails({ "USDT:TRC20": TRON });
  // trade A: funded at T0, no payment, the window and the grace pass: expired, its watch closed
  trades.set("arttest-a", rawTrade());
  NOW = T0 + 60e3; await auto.tick();
  NOW = T0 + 3600e3 + 16 * 60e3; await auto.tick();
  const a = await row("arttest-a");
  assert.equal(a.status, "expired");
  assert.equal((await pool.query("SELECT open FROM auto_release_watch WHERE trade_ref = 'arttest-a'")).rows[0].open, false);
  // every other offset was used by a closed trade on this address in the last two days: only A's would be free, and it is not drawn
  await pool.query(`INSERT INTO auto_release (trade_ref, chain, pool_ref, agent, currency, pay_units, amount_offset, expected_units, funded_at, deadline, status)
    SELECT 'arttest-old-' || o, '1', 'arttest-pool', $1, 'USDT', '533000', o, (533000 + o)::text, $2, $3, 'expired' FROM generate_series(1, 999) AS o WHERE o <> $4`,
    [AGENT, new Date(T0 - 20 * 3600e3), new Date(T0 - 19 * 3600e3), a.amount_offset]);
  await pool.query(`INSERT INTO auto_release_watch (trade_ref, network, address, address_key, amount_offset, expected_units, open)
    SELECT 'arttest-old-' || o, 'USDT:TRC20', $1, $1, o, (533000 + o)::text, false FROM generate_series(1, 999) AS o WHERE o <> $2`, [TRON, a.amount_offset]);
  trades.set("arttest-b", rawTrade({ buyer: OTHER, "funded-at": { timep: iso(NOW) } }));
  let r = await auto.ensureRow(toTrade("arttest-b", trades.get("arttest-b"), "1"), toPool("arttest-pool", pools.get("arttest-pool"), "1"), { tRelease: 3600 });
  assert.equal(r.row.status, "manual", "no offset is free: the seller releases by hand");
  assert.match(r.row.last_error, /release by hand/);
  assert.equal((await getAuto("arttest-b", OTHER)).body.status, "manual");
  // two days later A's old neighbours no longer count (A's own deadline is still recent): B2 gets any offset but A's
  NOW = T0 + 45 * 3600e3;
  await pool.query("UPDATE auto_release SET deadline = $1 WHERE trade_ref LIKE 'arttest-old-%'", [new Date(NOW - 49 * 3600e3)]);
  trades.set("arttest-b2", rawTrade({ buyer: OTHER, "funded-at": { timep: iso(NOW) } }));
  r = await auto.ensureRow(toTrade("arttest-b2", trades.get("arttest-b2"), "1"), toPool("arttest-pool", pools.get("arttest-pool"), "1"), { tRelease: 3600 });
  assert.equal(r.row.status, "watching");
  assert.notEqual(r.row.amount_offset, a.amount_offset, "A's offset is still out of use");
  // and once A's deadline is more than 48 hours old its offset may come back (999 draws cannot all miss the one free offset)
  await pool.query("DELETE FROM auto_release WHERE trade_ref LIKE 'arttest-old-%'");
  await pool.query(`INSERT INTO auto_release (trade_ref, chain, pool_ref, agent, currency, pay_units, amount_offset, expected_units, funded_at, deadline, status)
    SELECT 'arttest-old-' || o, '1', 'arttest-pool', $1, 'USDT', '533000', o, (533000 + o)::text, $2, $2, 'expired' FROM generate_series(1, 999) AS o WHERE o <> $3`, [AGENT, new Date(NOW), a.amount_offset]);
  await pool.query(`INSERT INTO auto_release_watch (trade_ref, network, address, address_key, amount_offset, expected_units, open)
    SELECT 'arttest-old-' || o, 'USDT:TRC20', $1, $1, o, (533000 + o)::text, false FROM generate_series(1, 999) AS o WHERE o <> $2`, [TRON, a.amount_offset]);
  await pool.query("DELETE FROM auto_release WHERE trade_ref = 'arttest-b2'");
  NOW = T0 + 1800e3 + 49 * 3600e3;
  trades.set("arttest-b3", rawTrade({ buyer: OTHER, "funded-at": { timep: iso(NOW) } }));
  r = await auto.ensureRow(toTrade("arttest-b3", trades.get("arttest-b3"), "1"), toPool("arttest-pool", pools.get("arttest-pool"), "1"), { tRelease: 3600 });
  assert.deepEqual([r.row.status, r.row.amount_offset], ["watching", a.amount_offset]);
});

test("a payment that also fits a closed trade's window on the same address is ambiguous: nothing is released, the trade goes manual", async () => {
  await sellDetails({ "USDT:TRC20": TRON });
  // trade A expires without a payment (the seller has not refunded; the trade is still FUNDED on the chain)
  trades.set("arttest-a", rawTrade());
  NOW = T0 + 60e3; await auto.tick();
  NOW = T0 + 76 * 60e3; await auto.tick();
  const a = await row("arttest-a");
  assert.equal(a.status, "expired");
  // trade B on the same address, funded now, somehow holding A's amount (a row made before offsets were kept apart)
  trades.set("arttest-b", rawTrade({ buyer: OTHER, "funded-at": { timep: iso(NOW) } }));
  await auto.tick();
  await pin("arttest-b", a.expected_units);
  assert.equal(inWindow(a, T0 + 75 * 60e3), true, "A's grace still holds that minute");
  // buyer A pays A's exact amount, late, at a time inside both windows
  tron = [tronTx({ transaction_id: "tx-late-a", value: a.expected_units, block_timestamp: T0 + 75 * 60e3 })];
  NOW = T0 + 77 * 60e3;
  const r = await auto.tick();
  assert.deepEqual(r.matched, [], "A's payment is not taken as B's");
  assert.equal(sent.length, 0, "no release was signed");
  const b = await row("arttest-b");
  assert.deepEqual([b.status, b.matched_tx], ["manual", null]);
  assert.match(b.last_error, /^Ambiguous payment: tx-late-a on USDT:TRC20 also fits arttest-a/);
  assert.equal((await row("arttest-a")).status, "expired", "A stays as it was");
  const v = await getAuto("arttest-b", OTHER);
  assert.deepEqual([v.body.status, v.body.reason?.startsWith("Ambiguous payment")], ["manual", true]);
  // the same amount on another address is not ambiguous
  await sellDetails({ "USDT:TRC20": TRON2 }, "arttest-pool2");
  pools.set("arttest-pool2", rawPool());
  trades.set("arttest-c", rawTrade({ offer: "arttest-pool2", buyer: OTHER, "funded-at": { timep: iso(NOW) } }));
  await auto.tick();
  await pin("arttest-c", a.expected_units);
  tron = [tronTx({ transaction_id: "tx-c", value: a.expected_units, to: TRON2, block_timestamp: NOW })];
  assert.deepEqual((await auto.tick()).matched, ["arttest-c"]);
});

test("the payment window's grace period: a payment made after the window but inside the contract's 30 minutes still releases", async () => {
  assert.equal(tradeDeadline(toTrade("x", rawTrade(), "1")), T0 + (1800 + CONTRACT_GRACE_S) * 1000);
  await sellDetails();
  trades.set("arttest-g", rawTrade());
  await auto.tick(); await pin("arttest-g");
  tron = [tronTx({ transaction_id: "tx-grace", block_timestamp: T0 + 1800e3 + 20 * 60e3 })];
  NOW = T0 + 1800e3 + 21 * 60e3;
  assert.deepEqual((await auto.tick()).matched, ["arttest-g"]);
});

const getIncoming = (ref, wallet) => fetch(`${base}/api/v11/trades/${encodeURIComponent(ref)}/incoming?wallet=${wallet}&publicKey=x&signedCmd=x`).then(async (r) => ({ status: r.status, body: await r.json() }));
test("before taking the KDA back: payments that reached the seller's address during the trade, for the seller and the arbiter only", async () => {
  await sellDetails();
  trades.set("arttest-i", rawTrade({ agent: "" })); // no auto-release on this trade: the check still looks
  NOW = T0 + 3600e3 + 60e3;
  tron = [
    tronTx({ transaction_id: "tx-before", block_timestamp: T0 - 10 * 60e3 }),          // before the take: not shown
    tronTx({ transaction_id: "tx-small", value: "100000", block_timestamp: T0 + 5 * 60e3 }), // 0.1 USDT: shown, does not cover 0.533
    tronTx({ transaction_id: "tx-fake", token_info: { symbol: "USDT", address: FAKE_TRON } }), // not the official token
  ];
  eth = [ethTx({ hash: "0xcovers", value: "533000", timeStamp: String((T0 + 50 * 60e3) / 1000) })];
  let r = await getIncoming("arttest-i", SELLER);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.payments.map((x) => [x.txid, x.amount, x.covers]), [["tx-small", "0.1", false], ["0xcovers", "0.533", true]]);
  assert.equal(r.body.hold, true);
  assert.equal(r.body.checked, true);
  assert.equal((await getIncoming("arttest-i", ARB)).status, 200);
  assert.equal((await getIncoming("arttest-i", BUYER)).status, 403, "the buyer does not see the seller's incoming payments");
  // a transfer another trade already matched is that trade's
  await pool.query(`INSERT INTO auto_release (trade_ref, chain, pool_ref, agent, currency, pay_units, amount_offset, expected_units, funded_at, deadline, status, matched_tx)
    VALUES ('arttest-other', '1', 'arttest-pool', $1, 'USDT', '533000', 7, '533007', $2, $2, 'released', '0xcovers')`, [AGENT, new Date(T0)]);
  r = await getIncoming("arttest-i", SELLER);
  assert.deepEqual([r.body.payments.map((x) => x.txid), r.body.hold], [["tx-small"], false]);
  // a paid trade is not checked
  trades.set("arttest-i", rawTrade({ agent: "", state: "PAID", "paid-at": { timep: iso(T0 + 600e3) } }));
  r = await getIncoming("arttest-i", SELLER);
  assert.deepEqual([r.body.checked, r.body.payments], [false, []]);
});

/* ---------------- paid from an exchange: the transaction ID ---------------- */
const claim = (ref, wallet, txid, network = "USDT:TRC20") => fetch(`${base}/api/v11/trades/${encodeURIComponent(ref)}/claim-payment`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet, publicKey: "x", signedCmd: "x", network, txid }),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
const hex = (c) => c.repeat(64);

test("paid from an exchange: a transaction ID that brought at least the amount, to the address, in the window, releases", async () => {
  await sellDetails();
  trades.set("arttest-x1", rawTrade());
  await auto.tick(); await pin("arttest-x1");
  // the exchange took its fee and rounded: 0.54 arrived (the trade is 0.533, the identifying amount 0.533017)
  tron = [tronTx({ transaction_id: hex("e"), value: "540000" })];
  assert.deepEqual((await auto.tick()).matched, [], "the watcher alone does not take it: not the exact amount");
  let r = await claim("arttest-x1", OTHER, hex("e"));
  assert.equal(r.status, 403, "only the buyer");
  r = await claim("arttest-x1", BUYER, hex("E"));
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.status, r.body.matchedTx], ["releasing", hex("e")]);
  assert.equal(sent.length, 1, "released at once");
  assert.equal(JSON.parse(sent[0].cmd).payload.exec.code, '(free.p2p-escrow-v11.release "arttest-x1")');
  // the same transaction cannot pay a second trade
  trades.set("arttest-x2", rawTrade({ buyer: OTHER, "funded-at": { timep: iso(T0 + 30e3) } }));
  await auto.tick();
  NOW += 20e3;
  r = await claim("arttest-x2", OTHER, hex("e"));
  assert.deepEqual([r.status, r.body.error], [409, "That transaction was already used for a trade"]);
});

test("paid from an exchange: refusals", async () => {
  await sellDetails();
  trades.set("arttest-x3", rawTrade());
  await auto.tick();
  tron = [
    tronTx({ transaction_id: hex("1"), value: "500000" }),                                  // less than 0.533
    tronTx({ transaction_id: hex("2"), token_info: { symbol: "USDT", address: FAKE_TRON } }),  // not official USDT
    tronTx({ transaction_id: hex("3"), block_timestamp: T0 - 10 * 60e3 }),                  // before the take
  ];
  const step = async (txid, network) => { NOW += 11e3; return claim("arttest-x3", BUYER, txid, network); };
  let r = await step("not-a-txid");
  assert.equal(r.status, 400);
  assert.match((await step(hex("1"))).body.error, /brought 0\.500000 USDT; this trade needs at least 0\.533000/);
  assert.equal((await step(hex("2"))).status, 422);
  assert.equal((await step(hex("3"))).status, 404, "before the take: not even listed (the lookup starts at the take)");
  r = await step(hex("9"));
  assert.equal(r.status, 404);
  assert.match(r.body.error, /No USDT transfer with this ID/);
  r = await claim("arttest-x3", BUYER, hex("9"));
  assert.equal(r.status, 429, "one check every few seconds per trade");
  r = await step(hex("1"), "USDC:ERC20");
  assert.equal(r.status, 400, "not a network of this trade");
  eth = [ethTx({ hash: "0x" + hex("a"), value: "600000", confirmations: "3" })];
  r = await step("0x" + hex("A"), "USDT:ERC20");
  assert.deepEqual([r.status, r.body.error], [409, "Waiting for confirmations (3 of 12). Try again in a few minutes."]);
  assert.equal(sent.length, 0);
  assert.equal((await row("arttest-x3")).status, "watching");
});

test("paid from an exchange: a payment that could belong to another trade with this seller is not released", async () => {
  await sellDetails();
  // another open trade on the same address, by another buyer, also covered by 0.54
  trades.set("arttest-x4", rawTrade());
  trades.set("arttest-x5", rawTrade({ buyer: OTHER, "funded-at": { timep: iso(T0 + 60e3) } }));
  await auto.tick();
  tron = [tronTx({ transaction_id: hex("4"), value: "540000", block_timestamp: T0 + 2 * 60e3 })];
  NOW += 20e3;
  let r = await claim("arttest-x5", OTHER, hex("4"));
  assert.equal(r.status, 409);
  assert.match(r.body.error, /could also belong to another trade/);
  assert.equal(sent.length, 0);
  assert.equal((await row("arttest-x5")).status, "watching", "nothing changed: the seller decides");
  // a trade of the same seller on a pool without auto-release (no row) counts too
  await clean(); trades.clear(); pools.clear(); pools.set("arttest-pool", rawPool());
  await sellDetails();
  await sellDetails({ "USDT:TRC20": TRON }, "arttest-poolm");
  pools.set("arttest-poolm", rawPool({ agent: "" }));
  trades.set("arttest-x6", rawTrade());
  trades.set("arttest-m1", rawTrade({ offer: "arttest-poolm", agent: "", buyer: OTHER }));
  await auto.tick();
  NOW += 20e3;
  r = await claim("arttest-x6", BUYER, hex("4"));
  assert.equal(r.status, 409, "the manual trade's buyer may have sent it");
  // on another address it is not ambiguous
  await sellDetails({ "USDT:TRC20": TRON2 }, "arttest-poolm");
  NOW += 20e3;
  r = await claim("arttest-x6", BUYER, hex("4"));
  assert.deepEqual([r.status, r.body.status], [200, "releasing"]);
});

test("paid from an exchange: after the window passed unmatched, a payment made inside it still releases", async () => {
  await sellDetails();
  trades.set("arttest-x7", rawTrade());
  await auto.tick();
  tron = [tronTx({ transaction_id: hex("7"), value: "600000", block_timestamp: T0 + 25 * 60e3 })];
  NOW = tradeDeadline(toTrade("arttest-x7", trades.get("arttest-x7"), "1")) + 16 * 60e3; // the window, its grace and our 15 minutes passed
  await auto.tick();
  assert.equal((await row("arttest-x7")).status, "expired");
  const v = await getAuto("arttest-x7", BUYER);
  assert.deepEqual(v.body.byTxid.map((x) => x.id).sort(), ["USDT:ERC20", "USDT:TRC20"], "still offered after the window passed");
  const r = await claim("arttest-x7", BUYER, hex("7"));
  assert.deepEqual([r.status, r.body.status], [200, "releasing"]);
});
