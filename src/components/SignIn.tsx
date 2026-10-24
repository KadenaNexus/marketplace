import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { authProof, useSignedIn } from "@/lib/session";

/**
 * The wallet signs in only when the person taps Sign in (or a trade step), never on its own when the page
 * opens. The signature moves no coins; the server checks it and this device stays signed in for 30 days.
 */
export function useSignIn() {
  const { account, isConnected } = useWallet();
  const signedIn = useSignedIn(isConnected ? account?.account : null);
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    if (!account || busy) return;
    setBusy(true);
    try {
      await authProof(account.account, account.publicKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Sign-in did not finish", { description: /reject|cancel|denied/i.test(msg) ? "You closed the request in your wallet. Tap Sign in to try again." : msg });
    } finally {
      setBusy(false);
    }
  };
  return { canSignIn: isConnected && !!account && !signedIn, signedIn, busy, signIn };
}

/** Header button next to the wallet address while this device is not signed in. */
export function SignInButton() {
  const { canSignIn, busy, signIn } = useSignIn();
  if (!canSignIn) return null;
  return (
    <Button size="sm" onClick={signIn} disabled={busy} className="shrink-0 gap-2 px-2 sm:px-3" title="Sign in with your wallet. This moves no coins." aria-label="Sign in">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
      <span>Sign in</span>
    </Button>
  );
}

/** In place of private trade details (payment details, messages) until the person signs in. */
export function SignInPrompt({ what }: { what: string }) {
  const { canSignIn, busy, signIn } = useSignIn();
  if (!canSignIn) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border p-3 text-sm">
      <span className="text-muted-foreground">
        <KeyRound className="mr-1.5 inline h-4 w-4" />
        Sign in with your wallet to see {what}. This moves no coins.
      </span>
      <Button size="sm" onClick={signIn} disabled={busy} className="gap-2">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Sign in
      </Button>
    </div>
  );
}
