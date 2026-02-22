import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProfileSummaryView } from "./ProfileSummary";
import { useWallet } from "@/hooks/useWallet";
import { useIsOnline } from "@/hooks/useOnlineStatus";
import { sendMessage, getMessages, markMessageAsRead, type UserMessage } from "@/lib/messageApi";
import { buildProfileAuthTx, signTransaction } from "@/lib/kadena";
import { MessageCircle, Send, X, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface ChatBoxProps {
  otherWallet: string;
  otherProfile?: { username: string | null; avatar: string | null; wallet: string } | null;
  onClose?: () => void;
  className?: string;
  contextOfferId?: string; // Optional: offer that triggered this conversation (for context only)
}

export function ChatBox({ otherWallet, otherProfile, onClose, className, contextOfferId }: ChatBoxProps) {
  const { account, isConnected } = useWallet();
  const [messageText, setMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const isOtherOnline = useIsOnline(otherWallet);
  /** Reuse same signed proof for send + mark-as-read so user signs only once. Valid 60s. */
  const signedProofCacheRef = useRef<{ signedCmd: unknown; ts: number } | null>(null);
  const PROOF_CACHE_MS = 60_000;

  const { data: messages = [], refetch } = useQuery({
    queryKey: ["messages", otherWallet, account?.account],
    queryFn: () => getMessages(otherWallet, account?.account || ""),
    enabled: !!account && isConnected && !!otherWallet,
    refetchInterval: 5000, // Poll every 5 seconds as fallback
  });

  /** Mark message(s) as read using optional signed proof (no extra sign if provided or cached). */
  const markAsReadWithProof = async (messageIds: number[], signedCmd?: unknown) => {
    if (!account || !isConnected || messageIds.length === 0) return;
    let proof = signedCmd;
    if (!proof) {
      const cached = signedProofCacheRef.current;
      if (cached && Date.now() - cached.ts < PROOF_CACHE_MS) proof = cached.signedCmd;
    }
    if (!proof) {
      try {
        const tx = buildProfileAuthTx(account.account, account.publicKey);
        let raw = await signTransaction(tx);
        if (raw?.signedCmd && !raw.cmd) raw = raw.signedCmd;
        const sigs = Array.isArray(raw?.sigs) ? raw.sigs : [];
        if (sigs[0] && !sigs[0].pubKey) sigs[0] = { ...sigs[0], pubKey: account.publicKey };
        if (sigs[0]?.signature && !sigs[0].sig) sigs[0] = { ...sigs[0], sig: sigs[0].signature };
        proof = raw;
        signedProofCacheRef.current = { signedCmd: proof, ts: Date.now() };
      } catch (err) {
        console.error("Failed to sign for mark-as-read:", err);
        return;
      }
    }
    for (const id of messageIds) {
      try {
        await markMessageAsRead(id, account.account, account.publicKey, proof);
      } catch (err) {
        console.error("Failed to mark message as read:", err);
      }
    }
    queryClient.invalidateQueries({ queryKey: ["messages", otherWallet, account.account] });
  };

  // Listen for real-time messages via WebSocket (no auto mark-as-read here to avoid extra signs)
  const accountRef = useRef(account?.account);
  const otherWalletRef = useRef(otherWallet);
  accountRef.current = account?.account;
  otherWalletRef.current = otherWallet;
  useEffect(() => {
    if (typeof window === "undefined" || !account) return;
    const socket = (window as any).__socket;
    if (!socket || !socket.connected) {
      const timeout = setTimeout(() => {
        const retrySocket = (window as any).__socket;
        if (retrySocket && retrySocket.connected) {
          retrySocket.emit("join-offer", { offerId });
        }
      }, 1000);
      return () => clearTimeout(timeout);
    }
    const handleNewMessage = (data: UserMessage) => {
      const myAccount = accountRef.current;
      const other = otherWalletRef.current;
      if (!myAccount || !other) return;
      if ((data.from === other && data.to === myAccount) || (data.from === myAccount && data.to === other)) {
        queryClient.setQueryData<UserMessage[]>(["messages", other, myAccount], (old) => {
          if (!old) return [data];
          if (old.some((m) => m.id === data.id)) return old;
          return [...old, data];
        });
        // Do not call markAsRead here — would trigger extra wallet signs when receiving messages.
        // Unread will be marked when user sends a message (same proof) or on next poll/load.
      }
    };
    socket.on("new-message", handleNewMessage);
    socket.emit("join-conversation", { otherWallet });
    return () => {
      socket.off("new-message", handleNewMessage);
      socket.emit("leave-conversation", { otherWallet });
    };
  }, [otherWallet, account?.account, queryClient]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const sendMutation = useMutation({
    mutationFn: sendMessage,
    onSuccess: () => {
      setMessageText("");
      refetch();
    },
    onError: (error: Error) => {
      toast.error("Failed to send message", {
        description: error.message,
      });
    },
  });

  const handleSend = async () => {
    if (!messageText.trim() || !account || !isConnected || isSending) return;

    setIsSending(true);
    try {
      const tx = buildProfileAuthTx(account.account, account.publicKey);
      let signedCmd = await signTransaction(tx);
      if (signedCmd?.signedCmd && !signedCmd.cmd) signedCmd = signedCmd.signedCmd;
      const sigs = Array.isArray(signedCmd?.sigs) ? signedCmd.sigs : [];
      if (sigs[0] && !sigs[0].pubKey) sigs[0] = { ...sigs[0], pubKey: account.publicKey };
      if (sigs[0]?.signature && !sigs[0].sig) sigs[0] = { ...sigs[0], sig: sigs[0].signature };

      signedProofCacheRef.current = { signedCmd, ts: Date.now() };

      await sendMutation.mutateAsync({
        toWallet: otherWallet,
        message: messageText.trim(),
        wallet: account.account,
        publicKey: account.publicKey,
        signedCmd,
        contextOfferId: contextOfferId,
      });

      const unreadFromThem = messages.filter(
        (m) => m.from === otherWallet && m.to === account.account && !m.readAt
      );
      if (unreadFromThem.length > 0) {
        await markAsReadWithProof(unreadFromThem.map((m) => m.id), signedCmd);
      }
    } catch (err) {
      console.error("Send message error:", err);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!account || !isConnected) {
    return (
      <Card className={cn("escrow-card", className)}>
        <CardContent className="p-6 text-center text-muted-foreground">
          Please connect your wallet to use chat
        </CardContent>
      </Card>
    );
  }

  const isMyMessage = (msg: UserMessage) => msg.from === account.account;

  return (
    <Card className={cn("escrow-card flex flex-col h-[500px]", className)}>
      <CardHeader className="flex-shrink-0 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Chat</CardTitle>
            {isOtherOnline ? (
              <span className="text-xs text-green-500 flex items-center gap-1">
                <span className="h-2 w-2 bg-green-500 rounded-full"></span>
                Online
              </span>
            ) : (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Offline
              </span>
            )}
          </div>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-sm text-muted-foreground">With:</span>
          <ProfileSummaryView wallet={otherWallet} summary={otherProfile} size="sm" />
        </div>
      </CardHeader>

      <ScrollArea className="flex-1 px-4" ref={scrollAreaRef}>
        <div className="space-y-4 py-4">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No messages yet</p>
              {!isOtherOnline && (
                <p className="text-xs mt-2">
                  User is offline. Your message will be delivered when they come online.
                </p>
              )}
            </div>
          ) : (
            messages.map((msg) => {
              const isMine = isMyMessage(msg);
              return (
                <div
                  key={msg.id}
                  className={cn(
                    "flex",
                    isMine ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[75%] rounded-lg px-4 py-2",
                      isMine
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    )}
                  >
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.message}</p>
                    <p
                      className={cn(
                        "text-xs mt-1",
                        isMine ? "text-primary-foreground/70" : "text-muted-foreground"
                      )}
                    >
                      {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <div className="flex-shrink-0 p-4 border-t">
        <div className="flex gap-2">
          <Textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={
              isOtherOnline
                ? "Type your message..."
                : "User is offline. Leave a message and they'll see it when online..."
            }
            className="min-h-[60px] resize-none"
            disabled={isSending}
          />
          <Button
            onClick={handleSend}
            disabled={!messageText.trim() || isSending}
            className="self-end"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
