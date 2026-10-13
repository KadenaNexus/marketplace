// Base URL for API: use relative "" (same-origin) so Nginx receives /api/... and proxies correctly.
// Set VITE_PROFILE_API only when the API is on a different origin (e.g. dev backend URL).
// For production: leave VITE_PROFILE_API unset so requests go to same domain (/api/...).
function getApiBase(): string {
  if (typeof import.meta.env?.VITE_PROFILE_API === "string" && import.meta.env.VITE_PROFILE_API.trim() !== "") {
    return import.meta.env.VITE_PROFILE_API.trim().replace(/\/$/, "");
  }
  return "";
}

function buildProfileUrl(path: string): string {
  const base = getApiBase();
  return base ? `${base}${path}` : path;
}

function wrapNetworkError(err: unknown, context: string): never {
  const msg = err instanceof Error ? err.message : "Network error";
  const isNetwork = typeof msg === "string" && (
    msg.includes("fetch") ||
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    msg.includes("Load failed") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("net::ERR_")
  );
  if (isNetwork) {
    const apiBase = getApiBase();
    const hint = apiBase
      ? `API is set to ${apiBase}. Ensure the backend is running there (e.g. npm run dev:server).`
      : "Backend may be down or /api not proxied. Dev: run 'npm run dev:server'. Production: ensure backend runs and Nginx proxies /api to it.";
    throw new Error(`${context} ${hint}`);
  }
  throw err;
}

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
  /** Last time the wallet was connected or created an offer (ISO), when known */
  lastActive?: string | null;
}

export async function fetchProfile(wallet: string): Promise<Profile | null> {
  const url = buildProfileUrl(`/api/profiles/${encodeURIComponent(wallet)}`);
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    wrapNetworkError(err, "Profile server unreachable.");
  }
  if (res!.status === 404 || res!.status === 204) return null;
  if (!res!.ok) throw new Error(await res!.text().catch(() => res!.statusText));
  const j = await res!.json();
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
  form.append("signedCmd", typeof signedCmd === "string" ? signedCmd : JSON.stringify(signedCmd));
  let res: Response;
  try {
    res = await fetch(buildProfileUrl("/api/profiles/upload-avatar"), {
      method: "POST",
      body: form,
    });
  } catch (err) {
    wrapNetworkError(err, "Profile server unreachable.");
  }
  if (!res!.ok) {
    const e = await res!.json().catch(() => ({ error: res!.statusText }));
    throw new Error(e.reason || e.error || "Upload failed");
  }
  return res!.json();
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
  let res: Response;
  try {
    res = await fetch(buildProfileUrl("/api/profiles"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    wrapNetworkError(err, "Profile server unreachable.");
  }
  if (!res!.ok) {
    const e = await res!.json().catch(() => ({ error: res!.statusText }));
    throw new Error(e.reason || e.error || "Failed to save profile");
  }
  return res!.json();
}

export async function fetchProfilesBulk(wallets: string[]): Promise<Record<string, ProfileSummary>> {
  if (wallets.length === 0) return {};
  let res: Response;
  try {
    res = await fetch(buildProfileUrl("/api/profiles/bulk"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallets }),
    });
  } catch (err) {
    wrapNetworkError(err, "Profile server unreachable.");
  }
  if (!res!.ok) throw new Error(await res!.text().catch(() => res!.statusText));
  return res!.json();
}
