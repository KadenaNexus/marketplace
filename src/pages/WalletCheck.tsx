import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { NETWORK_ID } from "@/lib/kadena";

/**
 * /wallet-check: what a wallet app's built-in browser gives this site (for adding phone wallets).
 * Lists wallet objects the page can see and lets us call the Kadena wallet methods by hand.
 * Read-only: no signing request, nothing is sent anywhere.
 */
const NAMES = [
  "kadena", "linx", "linxWallet", "linxwallet", "eckoWallet", "ecko", "koala", "koalaWallet", "chainweaver",
  "alephium", "alephiumProviders", "ethereum", "flutter_inappwebview", "ReactNativeWebView", "webkit",
];

function describe(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t === "function") return "function";
  if (t !== "object") return v;
  if (depth > 1) return "{…}";
  const out: Record<string, unknown> = {};
  const proto = Object.getPrototypeOf(v);
  const own = proto && proto !== Object.prototype ? Object.getOwnPropertyNames(proto) : [];
  const keys = new Set<string>([...Object.keys(v as object), ...own]);
  for (const k of [...keys].slice(0, 40)) {
    if (k === "constructor") continue;
    try { out[k] = describe((v as Record<string, unknown>)[k], depth + 1); } catch { out[k] = "(unreadable)"; }
  }
  return out;
}

function scan() {
  const w = window as unknown as Record<string, unknown>;
  const found: Record<string, unknown> = {};
  for (const n of NAMES) if (w[n] !== undefined) found[n] = describe(w[n]);
  // globals that a plain page does not have
  const frame = document.createElement("iframe");
  frame.style.display = "none";
  document.body.appendChild(frame);
  const base = new Set(Object.getOwnPropertyNames(frame.contentWindow || {}));
  frame.remove();
  const extra = Object.getOwnPropertyNames(window).filter((k) => !base.has(k) && !/^(__|webpack|vite|React|\$|on)/.test(k));
  return { found, extraGlobals: extra.slice(0, 80) };
}

export default function WalletCheck() {
  const [report, setReport] = useState<{ when: string; data: unknown }[]>([]);
  const add = (when: string, data: unknown) => setReport((r) => [...r, { when, data }]);

  useEffect(() => {
    add("browser", { userAgent: navigator.userAgent, url: location.href, standalone: (navigator as unknown as { standalone?: boolean }).standalone ?? null });
    add("scan now", scan());
    const t1 = setTimeout(() => add("scan after 1 s", scan()), 1000);
    const t2 = setTimeout(() => add("scan after 4 s", scan()), 4000);
    const onEvt = (e: Event) => add(`event ${e.type}`, (e as CustomEvent).detail ?? null);
    const evts = ["kadena#initialized", "eckoWallet#initialized", "linx#initialized", "message"];
    evts.forEach((n) => window.addEventListener(n, onEvt));
    return () => { clearTimeout(t1); clearTimeout(t2); evts.forEach((n) => window.removeEventListener(n, onEvt)); };
  }, []);

  const call = async (method: string) => {
    const k = (window as unknown as { kadena?: { request?: (a: unknown) => Promise<unknown> } }).kadena;
    if (!k?.request) return add(method, "window.kadena.request is not available");
    try {
      const r = await Promise.race([k.request({ method, networkId: NETWORK_ID }), new Promise((_, no) => setTimeout(() => no(new Error("no answer in 60 s")), 60000))]);
      add(method, r);
    } catch (e) {
      add(method, `error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const text = report.map((r) => `## ${r.when}\n${JSON.stringify(r.data, null, 2)}`).join("\n\n");
  const copy = async () => { try { await navigator.clipboard.writeText(text); add("copied", "report copied"); } catch { add("copy", "could not copy; take screenshots instead"); } };

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <h1 className="font-display text-2xl font-bold">Wallet check</h1>
      <p className="text-sm text-muted-foreground">Open this page inside your wallet app's browser. It shows what the wallet gives this site. Nothing is signed or sent.</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => call("kda_checkStatus")}>Check status</Button>
        <Button onClick={() => call("kda_connect")}>Connect</Button>
        <Button variant="outline" onClick={() => call("kda_getNetwork")}>Network</Button>
        <Button variant="outline" onClick={() => call("kda_requestAccount")}>Account</Button>
        <Button variant="outline" onClick={() => add("scan", scan())}>Scan again</Button>
        <Button variant="secondary" onClick={copy}>Copy report</Button>
      </div>
      <pre className="whitespace-pre-wrap break-all rounded-xl border border-border bg-muted/40 p-3 text-xs">{text}</pre>
    </main>
  );
}
