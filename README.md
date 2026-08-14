# stellar-save

A calm, clear way to save, send, and stay in control of your money.

Built with Next.js 16, better-auth, Drizzle ORM, Neon (Postgres), Stripe, and Tailwind CSS v4.

---

## Features

- **Auth** — sign up, sign in, sign out via better-auth (email + password)
- **Dashboard** — real-time balance, goals summary, recent activity
- **Savings goals** — create, edit, delete, allocate and withdraw with balance safeguards
- **Add money** — instant wallet credit (quick chips) or card payment via Stripe Checkout
- **Send money** — transfer funds with balance validation
- **Cash out** — Stripe Connect Express onboarding for bank payouts
- **Transaction history** — full ledger with status indicators
- **Smart contrast** — accessible goal accent colours, focus rings, high-contrast and reduced-motion support

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Auth | better-auth |
| Database | Neon (Postgres) via Drizzle ORM |
| Payments | Stripe Checkout + Stripe Connect Express |
| Styling | Tailwind CSS v4, shadcn base-nova |
| Package manager | pnpm 11 |

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
```

Get Stripe keys from [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys).

### 3. Run database migrations

```bash
# Option A — run the provided SQL directly
psql $DATABASE_URL -f db/migrations/0002_add_stripe_and_goal_columns.sql

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
  actions/          # Server actions (wallet, goals, Stripe)
  api/
    auth/           # better-auth handler
    stripe/webhook/ # Stripe webhook (signature verification + ledger update)
  cashout/          # Stripe Connect onboarding return/refresh pages
  deposit/          # Stripe Checkout success/cancel pages
  sign-in/
  sign-up/
  page.tsx          # Main dashboard
components/
  goal-modals.tsx   # Create/edit/delete/allocate goal modals
  auth-form.tsx     # Shared sign-in/sign-up form
  ui/               # shadcn components
lib/
  auth.ts           # better-auth server config
  auth-client.ts    # better-auth client
  contrast.ts       # WCAG contrast utilities
  db/
    schema.ts       # Drizzle schema
    index.ts        # DB connection
  stripe.ts         # Stripe singleton
db/
  migrations/       # SQL migration files
```

---

## Stripe notes

- **Deposits** use Stripe Checkout. The webhook at `/api/stripe/webhook` credits the wallet once `payment_intent.succeeded` fires. Idempotency is enforced via `stripePaymentIntentId`.
- **Cash out** uses Stripe Connect Express. Users complete hosted onboarding; the app live-checks `charges_enabled` before showing a ready state — it never falsely reports a payout as complete.
- Quick-add chips (`+$25` etc.) credit the wallet directly without Stripe, useful for testing without real keys.

---

## Compliance notes

| Area | Status |
|---|---|
| Stripe PCI | ✅ Delegated to Stripe Checkout |
| KYC / identity | ✅ Delegated to Stripe Connect Express |
| WCAG 2.1 AA | ⚠️ Implemented — full validation requires manual screen-reader testing |
| Money transmission licence | ⚠️ Consult a legal advisor for your jurisdiction |
| Rate limiting | ⚠️ Not implemented — add before production |
| GDPR data deletion | ⚠️ Auth tables cascade on user delete; Stripe accounts need separate API deletion |
