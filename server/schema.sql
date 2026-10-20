-- PostgreSQL Schema for Kadena P2P Escrow Profile API
-- Run this SQL to initialize the database schema

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
    wallet VARCHAR(255) PRIMARY KEY,
    username VARCHAR(64),
    avatar VARCHAR(512),
    bio VARCHAR(500),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP WITH TIME ZONE
);

-- Create unique index on wallet (already primary key, but explicit for clarity)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_wallet ON profiles(wallet);

-- Offer details (off-chain: price, limits, payment method; contract stores only trustless data)
CREATE TABLE IF NOT EXISTS offer_details (
    offer_id VARCHAR(255) PRIMARY KEY,
    creator VARCHAR(255) NOT NULL,
    amount DECIMAL NOT NULL,
    side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    price DECIMAL NOT NULL,
    min_amount DECIMAL NOT NULL,
    max_amount DECIMAL NOT NULL,
    payment_method TEXT NOT NULL DEFAULT '[]',
    fiat_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_offer_details_creator ON offer_details(creator);
-- List/filter offers by creator and time (Deliverable 5)
CREATE INDEX IF NOT EXISTS idx_offer_details_creator_created_at ON offer_details(creator, created_at);

-- Disputes table (OPEN | UNDER_REVIEW | CLOSED)
CREATE TABLE IF NOT EXISTS disputes (
    id SERIAL PRIMARY KEY,
    offer_id VARCHAR(255) NOT NULL,
    opened_by VARCHAR(10) NOT NULL CHECK (opened_by IN ('buyer', 'seller')),
    reason TEXT,
    opened_by_wallet VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'CLOSED')),
    triggered_by_timeout BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for disputes
CREATE INDEX IF NOT EXISTS idx_disputes_offer_id ON disputes(offer_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);

-- Dispute actions log (admin/arbiter: request_info, under_review, resolved)
CREATE TABLE IF NOT EXISTS dispute_actions (
    id SERIAL PRIMARY KEY,
    offer_id VARCHAR(255) NOT NULL,
    action_type VARCHAR(30) NOT NULL CHECK (action_type IN ('request_info', 'under_review', 'resolved')),
    by_wallet VARCHAR(255) NOT NULL,
    payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dispute_actions_offer_id ON dispute_actions(offer_id);

-- Evidence table
CREATE TABLE IF NOT EXISTS evidence (
    id SERIAL PRIMARY KEY,
    offer_id VARCHAR(255) NOT NULL,
    submitted_by VARCHAR(255) NOT NULL,
    explanation TEXT,
    files JSONB NOT NULL DEFAULT '[]'::jsonb,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for evidence
CREATE INDEX IF NOT EXISTS idx_evidence_offer_id ON evidence(offer_id);
CREATE INDEX IF NOT EXISTS idx_evidence_submitted_by ON evidence(submitted_by);

-- Dispute messages table (Deliverable 5: message length 2000, NOT NULL created_at)
CREATE TABLE IF NOT EXISTS dispute_messages (
    id SERIAL PRIMARY KEY,
    offer_id VARCHAR(255) NOT NULL,
    from_wallet VARCHAR(255) NOT NULL,
    message TEXT NOT NULL CHECK (char_length(message) <= 2000),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for dispute messages
CREATE INDEX IF NOT EXISTS idx_dispute_messages_offer_id ON dispute_messages(offer_id);
CREATE INDEX IF NOT EXISTS idx_dispute_messages_created_at ON dispute_messages(created_at);

-- User messages table (chat between users, not tied to specific offers)
-- Messages are identified by user pairs (from_wallet, to_wallet) sorted alphabetically
-- Deliverable 5: message length limit 2000 (matches API validation), NOT NULL on required fields
CREATE TABLE IF NOT EXISTS user_messages (
    id SERIAL PRIMARY KEY,
    from_wallet VARCHAR(255) NOT NULL,
    to_wallet VARCHAR(255) NOT NULL,
    message TEXT NOT NULL CHECK (char_length(message) <= 2000),
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    context_offer_id VARCHAR(255),
    attachment_url VARCHAR(512),
    attachment_name VARCHAR(255)
);

-- Indexes for user messages
CREATE INDEX IF NOT EXISTS idx_user_messages_from_wallet ON user_messages(from_wallet);
CREATE INDEX IF NOT EXISTS idx_user_messages_to_wallet ON user_messages(to_wallet);
CREATE INDEX IF NOT EXISTS idx_user_messages_created_at ON user_messages(created_at);
-- Composite index for efficient conversation queries (sorted wallet pair)
CREATE INDEX IF NOT EXISTS idx_user_messages_conversation ON user_messages(
    LEAST(from_wallet, to_wallet), 
    GREATEST(from_wallet, to_wallet), 
    created_at
);
CREATE INDEX IF NOT EXISTS idx_user_messages_context_offer ON user_messages(context_offer_id);
-- Deliverable 5: (from_wallet, to_wallet, created_at) for conversation ordering
CREATE INDEX IF NOT EXISTS idx_user_messages_from_to_created ON user_messages(from_wallet, to_wallet, created_at);
-- Unread count: to_wallet + read_at (read_at IS NULL = unread)
CREATE INDEX IF NOT EXISTS idx_user_messages_to_wallet_read_at ON user_messages(to_wallet, read_at);

-- Legacy offer_messages table (keep for backwards compatibility, but new messages go to user_messages)
-- Deliverable 5: message length limit 2000, NOT NULL where required
CREATE TABLE IF NOT EXISTS offer_messages (
    id SERIAL PRIMARY KEY,
    offer_id VARCHAR(255) NOT NULL,
    from_wallet VARCHAR(255) NOT NULL,
    to_wallet VARCHAR(255) NOT NULL,
    message TEXT NOT NULL CHECK (char_length(message) <= 2000),
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for offer messages (legacy)
CREATE INDEX IF NOT EXISTS idx_offer_messages_offer_id ON offer_messages(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_messages_from_wallet ON offer_messages(from_wallet);
CREATE INDEX IF NOT EXISTS idx_offer_messages_to_wallet ON offer_messages(to_wallet);
CREATE INDEX IF NOT EXISTS idx_offer_messages_created_at ON offer_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_offer_messages_conversation ON offer_messages(offer_id, from_wallet, to_wallet);
CREATE INDEX IF NOT EXISTS idx_offer_messages_from_to_created ON offer_messages(from_wallet, to_wallet, created_at);
CREATE INDEX IF NOT EXISTS idx_offer_messages_to_wallet_read_at ON offer_messages(to_wallet, read_at);

-- =============================================================================
-- RATINGS & REPUTATION (integrity rules)
-- 1. Only allow rating after a completed trade (row must exist in completed_offers).
-- 2. One rating per party per trade: UNIQUE(offer_id, rater_wallet).
-- 3. No self-rating: enforced in API (rated_wallet must be the counterparty).
-- 4. UI/hybrid outputs: summary API exposes trade counts, completion counts,
--    dispute counts, and rating aggregates; per-trade endpoint exposes ratings.
-- =============================================================================

-- Completed offers (only these trades can be rated)
CREATE TABLE IF NOT EXISTS completed_offers (
    offer_id VARCHAR(255) PRIMARY KEY,
    buyer_wallet VARCHAR(255) NOT NULL,
    seller_wallet VARCHAR(255) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_completed_offers_buyer ON completed_offers(buyer_wallet);
CREATE INDEX IF NOT EXISTS idx_completed_offers_seller ON completed_offers(seller_wallet);

-- Ratings: one per (trade/offer_id, rater); rated_wallet = counterparty (no self-rating in API)
CREATE TABLE IF NOT EXISTS ratings (
    id SERIAL PRIMARY KEY,
    offer_id VARCHAR(255) NOT NULL,
    rater_wallet VARCHAR(255) NOT NULL,
    rated_wallet VARCHAR(255) NOT NULL,
    rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(offer_id, rater_wallet)
);

CREATE INDEX IF NOT EXISTS idx_ratings_rated_wallet ON ratings(rated_wallet);
CREATE INDEX IF NOT EXISTS idx_ratings_offer_id ON ratings(offer_id);

-- Add last_seen column to profiles if it doesn't exist (for existing databases)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' AND column_name = 'last_seen'
    ) THEN
        ALTER TABLE profiles ADD COLUMN last_seen TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- =============================================================================
-- Deliverable 5 — Database hardening: indexes and constraints (idempotent)
-- Run this block on existing DBs to add new indexes and message length checks.
-- =============================================================================

-- Indexes (safe to run multiple times)
CREATE INDEX IF NOT EXISTS idx_offer_details_creator_created_at ON offer_details(creator, created_at);
CREATE INDEX IF NOT EXISTS idx_user_messages_from_to_created ON user_messages(from_wallet, to_wallet, created_at);
CREATE INDEX IF NOT EXISTS idx_user_messages_to_wallet_read_at ON user_messages(to_wallet, read_at);
CREATE INDEX IF NOT EXISTS idx_offer_messages_from_to_created ON offer_messages(from_wallet, to_wallet, created_at);
CREATE INDEX IF NOT EXISTS idx_offer_messages_to_wallet_read_at ON offer_messages(to_wallet, read_at);

-- Message length constraint (only add if missing)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'user_messages'::regclass AND conname = 'chk_user_messages_message_len') THEN
        ALTER TABLE user_messages ADD CONSTRAINT chk_user_messages_message_len CHECK (char_length(message) <= 2000);
    END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'offer_messages'::regclass AND conname = 'chk_offer_messages_message_len') THEN
        ALTER TABLE offer_messages ADD CONSTRAINT chk_offer_messages_message_len CHECK (char_length(message) <= 2000);
    END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'dispute_messages'::regclass AND conname = 'chk_dispute_messages_message_len') THEN
        ALTER TABLE dispute_messages ADD CONSTRAINT chk_dispute_messages_message_len CHECK (char_length(message) <= 2000);
    END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- NOT NULL on created_at where we have default (only if column is nullable)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_messages' AND column_name = 'created_at' AND is_nullable = 'YES') THEN
        UPDATE user_messages SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL;
        ALTER TABLE user_messages ALTER COLUMN created_at SET NOT NULL;
    END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'offer_messages' AND column_name = 'created_at' AND is_nullable = 'YES') THEN
        UPDATE offer_messages SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL;
        ALTER TABLE offer_messages ALTER COLUMN created_at SET NOT NULL;
    END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dispute_messages' AND column_name = 'created_at' AND is_nullable = 'YES') THEN
        UPDATE dispute_messages SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL;
        ALTER TABLE dispute_messages ALTER COLUMN created_at SET NOT NULL;
    END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Offer alerts by email (server/alerts.js). One row per address; the token is the manage/unsubscribe key.
CREATE TABLE IF NOT EXISTS alert_subscriptions (
    id SERIAL PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE,
    token VARCHAR(64) NOT NULL UNIQUE,
    want_sell BOOLEAN NOT NULL DEFAULT TRUE,
    want_buy BOOLEAN NOT NULL DEFAULT FALSE,
    currencies VARCHAR(100) NOT NULL DEFAULT '',
    min_kda DECIMAL,
    max_kda DECIMAL,
    frequency VARCHAR(10) NOT NULL DEFAULT 'instant' CHECK (frequency IN ('instant', 'daily')),
    lang VARCHAR(2) NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'ar')),
    confirmed_at TIMESTAMP WITH TIME ZONE,
    unsubscribed_at TIMESTAMP WITH TIME ZONE,
    confirm_sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_active ON alert_subscriptions(frequency) WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL;

-- Offers the alert watcher has seen (announced_at set once emailed or no longer open).
CREATE TABLE IF NOT EXISTS alert_offers_seen (
    offer_id VARCHAR(255) PRIMARY KEY,
    first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    announced_at TIMESTAMP WITH TIME ZONE
);

-- Every alert email attempt (for the daily sending limit).
CREATE TABLE IF NOT EXISTS alert_mail_log (
    id SERIAL PRIMARY KEY,
    subscription_id INTEGER,
    kind VARCHAR(20) NOT NULL,
    ok BOOLEAN NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_alert_mail_log_sent_at ON alert_mail_log(sent_at);

-- Small key/value store for the alert watcher (first-run marker, last daily summary date).
CREATE TABLE IF NOT EXISTS alert_state (
    key VARCHAR(64) PRIMARY KEY,
    value TEXT
);

-- Trade notifications (server/notifications.js): last state seen per escrow, the feed, and Web Push devices.
CREATE TABLE IF NOT EXISTS trade_states (
    offer_id VARCHAR(255) PRIMARY KEY,
    state VARCHAR(20) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- wallet is a k: account, or '*' for items everyone sees (new offers). offer_id is '' when there is none.
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    wallet VARCHAR(255) NOT NULL,
    offer_id VARCHAR(255) NOT NULL DEFAULT '',
    kind VARCHAR(64) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body VARCHAR(600) NOT NULL DEFAULT '',
    urgent BOOLEAN NOT NULL DEFAULT FALSE,
    data JSONB,
    pushed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (wallet, offer_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_notifications_wallet_created ON notifications(wallet, created_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    endpoint VARCHAR(1000) NOT NULL UNIQUE,
    p256dh VARCHAR(200) NOT NULL,
    auth VARCHAR(100) NOT NULL,
    wallet VARCHAR(255),
    trades BOOLEAN NOT NULL DEFAULT TRUE,
    offers BOOLEAN NOT NULL DEFAULT FALSE,
    fail_count INTEGER NOT NULL DEFAULT 0,
    last_ok_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_wallet ON push_subscriptions(wallet);

-- Every on-chain step of a trade (create, accept, deposit, mark paid, release, refund, …), so both sides see
-- the full list on any device. Recorded from the signed command (its hash must equal the request key) and kept
-- only once the chain reports success.
CREATE TABLE IF NOT EXISTS trade_txs (
    request_key VARCHAR(64) PRIMARY KEY,
    offer_id VARCHAR(255) NOT NULL,
    fn VARCHAR(64) NOT NULL,
    sender VARCHAR(255) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    block_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_trade_txs_offer ON trade_txs(offer_id);
CREATE INDEX IF NOT EXISTS idx_trade_txs_pending ON trade_txs(status, created_at);

-- Where the KDA holder (seller) receives the fiat or stablecoin payment: one entry per payment method,
-- e.g. [{"method":"USDT","value":"TRC20 T…"}, {"method":"Bank Transfer","value":"Al Rajhi, IBAN SA…"}].
-- Private: shown only to the two sides once the offer is accepted, and to the arbiter. Locked from FUNDED on.
CREATE TABLE IF NOT EXISTS trade_payouts (
    offer_id VARCHAR(255) PRIMARY KEY,
    wallet VARCHAR(255) NOT NULL,
    details JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Proof of payment the buyer adds when pressing Mark as Paid: a screenshot and/or the transfer reference
-- (USDT transaction ID, Wise/Revolut reference). Seen by the two sides and the arbiter.
CREATE TABLE IF NOT EXISTS payment_proofs (
    id SERIAL PRIMARY KEY,
    offer_id VARCHAR(255) NOT NULL,
    wallet VARCHAR(255) NOT NULL,
    reference VARCHAR(300),
    file_url VARCHAR(512),
    file_name VARCHAR(200),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_proofs_offer ON payment_proofs(offer_id);

-- Trade emails: a wallet's email for its trade notifications (see server/tradeEmails.js). Required to trade;
-- works once confirmed. A new address waits in pending_email (the old one keeps working) until confirmed.
CREATE TABLE IF NOT EXISTS trade_emails (
    wallet VARCHAR(255) PRIMARY KEY,
    email VARCHAR(254) NOT NULL,
    pending_email VARCHAR(254),
    token VARCHAR(64) NOT NULL UNIQUE,
    lang VARCHAR(5) NOT NULL DEFAULT 'en',
    confirmed_at TIMESTAMP WITH TIME ZONE,
    off_at TIMESTAMP WITH TIME ZONE,
    confirm_sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Terms of use, accepted once per wallet per version (server/trust.js)
CREATE TABLE IF NOT EXISTS terms_acceptances (
    wallet VARCHAR(255) NOT NULL,
    version VARCHAR(20) NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (wallet, version)
);

-- Rating registrations and ratings removed by the one-time chain re-check (kept for the record)
CREATE TABLE IF NOT EXISTS completed_offers_removed (
    offer_id VARCHAR(255) PRIMARY KEY,
    buyer_wallet VARCHAR(255),
    seller_wallet VARCHAR(255),
    reason VARCHAR(100),
    removed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ratings_removed (
    id SERIAL PRIMARY KEY,
    offer_id VARCHAR(255),
    rater_wallet VARCHAR(255),
    rated_wallet VARCHAR(255),
    rating SMALLINT,
    comment VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE,
    removed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Open offers the arbiter hid from the market (forgotten or inactive). Nothing changes on the chain;
-- the creator can still delete the offer or post it again. See server/offerModeration.js.
CREATE TABLE IF NOT EXISTS hidden_offers (
    offer_id VARCHAR(255) PRIMARY KEY,
    hidden_by VARCHAR(255) NOT NULL,
    reason VARCHAR(40) NOT NULL DEFAULT 'inactive',
    hidden_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- An open offer that expired (server/offerModeration.js) and was listed again by its creator: the clock restarts here.
CREATE TABLE IF NOT EXISTS offer_relists (
    offer_id VARCHAR(255) PRIMARY KEY,
    relisted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Escrow v11 (server/pools.js): what the server keeps per pool, off chain. Price, currency and limits are on the
-- chain now; here live the payment networks the creator accepts (e.g. ["USDT:TRC20","USDC:ERC20"]), the receiving
-- address per network ({"USDT:TRC20":"T…"}, shown only to the parties of a trade on the pool) and free-text notes.
CREATE TABLE IF NOT EXISTS pool_details (
    pool_id TEXT PRIMARY KEY,
    creator TEXT NOT NULL,
    networks JSONB NOT NULL DEFAULT '[]',
    payout JSONB NOT NULL DEFAULT '{}',
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Auto-release (server/autoRelease.js): USDT/USDC trades whose offer chose the platform's release agent. The buyer
-- is asked for the trade's pay-amount plus a small extra of 1-999 micro-units (`amount_offset`), so each payment to
-- one receiving address can be told apart; when that exact transfer arrives, the agent calls `release` on chain.
-- One row per trade; the receiving addresses are a snapshot taken when the row is made (auto_release_watch), so a
-- later edit of the pool or payout details never changes where the agent looks. Amounts are in base units (6 decimals).
CREATE TABLE IF NOT EXISTS auto_release (
    trade_ref TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    pool_ref TEXT NOT NULL,
    agent TEXT NOT NULL,
    currency TEXT NOT NULL,
    pay_units TEXT NOT NULL,
    amount_offset INTEGER NOT NULL CHECK (amount_offset BETWEEN 1 AND 999),
    expected_units TEXT NOT NULL,
    funded_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deadline TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT NOT NULL DEFAULT 'watching' CHECK (status IN ('watching', 'matched', 'releasing', 'released', 'manual', 'expired')),
    matched_tx TEXT UNIQUE,
    matched_network TEXT,
    matched_at TIMESTAMP WITH TIME ZONE,
    release_request_key TEXT,
    release_expires_at TIMESTAMP WITH TIME ZONE,
    release_attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auto_release_status ON auto_release(status);
-- The receiving address per network of an auto-release trade (snapshot). `address_key` is the address as compared
-- (lowercase for Ethereum). While `open`, no two trades paying one address on one network share an offset or an
-- expected amount, so one transfer can only ever fit one trade.
CREATE TABLE IF NOT EXISTS auto_release_watch (
    trade_ref TEXT NOT NULL REFERENCES auto_release(trade_ref) ON DELETE CASCADE,
    network TEXT NOT NULL,
    address TEXT NOT NULL,
    address_key TEXT NOT NULL,
    amount_offset INTEGER NOT NULL,
    expected_units TEXT NOT NULL,
    open BOOLEAN NOT NULL DEFAULT true,
    PRIMARY KEY (trade_ref, network)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_release_watch_offset ON auto_release_watch(network, address_key, amount_offset) WHERE open;
CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_release_watch_amount ON auto_release_watch(network, address_key, expected_units) WHERE open;
-- all rows (open or closed) of one address: offsets used in the last 48 hours are not drawn again, and a payment
-- that also fits a closed trade's window is left to the manual flow (server/autoRelease.js)
CREATE INDEX IF NOT EXISTS idx_auto_release_watch_address ON auto_release_watch(network, address_key);
