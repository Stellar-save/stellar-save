# stellar-save

A calm, clear way to save, send, and stay in control of your money — with real on-chain XLM payments powered by the **Stellar network**.

Built with Next.js 16, better-auth, Drizzle ORM, Neon (Postgres), Stripe, the Stellar SDK, and Tailwind CSS v4.

---

## Features

- **Auth** — sign up, sign in, sign out via better-auth (email + password)
- **Dashboard** — real-time balance, goals summary, recent activity
- **Savings goals** — create, edit, delete, allocate and withdraw with balance safeguards
- **Add money** — instant wallet credit (quick chips) or card payment via Stripe Checkout
- **Send money** — transfer funds with balance validation
- **Cash out** — Stripe Connect Express onboarding for bank payouts
- **Stellar wallet** — every user gets a Stellar keypair; funded automatically via Friendbot on testnet
- **Send XLM** — real on-chain XLM payments submitted to Horizon with verifiable transaction hashes
- **XLM balance** — live balance fetched from Horizon and cached in the DB; refreshes on every dashboard load
- **On-chain explorer links** — every XLM transaction links to Stellar Expert for public verification
- **Transaction history** — full ledger with status indicators and Stellar tx hash links
- **Smart contrast** — accessible goal accent colours, focus rings, high-contrast and reduced-motion support

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Auth | better-auth |
| Database | Neon (Postgres) via Drizzle ORM |
| Payments (fiat) | Stripe Checkout + Stripe Connect Express |
| Stellar network | @stellar/stellar-sdk — Horizon API, XLM payments |
| Styling | Tailwind CSS v4, shadcn base-nova |
| Package manager | pnpm 11 |

---

## Stellar integration

stellar-save integrates with the **Stellar network** at every level of the stack:

| Layer | What happens |
|---|---|
| Account creation | Server generates a Keypair, funds it via Friendbot (testnet) or `CreateAccount` (mainnet), stores the encrypted secret key |
| Balance | Live XLM balance fetched from Horizon on every dashboard load; cached in `wallet.xlmBalanceStroops` |
| Payments | `sendXlmPayment` builds, signs and submits a native XLM `payment` operation via Horizon |
| Ledger | Every XLM transaction is recorded with its Stellar `tx_hash`; links to Stellar Expert appear in the activity feed |
| Secret key security | AES-256-GCM encryption (Web Crypto API) — the secret key never leaves the server in plain text |

On testnet, accounts are funded automatically with 10,000 test XLM via Friendbot — no setup required beyond setting `STELLAR_NETWORK=testnet`.

---

## Getting started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Environment variables

Create `.env.local` in the project root:

```env
# Neon / Postgres
DATABASE_URL=postgresql://...

# better-auth
BETTER_AUTH_SECRET=<32-byte hex — run: openssl rand -hex 32>
BETTER_AUTH_URL=http://localhost:3000

# Stripe
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Stellar (testnet defaults — no changes needed for local dev)
STELLAR_NETWORK=testnet
NEXT_PUBLIC_STELLAR_NETWORK=testnet
# STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org   # optional override
# STELLAR_PLATFORM_SECRET=S...                              # mainnet only
```

Get Stripe keys from [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys).

### 3. Run database migrations

```bash
# Option A — run the provided SQL directly
psql $DATABASE_URL -f db/migrations/0002_add_stripe_and_goal_columns.sql
psql $DATABASE_URL -f db/migrations/0003_add_stellar_columns.sql

# Option B — drizzle-kit
npx drizzle-kit generate
npx drizzle-kit migrate
```

### 4. Start Stripe webhook listener (local dev)

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the `whsec_...` secret it prints into `STRIPE_WEBHOOK_SECRET`.

### 5. Run the dev server

```bash
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000).

---

## Project structure

```
app/
  actions/
    wallet.ts         # Wallet, goals, balance — includes Stellar balance refresh
    stripe.ts         # Stripe Checkout + Connect Express
    stellar.ts        # provisionStellarAccount, sendXlm, refreshXlmBalance
  api/
    auth/             # better-auth handler
    stripe/webhook/   # Stripe webhook (signature verification + ledger update)
    stellar/fund/     # Friendbot proxy (testnet only, authenticated)
  cashout/            # Stripe Connect onboarding return/refresh pages
  deposit/            # Stripe Checkout success/cancel pages
  sign-in/
  sign-up/
  page.tsx            # Main dashboard (includes XLM panel + Send XLM flow)
components/
  goal-modals.tsx     # Create/edit/delete/allocate goal modals
  auth-form.tsx       # Shared sign-in/sign-up form
  ui/                 # shadcn components
lib/
  auth.ts             # better-auth server config
  auth-client.ts      # better-auth client
  contrast.ts         # WCAG contrast utilities
  stellar.ts          # Horizon server, keypair helpers, sendXlmPayment, AES-256-GCM encryption
  stripe.ts           # Stripe singleton
  db/
    schema.ts         # Drizzle schema (includes Stellar wallet columns)
    index.ts          # DB connection
db/
  migrations/         # SQL migration files
```

---

## Stripe notes

- **Deposits** use Stripe Checkout. The webhook at `/api/stripe/webhook` credits the wallet once `payment_intent.succeeded` fires. Idempotency is enforced via `stripePaymentIntentId`.
- **Cash out** uses Stripe Connect Express. Users complete hosted onboarding; the app live-checks `charges_enabled` before showing a ready state.

## Stellar notes

- On **testnet**, Stellar accounts are funded automatically via Friendbot (10,000 XLM). No `STELLAR_PLATFORM_SECRET` needed.
- On **mainnet**, set `STELLAR_PLATFORM_SECRET` to the secret key of a funded platform account. Each new user account requires a `CreateAccount` operation costing the minimum reserve (~1 XLM).
- All XLM transaction hashes are stored in the `transaction.stellarTxHash` column and link to [Stellar Expert](https://stellar.expert) in the UI.
- The user's Stellar secret key is encrypted with AES-256-GCM (Web Crypto) before being stored. It is derived from `BETTER_AUTH_SECRET` and never returned to the client.

---

## Compliance notes

| Area | Status | Notes |
|---|---|---|
| Stripe PCI compliance | ✅ Delegated | All card data handled by Stripe Checkout |
| Stripe Connect KYC | ✅ Delegated | Identity verification via Stripe Express onboarding |
| Stellar on-chain transparency | ✅ Implemented | All XLM transactions verifiable on Stellar Expert |
| Financial regulation (MSB) | ⚠️ Manual review | Sending money may require a money transmitter licence. Consult a legal advisor. |
| GDPR / data deletion | ⚠️ Partial | Auth tables cascade-delete. Stripe + Stellar accounts need separate API-level deletion. |
| WCAG 2.1 AA | ⚠️ Partial | Focus rings, contrast ≥4.5:1, aria-labels, aria-live regions implemented. |
| Rate limiting | ⚠️ Not implemented | Add rate limiting to `/api/stellar/fund` and server actions before production. |
| Audit logging | ⚠️ Not implemented | Consider an append-only audit table for all financial events. |
