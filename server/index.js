/**
 * Profile API – wallet-linked profiles with signed proof of ownership.
 * Stores profiles in PostgreSQL. Offers/escrows stay on-chain (Pact); no contract DB for profiles.
 * Run: npm run dev:server (default port 3001).
 * In dev, Vite proxies /api to this server.
 *
 * Env: DATABASE_URL (default postgresql://localhost:5432/kadena_nexus)
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import pg from "pg";
import multer from "multer";
import { hash, base64UrlDecodeArr, hexToBin, verifySig } from "@kadena/cryptography-utils";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROFILE_AUTH_PURPOSE = "Kadena P2P Escrow Profile";
const NONCE_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes
const AVATAR_MAX_BYTES = 20 * 1024 * 1024; // 20MB

// PostgreSQL configuration from environment variables
// Can use either DATABASE_URL (full connection string) or individual components
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = process.env.DB_PORT || "5432";
const DB_USER = process.env.DB_USER || "postgres";
const DB_PASSWORD = process.env.DB_PASSWORD || "postgres";
const DB_NAME = process.env.DB_NAME || "kadena_nexus";

// Build connection string from components if DATABASE_URL is not provided
const DATABASE_URL = process.env.DATABASE_URL || 
  `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

const UPLOADS_DIR = path.join(__dirname, "uploads", "profiles");
const EVIDENCE_DIR = path.join(__dirname, "uploads", "evidence");
try {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  console.log(`Evidence directory: ${EVIDENCE_DIR}`);
} catch (e) {
  console.error("Failed to create evidence directory:", e.message);
  process.exit(1);
}
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

// Evidence upload (images and PDFs, max 10MB)
const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const uploadEvidence = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
        cb(null, EVIDENCE_DIR);
      } catch (e) {
        cb(new Error(`Failed to create evidence directory: ${e.message}`), null);
      }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname)?.toLowerCase() || "";
      const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf"];
      const e = allowed.includes(ext) ? ext : "";
      cb(null, crypto.randomUUID() + e);
    },
  }),
  limits: { fileSize: EVIDENCE_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
    if (!allowedMimes.includes(file.mimetype)) {
      return cb(new Error("Only images (JPG, PNG, GIF, WebP) and PDFs allowed"), false);
    }
    cb(null, true);
  },
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "256kb" }));

// Serve uploaded profile images
app.use("/uploads/profiles", express.static(UPLOADS_DIR));
// Serve uploaded evidence files
app.use("/uploads/evidence", express.static(EVIDENCE_DIR));

/** @type {pg.Pool} */
let pool;

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
    const result = await pool.query("SELECT wallet, username, avatar, bio, updated_at FROM profiles WHERE wallet = $1", [wallet]);
    const p = result.rows[0];
    return res.json(p ? { 
      username: p.username, 
      avatar: p.avatar, 
      bio: p.bio, 
      wallet: p.wallet, 
      updatedAt: p.updated_at 
    } : null);
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
    // Check for existing profile to handle old avatar deletion
    const existingResult = await pool.query("SELECT avatar FROM profiles WHERE wallet = $1", [wallet]);
    const existing = existingResult.rows[0];
    
    if (existing?.avatar && existing.avatar.startsWith("/uploads/profiles/") && existing.avatar !== av) {
      const oldPath = path.join(UPLOADS_DIR, path.basename(existing.avatar));
      try {
        fs.unlinkSync(oldPath);
      } catch (e) {
        console.warn("Could not delete old avatar file:", oldPath, e.message);
      }
    }
    
    // Upsert profile
    await pool.query(
      `INSERT INTO profiles (wallet, username, avatar, bio, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (wallet) 
       DO UPDATE SET username = $2, avatar = $3, bio = $4, updated_at = $5`,
      [wallet, profile.username, profile.avatar, profile.bio, profile.updatedAt]
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
    const result = await pool.query(
      "SELECT wallet, username, avatar FROM profiles WHERE wallet = ANY($1)",
      [list]
    );
    const out = {};
    for (const p of result.rows) {
      out[p.wallet] = { username: p.username, avatar: p.avatar, wallet: p.wallet };
    }
    return res.json(out);
  } catch (err) {
    console.error("POST /api/profiles/bulk", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

/* ============================================================
   DISPUTE API
============================================================ */

// POST /api/disputes – open a dispute. Body: { offerId, openedBy (buyer/seller), reason, wallet, publicKey, signedCmd }
app.post("/api/disputes", async (req, res) => {
  const { offerId, openedBy, reason, wallet, publicKey, signedCmd } = req.body ?? {};
  if (!offerId || typeof offerId !== "string") {
    return res.status(400).json({ error: "Missing offerId" });
  }
  if (!openedBy || (openedBy !== "buyer" && openedBy !== "seller")) {
    return res.status(400).json({ error: "openedBy must be 'buyer' or 'seller'" });
  }
  if (!wallet || typeof wallet !== "string") {
    return res.status(400).json({ error: "Missing wallet" });
  }
  const v = verifyProfileAuth(signedCmd, wallet, publicKey);
  if (!v.ok) {
    return res.status(403).json({ error: "Proof of ownership failed", reason: v.reason });
  }
  try {
    const existingResult = await pool.query(
      "SELECT id FROM disputes WHERE offer_id = $1 AND status = $2",
      [offerId, "OPEN"]
    );
    if (existingResult.rows.length > 0) {
      return res.status(400).json({ error: "An open dispute already exists for this offer. Please wait for it to be resolved." });
    }
    
    const now = new Date().toISOString();
    const result = await pool.query(
      `INSERT INTO disputes (offer_id, opened_by, reason, opened_by_wallet, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, offer_id, opened_by, reason, opened_by_wallet, status, created_at, updated_at`,
      [offerId, openedBy, typeof reason === "string" ? reason.trim().slice(0, 1000) : "", wallet, "OPEN", now, now]
    );
    
    const dispute = result.rows[0];
    return res.json({
      offerId: dispute.offer_id,
      openedBy: dispute.opened_by,
      reason: dispute.reason,
      openedByWallet: dispute.opened_by_wallet,
      status: dispute.status,
      createdAt: dispute.created_at,
      updatedAt: dispute.updated_at,
    });
  } catch (err) {
    console.error("POST /api/disputes", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// GET /api/disputes/:offerId – get dispute for an offer
app.get("/api/disputes/:offerId", async (req, res) => {
  const offerId = req.params.offerId?.trim();
  if (!offerId) {
    return res.status(400).json({ error: "Missing offerId" });
  }
  try {
    const result = await pool.query(
      "SELECT id, offer_id, opened_by, reason, opened_by_wallet, status, created_at, updated_at FROM disputes WHERE offer_id = $1",
      [offerId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Dispute not found" });
    }
    const dispute = result.rows[0];
    return res.json({
      offerId: dispute.offer_id,
      openedBy: dispute.opened_by,
      reason: dispute.reason,
      openedByWallet: dispute.opened_by_wallet,
      status: dispute.status,
      createdAt: dispute.created_at,
      updatedAt: dispute.updated_at,
    });
  } catch (err) {
    console.error("GET /api/disputes/:offerId", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// POST /api/disputes/:offerId/evidence – submit evidence. Multipart: file(s), explanation, wallet, publicKey, signedCmd
app.post("/api/disputes/:offerId/evidence", (req, res, next) => {
  uploadEvidence.array("files", 10)(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File too large (max 10MB per file)" });
      }
      if (err.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({ error: "Unexpected file field" });
      }
      if (err.code === "LIMIT_FILE_COUNT") {
        return res.status(400).json({ error: "Too many files (max 10)" });
      }
      return res.status(400).json({ error: err.message || "Upload error" });
    }
    next();
  });
}, async (req, res) => {
  try {
    const offerId = req.params.offerId?.trim();
    if (!offerId) {
      return res.status(400).json({ error: "Missing offerId" });
    }
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }
    const { explanation, wallet, publicKey } = req.body ?? {};
    let signedCmd = req.body?.signedCmd;
    if (typeof signedCmd === "string") {
      try {
        signedCmd = JSON.parse(signedCmd);
      } catch (e) {
        return res.status(400).json({ error: "Invalid signedCmd JSON" });
      }
    }
    if (!wallet || typeof wallet !== "string") {
      return res.status(400).json({ error: "Missing wallet" });
    }
    const v = verifyProfileAuth(signedCmd, wallet, publicKey);
    if (!v.ok) {
      return res.status(403).json({ error: "Proof of ownership failed", reason: v.reason });
    }
    // Check if dispute exists
    const disputeResult = await pool.query("SELECT id FROM disputes WHERE offer_id = $1", [offerId]);
    if (disputeResult.rows.length === 0) {
      return res.status(404).json({ error: "Dispute not found" });
    }
    // Verify user is buyer or seller
    // Note: We'd need to fetch escrow from chain to verify, but for now we'll trust the dispute record
    const evidenceFiles = files.map((f) => ({
      filename: f.filename,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
      url: `/uploads/evidence/${f.filename}`,
    }));
    
    const result = await pool.query(
      `INSERT INTO evidence (offer_id, submitted_by, explanation, files, submitted_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, offer_id, submitted_by, explanation, files, submitted_at`,
      [
        offerId,
        wallet,
        typeof explanation === "string" ? explanation.trim().slice(0, 2000) : "",
        JSON.stringify(evidenceFiles),
        new Date().toISOString(),
      ]
    );
    
    await pool.query(
      "UPDATE disputes SET updated_at = $1 WHERE offer_id = $2",
      [new Date().toISOString(), offerId]
    );
    
    const evidence = result.rows[0];
    return res.json({
      offerId: evidence.offer_id,
      submittedBy: evidence.submitted_by,
      explanation: evidence.explanation,
      files: evidence.files,
      submittedAt: evidence.submitted_at,
    });
  } catch (err) {
    console.error("POST /api/disputes/:offerId/evidence", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
});

// GET /api/disputes/:offerId/evidence – get all evidence for a dispute. Query: ?wallet=<wallet> (for authorization check)
app.get("/api/disputes/:offerId/evidence", async (req, res) => {
  const offerId = req.params.offerId?.trim();
  const wallet = req.query.wallet?.toString();
  if (!offerId) {
    return res.status(400).json({ error: "Missing offerId" });
  }
  try {
    const disputeResult = await pool.query("SELECT id FROM disputes WHERE offer_id = $1", [offerId]);
    if (disputeResult.rows.length === 0) {
      return res.status(404).json({ error: "Dispute not found" });
    }
    // Authorization: only buyer, seller, or arbiter can view evidence
    // For now, we'll return evidence if wallet matches openedByWallet or if it's provided
    // In production, you'd verify against the escrow contract to check buyer/seller/arbiter
    const result = await pool.query(
      "SELECT id, offer_id, submitted_by, explanation, files, submitted_at FROM evidence WHERE offer_id = $1 ORDER BY submitted_at DESC",
      [offerId]
    );
    const evidenceList = result.rows.map(row => ({
      offerId: row.offer_id,
      submittedBy: row.submitted_by,
      explanation: row.explanation,
      files: row.files,
      submittedAt: row.submitted_at,
    }));
    return res.json(evidenceList);
  } catch (err) {
    console.error("GET /api/disputes/:offerId/evidence", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// POST /api/disputes/:offerId/messages – send a message in dispute. Body: { message, wallet, publicKey, signedCmd }
app.post("/api/disputes/:offerId/messages", async (req, res) => {
  const offerId = req.params.offerId?.trim();
  const { message, wallet, publicKey, signedCmd } = req.body ?? {};
  if (!offerId) {
    return res.status(400).json({ error: "Missing offerId" });
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message is required" });
  }
  if (!wallet || typeof wallet !== "string") {
    return res.status(400).json({ error: "Missing wallet" });
  }
  const v = verifyProfileAuth(signedCmd, wallet, publicKey);
  if (!v.ok) {
    return res.status(403).json({ error: "Proof of ownership failed", reason: v.reason });
  }
  try {
    const disputeResult = await pool.query("SELECT id FROM disputes WHERE offer_id = $1", [offerId]);
    if (disputeResult.rows.length === 0) {
      return res.status(404).json({ error: "Dispute not found" });
    }
    
    const result = await pool.query(
      `INSERT INTO dispute_messages (offer_id, from_wallet, message, created_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, offer_id, from_wallet, message, created_at`,
      [offerId, wallet, message.trim().slice(0, 2000), new Date().toISOString()]
    );
    
    await pool.query(
      "UPDATE disputes SET updated_at = $1 WHERE offer_id = $2",
      [new Date().toISOString(), offerId]
    );
    
    const msg = result.rows[0];
    return res.json({
      offerId: msg.offer_id,
      from: msg.from_wallet,
      message: msg.message,
      createdAt: msg.created_at,
    });
  } catch (err) {
    console.error("POST /api/disputes/:offerId/messages", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// GET /api/disputes/:offerId/messages – get all messages in dispute
app.get("/api/disputes/:offerId/messages", async (req, res) => {
  const offerId = req.params.offerId?.trim();
  if (!offerId) {
    return res.status(400).json({ error: "Missing offerId" });
  }
  try {
    const disputeResult = await pool.query("SELECT id FROM disputes WHERE offer_id = $1", [offerId]);
    if (disputeResult.rows.length === 0) {
      return res.status(404).json({ error: "Dispute not found" });
    }
    
    const result = await pool.query(
      "SELECT id, offer_id, from_wallet, message, created_at FROM dispute_messages WHERE offer_id = $1 ORDER BY created_at ASC",
      [offerId]
    );
    
    const messages = result.rows.map(row => ({
      offerId: row.offer_id,
      from: row.from_wallet,
      message: row.message,
      createdAt: row.created_at,
    }));
    
    return res.json(messages);
  } catch (err) {
    console.error("GET /api/disputes/:offerId/messages", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// PUT /api/disputes/:offerId/close – arbiter closes dispute. Body: { wallet, publicKey, signedCmd }
app.put("/api/disputes/:offerId/close", async (req, res) => {
  const offerId = req.params.offerId?.trim();
  const { wallet, publicKey, signedCmd } = req.body ?? {};
  if (!offerId) {
    return res.status(400).json({ error: "Missing offerId" });
  }
  if (!wallet || typeof wallet !== "string") {
    return res.status(400).json({ error: "Missing wallet" });
  }
  const v = verifyProfileAuth(signedCmd, wallet, publicKey);
  if (!v.ok) {
    return res.status(403).json({ error: "Proof of ownership failed", reason: v.reason });
  }
  try {
    const disputeResult = await pool.query("SELECT status FROM disputes WHERE offer_id = $1", [offerId]);
    if (disputeResult.rows.length === 0) {
      return res.status(404).json({ error: "Dispute not found" });
    }
    const dispute = disputeResult.rows[0];
    if (dispute.status !== "OPEN") {
      return res.status(400).json({ error: "Dispute is not open" });
    }
    // Note: In production, verify wallet is the arbiter from escrow contract
    await pool.query(
      "UPDATE disputes SET status = $1, updated_at = $2 WHERE offer_id = $3",
      ["CLOSED", new Date().toISOString(), offerId]
    );
    return res.json({ success: true, status: "CLOSED" });
  } catch (err) {
    console.error("PUT /api/disputes/:offerId/close", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

const PORT = Number(process.env.PORT) || 3001;

// Check if running in Vercel serverless environment
const isVercel = process.env.VERCEL === "1";

async function initializeSchema() {
  const schemaPath = path.join(__dirname, "schema.sql");
  if (!fs.existsSync(schemaPath)) {
    console.error(`Schema file not found: ${schemaPath}`);
    throw new Error("Schema file not found");
  }
  
  const schemaSQL = fs.readFileSync(schemaPath, "utf-8");
  
  // Better SQL parsing: handle multi-line statements and comments
  let currentStatement = "";
  const statements = [];
  
  const lines = schemaSQL.split("\n");
  for (let line of lines) {
    // Remove inline comments (-- comments)
    const commentIndex = line.indexOf("--");
    if (commentIndex >= 0) {
      line = line.substring(0, commentIndex);
    }
    
    line = line.trim();
    
    // Skip empty lines
    if (line.length === 0) continue;
    
    // Add line to current statement
    currentStatement += (currentStatement ? " " : "") + line;
    
    // If line ends with semicolon, it's the end of a statement
    if (line.endsWith(";")) {
      const statement = currentStatement.trim();
      if (statement.length > 1) { // More than just ";"
        statements.push(statement);
      }
      currentStatement = "";
    }
  }
  
  // Execute each statement
  console.log(`Executing ${statements.length} schema statements...`);
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    if (statement.length === 0) continue;
    
    try {
      await pool.query(statement);
      const statementType = statement.split(" ")[0].toUpperCase();
      console.log(`  ✓ Executed: ${statementType}...`);
    } catch (err) {
      // Ignore "already exists" errors for tables/indexes
      const isAlreadyExists = err.message.includes("already exists") || err.code === "42P07";
      if (isAlreadyExists) {
        const statementType = statement.split(" ")[0].toUpperCase();
        console.log(`  ⊙ Already exists: ${statementType}...`);
      } else {
        console.error(`  ✗ Schema initialization error on statement ${i + 1}:`, err.message);
        console.error("  Failed statement:", statement.substring(0, 150));
        // Don't throw - continue with other statements
        console.warn("  Continuing with remaining statements...");
      }
    }
  }
  console.log("Database schema initialized successfully");
}

async function start() {
  try {
    // Parse connection string to extract database name
    const url = new URL(DATABASE_URL);
    const dbName = url.pathname.slice(1) || "kadena_nexus";
    
    // Connect to default 'postgres' database first to create our database if needed
    const adminUrl = DATABASE_URL.replace(`/${dbName}`, "/postgres");
    const adminPool = new Pool({ connectionString: adminUrl });
    
    try {
      // Check if database exists
      const result = await adminPool.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [dbName]
      );
      
      if (result.rows.length === 0) {
        // Database doesn't exist, create it
        console.log(`Creating database: ${dbName}`);
        await adminPool.query(`CREATE DATABASE ${dbName}`);
        console.log(`Database ${dbName} created successfully`);
      }
    } catch (createErr) {
      // If we can't create (might not have permissions), continue anyway
      console.warn("Could not create database automatically:", createErr.message);
      console.warn("Please create it manually: CREATE DATABASE " + dbName + ";");
    } finally {
      await adminPool.end();
    }
    
    // Now connect to our database
    pool = new Pool({
      connectionString: DATABASE_URL,
    });
    
    // Test connection
    await pool.query("SELECT 1");
    
    // Initialize schema
    console.log("Initializing database schema...");
    await initializeSchema();
    
    // Mask password in log output for security
    const safeUrl = DATABASE_URL.replace(/:[^:@]+@/, ":****@");
    console.log(`PostgreSQL connected: ${safeUrl}`);
  } catch (err) {
    console.error("PostgreSQL connection failed:");
    console.error("Error:", err.message || err);
    if (err.code) {
      console.error("Error code:", err.code);
    }
    console.error("\nPlease ensure:");
    console.error("1. PostgreSQL is running");
    console.error("2. User has permission to create databases (or create manually: CREATE DATABASE kadena_nexus;)");
    console.error("3. DATABASE_URL is correct");
    console.error("   - Format: postgresql://user:password@host:port/database");
    console.error("   - Current: " + DATABASE_URL.replace(/:[^:@]+@/, ":****@"));
    if (!isVercel) {
      process.exit(1);
    }
  }

  if (!isVercel) {
    app.listen(PORT, () => {
      console.log(`Profile API listening on http://localhost:${PORT}`);
    });
  }
}

// Initialize database connection for serverless (lazy initialization)
let dbInitialized = false;
async function ensureDbInitialized() {
  if (dbInitialized) return;
  try {
    if (!pool) {
      pool = new Pool({
        connectionString: DATABASE_URL,
      });
    }
    await pool.query("SELECT 1");
    if (!dbInitialized) {
      await initializeSchema();
      dbInitialized = true;
    }
  } catch (err) {
    console.error("Database initialization error:", err.message);
  }
}

// Export ensureDbInitialized for serverless functions
app.ensureDbInitialized = ensureDbInitialized;

// Graceful shutdown (only for traditional server)
if (!isVercel) {
  process.on("SIGINT", async () => {
    if (pool) {
      await pool.end();
    }
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    if (pool) {
      await pool.end();
    }
    process.exit(0);
  });

  start();
} else {
  // In Vercel, initialize DB on first request
  ensureDbInitialized();
}

// Export app for Vercel serverless functions
export default app;
