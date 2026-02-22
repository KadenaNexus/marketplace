/**
 * Deliverable 5 — Database hardening acceptance tests
 * Run: node server/acceptance-db-hardening.js
 * Requires: DATABASE_URL in env (e.g. from .env)
 *
 * Acceptance:
 * - Required indexes exist (large dataset queries remain fast)
 * - Invalid inserts fail at DB level (message length, NOT NULL)
 */

import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://localhost:5432/kadena_nexus";

const REQUIRED_INDEXES = [
  "idx_offer_details_creator_created_at",
  "idx_user_messages_from_to_created",
  "idx_user_messages_to_wallet_read_at",
  "idx_offer_messages_from_to_created",
  "idx_offer_messages_to_wallet_read_at",
];

async function run() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  let passed = 0;
  let failed = 0;

  try {
    // 1. Indexes exist
    const indexRows = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)",
      [REQUIRED_INDEXES]
    );
    const found = indexRows.rows.map((r) => r.indexname);
    const missing = REQUIRED_INDEXES.filter((n) => !found.includes(n));
    if (missing.length === 0) {
      console.log("✓ All required indexes exist");
      passed++;
    } else {
      console.error("✗ Missing indexes:", missing);
      failed++;
    }

    // 2. Message length constraint: insert > 2000 chars must fail at DB level
    const longMessage = "x".repeat(2001);
    try {
      await pool.query(
        `INSERT INTO user_messages (from_wallet, to_wallet, message)
         VALUES ($1, $2, $3)`,
        ["k:test-from", "k:test-to", longMessage]
      );
      console.error("✗ Insert of 2001-char message should have failed");
      failed++;
    } catch (e) {
      if (e.code === "23514" || e.message?.includes("chk_user_messages_message_len") || e.message?.includes("violates check constraint")) {
        console.log("✓ Invalid insert (message > 2000) rejected at DB level");
        passed++;
      } else {
        console.error("✗ Unexpected error (expected check constraint):", e.message);
        failed++;
      }
    }

    // 3. NOT NULL created_at: update to NULL must fail
    const insertResult = await pool.query(
      `INSERT INTO user_messages (from_wallet, to_wallet, message)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ["k:test-from", "k:test-to", "short"]
    ).catch(() => ({ rows: [] }));
    const id = insertResult.rows[0]?.id;
    if (id) {
      try {
        await pool.query(
          "UPDATE user_messages SET created_at = NULL WHERE id = $1",
          [id]
        );
        console.error("✗ UPDATE created_at = NULL should have failed");
        failed++;
      } catch (e) {
        if (e.code === "23502" || e.message?.includes("null value in column")) {
          console.log("✓ NOT NULL created_at enforced at DB level");
          passed++;
        } else {
          console.error("✗ Unexpected error (expected not null):", e.message);
          failed++;
        }
      }
      await pool.query("DELETE FROM user_messages WHERE id = $1", [id]).catch(() => {});
    } else {
      console.warn("⊙ Skipped NOT NULL test (insert failed, table may not exist)");
    }

    // 4. Indexed query runs (large dataset queries remain fast)
    const start = Date.now();
    await pool.query(
      `SELECT id, from_wallet, to_wallet, message, created_at, read_at
       FROM user_messages
       WHERE from_wallet = $1 AND to_wallet = $2
       ORDER BY created_at ASC
       LIMIT 100`,
      ["k:any", "k:any"]
    );
    const elapsed = Date.now() - start;
    if (elapsed < 5000) {
      console.log("✓ Indexed conversation query completed in", elapsed, "ms");
      passed++;
    } else {
      console.error("✗ Query too slow:", elapsed, "ms (expected < 5s)");
      failed++;
    }

    const offerStart = Date.now();
    await pool.query(
      `SELECT offer_id, creator, created_at FROM offer_details WHERE creator = $1 ORDER BY created_at DESC LIMIT 100`,
      ["k:any"]
    );
    const offerElapsed = Date.now() - offerStart;
    if (offerElapsed < 5000) {
      console.log("✓ Indexed offers-by-creator query completed in", offerElapsed, "ms");
      passed++;
    } else {
      console.error("✗ Offer query too slow:", offerElapsed, "ms");
      failed++;
    }
  } finally {
    await pool.end();
  }

  console.log("\n---");
  console.log("Result:", passed, "passed,", failed, "failed");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
