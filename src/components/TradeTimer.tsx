import { useState, useEffect } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { T1_SECONDS, T2_SECONDS, T3_SECONDS, type Escrow } from "@/lib/kadena";
import { cn } from "@/lib/utils";
import { isGiveaway } from "@/lib/markets";

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

export function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * One plain sentence telling this person what happens next and whose turn it is.
 * Button names match the trade buttons: Deposit, Mark as Paid, Release to Buyer,
 * Refund, Move to dispute, Close offer.
 */
export function nextStep(escrow: Escrow, me: string | undefined, expired: boolean): string {
  const kda = `${escrow.amount.toLocaleString("en-US", { maximumFractionDigits: 4 })} KDA`;
  const seller = !!me && me === escrow.seller;
  const buyer = !!me && me === escrow.buyer;
  if (isGiveaway(escrow) && !expired) {
    // free giveaway: nothing is paid; "Mark as Paid" only tells the contract the winner is ready
    if (escrow.state === "ACCEPTED") {
      if (seller) return `Your turn: press Deposit to lock the ${kda} giveaway in escrow.`;
      if (buyer) return `You won this free giveaway. Waiting for the giver to lock ${kda} in escrow. There is nothing to pay.`;
    }
    if (escrow.state === "FUNDED") {
      if (buyer) return `Your turn: the ${kda} is locked for you. There is nothing to pay: press Mark as Paid (no screenshot needed) before the time runs out.`;
      if (seller) return "The giveaway is locked in escrow. Waiting for the winner to press Mark as Paid.";
    }
    if (escrow.state === "PAID") {
      if (seller) return `Your turn: the winner confirmed. There is no payment to check: press Release to Buyer to send the ${kda}.`;
      if (buyer) return `Confirmed. Waiting for the giver to release the ${kda} to you.`;
    }
  }
  if (escrow.state === "ACCEPTED") {
    if (expired) return "The seller did not lock the KDA in time. Nothing was paid and nothing is at risk; either side can close the trade with Close offer.";
    if (seller) return `Your turn: press Deposit to lock ${kda} in escrow. The buyer will only send payment after that.`;
    if (buyer) return `Waiting for the seller to lock ${kda} in escrow. Do not send any payment until the trade shows Funded.`;
    return `Waiting for the seller to lock ${kda} in escrow.`;
  }
  if (escrow.state === "FUNDED") {
    if (expired) {
      if (seller) return "The buyer did not mark the payment in time. You can take your KDA back with Refund.";
      if (buyer) return "The payment deadline passed, so the seller can now take the KDA back. If you already paid, message the seller in the trade chat right away.";
      return "The payment deadline passed; the seller can take the KDA back.";
    }
    if (buyer) return `Your turn: the ${kda} is locked in escrow. Send the payment to the seller as agreed, then press Mark as Paid before the time runs out.`;
    if (seller) return "Your KDA is locked in escrow. Waiting for the buyer to send the payment and press Mark as Paid. Do not release anything yet.";
    return "KDA is locked in escrow. Waiting for the buyer to pay and press Mark as Paid.";
  }
  if (escrow.state === "PAID") {
    if (expired) return "The release deadline passed. Either side can press Move to dispute; the arbiter then reviews the trade and decides.";
    if (seller) return `Your turn: the buyer says the payment is sent. Check that you received it in full, then press Release to Buyer to send the ${kda}.`;
    if (buyer) return `Payment marked as sent. Waiting for the seller to confirm and release the ${kda} to you. If they do not release in time, you can open a dispute.`;
    return "Payment marked as sent. Waiting for the seller to release the KDA.";
  }
  return "";
}

interface TradeTimerProps {
  escrow: Escrow;
  /** Connected wallet, to say whose turn it is. */
  me?: string;
  className?: string;
}

export function TradeTimer({ escrow, me, className }: TradeTimerProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const state = escrow.state;
  let label = "";
  let deadlineIso: string | undefined;
  let limitSec = 0;

  if (state === "ACCEPTED" && escrow.acceptedAt) {
    label = "Time to fund escrow";
    deadlineIso = escrow.acceptedAt;
    limitSec = T1_SECONDS;
  } else if (state === "FUNDED" && escrow.fundedAt) {
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
            Time expired
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
              (Last 2 min: complete this step soon)
            </span>
          )}
        </>
      )}
      {nextStep(escrow, me, expired) && (
        <p className="basis-full text-muted-foreground">{nextStep(escrow, me, expired)}</p>
      )}
    </div>
  );
}
