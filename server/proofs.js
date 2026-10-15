/**
 * Proof of payment: when the buyer presses Mark as Paid, they attach a screenshot and/or the transfer
 * reference (USDT transaction ID, Wise/Revolut reference). Kept with the trade, so the seller knows where
 * to look and the arbiter has it in a dispute.
 *
 * Who is who comes from the chain (see payout.js):
 *   - add: the payer, while the trade is ACCEPTED, FUNDED or PAID
 *   - read: the payer, the KDA holder and the arbiter, once the offer is accepted
 *
 *   POST /api/offers/:offerId/proof   multipart: file (optional image/PDF), reference (optional), wallet, publicKey, signedCmd
 *   GET  /api/offers/:offerId/proof   (wallet, publicKey, signedCmd in the query) -> [{ reference, fileUrl, fileName, at }]
 */
import fs from "fs";
import { readEscrowFromChain, sidesOf } from "./payout.js";

const ADD_STATES = ["ACCEPTED", "FUNDED", "PAID"];

export function cleanReference(r) {
  const s = String(r ?? "").replace(/[\r\n]+/g, " ").trim();
  return s.slice(0, 300);
}

export function registerProofRoutes(app, { getPool, requireAuth, sendAuthError, upload, isAllowedFile, readEscrow = readEscrowFromChain, onAdded = () => {} }) {
  const drop = (f) => { if (f) { try { fs.unlinkSync(f.path); } catch { /* ignore */ } } };
  const offerIdOk = (s) => typeof s === "string" && s.length > 0 && s.length <= 255;

  app.post("/api/offers/:offerId/proof", (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "File too large (max 5MB)" : err.message || "Upload error" });
      next();
    });
  }, async (req, res) => {
    const f = req.file;
    if (req.body && typeof req.body.signedCmd === "string" && req.body.signedCmd.startsWith("{")) {
      try { req.body.signedCmd = JSON.parse(req.body.signedCmd); } catch { /* checked below */ }
    }
    const auth = requireAuth(req, "body");
    if (!auth.ok) { drop(f); return sendAuthError(res, auth); }
    if (req.body?.wallet !== auth.wallet) { drop(f); return res.status(400).json({ error: "Wallet must match authenticated wallet" }); }
    const pool = getPool();
    if (!pool) { drop(f); return res.status(503).json({ error: "Database not ready" }); }
    const { offerId } = req.params;
    if (!offerIdOk(offerId)) { drop(f); return res.status(400).json({ error: "Invalid offer" }); }
    const reference = cleanReference(req.body?.reference);
    if (!f && !reference) return res.status(400).json({ error: "Add a screenshot of the payment or its transaction ID / reference" });
    if (f && isAllowedFile && !isAllowedFile(f.path, f.mimetype)) { drop(f); return res.status(400).json({ error: "Invalid file (content does not match its type)" }); }
    try {
      const e = await readEscrow(offerId);
      if (!e) { drop(f); return res.status(404).json({ error: "Offer not found" }); }
      const { payer, holder } = sidesOf(e);
      if (!payer || payer !== auth.wallet) { drop(f); return res.status(403).json({ error: "Only the buyer adds proof of payment" }); }
      if (!ADD_STATES.includes(e.state)) { drop(f); return res.status(409).json({ error: "This trade is no longer waiting for a payment" }); }
      const { rows } = await pool.query(
        `INSERT INTO payment_proofs (offer_id, wallet, reference, file_url, file_name) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
        [offerId, auth.wallet, reference || null, f ? `/uploads/chat/${f.filename}` : null, f ? String(f.originalname || "").slice(0, 200) : null]
      );
      try { onAdded({ offerId, id: rows[0].id, to: holder }); } catch { /* ignore */ }
      return res.json({ ok: true, id: rows[0].id });
    } catch (err) {
      drop(f);
      console.error("POST /api/offers/:offerId/proof", err);
      return res.status(502).json({ error: "Could not save the proof. Try again." });
    }
  });

  app.get("/api/offers/:offerId/proof", async (req, res) => {
    const auth = requireAuth(req, "query");
    if (!auth.ok) return sendAuthError(res, auth);
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: "Database not ready" });
    const { offerId } = req.params;
    if (!offerIdOk(offerId)) return res.status(400).json({ error: "Invalid offer" });
    try {
      const e = await readEscrow(offerId);
      if (!e) return res.status(404).json({ error: "Offer not found" });
      const { payer, holder } = sidesOf(e);
      const me = auth.wallet;
      const allowed = e.state !== "CREATED" && ((!!payer && me === payer) || (!!holder && me === holder) || me === e.arbiter);
      if (!allowed) return res.status(403).json({ error: "Only the two sides of the trade and the arbiter see the proof" });
      const { rows } = await pool.query(
        "SELECT reference, file_url, file_name, created_at FROM payment_proofs WHERE offer_id = $1 AND wallet = $2 ORDER BY created_at",
        [offerId, payer]
      );
      return res.json(rows.map((r) => ({ reference: r.reference, fileUrl: r.file_url, fileName: r.file_name, at: r.created_at })));
    } catch (err) {
      console.error("GET /api/offers/:offerId/proof", err);
      return res.status(502).json({ error: "Could not check the offer on the chain. Try again." });
    }
  });
}
