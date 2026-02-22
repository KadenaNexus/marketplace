import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a fiat/money number so small values (e.g. 0.000801) don't show as "0.00". */
export function formatFiat(value: number): string {
  if (!Number.isFinite(value) || Number.isNaN(value)) return "0.00";
  const abs = Math.abs(value);
  if (abs === 0) return "0.00";
  if (abs < 0.000_001) return value.toFixed(10);
  if (abs < 0.000_1) return value.toFixed(8);
  if (abs < 0.01) return value.toFixed(6);
  if (abs < 1) return value.toFixed(4);
  return value.toFixed(2);
}
