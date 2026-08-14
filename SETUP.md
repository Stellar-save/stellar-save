# stellar-save — Setup & Compliance Guide

## 1. Install dependencies

```bash
pnpm install
```

> Stripe SDK (`stripe@^17.7.0`) was added to `package.json`. Run install before
> starting the dev server.

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
```

---

## 3. Database migration

The schema added two new columns to `wallet` and two to `transaction`.
Apply before first run:

```bash
# Option A — drizzle-kit (recommended)
npx drizzle-kit generate
npx drizzle-kit migrate

# Option B — manual SQL
psql $DATABASE_URL -f db/migrations/0002_add_stripe_and_goal_columns.sql
```

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
- Express accounts are **not available in all countries**. Check:
  https://stripe.com/docs/connect/express-accounts
- Payouts require Stripe to verify the user's identity (KYC). This is handled
  by the hosted onboarding flow at `/cashout/onboarding-return`.
- The app **never reports a payout as complete** unless `charges_enabled` is
  `true` on the connected account. Users see an "incomplete" state with a
  retry link if onboarding was not finished.

---

## 6. Remaining compliance requirements

| Area | Status | Notes |
|------|--------|-------|
| Stripe PCI compliance | ✅ Delegated | All card data handled by Stripe Checkout; no card data touches your server |
| Stripe Connect KYC | ✅ Delegated | Identity verification handled by Stripe Express onboarding |
| Financial regulation (MSB / money transmission) | ⚠️ **Manual review required** | Sending money between users may require a money transmitter licence depending on jurisdiction. Consult a legal advisor. |
| GDPR / data deletion | ⚠️ Partial | Auth tables cascade-delete on user removal. Stripe Connect accounts must be separately deleted via Stripe API. |
| WCAG 2.1 AA | ⚠️ Partial | Focus rings, colour contrast (≥4.5:1), `aria-label`s, `aria-live` regions implemented. Full validation requires manual screen-reader testing. |
| Rate limiting | ⚠️ Not implemented | Add rate limiting middleware (e.g. Upstash Ratelimit) to `/api/stripe/webhook` and server actions before production. |
| Audit logging | ⚠️ Not implemented | Consider logging all financial transactions to an append-only audit table. |
| Error monitoring | ⚠️ Not implemented | Add Sentry or similar before production. |

---

## 7. Running locally

```bash
pnpm dev
```

Then visit `http://localhost:3000`.
