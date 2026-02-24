/**
 * Input validation for /api/* using zod.
 * Limits: message 1–2000, display name 1–60, bio 0–500, URL fields max 2048, wallet k: format.
 */

import { z } from "zod";

const MAX_URL = 2048;
const MAX_WALLET = 256;

export const walletSchema = z
  .string()
  .min(1, "Wallet is required")
  .max(MAX_WALLET, "Wallet too long")
  .refine((s) => s.startsWith("k:"), { message: "Wallet must be k: format" });

export const messageSchema = z
  .string()
  .min(1, "Message is required")
  .max(2000, "Message too long (max 2000 chars)");

export const displayNameSchema = z
  .string()
  .max(60, "Display name too long (max 60 chars)")
  .optional()
  .transform((s) => (s == null || s === "" ? undefined : s.trim()));

export const bioSchema = z
  .string()
  .max(500, "Bio too long (max 500 chars)")
  .optional()
  .nullable()
  .transform((s) => (s == null || s === "" ? null : s.trim()));

export const urlFieldSchema = z
  .string()
  .max(MAX_URL, "URL too long (max 2048 chars)")
  .optional()
  .nullable();

export const publicKeySchema = z.string().min(1, "Public key is required").max(512);
export const signedCmdSchema = z.union([z.record(z.unknown()), z.string()]);

export const profilePutBodySchema = z.object({
  username: displayNameSchema,
  avatar: urlFieldSchema,
  bio: bioSchema,
  wallet: walletSchema,
  publicKey: publicKeySchema,
  signedCmd: signedCmdSchema,
});

/** POST /api/profiles/upload-avatar body (after multer). */
export const profileUploadAvatarBodySchema = z.object({
  wallet: walletSchema,
  publicKey: publicKeySchema,
  signedCmd: signedCmdSchema,
});

export const messagesPostBodySchema = z.object({
  toWallet: walletSchema,
  message: messageSchema,
  wallet: walletSchema,
  publicKey: publicKeySchema,
  signedCmd: signedCmdSchema,
  contextOfferId: z.string().max(256).optional().nullable(),
}).refine((d) => d.wallet !== d.toWallet, { message: "Cannot send message to yourself", path: ["toWallet"] });

/** Same as above but message optional (when sending file attachment only). */
export const messagesPostBodySchemaWithFile = z.object({
  toWallet: walletSchema,
  message: z.string().max(2000).optional().default(""),
  wallet: walletSchema,
  publicKey: publicKeySchema,
  signedCmd: signedCmdSchema,
  contextOfferId: z.string().max(256).optional().nullable(),
}).refine((d) => d.wallet !== d.toWallet, { message: "Cannot send message to yourself", path: ["toWallet"] });

export const messagesReadQuerySchema = z.object({
  wallet: walletSchema,
  publicKey: publicKeySchema,
  signedCmd: z.union([z.string(), z.record(z.unknown())]),
});

export const messageIdReadBodySchema = z.object({
  wallet: walletSchema,
  publicKey: publicKeySchema,
  signedCmd: signedCmdSchema,
});

export const offerIdParamSchema = z.object({ offerId: z.string().min(1).max(256) });
export const walletParamSchema = z.object({ wallet: walletSchema });
export const otherWalletParamSchema = z.object({ otherWallet: walletSchema });
export const messageIdParamSchema = z.object({ messageId: z.string().regex(/^\d+$/).transform(Number) });

export const profilesBulkBodySchema = z.object({
  wallets: z.array(walletSchema).min(1).max(200),
});
export const profilesStatusBulkBodySchema = z.object({
  wallets: z.array(walletSchema).max(200),
});

export const offersPutBodySchema = z.object({
  offerId: z.string().min(1).max(256),
  creator: walletSchema,
  amount: z.coerce.number().finite().positive(),
  side: z.enum(["BUY", "SELL"]),
  price: z.coerce.number().finite().positive(),
  paymentMethod: z.string().optional(),
  fiatCurrency: z.string().max(10).optional(),
});

export const disputesPostBodySchema = z.object({
  offerId: z.string().min(1).max(256),
  openedBy: z.enum(["buyer", "seller"]),
  reason: z.string().max(1000).optional(),
  wallet: walletSchema,
  publicKey: publicKeySchema,
  signedCmd: signedCmdSchema,
});

export const disputeEvidenceBodySchema = z.object({
  explanation: z.string().max(2000).optional(),
  wallet: walletSchema,
  publicKey: publicKeySchema,
  signedCmd: signedCmdSchema,
});

export const disputeMessageBodySchema = z.object({
  message: z.string().min(1).max(2000),
  wallet: walletSchema,
  publicKey: publicKeySchema,
  signedCmd: signedCmdSchema,
});

export const disputeActionBodySchema = z.object({
  wallet: walletSchema,
  publicKey: publicKeySchema,
  signedCmd: signedCmdSchema,
  message: z.string().max(1000).optional(),
});

export const completedOffersBodySchema = z.object({
  offerId: z.string().min(1).max(256),
  buyerWallet: walletSchema,
  sellerWallet: walletSchema,
  wallet: walletSchema,
  publicKey: publicKeySchema,
  signedCmd: signedCmdSchema,
});

export const ratingsPostBodySchema = z.object({
  offerId: z.string().min(1).max(256),
  ratedWallet: walletSchema,
  rating: z.coerce.number().min(1).max(5),
  comment: z.string().max(500).optional().nullable(),
  wallet: walletSchema,
  publicKey: publicKeySchema,
  signedCmd: signedCmdSchema,
});

export const ratingsCheckQuerySchema = z.object({
  offerId: z.string().min(1).max(256),
  wallet: walletSchema,
});

/** GET /api/offers/:offerId/messages (legacy) query. */
export const offerMessagesLegacyQuerySchema = z.object({
  wallet: walletSchema,
});

export const ratingsSummaryBulkBodySchema = z.object({
  wallets: z.array(walletSchema).max(200),
});

/** Middleware: validate req.body and return 400 on failure. */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const msg = result.error.errors?.[0]?.message ?? "Validation failed";
      return res.status(400).json({ error: msg, details: result.error.flatten() });
    }
    req.body = result.data;
    next();
  };
}

/** Middleware: validate req.query and return 400 on failure. */
export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query ?? {});
    if (!result.success) {
      const msg = result.error.errors?.[0]?.message ?? "Validation failed";
      return res.status(400).json({ error: msg, details: result.error.flatten() });
    }
    req.query = result.data;
    next();
  };
}

/** Middleware: validate req.params and return 400 on failure. */
export function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params ?? {});
    if (!result.success) {
      const msg = result.error.errors?.[0]?.message ?? "Validation failed";
      return res.status(400).json({ error: msg, details: result.error.flatten() });
    }
    req.params = result.data;
    next();
  };
}
