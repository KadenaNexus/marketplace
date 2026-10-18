// Makes the local Pact servers look like Chainweb: /chainweb/0.0/<net>/chain/<n>/pact/api/v1/* -> chain n's /api/v1/*.
// Usage: proxy.mjs <port> <routes>, routes = "1=4600,2=4601" (one Pact server per chain) or one port for every chain.
// A path without a chain (a bare VITE_CHAINWEB_API base) goes to the first route.
import http from "node:http";
const PORT = Number(process.argv[2] || 4500), SPEC = String(process.argv[3] || "4600");
const routes = /^\d+$/.test(SPEC) ? null : Object.fromEntries(SPEC.split(",").map((r) => r.split("=")));
const first = routes ? Object.values(routes)[0] : SPEC;
const target = (chain) => (routes ? routes[chain] : SPEC);
http.createServer(async (req, res) => {
  const m = req.url.match(/^\/chainweb\/0\.0\/[^/]+\/chain\/([^/]+)\/pact/);
  const port = m ? target(m[1]) : first;
  const path = req.url.replace(/^\/chainweb\/0\.0\/[^/]+\/chain\/[^/]+\/pact/, "").replace(/\?.*$/, "");
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (req.url.endsWith("/cut") || req.url.includes("/cut?")) { res.writeHead(200, { "content-type": "application/json", ...cors }); return res.end(JSON.stringify({ hashes: Object.fromEntries((routes ? Object.keys(routes) : ["1"]).map((c) => [c, { height: 7400000 }])) })); }
  if (!port) { res.writeHead(404, { "content-type": "text/plain", ...cors }); return res.end(`chain ${m?.[1]} is not run locally`); }
  let body = ""; for await (const c of req) body += c;
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: req.method, headers: { "content-type": "application/json" }, body: req.method === "POST" ? body : undefined });
    const t = await r.text();
    res.writeHead(r.status, { "content-type": "application/json", ...cors }); res.end(t);
  } catch (e) { res.writeHead(502, cors); res.end(String(e)); }
}).listen(PORT, "127.0.0.1", () => console.log("pact proxy on", PORT, "->", routes ? JSON.stringify(routes) : first));
