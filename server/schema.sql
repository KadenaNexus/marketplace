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

-- Disputes table
CREATE TABLE IF NOT EXISTS disputes (
    id SERIAL PRIMARY KEY,
    offer_id VARCHAR(255) NOT NULL,
    opened_by VARCHAR(10) NOT NULL CHECK (opened_by IN ('buyer', 'seller')),
    reason TEXT,
    opened_by_wallet VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for disputes
CREATE INDEX IF NOT EXISTS idx_disputes_offer_id ON disputes(offer_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);

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

-- Dispute messages table
CREATE TABLE IF NOT EXISTS dispute_messages (
    id SERIAL PRIMARY KEY,
    offer_id VARCHAR(255) NOT NULL,
    from_wallet VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for dispute messages
CREATE INDEX IF NOT EXISTS idx_dispute_messages_offer_id ON dispute_messages(offer_id);
CREATE INDEX IF NOT EXISTS idx_dispute_messages_created_at ON dispute_messages(created_at);

-- User messages table (chat between users, not tied to specific offers)
-- Messages are identified by user pairs (from_wallet, to_wallet) sorted alphabetically
CREATE TABLE IF NOT EXISTS user_messages (
    id SERIAL PRIMARY KEY,
    from_wallet VARCHAR(255) NOT NULL,
    to_wallet VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- Optional: reference to offer that triggered the conversation (for context, not required)
    context_offer_id VARCHAR(255)
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

-- Legacy offer_messages table (keep for backwards compatibility, but new messages go to user_messages)
-- We'll migrate existing data if needed
CREATE TABLE IF NOT EXISTS offer_messages (
    id SERIAL PRIMARY KEY,
    offer_id VARCHAR(255) NOT NULL,
    from_wallet VARCHAR(255) NOT NULL,
    to_wallet VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for offer messages (legacy)
CREATE INDEX IF NOT EXISTS idx_offer_messages_offer_id ON offer_messages(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_messages_from_wallet ON offer_messages(from_wallet);
CREATE INDEX IF NOT EXISTS idx_offer_messages_to_wallet ON offer_messages(to_wallet);
CREATE INDEX IF NOT EXISTS idx_offer_messages_created_at ON offer_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_offer_messages_conversation ON offer_messages(offer_id, from_wallet, to_wallet);

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
