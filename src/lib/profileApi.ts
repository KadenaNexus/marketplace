// Use VITE_PROFILE_API when set (e.g. for dev or when API is on another domain). Otherwise same-origin ("").
const API =
  typeof import.meta.env?.VITE_PROFILE_API === "string" && import.meta.env.VITE_PROFILE_API.trim() !== ""
    ? import.meta.env.VITE_PROFILE_API.trim().replace(/\/$/, "")
    : "";

export interface Profile {
  username: string | null;
  avatar: string | null;
  bio: string | null;
  wallet: string;
  updatedAt: string;
  lastSeen?: string;
  isOnline?: boolean;
}

export interface ProfileSummary {
  username: string | null;
  avatar: string | null;
  wallet: string;
  isOnline?: boolean;
}

export async function fetchProfile(wallet: string): Promise<Profile | null> {
  const res = await fetch(`${API}/api/profiles/${encodeURIComponent(wallet)}`);
  if (res.status === 404 || res.status === 204) return null;
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  const j = await res.json();
  return j && typeof j.wallet === "string" ? j : null;
}

/** Upload profile image; requires signed proof. Returns the URL to store (e.g. /uploads/profiles/xxx). */
export async function uploadAvatar(params: {
  image: File;
  wallet: string;
  publicKey: string;
  signedCmd: unknown;
}): Promise<{ url: string }> {
  const { image, wallet, publicKey, signedCmd } = params;
  const form = new FormData();
  form.append("image", image);
  form.append("wallet", wallet);
  form.append("publicKey", publicKey);
  form.append("signedCmd", JSON.stringify(signedCmd));
  const res = await fetch(`${API}/api/profiles/upload-avatar`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.reason || e.error || "Upload failed");
  }
  return res.json();
}

export async function putProfile(params: {
  username: string;
  avatar?: string | null;
  bio: string;
  wallet: string;
  publicKey: string;
  signedCmd: unknown;
}): Promise<Profile> {
  const body: Record<string, unknown> = {
    username: params.username,
    bio: params.bio,
    wallet: params.wallet,
    publicKey: params.publicKey,
    signedCmd: params.signedCmd,
  };
  if (params.avatar !== undefined) body.avatar = params.avatar;
  const res = await fetch(`${API}/api/profiles`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.reason || e.error || "Failed to save profile");
  }
  return res.json();
}

export async function fetchProfilesBulk(wallets: string[]): Promise<Record<string, ProfileSummary>> {
  if (wallets.length === 0) return {};
  const res = await fetch(`${API}/api/profiles/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallets }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}
