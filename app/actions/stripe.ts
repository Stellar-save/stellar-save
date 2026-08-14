'use server'

import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { transactions, wallet } from '@/lib/db/schema'
import { stripe } from '@/lib/stripe'

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function getAuthedUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user
}

function appUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  )
}

// ---------------------------------------------------------------------------
// Stripe Checkout — real deposit flow
// ---------------------------------------------------------------------------

/**
 * Creates a Stripe Checkout session for a deposit.
 * The webhook (app/api/stripe/webhook/route.ts) credits the wallet once
 * payment_intent.succeeded fires.
 *
 * We use `payment_intent_data.metadata` to carry user + amount info so the
 * webhook can update the ledger without trusting client input.
 */
export async function createCheckoutSession(amountCents: number): Promise<never> {
  const user = await getAuthedUser()

  if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 10_000_000) {
    throw new Error('Amount must be between $1.00 and $100,000')
  }

  const base = appUrl()

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          product_data: {
            name: 'stellar-save deposit',
            description: `Add ${(amountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} to your wallet`,
          },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      metadata: {
        userId: user.id,
        amountCents: String(amountCents),
        purpose: 'wallet_deposit',
      },
    },
    customer_email: user.email,
    success_url: `${base}/deposit/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/deposit/cancel`,
  })

  if (!session.url) throw new Error('Stripe did not return a checkout URL')

  // next/navigation redirect — throws NEXT_REDIRECT, must not be caught
  redirect(session.url)
}

// ---------------------------------------------------------------------------
// Stripe Connect Express — cash-out onboarding
// ---------------------------------------------------------------------------

/**
 * Creates or retrieves the user's Stripe Connect Express account and
 * redirects them to the hosted onboarding URL.
 *
 * Important: we never report a payout as complete here. The user lands back
 * at /cashout/onboarding-return where we check charges_enabled before
 * showing any "ready" state.
 */
export async function startConnectOnboarding(): Promise<never> {
  const user = await getAuthedUser()
  const base = appUrl()

  // Get or create wallet row
  const walletRows = await db
    .select()
    .from(wallet)
    .where(eq(wallet.userId, user.id))
    .limit(1)

  let w = walletRows[0]
  if (!w) {
    const created = await db
      .insert(wallet)
      .values({ id: crypto.randomUUID(), userId: user.id })
      .returning()
    w = created[0]
  }

  let connectAccountId = w.stripeConnectAccountId

  if (!connectAccountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      email: user.email,
      capabilities: { transfers: { requested: true } },
      metadata: { userId: user.id },
    })
    connectAccountId = account.id

    await db
      .update(wallet)
      .set({ stripeConnectAccountId: connectAccountId, updatedAt: new Date() })
      .where(and(eq(wallet.id, w.id), eq(wallet.userId, user.id)))
  }

  const link = await stripe.accountLinks.create({
    account: connectAccountId,
    refresh_url: `${base}/cashout/onboarding-refresh`,
    return_url: `${base}/cashout/onboarding-return`,
    type: 'account_onboarding',
  })

  redirect(link.url)
}

// ---------------------------------------------------------------------------
// Check Connect onboarding status — called after return redirect
// ---------------------------------------------------------------------------

export async function getConnectStatus(): Promise<{
  onboarded: boolean
  accountId: string | null
}> {
  const user = await getAuthedUser()

  const walletRows = await db
    .select()
    .from(wallet)
    .where(eq(wallet.userId, user.id))
    .limit(1)

  const w = walletRows[0]
  if (!w?.stripeConnectAccountId) return { onboarded: false, accountId: null }

  // Live-check with Stripe — don't rely on local flag alone
  const account = await stripe.accounts.retrieve(w.stripeConnectAccountId)
  const onboarded = account.charges_enabled && account.details_submitted

  if (onboarded && !w.stripeConnectOnboarded) {
    await db
      .update(wallet)
      .set({ stripeConnectOnboarded: true, updatedAt: new Date() })
      .where(eq(wallet.id, w.id))
  }

  return { onboarded: !!onboarded, accountId: w.stripeConnectAccountId }
}

// ---------------------------------------------------------------------------
// Initiate a payout to the connected account
// ---------------------------------------------------------------------------

export async function initiatePayout(amountCents: number): Promise<{ transferId: string }> {
  const user = await getAuthedUser()

  if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 10_000_000) {
    throw new Error('Amount must be between $1.00 and $100,000')
  }

  const walletRows = await db
    .select()
    .from(wallet)
    .where(eq(wallet.userId, user.id))
    .limit(1)

  const w = walletRows[0]
  if (!w) throw new Error('Wallet not found')
  if (!w.stripeConnectAccountId || !w.stripeConnectOnboarded) {
    throw new Error('Payout account not set up. Please complete onboarding first.')
  }
  if (w.balanceCents < amountCents) throw new Error('Insufficient wallet balance')

  // Deduct from wallet first (optimistic), then create Stripe transfer
  const newBalance = w.balanceCents - amountCents
  await db
    .update(wallet)
    .set({ balanceCents: newBalance, updatedAt: new Date() })
    .where(and(eq(wallet.id, w.id), eq(wallet.userId, user.id)))

  let transferId: string
  try {
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: 'usd',
      destination: w.stripeConnectAccountId,
      metadata: { userId: user.id, purpose: 'cashout' },
    })
    transferId = transfer.id
  } catch (err) {
    // Rollback wallet deduction if Stripe transfer fails
    await db
      .update(wallet)
      .set({ balanceCents: w.balanceCents, updatedAt: new Date() })
      .where(eq(wallet.id, w.id))
    throw err
  }

  // Record the transaction
  await db.insert(transactions).values({
    id: crypto.randomUUID(),
    userId: user.id,
    type: 'cashout',
    amountCents,
    description: 'Cash out via Stripe payout',
    status: 'completed',
  })

  return { transferId }
}
