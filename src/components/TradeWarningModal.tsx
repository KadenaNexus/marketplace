import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, MessageSquare, Zap, Shield } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";

export function TradeWarningModal() {
  const { isConnected } = useWallet();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isConnected) setOpen(true);
  }, [isConnected]);

  const handleAcknowledge = () => setOpen(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">
                Important
              </p>
              <h2 className="text-xl font-bold text-foreground leading-tight">
                Before You Trade
              </h2>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div
          className="overflow-y-auto px-6 py-4 flex-1 space-y-4 text-sm text-foreground/80"
        >
          <div className="flex gap-3">
            <div className="mt-0.5 flex-shrink-0">
              <MessageSquare className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground mb-0.5">Coordinate before starting</p>
              <p>
                Agree on a specific date and time with your counterparty before accepting an offer.
                Both parties must be online and available at the same time to complete the trade
                smoothly.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="mt-0.5 flex-shrink-0">
              <MessageSquare className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground mb-0.5">Use the in-trade chat</p>
              <p>
                Once an offer is accepted, a private chat opens between buyer and seller. Use it to
                confirm payment details and notify each other at every step. Chat is not available on
                created states — you need to accept first to interact.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="mt-0.5 flex-shrink-0">
              <Clock className="h-4 w-4 text-amber-500" />
            </div>
            <div>
              <p className="font-semibold text-foreground mb-1">
                Time limits are strictly enforced on-chain and cannot be extended
              </p>
              <ul className="space-y-1 pl-1">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                  1 hour to fund after accepting
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                  4 hours to mark payment after funding
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                  1 hour to release after payment is marked
                </li>
              </ul>
              <p className="mt-2 text-destructive/80 dark:text-red-400 font-medium">
                When a deadline passes, the next action depends on the trade state: an unfunded
                trade can be closed, an unpaid funded trade can be refunded, and a missed release
                deadline moves the trade into a dispute for arbiter review.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="mt-0.5 flex-shrink-0">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground mb-0.5">Act immediately when it is your turn</p>
              <p>
                Fund, Mark as Paid, or Release. Do not delay.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="mt-0.5 flex-shrink-0">
              <Shield className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-foreground mb-0.5">Kadena P2P Marketplace is decentralized</p>
              <p>
                The platform cannot intervene to extend timeouts or reverse transactions.
              </p>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex-shrink-0">
          <Button
            onClick={handleAcknowledge}
            className="w-full font-semibold"
            size="lg"
          >
            I Understand, Proceed
          </Button>
        </div>
      </div>
    </div>
  );
}
