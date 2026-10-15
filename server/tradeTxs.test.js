/**
 * Trade transaction history tests. Needs a Postgres with server/schema.sql applied (CI does this).
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kadena_nexus node --test server/tradeTxs.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { hash } from "@kadena/cryptography-utils";
import { parseEscrowCall, recordTradeTx, settlePending, listTradeTxs, followTx } from "./tradeTxs.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/kadena_nexus" });
const OFFER = "offer-test-tradetxs";
const SELLER = "k:" + "a".repeat(64);
const BUYER = "k:" + "b".repeat(64);
const clean = () => pool.query("DELETE FROM trade_txs WHERE offer_id LIKE 'offer-test-%'");

let n = 0;
const cmdFor = (code, sender, extra = {}) => JSON.stringify({
  networkId: "mainnet01",
  payload: { exec: { code, data: {} } },
  signers: [],
  meta: { chainId: "1", sender, gasLimit: 3000, gasPrice: 1e-8, ttl: 600, creationTime: 1760000000 + n },
  nonce: `t${n++}`,
  ...extra,
});
const send = async (code, sender, extra) => { const cmd = cmdFor(code, sender, extra); const requestKey = hash(cmd); return { cmd, requestKey, r: await recordTradeTx(pool, { cmd, requestKey }) }; };

before(clean);
after(async () => { await clean(); await pool.end(); });

test("reads the escrow call from a signed command", () => {
  assert.deepEqual(parseEscrowCall(cmdFor(`(free.p2p-escrow-v10.accept-offer "${OFFER}" "${BUYER}")`, BUYER)), { fn: "accept-offer", offerId: OFFER, sender: BUYER });
  assert.equal(parseEscrowCall(cmdFor(`(coin.transfer "${BUYER}" "${SELLER}" 1.0)`, BUYER)), null, "not the escrow");
  assert.equal(parseEscrowCall(cmdFor(`(free.p2p-escrow-v10.get-escrow "${OFFER}")`, BUYER)), null, "a read is not a step");
  assert.equal(parseEscrowCall(cmdFor(`(free.p2p-escrow-v10.deposit "${OFFER}")`, SELLER, { networkId: "testnet04" })), null, "other network");
  assert.equal(parseEscrowCall("not json"), null);
  // escrow v11: pools and trades, the first string is the pool or trade id
  assert.deepEqual(parseEscrowCall(cmdFor(`(free.p2p-escrow-v11.take-offer "trade-1-abc" "pool-1-xyz" "${BUYER}" 100.0)`, BUYER)), { fn: "take-offer", offerId: "trade-1-abc", sender: BUYER });
  assert.deepEqual(parseEscrowCall(cmdFor(`(free.p2p-escrow-v11.create-offer "pool-1-xyz" "${SELLER}" "SELL" 1000.0 50.0 500.0 0.01 "USDT" "" 1800 free.p2p-escrow-v11.EPOCH "")`, SELLER)).offerId, "pool-1-xyz");
  for (const fn of ["top-up", "withdraw", "update-offer", "close-offer", "take-and-settle", "mark-paid", "release", "cancel", "timeout-refund", "open-dispute", "resolve"]) {
    assert.equal(parseEscrowCall(cmdFor(`(free.p2p-escrow-v11.${fn} "x-1" 1.0)`, SELLER))?.fn, fn, fn);
  }
  assert.equal(parseEscrowCall(cmdFor(`(free.p2p-escrow-v11.get-offer "pool-1")`, SELLER)), null, "a read is not a step");
  assert.equal(parseEscrowCall(cmdFor(`(free.p2p-escrow-v11.release "x-1")`, SELLER), "free.p2p-escrow-v10"), null, "only the modules asked for");
});

test("records steps, refuses a command that does not match its key, settles with the chain result", async () => {
  const a = await send(`(free.p2p-escrow-v10.create-offer "${OFFER}" "${SELLER}" 25.00000000 "SELL")`, SELLER);
  const b = await send(`(free.p2p-escrow-v10.accept-offer "${OFFER}" "${BUYER}")`, BUYER);
  const c = await send(`(free.p2p-escrow-v10.deposit "${OFFER}")`, SELLER);
  assert.ok(a.r.ok && b.r.ok && c.r.ok);
  assert.equal((await recordTradeTx(pool, { cmd: a.cmd, requestKey: b.requestKey })).error, "The command does not match the request key");
  assert.ok((await recordTradeTx(pool, { cmd: cmdFor(`(coin.transfer "a" "b" 1.0)`, SELLER), requestKey: "x".repeat(43) })).error);
  // the same step posted twice is kept once
  assert.ok((await recordTradeTx(pool, { cmd: a.cmd, requestKey: a.requestKey })).ok);

  let list = await listTradeTxs(pool, OFFER);
  assert.deepEqual(list.map((t) => [t.action, t.status]), [["Create offer", "pending"], ["Accept", "pending"], ["Deposit", "pending"]]);

  const t0 = Date.parse("2026-10-13T10:00:00Z") * 1000; // chain block time is in microseconds
  const poll = async (keys) => ({
    [a.requestKey]: { status: "success", blockTime: new Date(t0 / 1000) },
    [b.requestKey]: { status: "success", blockTime: new Date(t0 / 1000 + 60000) },
    [c.requestKey]: { status: "failure", blockTime: new Date(t0 / 1000 + 120000) },
    ...Object.fromEntries(keys.filter((k) => ![a, b, c].some((x) => x.requestKey === k)).map((k) => [k, { status: "success", blockTime: null }])),
  });
  await settlePending(pool, poll);
  list = await listTradeTxs(pool, OFFER);
  assert.deepEqual(list.map((t) => [t.action, t.status, t.sender]), [["Create offer", "confirmed", SELLER], ["Accept", "confirmed", BUYER]], "a failed step is not listed");
  assert.equal(new Date(list[1].at).toISOString(), "2026-10-13T10:01:00.000Z");
});

test("a step the chain never confirms stops being checked after 30 minutes", async () => {
  const d = await send(`(free.p2p-escrow-v10.mark-paid "offer-test-old")`, BUYER);
  await pool.query("UPDATE trade_txs SET created_at = NOW() - INTERVAL '31 minutes' WHERE request_key = $1", [d.requestKey]);
  let asked = [];
  await settlePending(pool, async (keys) => { asked = keys; return {}; });
  assert.ok(!asked.includes(d.requestKey));
  assert.deepEqual(await listTradeTxs(pool, "offer-test-old"), []);
});

test("a just-sent step is followed closely and announced once it is confirmed", async () => {
  const e = await send(`(free.p2p-escrow-v10.release "offer-test-follow")`, SELLER);
  let polls = 0;
  const poll = async (keys) => (++polls < 3 ? {} : Object.fromEntries(keys.map((k) => [k, { status: "success", blockTime: new Date() }])));
  const seen = [];
  await new Promise((resolve) => {
    followTx(() => pool, e.requestKey, (x) => { seen.push(x); resolve(); }, { everyMs: 30, poll });
    setTimeout(resolve, 3000);
  });
  assert.deepEqual(seen.map((x) => [x.offerId, x.fn, x.ok]), [["offer-test-follow", "release", true]]);
  assert.ok(polls >= 3);
  assert.deepEqual((await listTradeTxs(pool, "offer-test-follow")).map((t) => t.status), ["confirmed"]);
});
