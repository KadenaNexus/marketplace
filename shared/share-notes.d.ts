/** Types for shared/share-notes.js. */
export function marketNote(price: number, marketPrice: number | null | undefined, when?: Date): string;
export function marketPriceFor(prices: Partial<Record<string, number>> | null | undefined, currency: string): number | null;
export function escrowNote(side: "SELL" | "BUY" | string): string;
