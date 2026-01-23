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

  const { data: messages = [], refetch } = useQuery({
    queryKey: ["messages", otherWallet, account?.account],
    queryFn: () => getMessages(otherWallet, account?.account || ""),
    enabled: !!account && isConnected && !!otherWallet,
    refetchInterval: 5000, // Poll every 5 seconds as fallback
  });

  const markAsRead = async (messageId: number) => {
    if (!account || !isConnected) return;
    
    try {
      const tx = buildProfileAuthTx(account.account, account.publicKey);
      let signedCmd = await signTransaction(tx);
      if (signedCmd?.signedCmd && !signedCmd.cmd) signedCmd = signedCmd.signedCmd;
      const sigs = Array.isArray(signedCmd?.sigs) ? signedCmd.sigs : [];
      if (sigs[0] && !sigs[0].pubKey) sigs[0] = { ...sigs[0], pubKey: account.publicKey };
      if (sigs[0]?.signature && !sigs[0].sig) sigs[0] = { ...sigs[0], sig: sigs[0].signature };
      
      await markMessageAsRead(messageId, account.account, account.publicKey, signedCmd);
      queryClient.invalidateQueries({ queryKey: ["messages", otherWallet, account.account] });
    } catch (err) {
      console.error("Failed to mark message as read:", err);
    }
  };

  // Listen for real-time messages via WebSocket
  useEffect(() => {
    if (typeof window === "undefined" || !account) return;
    
    // Get socket from global
    const socket = (window as any).__socket;
    if (!socket || !socket.connected) {
      // Wait a bit for socket to connect
      const timeout = setTimeout(() => {
        const retrySocket = (window as any).__socket;
        if (retrySocket && retrySocket.connected) {
          retrySocket.emit("join-offer", { offerId });
        }
      }, 1000);
      return () => clearTimeout(timeout);
    }

    const handleNewMessage = (data: UserMessage) => {
      // Check if message is between current user and otherWallet
      if ((data.from === otherWallet && data.to === account.account) || 
          (data.from === account.account && data.to === otherWallet)) {
        queryClient.setQueryData<UserMessage[]>(["messages", otherWallet, account.account], (old) => {
          if (!old) return [data];
          // Avoid duplicates
          if (old.some((m) => m.id === data.id)) return old;
          return [...old, data];
        });
        
        // Mark as read if it's to us (async, don't await)
        if (data.to === account.account && !data.readAt) {
          markAsRead(data.id).catch(console.error);
        }
      }
    };

    socket.on("new-message", handleNewMessage);
    
    // Join conversation room (user-to-user)
    socket.emit("join-conversation", { otherWallet });

    return () => {
      socket.off("new-message", handleNewMessage);
      socket.emit("leave-conversation", { otherWallet });
    };
  }, [otherWallet, account?.account, queryClient, markAsRead]);

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

      await sendMutation.mutateAsync({
        toWallet: otherWallet,
        message: messageText.trim(),
        wallet: account.account,
        publicKey: account.publicKey,
        signedCmd,
        contextOfferId: contextOfferId,
      });
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
