-- Migration: add Stellar network columns to wallet and transaction tables.
--
-- Run this against your database BEFORE deploying the Stellar integration.
--
--   Option A — drizzle-kit (recommended):
--     npx drizzle-kit generate
--     npx drizzle-kit migrate
--
--   Option B — manual SQL:
--     psql $DATABASE_URL -f db/migrations/0003_add_stellar_columns.sql

-- -------------------------------------------------------------------------
-- wallet table: Stellar account fields
-- -------------------------------------------------------------------------

ALTER TABLE "wallet"
  -- Stellar G... public key. NULL until the user provisions their account.
  ADD COLUMN IF NOT EXISTS "stellarPublicKey"    text,

  -- AES-256-GCM encrypted secret key stored as "iv_b64:ciphertext_b64".
  -- Never returned to the client — server-side decryption only.
  ADD COLUMN IF NOT EXISTS "stellarSecretKeyEnc" text,

  -- Cached XLM balance in stroops (1 XLM = 10,000,000 stroops).
  -- Refreshed on every dashboard load via Horizon.
  ADD COLUMN IF NOT EXISTS "xlmBalanceStroops"   bigint NOT NULL DEFAULT 0;

-- -------------------------------------------------------------------------
-- transaction table: Stellar on-chain traceability
-- -------------------------------------------------------------------------

ALTER TABLE "transaction"
  -- Stellar transaction hash for XLM send/receive operations.
  -- Allows users (and auditors) to verify on Stellar Expert / Horizon.
  ADD COLUMN IF NOT EXISTS "stellarTxHash" text;
