import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getSocket } from "@/hooks/useOnlineStatus";
import { useWallet } from "@/hooks/useWallet";
import type { UserMessage } from "@/lib/messageApi";

/**
 * Listens for new-message events for the current user (when message.to === myWallet)
 * and notifies them: in-app toast + invalidates message queries so any unread badge
 * or list updates. If the tab is in the background, shows a browser Notification when
 * permission is granted.
 */
export function useNewMessageNotification() {
  const queryClient = useQueryClient();
  const { account } = useWallet();
  const accountRef = useRef(account);
  accountRef.current = account;

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleNewMessage = (data: UserMessage) => {
      const myAccount = accountRef.current?.account;
      if (!myAccount || data.to !== myAccount) return;
      // Don't notify for our own messages (e.g. from another tab)
      if (data.from === myAccount) return;

      // Invalidate so any unread count or message list refetches
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["messages-unread-count"] });

      const preview = data.message?.trim().slice(0, 60) || "(attachment)";
      const fromShort = data.from.slice(0, 10) + "…";
      toast.info("New message", {
        description: `From ${fromShort}: ${preview}${preview.length >= 60 ? "…" : ""}`,
        duration: 5000,
      });

      // Browser notification when tab is in background (if permission granted)
      if (typeof document !== "undefined" && document.hidden && "Notification" in window) {
        const showNotification = () => {
          try {
            new Notification("New message", {
              body: `From ${fromShort}: ${preview}${preview.length >= 60 ? "…" : ""}`,
              tag: `msg-${data.id}`,
            });
          } catch (_) {}
        };
        if (Notification.permission === "granted") {
          showNotification();
        } else if (Notification.permission === "default") {
          Notification.requestPermission().then((p) => {
            if (p === "granted") showNotification();
          });
        }
      }
    };

    socket.on("new-message", handleNewMessage);

    return () => {
      socket.off("new-message", handleNewMessage);
    };
  }, [queryClient]);
}
