/**
 * Off-chain offer details (price, limits, payment method).
 * Contract stores only trustless data; merge with chain escrow for UI.
 */

const API = "";

export interface OfferDetails {
  offerId: string;
  creator: string;
  amount: number;
  side: "BUY" | "SELL";
  price: number;
  minAmount: number;
  maxAmount: number;
  paymentMethod: string;
  fiatCurrency: string;
  createdAt?: string;
}

export async function getOfferDetails(offerId: string): Promise<OfferDetails | null> {
  const res = await fetch(`${API}/api/offers/${encodeURIComponent(offerId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}

export async function putOfferDetails(details: Omit<OfferDetails, "createdAt">): Promise<{ ok: boolean; offerId: string }> {
  const res = await fetch(`${API}/api/offers`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(details),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}
