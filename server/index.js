/**
 * Profile API – wallet-linked profiles with signed proof of ownership.
 * Stores profiles in MongoDB. Offers/escrows stay on-chain (Pact); no contract DB for profiles.
 * Run: npm run dev:server (default port 3001).
 * In dev, Vite proxies /api to this server.
 *
 * Env: MONGODB_URI (default mongodb://localhost:27017), MONGODB_DB (default kadena_nexus)
 */

import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";
import multer from "multer";
import { hash, base64UrlDecodeArr, hexToBin, verifySig } from "@kadena/cryptography-utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROFILE_AUTH_PURPOSE = "Kadena P2P Escrow Profile";
const NONCE_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes
const AVATAR_MAX_BYTES = 20 * 1024 * 1024; // 2MB

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const MONGODB_DB = process.env.MONGODB_DB || "kadena_nexus";
const PROFILES_COLLECTION = "profiles";

const UPLOADS_DIR = path.join(__dirname, "uploads", "profiles");
try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log(`Uploads directory: ${UPLOADS_DIR}`);
} catch (e) {
  console.error("Failed to create uploads directory:", e.message);
  process.exit(1);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        cb(null, UPLOADS_DIR);
      } catch (e) {
        cb(new Error(`Failed to create upload directory: ${e.message}`), null);
      }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname)?.toLowerCase() || ".jpg";
      const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
      const e = allowed.includes(ext) ? ext : ".jpg";
      cb(null, crypto.randomUUID() + e);
    },
  }),
  limits: { fileSize: AVATAR_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Only images allowed"), false);
    cb(null, true);
  },
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "256kb" }));

// Serve uploaded profile images
app.use("/uploads/profiles", express.static(UPLOADS_DIR));

/** @type {import('mongodb').Db} */
let db;

/**
 * Verify that signedCmd was signed by the key for `wallet` and includes
 * profile-auth data with matching wallet and recent nonce.
 * Ecko may return sigs[0] with `signature` instead of `sig`, and may omit `pubKey`;
 * `bodyPublicKey` is used as fallback when pubKey is missing in sigs[0].
 * @param {object} signedCmd - { cmd, hash, sigs: [{ sig|signature, pubKey? }] }
 * @param {string} expectedWallet
 * @param {string} [bodyPublicKey] - publicKey from request body, used if sigs[0].pubKey is missing
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function verifyProfileAuth(signedCmd, expectedWallet, bodyPublicKey) {
  if (!signedCmd || typeof signedCmd !== "object") {
    return { ok: false, reason: "Missing signedCmd" };
  }
  // Ecko can return { signedCmd: { cmd, hash, sigs } }; unwrap once
  const cmdObj = signedCmd.cmd != null ? signedCmd : signedCmd.signedCmd;
  if (!cmdObj || typeof cmdObj !== "object") {
    return { ok: false, reason: "Invalid signedCmd shape" };
  }
  const { cmd, hash: hashB64, sigs } = cmdObj;
  if (typeof cmd !== "string" || typeof hashB64 !== "string" || !Array.isArray(sigs) || sigs.length === 0) {
    return { ok: false, reason: "Invalid signedCmd shape" };
  }

  const s0 = sigs[0];
  const sig = (s0 && (s0.sig ?? s0.signature)) || null;
  const pubKey = (s0 && s0.pubKey) || (typeof bodyPublicKey === "string" ? bodyPublicKey : null);
  if (!sig) {
    return { ok: false, reason: "Missing signature in sigs[0] (expected sig or signature)" };
  }
  if (!pubKey) {
    return { ok: false, reason: "Missing pubKey in sigs[0]; include publicKey in request body" };
  }

  // 1) Hash(cmd) must equal stored hash
  try {
    const computed = hash(cmd);
    if (computed !== hashB64) {
      return { ok: false, reason: "Hash mismatch" };
    }
  } catch (e) {
    return { ok: false, reason: "Hash error" };
  }

  // 2) Ed25519 verify: signature over the hash
  try {
    const msgBytes = base64UrlDecodeArr(hashB64);
    const sigBytes = hexToBin(sig);
    const pubBytes = hexToBin(pubKey);
    if (!verifySig(msgBytes, sigBytes, pubBytes)) {
      return { ok: false, reason: "Invalid signature" };
    }
  } catch (e) {
    return { ok: false, reason: "Verify error" };
  }

  // 3) Parse cmd and check data["profile-auth"]
  let payload;
  try {
    const parsed = JSON.parse(cmd);
    payload = parsed?.payload;
  } catch {
    return { ok: false, reason: "Invalid cmd JSON" };
  }
  const data = payload?.exec?.data;
  const auth = data?.["profile-auth"];
  if (!auth || typeof auth !== "object") {
    return { ok: false, reason: "Missing profile-auth in signed data" };
  }
  if (auth.purpose !== PROFILE_AUTH_PURPOSE) {
    return { ok: false, reason: "Wrong purpose" };
  }
  if (auth.wallet !== expectedWallet) {
    return { ok: false, reason: "Wallet mismatch" };
  }
  const nonce = Number(auth.nonce);
  if (!Number.isFinite(nonce)) {
    return { ok: false, reason: "Invalid nonce" };
  }
  const now = Date.now();
  if (Math.abs(now - nonce) > NONCE_TOLERANCE_MS) {
    return { ok: false, reason: "Nonce expired" };
  }

  return { ok: true };
}

// POST /api/profiles/upload-avatar – multipart: image (file), wallet, publicKey, signedCmd (JSON string). Returns { url }.
app.post("/api/profiles/upload-avatar", (req, res, next) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File too large (max 2MB)" });
      }
      if (err.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({ error: "Unexpected file field" });
      }
      return res.status(400).json({ error: err.message || "Upload error" });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      console.error("POST /api/profiles/upload-avatar: No file in request");
      return res.status(400).json({ error: "Missing image file" });
    }
    const wallet = req.body?.wallet;
    const publicKey = req.body?.publicKey;
    let signedCmd = req.body?.signedCmd;
    if (typeof signedCmd === "string") {
      try {
        signedCmd = JSON.parse(signedCmd);
      } catch (e) {
        console.error("POST /api/profiles/upload-avatar: Invalid signedCmd JSON", e.message);
        return res.status(400).json({ error: "Invalid signedCmd JSON" });
      }
    }
    if (!wallet || typeof wallet !== "string") {
      return res.status(400).json({ error: "Missing wallet" });
    }
    const v = verifyProfileAuth(signedCmd, wallet, publicKey);
    if (!v.ok) {
      console.error("POST /api/profiles/upload-avatar: Verification failed", v.reason);
      return res.status(403).json({ error: "Proof of ownership failed", reason: v.reason });
    }
    const url = "/uploads/profiles/" + req.file.filename;
    console.log(`Avatar uploaded: ${url} for wallet ${wallet}`);
    return res.json({ url });
  } catch (err) {
    console.error("POST /api/profiles/upload-avatar error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
});

// GET /api/profiles/:wallet
app.get("/api/profiles/:wallet", async (req, res) => {
  const wallet = req.params.wallet?.trim();
  if (!wallet) {
    return res.status(400).json({ error: "Missing wallet" });
  }
  try {
    const p = await db.collection(PROFILES_COLLECTION).findOne({ wallet });
    return res.json(p ? { username: p.username, avatar: p.avatar, bio: p.bio, wallet: p.wallet, updatedAt: p.updatedAt } : null);
  } catch (err) {
    console.error("GET /api/profiles/:wallet", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// PUT /api/profiles – create/update; requires { username, avatar?, bio?, wallet, publicKey, signedCmd }. avatar: URL (uploaded or external) or null to clear.
app.put("/api/profiles", async (req, res) => {
  const { username, avatar, bio, wallet, publicKey, signedCmd } = req.body ?? {};
  if (!wallet || typeof wallet !== "string") {
    return res.status(400).json({ error: "Missing wallet" });
  }
  const v = verifyProfileAuth(signedCmd, wallet, publicKey);
  if (!v.ok) {
    return res.status(403).json({ error: "Proof of ownership failed", reason: v.reason });
  }

  const name = typeof username === "string" ? username.trim().slice(0, 64) : "";
  const av = (typeof avatar === "string" ? avatar.trim().slice(0, 512) : "") || null;
  const b = typeof bio === "string" ? bio.trim().slice(0, 500) : "";

  const profile = {
    username: name || null,
    avatar: av,
    bio: b || null,
    wallet,
    updatedAt: new Date().toISOString(),
  };

  try {
    const existing = await db.collection(PROFILES_COLLECTION).findOne({ wallet });
    if (existing?.avatar && existing.avatar.startsWith("/uploads/profiles/") && existing.avatar !== av) {
      const oldPath = path.join(UPLOADS_DIR, path.basename(existing.avatar));
      try {
        fs.unlinkSync(oldPath);
      } catch (e) {
        console.warn("Could not delete old avatar file:", oldPath, e.message);
      }
    }
    await db.collection(PROFILES_COLLECTION).updateOne(
      { wallet },
      { $set: profile },
      { upsert: true }
    );
    return res.json(profile);
  } catch (err) {
    console.error("PUT /api/profiles", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// POST /api/profiles/bulk – body: { wallets: string[] }; returns { [wallet]: ProfileSummary }
app.post("/api/profiles/bulk", async (req, res) => {
  const { wallets } = req.body ?? {};
  if (!Array.isArray(wallets)) {
    return res.status(400).json({ error: "wallets must be an array" });
  }
  const list = wallets.filter((w) => typeof w === "string").map((w) => w.trim()).filter(Boolean);
  if (list.length === 0) return res.json({});
  try {
    const cursor = db.collection(PROFILES_COLLECTION).find({ wallet: { $in: list } });
    const rows = await cursor.toArray();
    const out = {};
    for (const p of rows) {
      out[p.wallet] = { username: p.username, avatar: p.avatar, wallet: p.wallet };
    }
    return res.json(out);
  } catch (err) {
    console.error("POST /api/profiles/bulk", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

const PORT = Number(process.env.PORT) || 3001;

async function start() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(MONGODB_DB);
    await db.collection(PROFILES_COLLECTION).createIndex({ wallet: 1 }, { unique: true });
    console.log(`MongoDB connected: ${MONGODB_DB}.${PROFILES_COLLECTION}`);
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Profile API listening on http://localhost:${PORT}`);
  });
}

start();
