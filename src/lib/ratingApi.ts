const API = "";

/**
 * Ratings & Reputation (enforcement):
 * - Only allow rating after a completed trade (completed_offers).
 * - One rating per party per trade: unique (tradeId, rater).
 * - No self-rating (enforced server-side).
 * - UI outputs: trade counts, completion counts, dispute counts, rating aggregates.
 */

export interface RatingSummary {
  averageRating: number;
  totalRatings: number;
  completedTrades: number;
  disputedCount: number;
  completionRate: number;
}

export interface TradeRatingEntry {
  raterWallet: string;
  ratedWallet: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export interface TradeRatingsResponse {
  offerId: string;
  trade: { buyerWallet: string; sellerWallet: string; completedAt: string } | null;
  ratings: TradeRatingEntry[];
  ratingCount: number;
}

export async function fetchTradeRatings(offerId: string): Promise<TradeRatingsResponse> {
  const res = await fetch(`${API}/api/ratings/trade/${encodeURIComponent(offerId)}`);
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}

export async function registerCompletion(params: {
  offerId: string;
  buyerWallet: string;
  sellerWallet: string;
  wallet: string;
  publicKey: string;
  signedCmd: unknown;
}): Promise<{ ok: boolean; offerId: string }> {
  const res = await fetch(`${API}/api/completed-offers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      offerId: params.offerId,
      buyerWallet: params.buyerWallet,
      sellerWallet: params.sellerWallet,
      wallet: params.wallet,
      publicKey: params.publicKey,
      signedCmd: params.signedCmd,
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.reason || e.error || "Failed to register completion");
  }
  return res.json();
}

export async function submitRating(params: {
  offerId: string;
  ratedWallet: string;
  rating: number;
  comment?: string | null;
  wallet: string;
  publicKey: string;
  signedCmd: unknown;
}): Promise<{ ok: boolean; offerId: string }> {
  const res = await fetch(`${API}/api/ratings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      offerId: params.offerId,
      ratedWallet: params.ratedWallet,
      rating: params.rating,
      comment: params.comment ?? undefined,
      wallet: params.wallet,
      publicKey: params.publicKey,
      signedCmd: params.signedCmd,
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.reason || e.error || "Failed to submit rating");
  }
  return res.json();
}

export async function fetchRatingSummary(wallet: string): Promise<RatingSummary> {
  const res = await fetch(`${API}/api/ratings/summary/${encodeURIComponent(wallet)}`);
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}

export async function fetchRatingSummariesBulk(
  wallets: string[]
): Promise<Record<string, RatingSummary>> {
  if (wallets.length === 0) return {};
  const res = await fetch(`${API}/api/ratings/summary/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallets }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}

export interface RatingCheck {
  canRate: boolean;
  alreadyRated: boolean;
}

export async function checkCanRate(
  offerId: string,
  wallet: string
): Promise<RatingCheck> {
  const res = await fetch(
    `${API}/api/ratings/check?offerId=${encodeURIComponent(offerId)}&wallet=${encodeURIComponent(wallet)}`
  );
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}
