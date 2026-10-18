// Local chain for development: loads coin (demo build where anyone can mint), namespace free and
// p2p-escrow-v11 into a Pact 5 server, then funds the demo accounts in keys.json (created if missing).
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, "../../package.json"));
const { hash, signHash, genKeyPair } = require("@kadena/cryptography-utils");
const SRV = process.env.PACT_SERVER || "http://127.0.0.1:4600";
const CHAIN = process.env.CHAIN_ID || "1"; // reset.sh runs one Pact server per chain and bootstraps each
const V = path.join(HERE, "../../contracts");
const keysPath = process.env.DEMO_KEYS || path.join(HERE, "keys.json");
const keys = fs.existsSync(keysPath) ? JSON.parse(fs.readFileSync(keysPath, "utf8")) : {};
for (const who of ["seller", "buyer", "arbiter"]) if (!keys[who]) { keys[who] = genKeyPair(); keys[who].account = "k:" + keys[who].publicKey; }
if (!keys.gov) { keys.gov = genKeyPair(); keys.gov.account = "k:" + keys.gov.publicKey; }
fs.writeFileSync(keysPath, JSON.stringify(keys, null, 1));
const ARBITER = process.env.DEMO_ARBITER || keys.arbiter?.account;
const FEE = keys.gov.account;

async function send(code, data = {}, signer = null, caps = []) {
  const cmd = JSON.stringify({ networkId: "development", payload: { exec: { code, data } },
    signers: signer ? [{ pubKey: signer.publicKey, clist: caps }] : [],
    meta: { chainId: CHAIN, sender: signer ? "k:" + signer.publicKey : "", gasLimit: 150000, gasPrice: 1e-8, ttl: 600, creationTime: Math.floor(Date.now() / 1000) - 5 }, nonce: String(Date.now()) + Math.random() });
  const h = hash(cmd);
  const sigs = signer ? [{ sig: signHash(h, signer).sig }] : [];
  const r = await fetch(SRV + "/api/v1/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmds: [{ hash: h, sigs, cmd }] }) });
  const t = await r.text(); if (!r.ok) throw new Error("send: " + t);
  const key = JSON.parse(t).requestKeys[0];
  const l = await fetch(SRV + "/api/v1/listen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listen: key }) });
  const res = await l.json();
  if (res.result?.status !== "success") throw new Error(code.slice(0, 80) + " -> " + JSON.stringify(res.result?.error?.message || res));
  return res.result.data;
}
const file = (p) => fs.readFileSync(p, "utf8");
const gov = keys.gov;
const ks = { keys: [gov.publicKey], pred: "keys-all" };
await send(file(V + "/test/vendor/fungible-v2.pact"));
await send(file(V + "/test/vendor/fungible-xchain-v1.pact"));
await send(file(V + "/test/vendor/coin.pact").replace("(require-capability (COINBASE))", "(with-capability (COINBASE) true) ; DEMO ONLY: anyone can mint") + "\n(create-table coin.coin-table)(create-table coin.allocation-table)");
await send('(define-namespace "free" (read-keyset "ns") (read-keyset "ns"))', { ns: ks }, gov);
// DEMO ONLY: the local Pact server has no blocks, so block-time is 1970. Transactions may carry "demo-now" in their data.
const contract = file(V + "/p2p-escrow-v11.pact").replace('(defun now:time () (at "block-time" (chain-data)))',
  '(defun now:time () (try (at "block-time" (chain-data)) (time (read-string "demo-now"))))');
if (!contract.includes("demo-now")) throw new Error("now() patch did not apply");
await send(contract + `\n(create-table free.p2p-escrow-v11.config)(create-table free.p2p-escrow-v11.offers)(create-table free.p2p-escrow-v11.trades)(create-table free.p2p-escrow-v11.reputation)(free.p2p-escrow-v11.init-config "${ARBITER}" "${FEE}")`, { "gov-keyset": ks }, gov);
const fund = async (k, amt) => send(`(coin.coinbase "${k.account}" (read-keyset "ks") ${amt})`, { ks: { keys: [k.publicKey], pred: "keys-all" } });
for (const [who, k] of Object.entries(keys)) if (k.account) await fund(k, who === "seller" ? "5000.5" : "50.0");
console.log(`bootstrapped v11 on chain ${CHAIN} at`, SRV, "arbiter", ARBITER, "gov", gov.account);
console.log(await send('(free.p2p-escrow-v11.get-config)'));
