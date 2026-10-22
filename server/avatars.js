/**
 * Who owns an uploaded profile picture. An upload is stored as "<owner tag>-<uuid>.jpg", the tag being a hash of
 * the wallet that uploaded it, so a profile can only point at, and only delete, pictures that wallet uploaded.
 * Files from before this rule (bare "<uuid>.jpg") have no owner tag: they are kept, and deleted only when no
 * other profile still shows them.
 */
import crypto from "crypto";
import path from "path";

export const AVATAR_URL_PREFIX = "/uploads/profiles/";

/** 16 hex characters from the wallet; the file name reveals nothing about the wallet itself. */
export const ownerTag = (wallet) => crypto.createHash("sha256").update(String(wallet)).digest("hex").slice(0, 16);

/** The file name for a fresh upload by `wallet`. */
export const ownedFilename = (wallet, ext = ".jpg") => `${ownerTag(wallet)}-${crypto.randomUUID()}${ext}`;

export const isUploadedAvatar = (url) => typeof url === "string" && url.startsWith(AVATAR_URL_PREFIX);

/** Did `wallet` upload the picture at this URL? (false for a picture without an owner tag) */
export function uploadedBy(url, wallet) {
  if (!isUploadedAvatar(url)) return false;
  return path.basename(url).startsWith(`${ownerTag(wallet)}-`);
}

/**
 * May a profile save `next` as its picture? External URLs and null: yes. An uploaded picture: only one this wallet
 * uploaded, or the one the profile already shows (an upload from before the owner tag).
 */
export function mayUseAvatar(next, current, wallet) {
  if (!isUploadedAvatar(next)) return true;
  if (next === current) return true;
  return uploadedBy(next, wallet);
}

/**
 * Should the picture a profile stops showing be deleted from disk? Only a picture of this wallet's own; a picture
 * without an owner tag only when `stillShownElsewhere` (checked by the caller) is false.
 */
export function shouldDeleteOld(current, next, wallet, stillShownElsewhere) {
  if (!isUploadedAvatar(current) || current === next) return false;
  if (uploadedBy(current, wallet)) return true;
  if (/^[0-9a-f-]{36}\.jpg$/i.test(path.basename(current))) return !stillShownElsewhere;
  return false;
}
