import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A short, colored code for each offer/trade (e.g. "#MPAMY7"), so someone following several trades can
 * tell them apart at a glance. The color comes from the offer ID, so a trade keeps its color everywhere
 * (list, trade screen, every device).
 */

// Full class strings (Tailwind only keeps classes it can see written out)
const COLORS = [
  "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800",
  "bg-violet-100 text-violet-900 border-violet-300 dark:bg-violet-950 dark:text-violet-200 dark:border-violet-800",
  "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800",
  "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800",
  "bg-indigo-100 text-indigo-900 border-indigo-300 dark:bg-indigo-950 dark:text-indigo-200 dark:border-indigo-800",
  "bg-lime-100 text-lime-900 border-lime-300 dark:bg-lime-950 dark:text-lime-200 dark:border-lime-800",
  "bg-fuchsia-100 text-fuchsia-900 border-fuchsia-300 dark:bg-fuchsia-950 dark:text-fuchsia-200 dark:border-fuchsia-800",
  "bg-cyan-100 text-cyan-900 border-cyan-300 dark:bg-cyan-950 dark:text-cyan-200 dark:border-cyan-800",
  "bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-950 dark:text-orange-200 dark:border-orange-800",
];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** "offer-1791905154488-mpamy7" -> "MPAMY7"; other IDs -> their last 6 letters or digits. */
export function tradeCode(offerId: string): string {
  const last = offerId.split("-").pop() ?? offerId;
  const code = /^[a-z0-9]{4,8}$/i.test(last) ? last : offerId.replace(/[^a-z0-9]/gi, "").slice(-6);
  return code.toUpperCase();
}

export function TradeCode({ offerId, className, copy = false, size = "sm" }: { offerId: string; className?: string; copy?: boolean; size?: "sm" | "md" }) {
  const [copied, setCopied] = useState(false);
  const color = COLORS[hash(offerId) % COLORS.length];
  const label = `Trade #${tradeCode(offerId)}`;
  const body = (
    <>
      <span className="font-mono font-bold tracking-wide">#{tradeCode(offerId)}</span>
      {copy && (copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3 opacity-70" />)}
    </>
  );
  const cls = cn(
    "inline-flex shrink-0 items-center gap-1 rounded-md border",
    size === "md" ? "px-2 py-0.5 text-sm" : "px-1.5 py-0.5 text-xs",
    color,
    className,
  );
  if (!copy) return <span className={cls} title={`${label} (${offerId})`} aria-label={label}>{body}</span>;
  return (
    <button
      type="button"
      className={cls}
      title={`Copy the full offer ID: ${offerId}`}
      aria-label={`${label}, copy the full offer ID`}
      onClick={async (e) => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(offerId); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
      }}
    >
      {body}
    </button>
  );
}
