/**
 * The transaction being confirmed right now, for the "keep this page open" countdown.
 * submitTransaction() starts it and pollTransaction() ends it, so every on-chain step in the app is covered.
 * Callers can name the step first with setTxLabel("Releasing 250 KDA"). When something must still be saved after
 * the chain answers (the offer's price, a deposit's link), pass { hold: true } and call txFinished() when done:
 * the page then stays covered, with "Saving…", until then.
 */
import { useSyncExternalStore } from "react";

export type TxInProgress = { requestKey: string; label: string; startedAt: number; hold: boolean; saving: boolean };

let current: TxInProgress | null = null;
let next: { label: string; hold: boolean } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Name the next transaction (the title of the countdown). */
export function setTxLabel(label: string, { hold = false }: { hold?: boolean } = {}) { next = { label, hold }; }

export function txSubmitted(requestKey: string) {
  current = { requestKey, label: next?.label || "Confirming your transaction", startedAt: Date.now(), hold: !!next?.hold, saving: false };
  next = null;
  emit();
}

/** The chain answered (or polling gave up). */
export function txSettled(requestKey: string) {
  if (current?.requestKey !== requestKey) return;
  current = current.hold ? { ...current, saving: true } : null;
  emit();
}

/** The step is over, whatever happened (call in a finally). */
export function txFinished() {
  next = null;
  if (current) { current = null; emit(); }
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useTxInProgress(): TxInProgress | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
