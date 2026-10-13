/** Where the KDA holder (seller) is paid: one line per payment method. See server/payout.js. */

/** One way to pay the seller. For USDT/USDC, `value` is the wallet address and `network` the chain it is on. */
export interface PayoutItem { method: string; value: string; network?: string }
export interface Payout {
  details: PayoutItem[];
  updatedAt: string | null;
  /** This wallet is the KDA holder (sets the details) */
  isMine: boolean;
  /** Can still change (offer open or accepted, not yet funded) */
  editable: boolean;
  state: string;
}

type Auth = { wallet: string; publicKey: string; signedCmd: unknown };
const proof = (s: unknown) => (typeof s === "string" ? s : JSON.stringify(s));

export async function getPayout(offerId: string, a: Auth): Promise<Payout | null> {
  const q = new URLSearchParams({ wallet: a.wallet, publicKey: a.publicKey, signedCmd: proof(a.signedCmd) });
  const r = await fetch(`/api/offers/${encodeURIComponent(offerId)}/payout?${q}`);
  if (r.status === 403 || r.status === 404) return null;
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not load the payment details");
  return r.json();
}

export async function putPayout(offerId: string, details: PayoutItem[], a: Auth): Promise<void> {
  const r = await fetch(`/api/offers/${encodeURIComponent(offerId)}/payout`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...a, details }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not save the payment details");
}

/** What to type for each payment method. */
export const PAYOUT_HINTS: Record<string, string> = {
  USDT: "USDT wallet address",
  USDC: "USDC wallet address",
  BUSD: "BUSD address and network",
  "Bank Transfer": "Bank, account name, IBAN",
  PayPal: "PayPal email",
  Wise: "Wise email or account details",
  Revolut: "Revtag (@name) or phone",
  "Cash App": "$Cashtag",
};
export const payoutHint = (method: string) => PAYOUT_HINTS[method] ?? `Your ${method} details`;

/* ---------- USDT / USDC: the network is chosen separately from the address ---------- */
const EVM = /^0x[0-9a-fA-F]{40}$/;
export const STABLE_NETWORKS = [
  { id: "TRC20", label: "Tron (TRC20)", hint: "T… (34 characters)", re: /^T[1-9A-HJ-NP-Za-km-z]{33}$/ },
  { id: "ERC20", label: "Ethereum (ERC20)", hint: "0x… (42 characters)", re: EVM },
  { id: "BEP20", label: "BNB Smart Chain (BEP20)", hint: "0x… (42 characters)", re: EVM },
  { id: "Polygon", label: "Polygon", hint: "0x… (42 characters)", re: EVM },
  { id: "Arbitrum", label: "Arbitrum One", hint: "0x… (42 characters)", re: EVM },
  { id: "Solana", label: "Solana", hint: "32–44 letters and digits", re: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ },
] as const;
export const isStable = (method: string) => /^(USDT|USDC)$/i.test(method);
export const networkLabel = (id?: string) => STABLE_NETWORKS.find((n) => n.id === id)?.label ?? id ?? "";

/** Problem with a USDT/USDC payout line, or null when it looks right (or is not a stablecoin). */
export function stableProblem(item: { method: string; value: string; network?: string }): string | null {
  if (!isStable(item.method) || !item.value.trim()) return null;
  const n = STABLE_NETWORKS.find((x) => x.id === item.network);
  if (!n) return `${item.method}: choose the network`;
  if (!n.re.test(item.value.trim())) return `${item.method}: that doesn't look like a valid ${n.label} address (${n.hint})`;
  return null;
}
