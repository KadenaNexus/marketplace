import { useState } from "react";
import { SignInPrompt } from "@/components/SignIn";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, MessageCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ChatBox } from "./ChatBox";
import { ProfileSummaryView } from "./ProfileSummary";
import type { ProfileSummary } from "@/lib/profileApi";
import type { Escrow } from "@/lib/kadena";
import { useWallet } from "@/hooks/useWallet";
import { authProof, useSignedIn } from "@/lib/session";
import { getOfferThreads } from "@/lib/messageApi";

/**
 * Chat inside an offer or trade.
 *  - Buyer and seller of an accepted trade talk to each other.
 *  - Anyone looking at an open offer can message its creator (questions before accepting).
 *  - The creator of an open offer sees everyone who wrote about it and picks whom to answer.
 */
export function OfferChat({ escrow, profileMap }: { escrow: Escrow; profileMap: Record<string, ProfileSummary> }) {
  const { account, isConnected } = useWallet();
  const [picked, setPicked] = useState<string | null>(null);
  const me = account?.account ?? null;
  const parties = [escrow.seller, escrow.buyer].filter((w): w is string => !!w);
  const isParty = !!me && parties.includes(me);
  const counterparty = isParty ? parties.find((w) => w !== me) ?? null : null;
  const isCreator = !!me && escrow.creator === me;
  const listForCreator = isCreator && !counterparty;
  const signedIn = useSignedIn(me);

  const { data: threads = [], isLoading } = useQuery({
    queryKey: ["offer-threads", escrow.offerId, me],
    queryFn: async () => {
      const signedCmd = await authProof(account!.account, account!.publicKey);
      return getOfferThreads({ offerId: escrow.offerId, wallet: account!.account, publicKey: account!.publicKey, signedCmd });
    },
    enabled: listForCreator && isConnected && !!account && signedIn,
    refetchInterval: 10000,
  });

  if (!account || !isConnected) {
    return <div className="py-8 text-center text-muted-foreground">Connect your wallet to use chat</div>;
  }

  const chatWith = (wallet: string, onBack?: () => void) => (
    <div className="space-y-2">
      {onBack && (
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-primary">
          <ArrowLeft className="h-4 w-4" />All messages about this offer
        </button>
      )}
      <ChatBox otherWallet={wallet} otherProfile={profileMap[wallet]} contextOfferId={escrow.offerId} />
    </div>
  );

  if (counterparty) return chatWith(counterparty);
  if (!isCreator) {
    if (escrow.state !== "CREATED") {
      return <div className="py-8 text-center text-muted-foreground">This offer has been taken. Its chat is between the buyer and the seller.</div>;
    }
    return chatWith(escrow.creator);
  }
  if (picked) return chatWith(picked, () => setPicked(null));

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">People who saw your offer can message you here before they accept.</p>
      {!signedIn ? (
        <SignInPrompt what="messages about this offer" />
      ) : isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading messages…</p>
      ) : threads.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground">
          <MessageCircle className="mx-auto mb-2 h-10 w-10 opacity-50" />
          <p className="text-sm">No messages about this offer yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {threads.map((t) => (
            <li key={t.wallet}>
              <button type="button" onClick={() => setPicked(t.wallet)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50">
                <span className="min-w-0 flex-1">
                  <ProfileSummaryView wallet={t.wallet} summary={profileMap[t.wallet]} size="sm" />
                  <span className="mt-1 block text-xs text-muted-foreground">Last message {formatDistanceToNow(new Date(t.lastAt), { addSuffix: true })}</span>
                </span>
                {t.unread > 0 && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">{t.unread} new</span>
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
