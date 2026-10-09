# stellar-save — Setup & Compliance Guide

## 1. Install dependencies

```bash
pnpm install
```

> Stripe SDK (`stripe@^17.7.0`) and Stellar SDK (`@stellar/stellar-sdk@13.0.0`)
> are both in `package.json`. Run install before starting the dev server.

---

## 2. Environment variables

Create `.env.local` in the project root:

```env
# Neon / Postgres
DATABASE_URL=postgresql://...

# better-auth (generate with: openssl rand -hex 32)
BETTER_AUTH_SECRET=your_secret_here
BETTER_AUTH_URL=http://localhost:3000

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...          # from: stripe listen --forward-to ...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# App base URL (used for Stripe redirect URLs)
NEXT_PUBLIC_APP_URL=http://localhost:3000

# ── Stellar ──────────────────────────────────────────────────────────────────
# Network: 'testnet' (default) or 'mainnet'
STELLAR_NETWORK=testnet
NEXT_PUBLIC_STELLAR_NETWORK=testnet      # used in UI for Stellar Expert links

# Optional — defaults are derived from STELLAR_NETWORK if not set:
# STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
# STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Mainnet only — secret key (S...) of the platform's funded Stellar account.
# Used to execute CreateAccount operations for new users.
# On testnet this is NOT needed — Friendbot funds accounts automatically.
# STELLAR_PLATFORM_SECRET=S...
```

---

## 3. Database migrations

The schema has three new columns on `wallet` and one on `transaction` for Stellar.
Apply all migrations before first run:

```bash
# Option A — drizzle-kit (recommended)
npx drizzle-kit generate
npx drizzle-kit migrate

# Option B — manual SQL (run in order)
psql $DATABASE_URL -f db/migrations/0002_add_stripe_and_goal_columns.sql
psql $DATABASE_URL -f db/migrations/0003_add_stellar_columns.sql
```

Migration `0003` adds:

| Table | Column | Type | Purpose |
|---|---|---|---|
| `wallet` | `stellarPublicKey` | text | User's Stellar G... public key |
| `wallet` | `stellarSecretKeyEnc` | text | AES-256-GCM encrypted secret key |
| `wallet` | `xlmBalanceStroops` | bigint | Cached XLM balance (1 XLM = 10,000,000 stroops) |
| `transaction` | `stellarTxHash` | text | On-chain transaction hash for XLM operations |

---

## 4. Stripe webhook setup

### Local development

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the `whsec_...` secret printed by the CLI into `STRIPE_WEBHOOK_SECRET`.

### Production (Vercel / other)

Add a webhook endpoint in the Stripe Dashboard pointing to:

```
https://your-domain.com/api/stripe/webhook
```

Events to subscribe:
- `payment_intent.succeeded`
- `payment_intent.payment_failed`

---

## 5. Stripe Connect (cash-out / payouts)

Cash-out uses **Stripe Connect Express**. Requirements:

- Stripe Connect must be enabled on your Stripe account (Dashboard → Connect).
- Express accounts are **not available in all countries**.
- The app **never reports a payout as complete** unless `charges_enabled` is `true`.

---

## 6. Stellar network setup

### Testnet (default — zero configuration needed)

When `STELLAR_NETWORK=testnet`, every new user account is funded automatically
via Friendbot with 10,000 test XLM. No platform account or additional env vars
are required. This is the recommended mode for development and SCF review.

User flow:
1. User clicks **Stellar** in the sidebar or quick actions.
2. Clicks **Create Stellar account** — server calls `provisionStellarAccount()`.
3. A keypair is generated, Friendbot funds the account, the encrypted secret is saved.
4. User can now view their XLM balance and send XLM to any Stellar public key.
5. Every transaction shows a link to [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet).

### Mainnet

1. Set `STELLAR_NETWORK=mainnet` and `NEXT_PUBLIC_STELLAR_NETWORK=mainnet`.
2. Fund a dedicated platform Stellar account with enough XLM to cover user account creation (minimum ~1 XLM per user for the base reserve).
3. Set `STELLAR_PLATFORM_SECRET` to that account's secret key.
4. Each new user's account is created via a `CreateAccount` operation signed by the platform.

### Stellar account security

- The user's secret key is encrypted with **AES-256-GCM** using a key derived from `BETTER_AUTH_SECRET` before being stored in the database.
- The encrypted value is stored as `"iv_base64:ciphertext_base64"` in `wallet.stellarSecretKeyEnc`.
- The secret key is **never returned to the client** — it is only decrypted server-side at transaction signing time.
- Rotating `BETTER_AUTH_SECRET` will break decryption of existing secret keys. Treat it as permanent once users have Stellar accounts.

### Authenticated Friendbot proxy

A helper endpoint is available at `POST /api/stellar/fund` for re-funding testnet accounts during development:

```bash
curl -X POST http://localhost:3000/api/stellar/fund \
  -H "Content-Type: application/json" \
  -d '{"publicKey": "G..."}'
```

Requires an active browser session (cookie-based auth). Returns 403 on mainnet.

---

## 7. Remaining compliance requirements

| Area | Status | Notes |
|---|---|---|
| Stripe PCI compliance | ✅ Delegated | All card data handled by Stripe Checkout; no card data touches your server |
| Stripe Connect KYC | ✅ Delegated | Identity verification handled by Stripe Express onboarding |
| Stellar on-chain transparency | ✅ Implemented | All XLM tx hashes stored; Stellar Expert links in activity feed |
| Stellar secret key security | ✅ Implemented | AES-256-GCM server-side encryption; never exposed to client |
| Financial regulation (MSB / money transmission) | ⚠️ Manual review | Sending money between users may require a money transmitter licence. Consult a legal advisor. |
| GDPR / data deletion | ⚠️ Partial | Auth tables cascade-delete on user removal. Stripe Connect and Stellar accounts must be separately deleted via their respective APIs. |
| WCAG 2.1 AA | ⚠️ Partial | Focus rings, colour contrast (≥4.5:1), `aria-label`s, `aria-live` regions implemented. Full validation requires manual screen-reader testing. |
| Rate limiting | ⚠️ Not implemented | Add rate limiting to `/api/stellar/fund`, `/api/stripe/webhook`, and server actions before production. |
| Audit logging | ⚠️ Not implemented | Consider logging all financial transactions to an append-only audit table. |
| Error monitoring | ⚠️ Not implemented | Add Sentry or similar before production. |

---

## 8. Running locally

```bash
pnpm dev
```

Then visit `http://localhost:3000`.

To test the Stellar flow end-to-end on testnet:
1. Sign up / sign in.
2. Click **Stellar** in the sidebar.
3. Click **Create Stellar account** — the account will be funded with 10,000 XLM via Friendbot.
4. Click **Send XLM**, enter any testnet public key (e.g. from [Stellar Lab](https://lab.stellar.org)), and submit.
5. The transaction hash will appear in the activity feed with a link to Stellar Expert.
