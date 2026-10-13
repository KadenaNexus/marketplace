/** Reading a phone wallet's answer to kadena_quicksign_v1 (WalletConnect). No imports, so it can be tested on its own. */

const HEX_SIG = /^[0-9a-f]{128}$/i;
const HEX_KEY = /^[0-9a-f]{64}$/i;

/**
 * The layout of an answer with values replaced by their kind, e.g. {"results":[{"sig":"<sig>","pubKey":"<key>"}]}.
 * Safe to log: no signatures, keys or commands, only field names.
 */
export function answerLayout(v: unknown, depth = 0): unknown {
  if (typeof v === "string") {
    if (HEX_SIG.test(v)) return "<sig>";
    if (HEX_KEY.test(v)) return "<key>";
    if (v.startsWith("{")) return "<json>";
    return v.length > 24 ? "<text>" : v.replace(/[0-9a-f]{16,}/gi, "<hex>");
  }
  if (v === null || typeof v !== "object") return v;
  if (depth > 5) return "…";
  if (Array.isArray(v)) return v.slice(0, 3).map((x) => answerLayout(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 12)) out[k] = k === "cmd" ? "<cmd>" : answerLayout(x, depth + 1);
  return out;
}

const fields = (v: unknown) => (v && typeof v === "object" ? Object.keys(v as object).slice(0, 8).join(", ") || "none" : typeof v);

/**
 * Signatures from a kadena_quicksign_v1 answer.
 *
 * KIP-17 says { responses: [{ commandSigData: { sigs }, outcome }] }, but wallets differ: Ecko uses
 * { quickSignData }, Linx answers with { results: [...] }. Rather than list every variant, this walks the
 * whole answer (also when it is a JSON string) and collects:
 *  - objects with a 128-hex `sig` / `signature` (pubKey taken from the object, or from the signer order)
 *  - bare 128-hex strings in a list (matched to the signers in order)
 * and refuses the answer if it reports a failure or a different transaction hash.
 */
export function signaturesFromQuicksign(answer: unknown, hash: string, signerKeys: string[]): { pubKey: string; sig: string }[] {
  const parse = (v: unknown): unknown => {
    if (typeof v === "string" && /^\s*[[{]/.test(v)) { try { return JSON.parse(v); } catch { return v; } }
    return v;
  };
  const root = parse(answer);
  const found: { pubKey?: string; sig: string }[] = [];
  let failure = null as string | null;
  let otherHash = false;

  const walk = (v: unknown, depth: number) => {
    v = parse(v);
    if (depth > 8 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        if (typeof x === "string" && HEX_SIG.test(x)) found.push({ pubKey: signerKeys[i], sig: x });
        else walk(x, depth + 1);
      });
      return;
    }
    const o = v as Record<string, unknown>;
    const result = typeof o.result === "string" ? o.result : typeof o.status === "string" ? o.status : null;
    if (result && /^(failure|failed|error|noSig|rejected?)$/i.test(result)) {
      failure = result.toLowerCase() === "nosig" ? "The wallet did not sign." : `The wallet could not sign${typeof o.msg === "string" ? `: ${o.msg}` : typeof o.message === "string" ? `: ${o.message}` : "."}`;
    }
    if (typeof o.hash === "string" && o.hash.length >= 40 && o.hash !== hash && (o.result !== undefined || o.outcome !== undefined || o.sigs !== undefined)) otherHash = true;
    const sig = typeof o.sig === "string" ? o.sig : typeof o.signature === "string" ? o.signature : null;
    if (sig && HEX_SIG.test(sig)) found.push({ pubKey: typeof o.pubKey === "string" ? o.pubKey : typeof o.publicKey === "string" ? o.publicKey : undefined, sig });
    for (const [k, x] of Object.entries(o)) if (k !== "sig" && k !== "signature") walk(x, depth + 1);
  };
  walk(root, 0);

  if (failure) throw new Error(failure);
  if (otherHash) throw new Error("The wallet signed a different transaction than the one shown here. Nothing was sent.");
  const seen = new Set<string>();
  const sigs = found
    .map((s, i) => ({ pubKey: (s.pubKey ?? signerKeys[i] ?? signerKeys[0] ?? "").toLowerCase(), sig: s.sig.toLowerCase() }))
    .filter((s) => s.pubKey && signerKeys.map((k) => k.toLowerCase()).includes(s.pubKey))
    .filter((s) => (seen.has(s.pubKey) ? false : (seen.add(s.pubKey), true)));
  if (!sigs.length) throw new Error(`The wallet approved but sent no signature (fields ${fields(root)}).`);
  return sigs;
}
