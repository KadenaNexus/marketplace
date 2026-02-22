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
    const msg = e.reason || e.error || (res.status === 404 ? "Chat server not available. Run 'npm run dev:server' in another terminal for profile and chat." : "Failed to send message");
    throw new Error(msg);
  }
  return res.json();
}

export interface GetMessagesParams {
  otherWallet: string;
  wallet: string;
  publicKey: string;
  signedCmd: unknown;
}

export async function getMessages(params: GetMessagesParams): Promise<UserMessage[]> {
  const { otherWallet, wallet, publicKey, signedCmd } = params;
  const q = new URLSearchParams({
    wallet,
    publicKey,
    signedCmd: typeof signedCmd === "string" ? signedCmd : JSON.stringify(signedCmd),
  });
  const url = `${API}/api/messages/${encodeURIComponent(otherWallet)}?${q.toString()}`;
  console.log("[getMessages] Fetching:", url.replace(/signedCmd=[^&]+/, "signedCmd=..."));
  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text().catch(() => res.statusText);
    console.error("[getMessages] Error:", res.status, errorText);
    const msg = res.status === 404
      ? "Chat server not available. Run 'npm run dev:server' in another terminal for profile and chat."
      : (errorText || `Failed to fetch messages: ${res.status}`);
    throw new Error(msg);
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

export interface GetUnreadCountParams {
  wallet: string;
  publicKey: string;
  signedCmd: unknown;
}

export async function getUnreadCount(params: GetUnreadCountParams): Promise<{ unreadCount: number }> {
  const { wallet, publicKey, signedCmd } = params;
  const q = new URLSearchParams({
    wallet,
    publicKey,
    signedCmd: typeof signedCmd === "string" ? signedCmd : JSON.stringify(signedCmd),
  });
  const res = await fetch(`${API}/api/messages/unread-count?${q.toString()}`);
  if (!res.ok) {
    throw new Error(await res.text().catch(() => res.statusText));
  }
  return res.json();
}
