-- Migration: add Stripe Connect columns to wallet,
--             add stripePaymentIntentId + goalId to transaction,
--             change savingsGoal.color default to hex format.
--
-- Run this against your Neon database BEFORE deploying the new code.
-- If you are using drizzle-kit, you can generate this automatically with:
--   npx drizzle-kit generate
--   npx drizzle-kit migrate
--
-- Or apply manually:

ALTER TABLE "wallet"
  ADD COLUMN IF NOT EXISTS "stripeConnectAccountId" text,
  ADD COLUMN IF NOT EXISTS "stripeConnectOnboarded" boolean NOT NULL DEFAULT false;

ALTER TABLE "transaction"
  ADD COLUMN IF NOT EXISTS "stripePaymentIntentId" text,
  ADD COLUMN IF NOT EXISTS "goalId" text;

-- Optional: update existing goals whose color is a named value to hex.
-- Only needed if you had rows with color = 'gold' | 'navy' | 'teal'.
UPDATE "savings_goal" SET "color" = '#f5c86a' WHERE "color" = 'gold';
UPDATE "savings_goal" SET "color" = '#102b4e' WHERE "color" = 'navy';
UPDATE "savings_goal" SET "color" = '#5eb697' WHERE "color" = 'teal';
