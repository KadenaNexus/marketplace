const API = ""; // relative; /api is proxied in dev or same-origin in prod

export interface UserMessage {
  id: number;
  from: string;
  to: string;
  message: string;
  createdAt: string;
  readAt: string | null;
  contextOfferId?: string | null; // Optional reference to offer that triggered conversation
}

export interface SendMessageParams {
  toWallet: string;
  message: string;
  wallet: string;
  publicKey: string;
  signedCmd: unknown;
  contextOfferId?: string; // Optional: offer that triggered this message
}

export async function sendMessage(params: SendMessageParams): Promise<UserMessage> {
  const res = await fetch(`${API}/api/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: params.message,
      toWallet: params.toWallet,
      wallet: params.wallet,
      publicKey: params.publicKey,
      signedCmd: params.signedCmd,
      contextOfferId: params.contextOfferId,
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.reason || e.error || "Failed to send message");
  }
  return res.json();
}

export async function getMessages(otherWallet: string, wallet: string): Promise<UserMessage[]> {
  const url = `${API}/api/messages/${encodeURIComponent(otherWallet)}?wallet=${encodeURIComponent(wallet)}`;
  console.log("[getMessages] Fetching:", url);
  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text().catch(() => res.statusText);
    console.error("[getMessages] Error:", res.status, errorText);
    throw new Error(errorText || `Failed to fetch messages: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function markMessageAsRead(
  messageId: number,
  wallet: string,
  publicKey: string,
  signedCmd: unknown
): Promise<{ id: number; readAt: string }> {
  const res = await fetch(
    `${API}/api/messages/${messageId}/read`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, publicKey, signedCmd }),
    }
  );
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.reason || e.error || "Failed to mark message as read");
  }
  return res.json();
}

export async function getUnreadCount(wallet: string): Promise<{ unreadCount: number }> {
  const res = await fetch(`${API}/api/messages/unread-count?wallet=${encodeURIComponent(wallet)}`);
  if (!res.ok) {
    throw new Error(await res.text().catch(() => res.statusText));
  }
  return res.json();
}
