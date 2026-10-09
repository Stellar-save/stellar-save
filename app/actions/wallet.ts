'use server'

import { and, desc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { savingsGoal, transactions, wallet } from '@/lib/db/schema'
import { getXlmBalanceStroops, stroopsToXlm } from '@/lib/stellar'

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function getUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

// ---------------------------------------------------------------------------
// Wallet helpers
// ---------------------------------------------------------------------------

async function getOrCreateWallet(userId: string) {
  const existing = await db
    .select()
    .from(wallet)
    .where(eq(wallet.userId, userId))
    .limit(1)
  if (existing[0]) return existing[0]
  const created = await db
    .insert(wallet)
    .values({ id: crypto.randomUUID(), userId })
    .returning()
  return created[0]
}

// ---------------------------------------------------------------------------
// Read: full dashboard data (replaces all demo data)
// ---------------------------------------------------------------------------

export async function getWalletData() {
  const userId = await getUserId()
  const [walletRows, goals, activity] = await Promise.all([
    db.select().from(wallet).where(eq(wallet.userId, userId)).limit(1),
    db
      .select()
      .from(savingsGoal)
      .where(eq(savingsGoal.userId, userId))
      .orderBy(desc(savingsGoal.createdAt)),
    db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.createdAt))
      .limit(20),
  ])

  const w = walletRows[0] ?? null

  // Refresh the cached XLM balance from Horizon in the background whenever
  // the user has a provisioned Stellar account. We update the DB row but don't
  // block the response on it — the next load will show the freshest value.
  if (w?.stellarPublicKey) {
    getXlmBalanceStroops(w.stellarPublicKey)
      .then((stroops) => {
        if (stroops !== w.xlmBalanceStroops) {
          db.update(wallet)
            .set({ xlmBalanceStroops: stroops, updatedAt: new Date() })
            .where(eq(wallet.id, w.id))
            .catch(() => {/* non-critical cache refresh — ignore errors */})
        }
      })
      .catch(() => {/* Horizon unavailable — use cached value */})
  }

  return {
    wallet: w,
    goals,
    activity,
    stellar: w
      ? {
          publicKey: w.stellarPublicKey ?? null,
          xlmBalanceStroops: w.xlmBalanceStroops ?? 0n,
          xlmFormatted: stroopsToXlm(w.xlmBalanceStroops ?? 0n),
        }
      : { publicKey: null, xlmBalanceStroops: 0n, xlmFormatted: '0' },
  }
}

export async function ensureWallet() {
  const userId = await getUserId()
  const w = await getOrCreateWallet(userId)
  revalidatePath('/')
  return w
}

// ---------------------------------------------------------------------------
// Write: generic transaction (send / cashout / manual deposit)
// ---------------------------------------------------------------------------

export async function recordTransaction(input: {
  type: 'deposit' | 'send' | 'cashout'
  amountCents: number
  description: string
}) {
  const userId = await getUserId()

  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 10_000_000) {
    throw new Error('Invalid amount')
  }

  const current = await getOrCreateWallet(userId)
  const delta = input.type === 'deposit' ? input.amountCents : -input.amountCents
  const nextBalance = current.balanceCents + delta

  if (nextBalance < 0) throw new Error('Insufficient funds')

  await db
    .update(wallet)
    .set({ balanceCents: nextBalance, updatedAt: new Date() })
    .where(and(eq(wallet.id, current.id), eq(wallet.userId, userId)))

  await db.insert(transactions).values({
    id: crypto.randomUUID(),
    userId,
    type: input.type,
    amountCents: input.amountCents,
    description: input.description,
    status: 'completed',
  })

  revalidatePath('/')
  return { balanceCents: nextBalance }
}

// ---------------------------------------------------------------------------
// Savings goals CRUD
// ---------------------------------------------------------------------------

const GOAL_NAME_MAX = 60
const GOAL_TARGET_MAX_CENTS = 100_000_000 // $1,000,000

function validateGoalInput(name: string, targetCents: number, color: string) {
  if (!name || name.trim().length === 0) throw new Error('Goal name is required')
  if (name.trim().length > GOAL_NAME_MAX) throw new Error('Goal name is too long')
  if (!Number.isInteger(targetCents) || targetCents < 100 || targetCents > GOAL_TARGET_MAX_CENTS) {
    throw new Error('Target must be between $1.00 and $1,000,000')
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('Invalid color format')
}

export async function createSavingsGoal(input: {
  name: string
  targetCents: number
  color: string
}) {
  const userId = await getUserId()
  validateGoalInput(input.name, input.targetCents, input.color)

  const goal = await db
    .insert(savingsGoal)
    .values({
      id: crypto.randomUUID(),
      userId,
      name: input.name.trim(),
      targetCents: input.targetCents,
      color: input.color,
    })
    .returning()

  revalidatePath('/')
  return goal[0]
}

export async function updateSavingsGoal(input: {
  id: string
  name: string
  targetCents: number
  color: string
}) {
  const userId = await getUserId()
  validateGoalInput(input.name, input.targetCents, input.color)

  // Verify ownership
  const existing = await db
    .select()
    .from(savingsGoal)
    .where(and(eq(savingsGoal.id, input.id), eq(savingsGoal.userId, userId)))
    .limit(1)
  if (!existing[0]) throw new Error('Goal not found')

  // Target cannot be set below what's already saved
  if (input.targetCents < existing[0].savedCents) {
    throw new Error('Target cannot be less than amount already saved')
  }

  await db
    .update(savingsGoal)
    .set({
      name: input.name.trim(),
      targetCents: input.targetCents,
      color: input.color,
      updatedAt: new Date(),
    })
    .where(and(eq(savingsGoal.id, input.id), eq(savingsGoal.userId, userId)))

  revalidatePath('/')
}

export async function deleteSavingsGoal(id: string) {
  const userId = await getUserId()

  const existing = await db
    .select()
    .from(savingsGoal)
    .where(and(eq(savingsGoal.id, id), eq(savingsGoal.userId, userId)))
    .limit(1)
  if (!existing[0]) throw new Error('Goal not found')

  // Return saved amount to wallet if any
  if (existing[0].savedCents > 0) {
    const w = await getOrCreateWallet(userId)
    await db
      .update(wallet)
      .set({ balanceCents: w.balanceCents + existing[0].savedCents, updatedAt: new Date() })
      .where(eq(wallet.id, w.id))
    await db.insert(transactions).values({
      id: crypto.randomUUID(),
      userId,
      type: 'goal_withdraw',
      amountCents: existing[0].savedCents,
      description: `Returned from deleted goal: ${existing[0].name}`,
      status: 'completed',
      goalId: id,
    })
  }

  await db
    .delete(savingsGoal)
    .where(and(eq(savingsGoal.id, id), eq(savingsGoal.userId, userId)))

  revalidatePath('/')
}

export async function allocateToGoal(input: {
  goalId: string
  amountCents: number
  /** true = move FROM wallet TO goal; false = move FROM goal TO wallet */
  direction: 'add' | 'withdraw'
}) {
  const userId = await getUserId()

  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 10_000_000) {
    throw new Error('Invalid amount')
  }

  const [w, goalRows] = await Promise.all([
    getOrCreateWallet(userId),
    db
      .select()
      .from(savingsGoal)
      .where(and(eq(savingsGoal.id, input.goalId), eq(savingsGoal.userId, userId)))
      .limit(1),
  ])

  const goal = goalRows[0]
  if (!goal) throw new Error('Goal not found')

  if (input.direction === 'add') {
    if (w.balanceCents < input.amountCents) throw new Error('Insufficient wallet balance')
    const newSaved = goal.savedCents + input.amountCents
    if (newSaved > goal.targetCents) throw new Error('Amount exceeds remaining goal target')

    await Promise.all([
      db
        .update(wallet)
        .set({ balanceCents: w.balanceCents - input.amountCents, updatedAt: new Date() })
        .where(eq(wallet.id, w.id)),
      db
        .update(savingsGoal)
        .set({ savedCents: newSaved, updatedAt: new Date() })
        .where(eq(savingsGoal.id, goal.id)),
      db.insert(transactions).values({
        id: crypto.randomUUID(),
        userId,
        type: 'goal_allocate',
        amountCents: input.amountCents,
        description: `Added to goal: ${goal.name}`,
        status: 'completed',
        goalId: goal.id,
      }),
    ])
  } else {
    if (goal.savedCents < input.amountCents) throw new Error('Insufficient goal balance')

    await Promise.all([
      db
        .update(wallet)
        .set({ balanceCents: w.balanceCents + input.amountCents, updatedAt: new Date() })
        .where(eq(wallet.id, w.id)),
      db
        .update(savingsGoal)
        .set({ savedCents: goal.savedCents - input.amountCents, updatedAt: new Date() })
        .where(eq(savingsGoal.id, goal.id)),
      db.insert(transactions).values({
        id: crypto.randomUUID(),
        userId,
        type: 'goal_withdraw',
        amountCents: input.amountCents,
        description: `Withdrawn from goal: ${goal.name}`,
        status: 'completed',
        goalId: goal.id,
      }),
    ])
  }

  revalidatePath('/')
}
