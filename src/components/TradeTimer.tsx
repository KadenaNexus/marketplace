import { useState, useEffect } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { T2_SECONDS, T3_SECONDS, type Escrow } from "@/lib/kadena";
import { cn } from "@/lib/utils";

const WARNING_THRESHOLD_SEC = 2 * 60; // Last 2 minutes: show warning

/** Remaining seconds until deadline (limitSeconds after deadlineIso). Null if no deadline. */
export function getRemainingSeconds(deadlineIso: string, limitSeconds: number): number | null {
  if (!deadlineIso) return null;
  const deadline = new Date(deadlineIso).getTime() + limitSeconds * 1000;
  return Math.max(0, Math.floor((deadline - Date.now()) / 1000));
}

/** True if the timed step has expired (can call timeout-* on contract). */
export function isStepExpired(deadlineIso: string | undefined, limitSeconds: number): boolean {
  if (!deadlineIso) return false;
  const remaining = getRemainingSeconds(deadlineIso, limitSeconds);
  return remaining !== null && remaining <= 0;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface TradeTimerProps {
  escrow: Escrow;
  className?: string;
}

export function TradeTimer({ escrow, className }: TradeTimerProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const state = escrow.state;
  let label = "";
  let deadlineIso: string | undefined;
  let limitSec = 0;

  if (state === "FUNDED" && escrow.fundedAt) {
    label = "Time to mark payment sent";
    deadlineIso = escrow.fundedAt;
    limitSec = T2_SECONDS;
  } else if (state === "PAID" && escrow.paidAt) {
    label = "Time to release KDA";
    deadlineIso = escrow.paidAt;
    limitSec = T3_SECONDS;
  }

  if (!deadlineIso || !limitSec) return null;

  const remaining = getRemainingSeconds(deadlineIso, limitSec);
  if (remaining === null) return null;

  const expired = remaining <= 0;
  const warning = !expired && remaining <= WARNING_THRESHOLD_SEC;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm",
        warning && "border-amber-500 bg-amber-500/10",
        expired && "border-destructive/50 bg-destructive/10",
        className
      )}
    >
      {expired ? (
        <>
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <span className="font-medium text-destructive">
            Time expired — {state === "ACCEPTED" ? "trade can be closed (no funds)." : state === "FUNDED" ? "seller can refund." : "trade moved to dispute."}
          </span>
        </>
      ) : (
        <>
          <Clock className={cn("h-4 w-4 shrink-0", warning && "text-amber-600")} />
          <span className={cn("font-medium tabular-nums", warning && "text-amber-700 dark:text-amber-400")}>
            {label}: {formatCountdown(remaining)}
          </span>
          {warning && (
            <span className="text-amber-600 dark:text-amber-400">
              (Last 2 min — complete this step soon)
            </span>
          )}
        </>
      )}
    </div>
  );
}
