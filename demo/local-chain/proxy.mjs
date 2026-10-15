// Makes the local Pact server look like a Chainweb node: /chainweb/0.0/<net>/chain/<n>/pact/api/v1/* -> /api/v1/*
import http from "node:http";
const PORT = Number(process.argv[2] || 4500), TARGET = `http://127.0.0.1:${process.argv[3] || 4600}`;
http.createServer(async (req, res) => {
  const path = req.url.replace(/^\/chainweb\/0\.0\/[^/]+\/chain\/[^/]+\/pact/, "").replace(/\?.*$/, "");
  if (req.url.endsWith("/cut") || req.url.includes("/cut?")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ hashes: { "1": { height: 7400000 } } })); }
  let body = ""; for await (const c of req) body += c;
  try {
    const r = await fetch(TARGET + path, { method: req.method, headers: { "content-type": "application/json" }, body: req.method === "POST" ? body : undefined });
    const t = await r.text();
    res.writeHead(r.status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*" }); res.end(t);
  } catch (e) { res.writeHead(502); res.end(String(e)); }
}).listen(PORT, "127.0.0.1", () => console.log("pact proxy on", PORT, "->", TARGET));
