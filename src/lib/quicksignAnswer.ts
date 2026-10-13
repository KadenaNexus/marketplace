/** Reading a phone wallet's answer to kadena_quicksign_v1 (WalletConnect). No imports, so it can be tested on its own. */
type Sig = { pubKey?: string; sig?: string | null; signature?: string | null };

/** Short description of an unexpected wallet answer, for the error message. */
function shapeOf(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (Array.isArray(v)) return `list of ${v.length}`;
  if (typeof v === "object") return `fields ${Object.keys(v as object).slice(0, 8).join(", ") || "none"}`;
  return typeof v;
}

/**
 * Signatures from a kadena_quicksign_v1 answer. KIP-17 says { responses: [{ commandSigData, outcome }] },
 * but wallets differ (Linx did not match what @kadena/client expects), so accept the shapes seen in practice:
 * { responses }, { quickSignData } (Ecko), { commandSigDatas }, a bare list, or one item; a JSON string of any.
 */
export function signaturesFromQuicksign(answer: unknown, hash: string, signerKeys: string[]): { pubKey: string; sig: string }[] {
  let r: unknown = answer;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch { /* keep */ } }
  const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
  const list = (Array.isArray(r) ? r : (o.responses ?? o.quickSignData ?? o.commandSigDatas ?? o.result ?? [r])) as unknown[];
  const item = (Array.isArray(list) ? list[0] : list) as Record<string, unknown> | undefined;
  if (!item || typeof item !== "object") throw new Error(`The wallet sent an answer this site does not understand (${shapeOf(r)}).`);
  const outcome = item.outcome as { result?: string; hash?: string; msg?: string } | undefined;
  if (outcome?.result && outcome.result !== "success") {
    throw new Error(outcome.result === "noSig" ? "The wallet did not sign." : `The wallet could not sign${outcome.msg ? `: ${outcome.msg}` : "."}`);
  }
  if (outcome?.hash && outcome.hash !== hash) throw new Error("The wallet signed a different transaction than the one shown here. Nothing was sent.");
  const data = (item.commandSigData ?? (item.commandSigDatas as unknown[] | undefined)?.[0] ?? item) as { sigs?: Sig[] };
  const raw = Array.isArray(data.sigs) ? data.sigs : [];
  const sigs = raw
    .map((x, i) => ({ pubKey: x?.pubKey ?? signerKeys[i], sig: x?.sig ?? x?.signature ?? null }))
    .filter((x): x is { pubKey: string; sig: string } => !!x.pubKey && !!x.sig);
  if (!sigs.length) throw new Error(`The wallet approved but sent no signature (${shapeOf(r)}).`);
  return sigs;
}
