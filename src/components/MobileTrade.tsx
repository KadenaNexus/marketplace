import { useEffect, useState } from "react";
import { Check, Clock } from "lucide-react";
import { T1_SECONDS, T2_SECONDS, T3_SECONDS, type Escrow } from "@/lib/kadena";
import { formatCountdown, getRemainingSeconds, nextStep } from "./TradeTimer";
import { cn } from "@/lib/utils";

/** Which side of this trade the connected wallet is on (or would be, if it accepts the offer). */
export function myTradeSide(e: Escrow, me?: string): "buyer" | "seller" | null {
  if (!me) return null;
  if (e.seller === me) return "seller";
  if (e.buyer === me) return "buyer";
  if (e.creator === me) return e.side === "SELL" ? "seller" : "buyer";
  if (e.state === "CREATED") return e.side === "SELL" ? "buyer" : "seller";
  return null;
}

export const kdaAmount = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

export function tradeTitle(e: Escrow, me?: string) {
  const side = myTradeSide(e, me);
  if (side === "buyer") return `Buying ${kdaAmount(e.amount)} KDA`;
  if (side === "seller") return `Selling ${kdaAmount(e.amount)} KDA`;
  return `${e.side === "SELL" ? "Sell" : "Buy"} offer: ${kdaAmount(e.amount)} KDA`;
}

function deadline(e: Escrow): { iso?: string; limit: number } {
  if (e.state === "ACCEPTED") return { iso: e.acceptedAt, limit: T1_SECONDS };
  if (e.state === "FUNDED") return { iso: e.fundedAt, limit: T2_SECONDS };
  if (e.state === "PAID") return { iso: e.paidAt, limit: T3_SECONDS };
  return { limit: 0 };
}

/** "42 min left", "3 h 12 min left" */
export function leftText(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return m < 60 ? `${m} min left` : `${Math.floor(m / 60)} h ${m % 60} min left`;
}

/** For lists: is this trade waiting for me, what is the step, and how much time is left. */
export function turnInfo(e: Escrow, me?: string): { mine: boolean; label: string; remaining: number | null } | null {
  if (!me) return null;
  const seller = me === e.seller, buyer = me === e.buyer;
  if (!seller && !buyer) return null;
  if (e.state === "DISPUTED") return { mine: false, label: "In dispute: the arbiter is reviewing", remaining: null };
  const { iso, limit } = deadline(e);
  const remaining = iso && limit ? getRemainingSeconds(iso, limit) : null;
  if (remaining === 0) return { mine: true, label: "Time is up: open the trade to see what you can do", remaining };
  if (e.state === "ACCEPTED") return seller ? { mine: true, label: "Your turn: deposit the KDA", remaining } : { mine: false, label: "Waiting for the seller to deposit", remaining };
  if (e.state === "FUNDED") return buyer ? { mine: true, label: "Your turn: pay and mark as paid", remaining } : { mine: false, label: "Waiting for the buyer's payment", remaining };
  if (e.state === "PAID") return seller ? { mine: true, label: "Your turn: check the payment and release", remaining } : { mine: false, label: "Waiting for the seller to release", remaining };
  return null;
}

/** One line on a trade card: whose turn and the time left (updates every 20 s). */
export function TurnLine({ escrow, me }: { escrow: Escrow; me?: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 20000);
    return () => clearInterval(t);
  }, []);
  const t = turnInfo(escrow, me);
  if (!t) return null;
  const urgent = t.remaining !== null && t.remaining <= 15 * 60;
  return (
    <p className={cn(
      "mt-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm",
      t.mine ? "bg-orange-100 font-semibold text-orange-900 dark:bg-orange-950 dark:text-orange-100" : "bg-muted text-muted-foreground",
    )}>
      <Clock className={cn("h-3.5 w-3.5 shrink-0", urgent && "text-red-600")} />
      <span className="min-w-0 flex-1">{t.label}</span>
      {t.remaining !== null && t.remaining > 0 && <span className={cn("shrink-0 tabular-nums", urgent && "text-red-700 dark:text-red-300")}>{leftText(t.remaining)}</span>}
    </p>
  );
}

/**
 * The first thing on a trade screen: whose turn it is, what to do, and the contract's countdown.
 */
export function YourTurnCard({ escrow: e, me, canAccept }: { escrow: Escrow; me?: string; canAccept: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const side = myTradeSide(e, me);
  const { iso, limit } = deadline(e);
  const remaining = iso && limit ? getRemainingSeconds(iso, limit) : null;
  const expired = remaining !== null && remaining <= 0;

  let eyebrow = "";
  let text = "";
  if (e.state === "CREATED") {
    if (canAccept) {
      eyebrow = "Before you accept";
      text = side === "buyer"
        ? `Check the price and how you pay. After you accept, the seller has 1 hour to lock the ${kdaAmount(e.amount)} KDA. You pay only after that.`
        : `Check the price and how you get paid. After you accept, you have 1 hour to lock the ${kdaAmount(e.amount)} KDA in escrow.`;
    } else if (e.creator === me) {
      eyebrow = "Your offer is live";
      text = "You'll get a notification when someone accepts it.";
    } else {
      text = "This offer is open.";
    }
  } else if (e.state === "DISPUTED") {
    eyebrow = "In dispute";
    text = "The arbiter is reviewing this trade. Use the Dispute tab to add evidence, and the chat to talk to the other side.";
  } else if (["COMPLETED", "REFUNDED", "CLOSED"].includes(e.state)) {
    eyebrow = "Finished";
    text = e.state === "COMPLETED" ? "The KDA was released to the buyer." : e.state === "REFUNDED" ? "The KDA went back to the seller." : "This offer was closed.";
  } else {
    const s = nextStep(e, me, expired);
    if (s.startsWith("Your turn: ")) { eyebrow = "Your turn"; text = s.slice("Your turn: ".length); }
    else { eyebrow = expired ? "Time is up" : "Waiting"; text = s; }
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }
  const mine = eyebrow === "Your turn" || eyebrow === "Before you accept";
  const warn = expired || (remaining !== null && remaining <= 120);

  return (
    <section
      aria-live="polite"
      className={cn(
        "rounded-2xl border-2 bg-card p-4",
        mine ? "border-primary" : "border-border",
        expired && "border-destructive/60",
      )}
    >
      {eyebrow && <p className={cn("text-xs font-semibold uppercase tracking-wide", mine ? "text-primary" : "text-muted-foreground")}>{eyebrow}</p>}
      <p className={cn("mt-1 leading-snug", mine ? "font-display text-lg font-semibold" : "text-base")}>{text}</p>
      {remaining !== null && !expired && (
        <p className={cn("mt-2 flex items-center gap-1.5 text-sm text-muted-foreground", warn && "text-amber-700 dark:text-amber-400")}>
          <Clock className={cn("h-4 w-4 text-orange-600", warn && "text-amber-600")} />
          <span className="font-semibold tabular-nums text-foreground">{formatCountdown(remaining)}</span> left, set by the escrow contract
        </p>
      )}
    </section>
  );
}

/** Four steps of a trade with the current one marked. Shown once an offer is accepted. */
export function TradeSteps({ escrow: e, me }: { escrow: Escrow; me?: string }) {
  const order = ["ACCEPTED", "FUNDED", "PAID", "COMPLETED"];
  const at = order.indexOf(e.state);
  if (at < 0) return null;
  const side = myTradeSide(e, me);
  const kda = `${kdaAmount(e.amount)} KDA`;
  const steps = [
    side === "buyer" && e.creator !== me ? "Accepted by you" : "Offer accepted",
    `${kda} locked in escrow`,
    side === "buyer" ? "You pay and mark it paid" : "Buyer pays and marks it paid",
    side === "buyer" ? "Seller releases the KDA to you" : side === "seller" ? "You release the KDA to the buyer" : "Seller releases the KDA",
  ];
  return (
    <ol className="space-y-2.5 rounded-2xl border border-border bg-card p-4" aria-label="Trade steps">
      {steps.map((label, i) => {
        const done = i <= at;
        const current = i === at + 1;
        return (
          <li key={label} className="flex items-center gap-3 text-sm">
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                done && "border-primary bg-primary text-primary-foreground",
                current && "border-orange-600",
                !done && !current && "border-border",
              )}
              aria-hidden="true"
            >
              {done && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span className={cn(done ? "text-foreground" : "text-muted-foreground", current && "font-semibold text-foreground")}>
              {label}
              <span className="sr-only">{done ? " (done)" : current ? " (now)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
