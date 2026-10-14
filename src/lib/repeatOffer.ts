/**
 * "Post again": a finished offer you created becomes a ready-filled new offer (same side, amount, price,
 * currency, payment methods and, for a sell offer, where you get paid). Kept in memory until the form takes it.
 */
import type { Escrow } from "@/lib/kadena";
import { PAY_CURRENCIES, methodsFor } from "@/lib/markets";

export interface OfferDraft { from: string; side: "BUY" | "SELL"; amount: number; price: number; fiatCurrency: string; paymentMethods: string[] }
export const REPEAT_OFFER_EVENT = "nx-repeat-offer";
let draft: OfferDraft | null = null;

export function repeatOffer(e: Escrow) {
  let methods: string[] = [];
  try { const a = JSON.parse(e.paymentMethod || "[]"); methods = Array.isArray(a) ? a.map(String) : []; } catch { methods = e.paymentMethod ? [e.paymentMethod] : []; }
  draft = {
    from: e.offerId,
    side: e.side,
    amount: e.amount,
    price: e.price,
    // offers made before the market was narrowed may use a method or currency that is no longer offered
    fiatCurrency: (PAY_CURRENCIES as readonly string[]).includes(e.fiatCurrency) ? e.fiatCurrency : "USD",
    paymentMethods: methods.filter((m) => methodsFor((PAY_CURRENCIES as readonly string[]).includes(e.fiatCurrency) ? e.fiatCurrency : "USD").includes(m)),
  };
  window.dispatchEvent(new CustomEvent(REPEAT_OFFER_EVENT, { detail: draft }));
}

/** The waiting draft for this side, once (it is cleared when taken). */
export function takeOfferDraft(side: "BUY" | "SELL"): OfferDraft | null {
  if (!draft || draft.side !== side) return null;
  const d = draft; draft = null;
  return d;
}
