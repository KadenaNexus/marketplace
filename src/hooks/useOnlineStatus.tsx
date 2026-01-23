import { useEffect, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useWallet } from "./useWallet";

const SOCKET_URL = ""; // Same origin, will connect to the server

// Global socket instance to share across components
let globalSocket: Socket | null = null;
let onlineStatusMap = new Map<string, boolean>();
const statusListeners = new Set<(wallet: string, isOnline: boolean) => void>();

/**
 * Initialize online status map from profile data (e.g., from API response)
 * This syncs the initial state before WebSocket updates take over
 */
export function initializeOnlineStatus(profiles: Record<string, { isOnline?: boolean }>) {
  let count = 0;
  for (const [wallet, profile] of Object.entries(profiles)) {
    if (profile.isOnline !== undefined) {
      const wasOnline = onlineStatusMap.get(wallet);
      onlineStatusMap.set(wallet, profile.isOnline);
      count++;
      // Always notify listeners so components can initialize their state
      // This ensures UI updates even if status hasn't "changed" (e.g., on initial load)
      statusListeners.forEach((listener) => {
        try {
          listener(wallet, profile.isOnline);
        } catch (err) {
          console.error("Error in status listener:", err);
        }
      });
    }
  }
  if (count > 0) {
    console.log(`Initialized online status for ${count} users from profile data`);
  }
}

function getSocket(): Socket | null {
  if (typeof window === "undefined") return null;
  
  if (!globalSocket) {
    globalSocket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    globalSocket.on("connect", () => {
      console.log("WebSocket connected");
    });

    globalSocket.on("disconnect", () => {
      console.log("WebSocket disconnected");
    });

    globalSocket.on("user-online", ({ wallet }: { wallet: string }) => {
      console.log(`User online event received: ${wallet}`);
      onlineStatusMap.set(wallet, true);
      // Notify all listeners
      statusListeners.forEach((listener) => {
        try {
          listener(wallet, true);
        } catch (err) {
          console.error("Error in status listener:", err);
        }
      });
    });

    globalSocket.on("user-offline", ({ wallet }: { wallet: string }) => {
      console.log(`User offline event received: ${wallet}`);
      onlineStatusMap.set(wallet, false);
      // Notify all listeners
      statusListeners.forEach((listener) => {
        try {
          listener(wallet, false);
        } catch (err) {
          console.error("Error in status listener:", err);
        }
      });
    });

    globalSocket.on("error", (error) => {
      console.error("WebSocket error:", error);
    });

    // Expose socket globally for ChatBox component
    if (typeof window !== "undefined") {
      (window as any).__socket = globalSocket;
    }
  }

  return globalSocket;
}

/**
 * Hook to manage WebSocket connection and track online status
 * Automatically identifies the user when wallet is connected
 * Socket connects immediately to receive status updates for all users
 */
export function useOnlineStatus() {
  const { account, isConnected } = useWallet();
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize socket connection immediately (not dependent on wallet)
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleConnect = () => {
      setIsSocketConnected(true);
      console.log("Socket connected, identifying user...");
      
      // Identify user when connected and wallet is available
      const wallet = account?.account;
      if (wallet && isConnected) {
        console.log(`Identifying wallet: ${wallet}`);
        socket.emit("identify", { wallet });
        prevWalletRef.current = wallet;
      }
    };

    const handleDisconnect = () => {
      setIsSocketConnected(false);
      console.log("Socket disconnected");
      // Clear wallet reference on disconnect
      if (prevWalletRef.current) {
        prevWalletRef.current = null;
      }
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    // Identify on mount if already connected
    if (socket.connected) {
      setIsSocketConnected(true);
      const wallet = account?.account;
      if (wallet && isConnected) {
        console.log(`Socket already connected, identifying wallet: ${wallet}`);
        socket.emit("identify", { wallet });
        prevWalletRef.current = wallet;
      }
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, []); // Empty deps - initialize once

  // Track previous wallet to detect logout
  const prevWalletRef = useRef<string | null>(null);

  // Handle wallet login/logout
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const currentWallet = account?.account || null;
    const prevWallet = prevWalletRef.current;

    // Wait for socket to be connected before identifying
    if (!isSocketConnected && currentWallet) {
      // Socket not connected yet, will identify when it connects
      prevWalletRef.current = currentWallet;
      return;
    }

    // User logged out (had a wallet, now doesn't)
    if (prevWallet && !currentWallet && isSocketConnected) {
      console.log(`Wallet disconnected, marking offline: ${prevWallet}`);
      socket.emit("logout", { wallet: prevWallet });
      prevWalletRef.current = null;
    }
    // User logged in (didn't have wallet, now does) or switched wallets
    else if (currentWallet && currentWallet !== prevWallet && isSocketConnected) {
      console.log(`Wallet connected, identifying: ${currentWallet}`);
      socket.emit("identify", { wallet: currentWallet });
      prevWalletRef.current = currentWallet;
    }
    // User is still connected - don't re-identify unnecessarily
    // Only re-identify if socket just reconnected (handled in connect handler)
    // Update ref even if socket not connected yet
    else if (currentWallet && currentWallet !== prevWallet) {
      prevWalletRef.current = currentWallet;
    }
  }, [account?.account, isConnected, isSocketConnected]);

  // Send heartbeat every 10 seconds when connected
  useEffect(() => {
    if (!isSocketConnected || !account?.account || !isConnected) {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      return;
    }

    const socket = getSocket();
    if (!socket) return;

    heartbeatIntervalRef.current = setInterval(() => {
      socket.emit("heartbeat", { wallet: account.account });
    }, 10000); // Every 10 seconds

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [isSocketConnected, account?.account, isConnected]);

  // Cleanup: mark user offline when component unmounts
  useEffect(() => {
    return () => {
      const socket = getSocket();
      const wallet = prevWalletRef.current;
      if (socket && wallet && socket.connected) {
        console.log(`Component unmounting, marking offline: ${wallet}`);
        socket.emit("logout", { wallet });
        prevWalletRef.current = null;
      }
    };
  }, []);

  return { isSocketConnected };
}

/**
 * Hook to check if a specific wallet is online
 * Updates in real-time via WebSocket events
 */
export function useIsOnline(wallet: string | null | undefined): boolean {
  const [isOnline, setIsOnline] = useState(() => {
    // Initialize from cache if available
    if (wallet) {
      return onlineStatusMap.get(wallet) || false;
    }
    return false;
  });

  useEffect(() => {
    if (!wallet) {
      setIsOnline(false);
      return;
    }

    // Ensure socket is initialized (connects immediately)
    getSocket();

    // Check cached status and update state immediately
    const cachedStatus = onlineStatusMap.get(wallet);
    if (cachedStatus !== undefined) {
      setIsOnline(cachedStatus);
    }

    // Listen for status changes from WebSocket
    const listener = (w: string, online: boolean) => {
      if (w === wallet) {
        console.log(`[useIsOnline] Status update for ${wallet}: ${online ? "online" : "offline"}`);
        setIsOnline(online);
      }
    };

    statusListeners.add(listener);

    return () => {
      statusListeners.delete(listener);
    };
  }, [wallet]); // Only depend on wallet, not isOnline

  return isOnline;
}

/**
 * Hook to get online status for multiple wallets
 */
export function useOnlineStatusMap(wallets: (string | null | undefined)[]): Map<string, boolean> {
  const [statusMap, setStatusMap] = useState(new Map<string, boolean>());

  useEffect(() => {
    const validWallets = wallets.filter((w): w is string => !!w);
    if (validWallets.length === 0) {
      setStatusMap(new Map());
      return;
    }

    // Initialize with cached values
    const newMap = new Map<string, boolean>();
    validWallets.forEach((wallet) => {
      newMap.set(wallet, onlineStatusMap.get(wallet) || false);
    });
    setStatusMap(newMap);

    // Listen for status changes
    const listener = (wallet: string, isOnline: boolean) => {
      if (validWallets.includes(wallet)) {
        setStatusMap((prev) => {
          const updated = new Map(prev);
          updated.set(wallet, isOnline);
          return updated;
        });
      }
    };

    statusListeners.add(listener);

    return () => {
      statusListeners.delete(listener);
    };
  }, [wallets.join(",")]);

  return statusMap;
}
