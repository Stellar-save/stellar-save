import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { db } from '@/lib/db'
import { transactions, wallet } from '@/lib/db/schema'
import { stripe } from '@/lib/stripe'

/**
 * Stripe webhook endpoint.
 *
 * Listens for `payment_intent.succeeded` and credits the user's wallet.
 * Idempotency is enforced by checking for an existing transaction row with the
 * same `stripePaymentIntentId` before writing anything.
 *
 * Required env vars:
 *   STRIPE_WEBHOOK_SECRET  — whsec_... from the Stripe dashboard / CLI
 */
export async function POST(request: Request) {
  const body = await request.text()
  const sig = (await headers()).get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Webhook signature verification failed:', message)
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 })
  }

  // -------------------------------------------------------------------------
  // payment_intent.succeeded — credit wallet
  // -------------------------------------------------------------------------
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent

    const { userId, amountCents: amountStr, purpose } = pi.metadata ?? {}

    if (purpose !== 'wallet_deposit' || !userId || !amountStr) {
      // Not a wallet deposit — acknowledge and skip
      return NextResponse.json({ received: true })
    }

    const amountCents = Number(amountStr)
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      console.error('Invalid amountCents in PaymentIntent metadata:', amountStr)
      return NextResponse.json({ error: 'Invalid amount in metadata' }, { status: 400 })
    }

    // Idempotency check: skip if we've already processed this PaymentIntent
    const existing = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.stripePaymentIntentId, pi.id))
      .limit(1)

    if (existing.length > 0) {
      // Already processed — acknowledge without re-crediting
      return NextResponse.json({ received: true, duplicate: true })
    }

    // Get or create wallet
    const walletRows = await db
      .select()
      .from(wallet)
      .where(eq(wallet.userId, userId))
      .limit(1)

    let w = walletRows[0]
    if (!w) {
      const created = await db
        .insert(wallet)
        .values({ id: crypto.randomUUID(), userId })
        .returning()
      w = created[0]
    }

    const newBalance = w.balanceCents + amountCents

    // Write wallet update and transaction in the same logical step.
    // No DB transaction primitive used here (keep it simple), but the
    // idempotency check above guards against double-credits.
    await db
      .update(wallet)
      .set({ balanceCents: newBalance, updatedAt: new Date() })
      .where(eq(wallet.id, w.id))

    await db.insert(transactions).values({
      id: crypto.randomUUID(),
      userId,
      type: 'deposit',
      amountCents,
      description: 'Deposit via Stripe',
      status: 'completed',
      stripePaymentIntentId: pi.id,
    })

    console.log(`Credited ${amountCents} cents to user ${userId} (PI: ${pi.id})`)
  }

  // -------------------------------------------------------------------------
  // payment_intent.payment_failed — mark pending deposit as failed
  // -------------------------------------------------------------------------
  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object as Stripe.PaymentIntent
    const { purpose } = pi.metadata ?? {}
    if (purpose === 'wallet_deposit') {
      // Update any pending deposit transaction to 'failed'
      await db
        .update(transactions)
        .set({ status: 'failed' })
        .where(eq(transactions.stripePaymentIntentId, pi.id))
    }
  }

  return NextResponse.json({ received: true })
}

// App Router: tell Next.js this route must not be statically cached
// and that we handle the raw body ourselves via request.text().
export const dynamic = 'force-dynamic'
