-- PostgreSQL Schema for Kadena P2P Escrow Profile API
-- Run this SQL to initialize the database schema

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
    wallet VARCHAR(255) PRIMARY KEY,
    username VARCHAR(64),
    avatar VARCHAR(512),
    bio VARCHAR(500),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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
