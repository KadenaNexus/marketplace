import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useTxInProgress } from "@/lib/txProgress";
import { getTxExplorerUrl } from "@/lib/kadena";

const EXPECTED_S = 60;
const R = 44, C = 2 * Math.PI * R;

/**
 * While a transaction is being confirmed on Kadena (usually under a minute): a 60-second countdown and a clear
 * "keep this page open". People otherwise think the app froze and refresh, which loses the result on screen
 * (and, for a deposit, the saved link to it). Closing the page is also asked to be confirmed.
 */
export function TxProgressOverlay() {
  const tx = useTxInProgress();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!tx) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    const stay = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", stay);
    return () => { clearInterval(t); window.removeEventListener("beforeunload", stay); };
  }, [tx]);

  if (!tx) return null;
  const elapsed = Math.max(0, (now - tx.startedAt) / 1000);
  const left = Math.max(0, Math.ceil(EXPECTED_S - elapsed));
  const over = elapsed >= EXPECTED_S || tx.saving;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
      <div role="alertdialog" aria-modal="true" aria-labelledby="tx-progress-title" aria-describedby="tx-progress-keep" aria-busy="true"
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl">
        <div className="relative mx-auto h-28 w-28">
          <svg viewBox="0 0 100 100" className={`h-28 w-28 -rotate-90 ${over ? "animate-spin [animation-duration:1.6s]" : ""}`} aria-hidden="true">
            <circle cx="50" cy="50" r={R} fill="none" strokeWidth="7" className="stroke-muted" />
            <circle cx="50" cy="50" r={R} fill="none" strokeWidth="7" strokeLinecap="round" className="stroke-primary transition-[stroke-dashoffset] duration-300 ease-linear"
              strokeDasharray={C} strokeDashoffset={over ? C * 0.72 : C * Math.min(1, elapsed / EXPECTED_S)} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center" aria-live="off">
            {over ? <span className="text-sm font-medium leading-tight text-muted-foreground">{tx.saving ? "Saving" : <>Still<br />confirming</>}</span> : (
              <>
                <span className="font-display text-4xl font-bold tabular-nums leading-none">{left}</span>
                <span className="mt-1 text-xs text-muted-foreground">seconds</span>
              </>
            )}
          </div>
        </div>
        <h2 id="tx-progress-title" className="mt-4 font-display text-xl font-semibold">{tx.label}…</h2>
        <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
          {tx.saving
            ? "Confirmed on Kadena. Almost done: saving the details…"
            : over
            ? "Taking a little longer than usual. It was sent and Kadena is still confirming it. Nothing is lost."
            : "Confirming on the Kadena network. This usually takes under a minute."}
        </p>
        <p id="tx-progress-keep" className="mt-4 flex items-start gap-2 rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-left text-sm font-medium text-amber-950 dark:bg-amber-950 dark:text-amber-50">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Please keep this page open. Don't refresh, close the app or go back until this finishes.</span>
        </p>
        <a href={getTxExplorerUrl(tx.requestKey)} target="_blank" rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2">
          Follow it on the Kadena explorer <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>,
    document.body,
  );
}
