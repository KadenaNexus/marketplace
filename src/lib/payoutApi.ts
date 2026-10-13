/** Where the KDA holder (seller) is paid: one line per payment method. See server/payout.js. */

export interface PayoutItem { method: string; value: string }
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
  USDT: "USDT address and network, e.g. TRC20 T…",
  USDC: "USDC address and network, e.g. ERC20 0x…",
  BUSD: "BUSD address and network",
  "Bank Transfer": "Bank, account name, IBAN",
  PayPal: "PayPal email",
  Wise: "Wise email or account details",
  Revolut: "Revtag (@name) or phone",
  "Cash App": "$Cashtag",
};
export const payoutHint = (method: string) => PAYOUT_HINTS[method] ?? `Your ${method} details`;
