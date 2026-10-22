// Creates the release agent's key ON THE SERVER and appends AUTO_RELEASE_SECRET to the given .env file.
// Prints only the public account (k:…), which is what governance names with set-agent and what you fund with gas.
// The secret never leaves this machine: don't paste it anywhere.
//   node server/scripts/new-agent-key.mjs /path/to/.env
import fs from "node:fs";
import { genKeyPair } from "@kadena/cryptography-utils";
const envPath = process.argv[2];
if (!envPath) { console.error("Usage: node server/scripts/new-agent-key.mjs /path/to/.env"); process.exit(1); }
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
if (/^AUTO_RELEASE_SECRET=/m.test(existing)) { console.error(`${envPath} already has AUTO_RELEASE_SECRET; not replacing it.`); process.exit(1); }
const { publicKey, secretKey } = genKeyPair();
fs.appendFileSync(envPath, `${existing && !existing.endsWith("\n") ? "\n" : ""}AUTO_RELEASE_SECRET=${secretKey}\n`, { mode: 0o600 });
console.log(`Release agent account: k:${publicKey}`);
console.log("Next: send it about 1 KDA on chain 1 for gas, and ask the governance wallets to run set-agent with this account.");
