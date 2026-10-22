// LOCAL TESTING ONLY: a tiny stand-in for TronGrid, so the server's auto-release (server/autoRelease.js) can be tried
// against the local chain without real USDT. Run the API server with TRONGRID_API=http://127.0.0.1:<port>.
//
//   node demo/local-chain/mock-tron.mjs [port=4700] [file]
//
//   GET    /v1/accounts/<address>/transactions/trc20?only_to=true&contract_address=…&min_timestamp=…   (what the server asks)
//   POST   /transfers  { "to": "T…", "amount": "0.533017" }   a fake confirmed USDT transfer, stamped now
//                      optional: "value" (base units instead of amount), "contract", "txid", "from", "timestamp" (ms)
//   GET    /transfers  every fake transfer
//   DELETE /transfers  forget them
//
// Transfers are kept in memory, and in `file` (JSON) when one is given, so a restart keeps them.
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.argv[2] || 4700);
const FILE = process.argv[3] || "";
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
let transfers = FILE && fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : [];
const save = () => { if (FILE) fs.writeFileSync(FILE, JSON.stringify(transfers, null, 1)); };
const units = (amount) => { const [w, f = ""] = String(amount).split("."); return (BigInt(w || "0") * 1000000n + BigInt((f + "000000").slice(0, 6))).toString(); };

const send = (res, status, body) => { res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(body)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  let body = ""; for await (const c of req) body += c;
  const m = u.pathname.match(/^\/v1\/accounts\/([^/]+)\/transactions\/trc20$/);
  if (req.method === "GET" && m) {
    const addr = decodeURIComponent(m[1]);
    const onlyTo = u.searchParams.get("only_to") === "true";
    const contract = u.searchParams.get("contract_address");
    const min = Number(u.searchParams.get("min_timestamp") || 0);
    const limit = Number(u.searchParams.get("limit") || 20);
    const data = transfers
      .filter((t) => (onlyTo ? t.to === addr : t.to === addr || t.from === addr))
      .filter((t) => !contract || t.token_info.address === contract)
      .filter((t) => t.block_timestamp >= min)
      .sort((a, b) => b.block_timestamp - a.block_timestamp)
      .slice(0, limit);
    return send(res, 200, { data, success: true, meta: { at: Date.now(), page_size: data.length } });
  }
  if (u.pathname === "/transfers") {
    if (req.method === "GET") return send(res, 200, transfers);
    if (req.method === "DELETE") { transfers = []; save(); return send(res, 200, { ok: true }); }
    if (req.method === "POST") {
      let b;
      try { b = JSON.parse(body || "{}"); } catch { return send(res, 400, { error: "JSON body" }); }
      if (!b.to || (b.amount == null && b.value == null)) return send(res, 400, { error: "to and amount (or value) are required" });
      const t = {
        transaction_id: b.txid || crypto.randomBytes(32).toString("hex"),
        token_info: { symbol: "USDT", address: b.contract || USDT, decimals: 6, name: "Tether USD" },
        block_timestamp: Number(b.timestamp || Date.now()),
        from: b.from || "TMockSenderXXXXXXXXXXXXXXXXXXXXXXX",
        to: b.to, type: "Transfer",
        value: b.value != null ? String(b.value) : units(b.amount),
      };
      transfers.push(t); save();
      console.log("fake transfer", t.value, "to", t.to, t.transaction_id);
      return send(res, 200, t);
    }
  }
  return send(res, 404, { error: "not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`mock TronGrid on ${PORT}${FILE ? `, transfers in ${FILE}` : ""}`));
