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
import { createServer } from "http";
import { Server } from "socket.io";

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

// Debug middleware to log all requests
app.use((req, res, next) => {
  if (req.path?.includes("messages")) {
    console.log(`[Request] ${req.method} ${req.path}`, req.query);
  }
  next();
});

// Serve uploaded profile images
app.use("/uploads/profiles", express.static(UPLOADS_DIR));
// Serve uploaded evidence files
app.use("/uploads/evidence", express.static(EVIDENCE_DIR));

/** @type {pg.Pool} */
let pool;

// WebSocket server for online status tracking
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
  },
});

// Track online users: Map<wallet, { socketId, lastSeen }>
const onlineUsers = new Map();

// Cleanup interval: mark users offline if no heartbeat for 60 seconds
const HEARTBEAT_TIMEOUT = 60 * 1000; // 60 seconds
setInterval(() => {
  const now = Date.now();
  const toRemove = [];
  for (const [wallet, data] of onlineUsers.entries()) {
    // Check if socket is still connected
    const socket = io.sockets.sockets.get(data.socketId);
    if (!socket || !socket.connected) {
      toRemove.push(wallet);
    } else if (now - data.lastSeen > HEARTBEAT_TIMEOUT) {
      toRemove.push(wallet);
    }
  }
  for (const wallet of toRemove) {
    onlineUsers.delete(wallet);
    // Notify all clients that this user is offline
    io.emit("user-offline", { wallet });
    console.log(`User ${wallet} marked offline (timeout or disconnected)`);
  }
}, 30000); // Check every 30 seconds

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // User identifies themselves with their wallet
  socket.on("identify", async ({ wallet }) => {
    if (!wallet || typeof wallet !== "string") {
      socket.emit("error", { message: "Invalid wallet" });
      return;
    }

    // Remove old socket if user reconnects (but keep the user online if it's the same wallet)
    const existing = onlineUsers.get(wallet);
    if (existing && existing.socketId !== socket.id) {
      // Disconnect old socket only if it's still connected
      const oldSocket = io.sockets.sockets.get(existing.socketId);
      if (oldSocket) {
        oldSocket.disconnect();
      }
    }

    // Mark user as online
    onlineUsers.set(wallet, {
      socketId: socket.id,
      lastSeen: Date.now(),
    });

    socket.data.wallet = wallet;
    console.log(`User online: ${wallet}`);

    // Update last_seen in database (if column exists)
    try {
      if (pool) {
        await pool.query(
          "UPDATE profiles SET last_seen = CURRENT_TIMESTAMP WHERE wallet = $1",
          [wallet]
        );
      }
    } catch (err) {
      // Ignore if column doesn't exist yet (migration will add it)
      if (!err.message?.includes("does not exist")) {
        console.error("Failed to update last_seen:", err.message);
      }
    }

    // Notify all clients that this user is online (including the user themselves)
    io.emit("user-online", { wallet });
  });

  // Heartbeat to keep connection alive
  socket.on("heartbeat", ({ wallet }) => {
    if (wallet && socket.data.wallet === wallet) {
      const userData = onlineUsers.get(wallet);
      if (userData) {
        userData.lastSeen = Date.now();
        // Update database last_seen periodically (every 5 heartbeats ~ 5 minutes)
        if (Math.random() < 0.2 && pool) {
          pool.query(
            "UPDATE profiles SET last_seen = CURRENT_TIMESTAMP WHERE wallet = $1",
            [wallet]
          ).catch((err) => {
            // Ignore if column doesn't exist yet
            if (!err.message?.includes("does not exist")) {
              console.error("Failed to update last_seen:", err.message);
            }
          });
        }
      }
    }
  });

  // Handle explicit logout
  socket.on("logout", ({ wallet }) => {
    if (!wallet || typeof wallet !== "string") return;
    
    const userData = onlineUsers.get(wallet);
    if (userData && userData.socketId === socket.id) {
      onlineUsers.delete(wallet);
      console.log(`User logged out: ${wallet}`);
      // Notify all clients (including the logging out user)
      io.emit("user-offline", { wallet });
    }
  });

  // Handle disconnection (network/socket disconnect)
  socket.on("disconnect", () => {
    const wallet = socket.data.wallet;
    if (wallet) {
      const userData = onlineUsers.get(wallet);
      if (userData && userData.socketId === socket.id) {
        onlineUsers.delete(wallet);
        console.log(`User offline (disconnected): ${wallet}`);
        // Notify all clients (including the disconnecting user)
        io.emit("user-offline", { wallet });
      }
    }
  });

  // Handle joining conversation room for real-time chat (user-to-user)
  socket.on("join-conversation", ({ otherWallet }) => {
    if (otherWallet && typeof otherWallet === "string" && socket.data.wallet) {
      // Create a consistent room name by sorting wallets alphabetically
      const wallets = [socket.data.wallet, otherWallet].sort();
      const roomName = `conversation:${wallets[0]}:${wallets[1]}`;
      socket.join(roomName);
      console.log(`Socket ${socket.id} (${socket.data.wallet}) joined conversation room with ${otherWallet}`);
    }
  });

  // Handle leaving conversation room
  socket.on("leave-conversation", ({ otherWallet }) => {
    if (otherWallet && typeof otherWallet === "string" && socket.data.wallet) {
      const wallets = [socket.data.wallet, otherWallet].sort();
      const roomName = `conversation:${wallets[0]}:${wallets[1]}`;
      socket.leave(roomName);
      console.log(`Socket ${socket.id} left conversation room with ${otherWallet}`);
    }
  });
});

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
    // Try to select with last_seen, fallback to without if column doesn't exist
    let result;
    try {
      result = await pool.query("SELECT wallet, username, avatar, bio, updated_at, last_seen FROM profiles WHERE wallet = $1", [wallet]);
    } catch (err) {
      if (err.message?.includes("does not exist")) {
        // Column doesn't exist yet, select without it
        result = await pool.query("SELECT wallet, username, avatar, bio, updated_at FROM profiles WHERE wallet = $1", [wallet]);
      } else {
        throw err;
      }
    }
    const p = result.rows[0];
    const isOnline = onlineUsers.has(wallet);
    return res.json(p ? { 
      username: p.username, 
      avatar: p.avatar, 
      bio: p.bio, 
      wallet: p.wallet, 
      updatedAt: p.updated_at,
      lastSeen: p.last_seen || null,
      isOnline
    } : { wallet, isOnline });
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

// GET /api/offers/:offerId – off-chain offer details (price, limits, payment method). Contract stores only trustless data.
app.get("/api/offers/:offerId", async (req, res) => {
  const offerId = req.params.offerId?.trim();
  if (!offerId) return res.status(400).json({ error: "Missing offerId" });
  try {
    const result = await pool.query(
      "SELECT offer_id, creator, amount, side, price, min_amount, max_amount, payment_method, fiat_currency, created_at FROM offer_details WHERE offer_id = $1",
      [offerId]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: "Offer not found" });
    return res.json({
      offerId: row.offer_id,
      creator: row.creator,
      amount: Number(row.amount),
      side: row.side,
      price: Number(row.price),
      minAmount: Number(row.min_amount),
      maxAmount: Number(row.max_amount),
      paymentMethod: row.payment_method,
      fiatCurrency: row.fiat_currency,
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error("GET /api/offers/:offerId", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// PUT /api/offers – upsert off-chain offer details (call before or after create-offer on chain)
app.put("/api/offers", async (req, res) => {
  const { offerId, creator, amount, side, price, minAmount, maxAmount, paymentMethod, fiatCurrency } = req.body ?? {};
  if (!offerId || typeof offerId !== "string") return res.status(400).json({ error: "Missing offerId" });
  if (!creator || typeof creator !== "string") return res.status(400).json({ error: "Missing creator" });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "Invalid amount" });
  if (side !== "BUY" && side !== "SELL") return res.status(400).json({ error: "Invalid side" });
  const pr = Number(price);
  if (!Number.isFinite(pr) || pr <= 0) return res.status(400).json({ error: "Invalid price" });
  const minA = Number(minAmount);
  const maxA = Number(maxAmount);
  if (!Number.isFinite(minA) || minA <= 0 || !Number.isFinite(maxA) || maxA < minA) {
    return res.status(400).json({ error: "Invalid minAmount/maxAmount" });
  }
  const pm = typeof paymentMethod === "string" ? paymentMethod : "[]";
  const fc = typeof fiatCurrency === "string" ? fiatCurrency.trim().slice(0, 10) : "USD";
  try {
    await pool.query(
      `INSERT INTO offer_details (offer_id, creator, amount, side, price, min_amount, max_amount, payment_method, fiat_currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (offer_id) DO UPDATE SET
         creator = EXCLUDED.creator, amount = EXCLUDED.amount, side = EXCLUDED.side,
         price = EXCLUDED.price, min_amount = EXCLUDED.min_amount, max_amount = EXCLUDED.max_amount,
         payment_method = EXCLUDED.payment_method, fiat_currency = EXCLUDED.fiat_currency`,
      [offerId.trim(), creator.trim(), amt, side, pr, minA, maxA, pm, fc]
    );
    return res.json({ ok: true, offerId: offerId.trim() });
  } catch (err) {
    console.error("PUT /api/offers", err);
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
      const isOnline = onlineUsers.has(p.wallet);
      out[p.wallet] = { 
        username: p.username, 
        avatar: p.avatar, 
        wallet: p.wallet,
        isOnline 
      };
    }
    // Also include online status for wallets not in profiles
    for (const wallet of list) {
      if (!out[wallet] && onlineUsers.has(wallet)) {
        out[wallet] = { wallet, isOnline: true };
      }
    }
    return res.json(out);
  } catch (err) {
    console.error("POST /api/profiles/bulk", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// GET /api/profiles/:wallet/status – get online status of a user
app.get("/api/profiles/:wallet/status", async (req, res) => {
  const wallet = req.params.wallet?.trim();
  if (!wallet) {
    return res.status(400).json({ error: "Missing wallet" });
  }
  const isOnline = onlineUsers.has(wallet);
  return res.json({ wallet, isOnline });
});

// POST /api/profiles/status/bulk – body: { wallets: string[] }; returns { [wallet]: { isOnline: boolean } }
app.post("/api/profiles/status/bulk", async (req, res) => {
  const { wallets } = req.body ?? {};
  if (!Array.isArray(wallets)) {
    return res.status(400).json({ error: "wallets must be an array" });
  }
  const list = wallets.filter((w) => typeof w === "string").map((w) => w.trim()).filter(Boolean);
  const out = {};
  for (const wallet of list) {
    out[wallet] = { isOnline: onlineUsers.has(wallet) };
  }
  return res.json(out);
});

/* ============================================================
   USER MESSAGES API (User-to-user conversations, not tied to specific offers)
   NOTE: Defined before DISPUTE API to avoid route conflicts
============================================================ */

// POST /api/messages – send a message to another user (user-to-user conversation)
// Body: { toWallet, message, wallet, publicKey, signedCmd, contextOfferId? }
app.post("/api/messages", async (req, res) => {
  const { message, toWallet, wallet, publicKey, signedCmd, contextOfferId } = req.body ?? {};
  
  console.log(`[POST /api/messages] from: ${wallet}, to: ${toWallet}, contextOfferId: ${contextOfferId}`);
  
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message is required" });
  }
  if (!toWallet || typeof toWallet !== "string") {
    return res.status(400).json({ error: "Missing toWallet" });
  }
  if (!wallet || typeof wallet !== "string") {
    return res.status(400).json({ error: "Missing wallet" });
  }
  if (wallet === toWallet) {
    return res.status(400).json({ error: "Cannot send message to yourself" });
  }
  
  const v = verifyProfileAuth(signedCmd, wallet, publicKey);
  if (!v.ok) {
    return res.status(403).json({ error: "Proof of ownership failed", reason: v.reason });
  }
  
  try {
    // Ensure pool is initialized
    if (!pool) {
      console.error("Database pool not initialized");
      return res.status(500).json({ error: "Database not initialized" });
    }
    
    // Try user_messages first, fallback to offer_messages if table doesn't exist
    let result;
    try {
      result = await pool.query(
        `INSERT INTO user_messages (from_wallet, to_wallet, message, context_offer_id, created_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, from_wallet, to_wallet, message, created_at, read_at, context_offer_id`,
        [wallet, toWallet, message.trim().slice(0, 2000), contextOfferId || null, new Date().toISOString()]
      );
    } catch (tableErr) {
      // If user_messages table doesn't exist, use offer_messages (backwards compatibility)
      if (tableErr.message?.includes("does not exist") || tableErr.message?.includes("relation") && tableErr.message?.includes("does not exist")) {
        console.log("user_messages table not found, using offer_messages");
        result = await pool.query(
          `INSERT INTO offer_messages (offer_id, from_wallet, to_wallet, message, created_at)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, offer_id, from_wallet, to_wallet, message, created_at, read_at`,
          [contextOfferId || 'general', wallet, toWallet, message.trim().slice(0, 2000), new Date().toISOString()]
        );
      } else {
        throw tableErr;
      }
    }
    
    const msg = result.rows[0];
    
    // Emit real-time message via WebSocket to both users
    const messageData = {
      id: msg.id,
      from: msg.from_wallet || msg.from_wallet,
      to: msg.to_wallet || msg.to_wallet,
      message: msg.message,
      createdAt: msg.created_at,
      readAt: msg.read_at || null,
      contextOfferId: msg.context_offer_id || msg.offer_id || null,
    };
    
    // Send to conversation room (both users)
    const wallets = [wallet, toWallet].sort();
    const roomName = `conversation:${wallets[0]}:${wallets[1]}`;
    io.to(roomName).emit("new-message", messageData);
    
    // Also send directly to both users if they're online (even if not in room)
    const senderSocket = Array.from(io.sockets.sockets.values()).find(
      (s) => s.data.wallet === wallet
    );
    if (senderSocket) {
      senderSocket.emit("new-message", messageData);
    }
    
    const recipientSocket = Array.from(io.sockets.sockets.values()).find(
      (s) => s.data.wallet === toWallet
    );
    if (recipientSocket) {
      recipientSocket.emit("new-message", messageData);
    }
    
    return res.json({
      id: msg.id,
      from: msg.from_wallet || msg.from_wallet,
      to: msg.to_wallet || msg.to_wallet,
      message: msg.message,
      createdAt: msg.created_at,
      readAt: msg.read_at || null,
      contextOfferId: msg.context_offer_id || msg.offer_id || null,
    });
  } catch (err) {
    console.error("POST /api/messages", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// GET /api/messages/:otherWallet – get all messages between current user and another user
// Query: ?wallet=<currentUserWallet>
app.get("/api/messages/:otherWallet", async (req, res) => {
  const otherWallet = req.params.otherWallet?.trim();
  const wallet = req.query.wallet?.toString();
  
  console.log(`[GET /api/messages/:otherWallet] wallet: ${wallet}, otherWallet: ${otherWallet}`);
  
  if (!otherWallet) {
    return res.status(400).json({ error: "Missing otherWallet" });
  }
  if (!wallet) {
    return res.status(400).json({ error: "Missing wallet parameter" });
  }
  
  try {
    // Ensure pool is initialized
    if (!pool) {
      console.error("Database pool not initialized");
      return res.status(500).json({ error: "Database not initialized" });
    }
    
    // Try user_messages first, fallback to offer_messages
    let result;
    try {
      result = await pool.query(
        `SELECT id, from_wallet, to_wallet, message, created_at, read_at, context_offer_id
         FROM user_messages
         WHERE (from_wallet = $1 AND to_wallet = $2) OR (from_wallet = $2 AND to_wallet = $1)
         ORDER BY created_at ASC`,
        [wallet, otherWallet]
      );
    } catch (tableErr) {
      // If user_messages table doesn't exist, use offer_messages
      if (tableErr.message?.includes("does not exist") || tableErr.message?.includes("relation") && tableErr.message?.includes("does not exist")) {
        console.log("user_messages table not found, using offer_messages");
        result = await pool.query(
          `SELECT id, offer_id, from_wallet, to_wallet, message, created_at, read_at
           FROM offer_messages
           WHERE (from_wallet = $1 AND to_wallet = $2) OR (from_wallet = $2 AND to_wallet = $1)
           ORDER BY created_at ASC`,
          [wallet, otherWallet]
        );
      } else {
        throw tableErr;
      }
    }
    
    const messages = result.rows.map(row => ({
      id: row.id,
      from: row.from_wallet,
      to: row.to_wallet,
      message: row.message,
      createdAt: row.created_at,
      readAt: row.read_at || null,
      contextOfferId: row.context_offer_id || row.offer_id || null,
    }));
    
    console.log(`[GET /api/messages/:otherWallet] Returning ${messages.length} messages`);
    return res.json(messages);
  } catch (err) {
    console.error("GET /api/messages/:otherWallet", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// PUT /api/messages/:messageId/read – mark message as read
app.put("/api/messages/:messageId/read", async (req, res) => {
  const messageId = parseInt(req.params.messageId);
  const { wallet, publicKey, signedCmd } = req.body ?? {};
  
  if (!messageId || isNaN(messageId)) {
    return res.status(400).json({ error: "Invalid messageId" });
  }
  if (!wallet || typeof wallet !== "string") {
    return res.status(400).json({ error: "Missing wallet" });
  }
  
  const v = verifyProfileAuth(signedCmd, wallet, publicKey);
  if (!v.ok) {
    return res.status(403).json({ error: "Proof of ownership failed", reason: v.reason });
  }
  
  try {
    // Try user_messages first, fallback to offer_messages
    let result;
    try {
      result = await pool.query(
        `UPDATE user_messages
         SET read_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND to_wallet = $2 AND read_at IS NULL
         RETURNING id, read_at`,
        [messageId, wallet]
      );
    } catch (tableErr) {
      if (tableErr.message?.includes("does not exist") || tableErr.message?.includes("relation") && tableErr.message?.includes("does not exist")) {
        result = await pool.query(
          `UPDATE offer_messages
           SET read_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND to_wallet = $2 AND read_at IS NULL
           RETURNING id, read_at`,
          [messageId, wallet]
        );
      } else {
        throw tableErr;
      }
    }
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Message not found or already read" });
    }
    
    return res.json({ id: result.rows[0].id, readAt: result.rows[0].read_at });
  } catch (err) {
    console.error("PUT /api/messages/:messageId/read", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// GET /api/messages/unread-count – get unread message count for a wallet
app.get("/api/messages/unread-count", async (req, res) => {
  const wallet = req.query.wallet?.toString();
  
  if (!wallet) {
    return res.status(400).json({ error: "Missing wallet parameter" });
  }
  
  try {
    // Try user_messages first, fallback to offer_messages
    let result;
    try {
      result = await pool.query(
        `SELECT COUNT(*) as count
         FROM user_messages
         WHERE to_wallet = $1 AND read_at IS NULL`,
        [wallet]
      );
    } catch (tableErr) {
      if (tableErr.message?.includes("does not exist") || tableErr.message?.includes("relation") && tableErr.message?.includes("does not exist")) {
        result = await pool.query(
          `SELECT COUNT(*) as count
           FROM offer_messages
           WHERE to_wallet = $1 AND read_at IS NULL`,
          [wallet]
        );
      } else {
        throw tableErr;
      }
    }
    
    return res.json({ unreadCount: parseInt(result.rows[0].count) || 0 });
  } catch (err) {
    console.error("GET /api/messages/unread-count", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// Legacy endpoint: POST /api/offers/:offerId/messages (for backwards compatibility)
// Redirects to POST /api/messages with contextOfferId
app.post("/api/offers/:offerId/messages", async (req, res) => {
  const offerId = req.params.offerId?.trim();
  req.body.contextOfferId = offerId;
  // Forward to the new endpoint
  return app._router.handle({ ...req, url: "/api/messages", path: "/api/messages" }, res);
});

// Legacy endpoint: GET /api/offers/:offerId/messages (for backwards compatibility)
// Gets messages between buyer and seller of the offer
app.get("/api/offers/:offerId/messages", async (req, res) => {
  const offerId = req.params.offerId?.trim();
  const wallet = req.query.wallet?.toString();
  
  if (!offerId || !wallet) {
    return res.status(400).json({ error: "Missing offerId or wallet" });
  }
  
  // We need to find the other wallet from the offer
  // For now, we'll get all messages for this user and filter by context
  // In a real implementation, you'd query the escrow contract to get buyer/seller
  try {
    const result = await pool.query(
      `SELECT DISTINCT 
         CASE WHEN from_wallet = $1 THEN to_wallet ELSE from_wallet END as other_wallet
       FROM user_messages
       WHERE (from_wallet = $1 OR to_wallet = $1) AND context_offer_id = $2
       LIMIT 1`,
      [wallet, offerId]
    ).catch(() => ({ rows: [] }));
    
    if (result.rows.length === 0) {
      // Fallback: try to get from offer_messages
      const fallback = await pool.query(
        `SELECT DISTINCT 
           CASE WHEN from_wallet = $1 THEN to_wallet ELSE from_wallet END as other_wallet
         FROM offer_messages
         WHERE (from_wallet = $1 OR to_wallet = $1) AND offer_id = $2
         LIMIT 1`,
        [wallet, offerId]
      ).catch(() => ({ rows: [] }));
      
      if (fallback.rows.length === 0) {
        return res.json([]);
      }
      
      const otherWallet = fallback.rows[0].other_wallet;
      req.params.otherWallet = otherWallet;
      return app._router.handle({ ...req, url: `/api/messages/${otherWallet}?wallet=${wallet}`, path: `/api/messages/${otherWallet}` }, res);
    }
    
    const otherWallet = result.rows[0].other_wallet;
    req.params.otherWallet = otherWallet;
    return app._router.handle({ ...req, url: `/api/messages/${otherWallet}?wallet=${wallet}`, path: `/api/messages/${otherWallet}` }, res);
  } catch (err) {
    console.error("GET /api/offers/:offerId/messages (legacy)", err);
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

// GET /api/disputes – list all disputes (for admin/arbiter panel). Query: ?status=OPEN|UNDER_REVIEW|CLOSED
app.get("/api/disputes", async (req, res) => {
  const statusFilter = req.query.status?.toString()?.toUpperCase();
  const validStatuses = ["OPEN", "UNDER_REVIEW", "CLOSED"];
  const status = statusFilter && validStatuses.includes(statusFilter) ? statusFilter : null;
  try {
    let result;
    try {
      result = await pool.query(
        `SELECT id, offer_id, opened_by, reason, opened_by_wallet, status, triggered_by_timeout, created_at, updated_at
         FROM disputes ${status ? "WHERE status = $1" : ""} ORDER BY created_at DESC`,
        status ? [status] : []
      );
    } catch (e) {
      if (e.message?.includes("triggered_by_timeout")) {
        result = await pool.query(
          `SELECT id, offer_id, opened_by, reason, opened_by_wallet, status, created_at, updated_at
           FROM disputes ${status ? "WHERE status = $1" : ""} ORDER BY created_at DESC`,
          status ? [status] : []
        );
        result.rows = result.rows.map((r) => ({ ...r, triggered_by_timeout: false }));
      } else throw e;
    }
    const list = result.rows.map((r) => ({
      id: r.id,
      offerId: r.offer_id,
      openedBy: r.opened_by,
      reason: r.reason || null,
      openedByWallet: r.opened_by_wallet,
      status: r.status,
      triggeredByTimeout: !!r.triggered_by_timeout,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    return res.json(list);
  } catch (err) {
    console.error("GET /api/disputes", err);
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
    let result;
    try {
      result = await pool.query(
        "SELECT id, offer_id, opened_by, reason, opened_by_wallet, status, triggered_by_timeout, created_at, updated_at FROM disputes WHERE offer_id = $1",
        [offerId]
      );
    } catch (e) {
      if (e.message?.includes("triggered_by_timeout")) {
        result = await pool.query(
          "SELECT id, offer_id, opened_by, reason, opened_by_wallet, status, created_at, updated_at FROM disputes WHERE offer_id = $1",
          [offerId]
        );
        if (result.rows[0]) result.rows[0].triggered_by_timeout = false;
      } else throw e;
    }
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
      triggeredByTimeout: !!dispute.triggered_by_timeout,
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
  console.log(`[GET /api/disputes/:offerId/messages] Matched! offerId: ${offerId}, path: ${req.path}`);
  if (!offerId) {
    return res.status(400).json({ error: "Missing offerId" });
  }
  try {
    const disputeResult = await pool.query("SELECT id FROM disputes WHERE offer_id = $1", [offerId]);
    if (disputeResult.rows.length === 0) {
      console.log(`[GET /api/disputes/:offerId/messages] Dispute not found for offerId: ${offerId}`);
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

// GET /api/disputes/:offerId/actions – action log for admin (request_info, under_review, resolved)
app.get("/api/disputes/:offerId/actions", async (req, res) => {
  const offerId = req.params.offerId?.trim();
  if (!offerId) return res.status(400).json({ error: "Missing offerId" });
  try {
    const result = await pool.query(
      "SELECT id, offer_id, action_type, by_wallet, payload, created_at FROM dispute_actions WHERE offer_id = $1 ORDER BY created_at ASC",
      [offerId]
    ).catch((e) => {
      if (e.message?.includes("dispute_actions")) return { rows: [] };
      throw e;
    });
    const actions = result.rows.map((r) => ({
      id: r.id,
      offerId: r.offer_id,
      actionType: r.action_type,
      byWallet: r.by_wallet,
      payload: r.payload || null,
      createdAt: r.created_at,
    }));
    return res.json(actions);
  } catch (err) {
    console.error("GET /api/disputes/:offerId/actions", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// PUT /api/disputes/:offerId/review – arbiter marks dispute under review. Body: { wallet, publicKey, signedCmd }
app.put("/api/disputes/:offerId/review", async (req, res) => {
  const offerId = req.params.offerId?.trim();
  const { wallet, publicKey, signedCmd } = req.body ?? {};
  if (!offerId) return res.status(400).json({ error: "Missing offerId" });
  if (!wallet || typeof wallet !== "string") return res.status(400).json({ error: "Missing wallet" });
  const v = verifyProfileAuth(signedCmd, wallet, publicKey);
  if (!v.ok) return res.status(403).json({ error: "Proof of ownership failed", reason: v.reason });
  try {
    const disputeResult = await pool.query("SELECT status FROM disputes WHERE offer_id = $1", [offerId]);
    if (disputeResult.rows.length === 0) return res.status(404).json({ error: "Dispute not found" });
    const dispute = disputeResult.rows[0];
    if (dispute.status !== "OPEN" && dispute.status !== "UNDER_REVIEW") {
      return res.status(400).json({ error: "Dispute is already closed" });
    }
    await pool.query(
      "UPDATE disputes SET status = $1, updated_at = $2 WHERE offer_id = $3",
      ["UNDER_REVIEW", new Date().toISOString(), offerId]
    );
    await pool.query(
      "INSERT INTO dispute_actions (offer_id, action_type, by_wallet, payload) VALUES ($1, $2, $3, $4)",
      [offerId, "under_review", wallet.trim(), JSON.stringify({ at: new Date().toISOString() })]
    ).catch(() => {});
    return res.json({ success: true, status: "UNDER_REVIEW" });
  } catch (err) {
    console.error("PUT /api/disputes/:offerId/review", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// POST /api/disputes/:offerId/request-info – arbiter requests more info. Body: { message?, wallet, publicKey, signedCmd }
app.post("/api/disputes/:offerId/request-info", async (req, res) => {
  const offerId = req.params.offerId?.trim();
  const { message, wallet, publicKey, signedCmd } = req.body ?? {};
  if (!offerId) return res.status(400).json({ error: "Missing offerId" });
  if (!wallet || typeof wallet !== "string") return res.status(400).json({ error: "Missing wallet" });
  const v = verifyProfileAuth(signedCmd, wallet, publicKey);
  if (!v.ok) return res.status(403).json({ error: "Proof of ownership failed", reason: v.reason });
  try {
    const disputeResult = await pool.query("SELECT id FROM disputes WHERE offer_id = $1", [offerId]);
    if (disputeResult.rows.length === 0) return res.status(404).json({ error: "Dispute not found" });
    const msg = typeof message === "string" ? message.trim().slice(0, 1000) : null;
    await pool.query(
      "INSERT INTO dispute_actions (offer_id, action_type, by_wallet, payload) VALUES ($1, $2, $3, $4)",
      [offerId, "request_info", wallet.trim(), JSON.stringify({ message: msg || "Arbiter requested more information.", at: new Date().toISOString() })]
    ).catch(() => {});
    if (msg) {
      await pool.query(
        "INSERT INTO dispute_messages (offer_id, from_wallet, message) VALUES ($1, $2, $3)",
        [offerId, wallet.trim(), `[Arbiter] ${msg}`]
      );
      await pool.query("UPDATE disputes SET updated_at = $1 WHERE offer_id = $2", [new Date().toISOString(), offerId]);
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("POST /api/disputes/:offerId/request-info", err);
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
    if (dispute.status !== "OPEN" && dispute.status !== "UNDER_REVIEW") {
      return res.status(400).json({ error: "Dispute is already closed" });
    }
    await pool.query(
      "UPDATE disputes SET status = $1, updated_at = $2 WHERE offer_id = $3",
      ["CLOSED", new Date().toISOString(), offerId]
    );
    await pool.query(
      "INSERT INTO dispute_actions (offer_id, action_type, by_wallet, payload) VALUES ($1, $2, $3, $4)",
      [offerId, "resolved", wallet.trim(), JSON.stringify({ at: new Date().toISOString() })]
    ).catch(() => {});
    return res.json({ success: true, status: "CLOSED" });
  } catch (err) {
    console.error("PUT /api/disputes/:offerId/close", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

/* ============================================================
   RATINGS & REPUTATION ENFORCEMENT
   - Only allow rating after a completed trade (completed_offers).
   - One rating per party per trade: UNIQUE(offer_id, rater_wallet).
   - No self-rating: ratedWallet must be the counterparty.
   - Expose: trade counts, completion counts, dispute counts, rating aggregates
     (GET summary, bulk summary, and per-trade ratings for UI/integrity).
============================================================ */

// POST /api/completed-offers – register a completed trade (buyer or seller). Body: { offerId, buyerWallet, sellerWallet, wallet, publicKey, signedCmd }
app.post("/api/completed-offers", async (req, res) => {
  const { offerId, buyerWallet, sellerWallet, wallet, publicKey, signedCmd } = req.body ?? {};
  if (!offerId || typeof offerId !== "string") {
    return res.status(400).json({ error: "Missing offerId" });
  }
  if (!buyerWallet || typeof buyerWallet !== "string" || !sellerWallet || typeof sellerWallet !== "string") {
    return res.status(400).json({ error: "Missing buyerWallet or sellerWallet" });
  }
  if (!wallet || typeof wallet !== "string") {
    return res.status(400).json({ error: "Missing wallet" });
  }
  const v = verifyProfileAuth(signedCmd, wallet, publicKey);
  if (!v.ok) {
    return res.status(403).json({ error: "Proof of ownership failed", reason: v.reason });
  }
  if (wallet !== buyerWallet && wallet !== sellerWallet) {
    return res.status(403).json({ error: "Wallet must be buyer or seller for this offer" });
  }
  try {
    await pool.query(
      `INSERT INTO completed_offers (offer_id, buyer_wallet, seller_wallet)
       VALUES ($1, $2, $3)
       ON CONFLICT (offer_id) DO NOTHING`,
      [offerId.trim(), buyerWallet.trim(), sellerWallet.trim()]
    );
    return res.json({ ok: true, offerId: offerId.trim() });
  } catch (err) {
    console.error("POST /api/completed-offers", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// POST /api/ratings – submit a rating (enforcement: completed trade only, one per party, no self-rating)
app.post("/api/ratings", async (req, res) => {
  const { offerId, ratedWallet, rating, comment, wallet, publicKey, signedCmd } = req.body ?? {};
  if (!offerId || typeof offerId !== "string") {
    return res.status(400).json({ error: "Missing offerId" });
  }
  if (!ratedWallet || typeof ratedWallet !== "string") {
    return res.status(400).json({ error: "Missing ratedWallet" });
  }
  const r = Number(rating);
  if (!Number.isFinite(r) || r < 1 || r > 5) {
    return res.status(400).json({ error: "rating must be 1–5" });
  }
  if (!wallet || typeof wallet !== "string") {
    return res.status(400).json({ error: "Missing wallet" });
  }
  const v = verifyProfileAuth(signedCmd, wallet, publicKey);
  if (!v.ok) {
    return res.status(403).json({ error: "Proof of ownership failed", reason: v.reason });
  }
  try {
    // Enforcement: only allow rating after a completed trade
    const row = await pool.query(
      "SELECT buyer_wallet, seller_wallet FROM completed_offers WHERE offer_id = $1",
      [offerId.trim()]
    );
    if (row.rows.length === 0) {
      return res.status(400).json({ error: "Offer not found as completed; complete the trade first" });
    }
    const { buyer_wallet, seller_wallet } = row.rows[0];
    if (wallet !== buyer_wallet && wallet !== seller_wallet) {
      return res.status(403).json({ error: "Only buyer or seller can rate this trade" });
    }
    if (ratedWallet !== buyer_wallet && ratedWallet !== seller_wallet) {
      return res.status(400).json({ error: "ratedWallet must be the other party (buyer or seller)" });
    }
    // Enforcement: no self-rating
    if (ratedWallet === wallet) {
      return res.status(400).json({ error: "Cannot rate yourself" });
    }
    const commentTrim = typeof comment === "string" ? comment.trim().slice(0, 500) : null;
    await pool.query(
      `INSERT INTO ratings (offer_id, rater_wallet, rated_wallet, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (offer_id, rater_wallet) DO UPDATE SET rating = $4, comment = $5, created_at = CURRENT_TIMESTAMP`,
      [offerId.trim(), wallet.trim(), ratedWallet.trim(), Math.round(r), commentTrim]
    );
    return res.json({ ok: true, offerId: offerId.trim() });
  } catch (err) {
    console.error("POST /api/ratings", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// GET /api/ratings/trade/:offerId – per-trade ratings for UI/integrity (trade counts, who rated whom)
app.get("/api/ratings/trade/:offerId", async (req, res) => {
  const offerId = req.params.offerId?.trim();
  if (!offerId) {
    return res.status(400).json({ error: "Missing offerId" });
  }
  try {
    const completed = await pool.query(
      "SELECT offer_id, buyer_wallet, seller_wallet, completed_at FROM completed_offers WHERE offer_id = $1",
      [offerId]
    );
    const trade = completed.rows[0] || null;
    const ratingsResult = await pool.query(
      "SELECT rater_wallet, rated_wallet, rating, comment, created_at FROM ratings WHERE offer_id = $1 ORDER BY created_at",
      [offerId]
    );
    const ratings = ratingsResult.rows.map((r) => ({
      raterWallet: r.rater_wallet,
      ratedWallet: r.rated_wallet,
      rating: r.rating,
      comment: r.comment || null,
      createdAt: r.created_at,
    }));
    return res.json({
      offerId,
      trade: trade ? { buyerWallet: trade.buyer_wallet, sellerWallet: trade.seller_wallet, completedAt: trade.completed_at } : null,
      ratings,
      ratingCount: ratings.length,
    });
  } catch (err) {
    console.error("GET /api/ratings/trade/:offerId", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// GET /api/ratings/summary/:wallet – UI/hybrid: trade counts, completion counts, dispute counts, rating aggregates
app.get("/api/ratings/summary/:wallet", async (req, res) => {
  const wallet = req.params.wallet?.trim();
  if (!wallet) {
    return res.status(400).json({ error: "Missing wallet" });
  }
  try {
    const completed = await pool.query(
      "SELECT COUNT(*) AS cnt FROM completed_offers WHERE buyer_wallet = $1 OR seller_wallet = $1",
      [wallet]
    );
    const completedTrades = parseInt(completed.rows[0]?.cnt ?? "0", 10);

    const disputed = await pool.query(
      `SELECT COUNT(DISTINCT d.id) AS cnt
       FROM disputes d
       INNER JOIN completed_offers c ON c.offer_id = d.offer_id
       WHERE c.buyer_wallet = $1 OR c.seller_wallet = $1`,
      [wallet]
    );
    const disputedCount = parseInt(disputed.rows[0]?.cnt ?? "0", 10);

    // Completion rate: share of completed trades that had no dispute
    const completionRate = completedTrades > 0
      ? Math.max(0, (completedTrades - disputedCount) / completedTrades)
      : 1;

    const agg = await pool.query(
      "SELECT COALESCE(AVG(rating), 0) AS avg_rating, COUNT(*) AS cnt FROM ratings WHERE rated_wallet = $1",
      [wallet]
    );
    const averageRating = parseFloat(agg.rows[0]?.avg_rating ?? "0");
    const totalRatings = parseInt(agg.rows[0]?.cnt ?? "0", 10);

    return res.json({
      averageRating: Math.round(averageRating * 10) / 10,
      totalRatings,
      completedTrades,
      disputedCount,
      completionRate: Math.round(completionRate * 100) / 100,
    });
  } catch (err) {
    console.error("GET /api/ratings/summary/:wallet", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// POST /api/ratings/summary/bulk – body: { wallets: string[] }; returns { [wallet]: { averageRating, totalRatings, completedTrades, disputedCount, completionRate } }
app.post("/api/ratings/summary/bulk", async (req, res) => {
  const { wallets } = req.body ?? {};
  if (!Array.isArray(wallets)) {
    return res.status(400).json({ error: "wallets must be an array" });
  }
  const list = wallets.filter((w) => typeof w === "string").map((w) => w.trim()).filter(Boolean);
  if (list.length === 0) return res.json({});
  try {
    const out = {};
    for (const w of list) {
      const completed = await pool.query(
        "SELECT COUNT(*) AS cnt FROM completed_offers WHERE buyer_wallet = $1 OR seller_wallet = $1",
        [w]
      );
      const completedTrades = parseInt(completed.rows[0]?.cnt ?? "0", 10);
      const disputed = await pool.query(
        `SELECT COUNT(DISTINCT d.id) AS cnt
         FROM disputes d
         INNER JOIN completed_offers c ON c.offer_id = d.offer_id
         WHERE c.buyer_wallet = $1 OR c.seller_wallet = $1`,
        [w]
      );
      const disputedCount = parseInt(disputed.rows[0]?.cnt ?? "0", 10);
      const completionRate = completedTrades > 0
        ? Math.max(0, (completedTrades - disputedCount) / completedTrades)
        : 1;
      const agg = await pool.query(
        "SELECT COALESCE(AVG(rating), 0) AS avg_rating, COUNT(*) AS cnt FROM ratings WHERE rated_wallet = $1",
        [w]
      );
      const averageRating = parseFloat(agg.rows[0]?.avg_rating ?? "0");
      const totalRatings = parseInt(agg.rows[0]?.cnt ?? "0", 10);
      out[w] = {
        averageRating: Math.round(averageRating * 10) / 10,
        totalRatings,
        completedTrades,
        disputedCount,
        completionRate: Math.round(completionRate * 100) / 100,
      };
    }
    return res.json(out);
  } catch (err) {
    console.error("POST /api/ratings/summary/bulk", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

// GET /api/ratings/check – query: offerId, wallet – returns { canRate: boolean, alreadyRated: boolean }
app.get("/api/ratings/check", async (req, res) => {
  const offerId = req.query.offerId?.trim();
  const wallet = req.query.wallet?.trim();
  if (!offerId || !wallet) {
    return res.status(400).json({ error: "Missing offerId or wallet" });
  }
  try {
    const completed = await pool.query(
      "SELECT 1 FROM completed_offers WHERE offer_id = $1 AND (buyer_wallet = $2 OR seller_wallet = $2)",
      [offerId, wallet]
    );
    if (completed.rows.length === 0) {
      return res.json({ canRate: false, alreadyRated: false });
    }
    const existing = await pool.query(
      "SELECT 1 FROM ratings WHERE offer_id = $1 AND rater_wallet = $2",
      [offerId, wallet]
    );
    return res.json({ canRate: true, alreadyRated: existing.rows.length > 0 });
  } catch (err) {
    console.error("GET /api/ratings/check", err);
    return res.status(500).json({ error: err.message || "Database error" });
  }
});

const PORT = Number(process.env.PORT) || 3001;

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
  
  // Ensure last_seen column exists (migration for existing databases)
  try {
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'profiles' AND column_name = 'last_seen'
    `);
    if (columnCheck.rows.length === 0) {
      console.log("  Adding last_seen column to profiles table...");
      await pool.query("ALTER TABLE profiles ADD COLUMN last_seen TIMESTAMP WITH TIME ZONE");
      console.log("  ✓ Added last_seen column");
    } else {
      console.log("  ⊙ last_seen column already exists");
    }
  } catch (err) {
    console.error("  ✗ Failed to add last_seen column:", err.message);
    // Don't throw - this is a migration, not critical for startup
  }

  // Ensure user_messages table exists (new user-to-user messaging system)
  try {
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'user_messages'
    `);
    if (tableCheck.rows.length === 0) {
      console.log("  Creating user_messages table...");
      await pool.query(`
        CREATE TABLE user_messages (
          id SERIAL PRIMARY KEY,
          from_wallet VARCHAR(255) NOT NULL,
          to_wallet VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          read_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          context_offer_id VARCHAR(255)
        )
      `);
      await pool.query(`CREATE INDEX idx_user_messages_from_wallet ON user_messages(from_wallet)`);
      await pool.query(`CREATE INDEX idx_user_messages_to_wallet ON user_messages(to_wallet)`);
      await pool.query(`CREATE INDEX idx_user_messages_created_at ON user_messages(created_at)`);
      await pool.query(`CREATE INDEX idx_user_messages_context_offer ON user_messages(context_offer_id)`);
      // Composite index for efficient conversation queries
      await pool.query(`
        CREATE INDEX idx_user_messages_conversation ON user_messages(
          LEAST(from_wallet, to_wallet), 
          GREATEST(from_wallet, to_wallet), 
          created_at
        )
      `);
      console.log("  ✓ Created user_messages table");
    } else {
      console.log("  ⊙ user_messages table already exists");
    }
  } catch (err) {
    console.error("  ✗ Failed to create user_messages table:", err.message);
    // Don't throw - this is a migration, not critical for startup
  }
  
  // Ensure offer_messages table exists (legacy, kept for backwards compatibility)
  try {
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'offer_messages'
    `);
    if (tableCheck.rows.length === 0) {
      console.log("  Creating offer_messages table (legacy)...");
      await pool.query(`
        CREATE TABLE offer_messages (
          id SERIAL PRIMARY KEY,
          offer_id VARCHAR(255) NOT NULL,
          from_wallet VARCHAR(255) NOT NULL,
          to_wallet VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          read_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query(`CREATE INDEX idx_offer_messages_offer_id ON offer_messages(offer_id)`);
      await pool.query(`CREATE INDEX idx_offer_messages_from_wallet ON offer_messages(from_wallet)`);
      await pool.query(`CREATE INDEX idx_offer_messages_to_wallet ON offer_messages(to_wallet)`);
      await pool.query(`CREATE INDEX idx_offer_messages_created_at ON offer_messages(created_at)`);
      await pool.query(`CREATE INDEX idx_offer_messages_conversation ON offer_messages(offer_id, from_wallet, to_wallet)`);
      console.log("  ✓ Created offer_messages table (legacy)");
    } else {
      console.log("  ⊙ offer_messages table already exists");
    }
  } catch (err) {
    console.error("  ✗ Failed to create offer_messages table:", err.message);
    // Don't throw - this is a migration, not critical for startup
  }

  // Admin/Arbiter: dispute_actions table and disputes.triggered_by_timeout
  try {
    const tableCheck = await pool.query(`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'dispute_actions'
    `);
    if (tableCheck.rows.length === 0) {
      console.log("  Creating dispute_actions table...");
      await pool.query(`
        CREATE TABLE dispute_actions (
          id SERIAL PRIMARY KEY,
          offer_id VARCHAR(255) NOT NULL,
          action_type VARCHAR(30) NOT NULL CHECK (action_type IN ('request_info', 'under_review', 'resolved')),
          by_wallet VARCHAR(255) NOT NULL,
          payload JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query("CREATE INDEX idx_dispute_actions_offer_id ON dispute_actions(offer_id)");
      console.log("  ✓ Created dispute_actions table");
    } else {
      console.log("  ⊙ dispute_actions table already exists");
    }
  } catch (err) {
    console.error("  ✗ Failed to create dispute_actions table:", err.message);
  }
  try {
    const colCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'disputes' AND column_name = 'triggered_by_timeout'
    `);
    if (colCheck.rows.length === 0) {
      console.log("  Adding triggered_by_timeout to disputes...");
      await pool.query("ALTER TABLE disputes ADD COLUMN triggered_by_timeout BOOLEAN NOT NULL DEFAULT FALSE");
      console.log("  ✓ Added triggered_by_timeout");
    }
    // Allow UNDER_REVIEW in status (drop old check, add new)
    await pool.query(`
      ALTER TABLE disputes DROP CONSTRAINT IF EXISTS disputes_status_check
    `).catch(() => {});
    await pool.query(`
      ALTER TABLE disputes ADD CONSTRAINT disputes_status_check
      CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'CLOSED'))
    `).catch((e) => {
      if (!e.message?.includes("already exists")) console.warn("  Note: disputes status constraint:", e.message);
    });
  } catch (err) {
    console.error("  ✗ Disputes migration:", err.message);
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
    process.exit(1);
  }

  httpServer.listen(PORT, () => {
    console.log(`Profile API listening on http://localhost:${PORT}`);
    console.log(`WebSocket server ready for online status tracking`);
  });
}

// Graceful shutdown
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
