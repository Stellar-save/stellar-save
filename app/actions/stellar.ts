'use server'

import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { transactions, wallet } from '@/lib/db/schema'
import {
  createStellarAccount,
  decryptSecretKey,
  encryptSecretKey,
  fundWithFriendbot,
  generateKeypair,
  getNetwork,
  getXlmBalanceStroops,
  sendXlmPayment,
  stroopsToXlm,
} from '@/lib/stellar'

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function getUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

// ---------------------------------------------------------------------------
// Wallet helper (reuse the existing row or create one)
// ---------------------------------------------------------------------------

async function getOrCreateWallet(userId: string) {
  const rows = await db.select().from(wallet).where(eq(wallet.userId, userId)).limit(1)
  if (rows[0]) return rows[0]
  const created = await db
    .insert(wallet)
    .values({ id: crypto.randomUUID(), userId })
    .returning()
  return created[0]
}

// ---------------------------------------------------------------------------
// Provision Stellar account
// ---------------------------------------------------------------------------

/**
 * Creates a Stellar keypair for the user, funds it (Friendbot on testnet /
 * CreateAccount on mainnet), and persists the encrypted secret key.
 *
 * Safe to call multiple times — returns the existing account if already provisioned.
 */
export async function provisionStellarAccount(): Promise<{
  publicKey: string
  isNew: boolean
}> {
  const userId = await getUserId()
  const w = await getOrCreateWallet(userId)

  if (w.stellarPublicKey) {
    return { publicKey: w.stellarPublicKey, isNew: false }
  }

  const { publicKey, secretKey } = generateKeypair()
  const encryptedSecret = await encryptSecretKey(secretKey)

  if (getNetwork() === 'testnet') {
    // Friendbot funds testnet accounts with 10,000 XLM for free
    await fundWithFriendbot(publicKey)
  } else {
    // On mainnet the platform account must pay the minimum reserve
    const platformSecret = process.env.STELLAR_PLATFORM_SECRET
    if (!platformSecret) {
      throw new Error(
        'STELLAR_PLATFORM_SECRET is required to create accounts on mainnet',
      )
    }
    await createStellarAccount({ platformSecret, newPublicKey: publicKey })
  }

  // Persist public key + encrypted secret
  await db
    .update(wallet)
    .set({
      stellarPublicKey: publicKey,
      stellarSecretKeyEnc: encryptedSecret,
      updatedAt: new Date(),
    })
    .where(and(eq(wallet.id, w.id), eq(wallet.userId, userId)))

  revalidatePath('/')
  return { publicKey, isNew: true }
}

// ---------------------------------------------------------------------------
// Refresh cached XLM balance
// ---------------------------------------------------------------------------

/**
 * Fetches the live XLM balance from Horizon and caches it in the wallet row.
 * Returns the balance in stroops and as a formatted XLM string.
 */
export async function refreshXlmBalance(): Promise<{
  xlmBalanceStroops: bigint
  xlmFormatted: string
}> {
  const userId = await getUserId()
  const w = await getOrCreateWallet(userId)

  if (!w.stellarPublicKey) {
    return { xlmBalanceStroops: 0n, xlmFormatted: '0' }
  }

  const stroops = await getXlmBalanceStroops(w.stellarPublicKey)
  const formatted = stroopsToXlm(stroops)

  await db
    .update(wallet)
    .set({ xlmBalanceStroops: stroops, updatedAt: new Date() })
    .where(and(eq(wallet.id, w.id), eq(wallet.userId, userId)))

  revalidatePath('/')
  return { xlmBalanceStroops: stroops, xlmFormatted: formatted }
}

// ---------------------------------------------------------------------------
// Send XLM payment on the Stellar network
// ---------------------------------------------------------------------------

/**
 * Send XLM from the user's Stellar account to any G... public key.
 *
 * @param destinationPublicKey  Recipient's Stellar public key
 * @param amountXlm             Amount in XLM as a decimal string, e.g. "10.5"
 * @param memo                  Optional text memo (max 28 bytes, truncated)
 */
export async function sendXlm(input: {
  destinationPublicKey: string
  amountXlm: string
  memo?: string
}): Promise<{ txHash: string }> {
  const userId = await getUserId()
  const w = await getOrCreateWallet(userId)

  if (!w.stellarPublicKey || !w.stellarSecretKeyEnc) {
    throw new Error('Stellar account not provisioned. Please set up your account first.')
  }

  // Basic input validation
  const amount = parseFloat(input.amountXlm)
  if (isNaN(amount) || amount <= 0) throw new Error('Invalid XLM amount')
  if (amount > 1_000_000) throw new Error('Amount too large')

  // Validate destination key format (must start with G and be 56 chars)
  if (!/^G[A-Z0-9]{55}$/.test(input.destinationPublicKey)) {
    throw new Error('Invalid Stellar public key')
  }

  if (input.destinationPublicKey === w.stellarPublicKey) {
    throw new Error('Cannot send to your own account')
  }

  const secretKey = await decryptSecretKey(w.stellarSecretKeyEnc)

  const result = await sendXlmPayment({
    sourceSecret: secretKey,
    destinationPublicKey: input.destinationPublicKey,
    amountXlm: input.amountXlm,
    memo: input.memo,
  })

  const txHash = result.hash

  // Record the transaction in the ledger
  await db.insert(transactions).values({
    id: crypto.randomUUID(),
    userId,
    type: 'xlm_send',
    amountCents: 0, // XLM transactions don't have a USD cent value
    description: `Sent ${input.amountXlm} XLM → ${input.destinationPublicKey.slice(0, 8)}…`,
    status: 'completed',
    stellarTxHash: txHash,
  })

  // Refresh cached balance
  const newStroops = await getXlmBalanceStroops(w.stellarPublicKey)
  await db
    .update(wallet)
    .set({ xlmBalanceStroops: newStroops, updatedAt: new Date() })
    .where(and(eq(wallet.id, w.id), eq(wallet.userId, userId)))

  revalidatePath('/')
  return { txHash }
}

// ---------------------------------------------------------------------------
// Get Stellar account status (public key + cached balance)
// ---------------------------------------------------------------------------

export async function getStellarAccountStatus(): Promise<{
  publicKey: string | null
  xlmBalanceStroops: bigint
  xlmFormatted: string
  network: string
}> {
  const userId = await getUserId()
  const w = await getOrCreateWallet(userId)

  return {
    publicKey: w.stellarPublicKey ?? null,
    xlmBalanceStroops: w.xlmBalanceStroops ?? 0n,
    xlmFormatted: stroopsToXlm(w.xlmBalanceStroops ?? 0n),
    network: getNetwork(),
  }
}
