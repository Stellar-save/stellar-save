import {
  Horizon,
  Keypair,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Operation,
  Asset,
  Memo,
} from '@stellar/stellar-sdk'

// ---------------------------------------------------------------------------
// Network config
// ---------------------------------------------------------------------------

export type StellarNetwork = 'testnet' | 'mainnet'

export function getNetwork(): StellarNetwork {
  return (process.env.STELLAR_NETWORK as StellarNetwork | undefined) ?? 'testnet'
}

export function getNetworkPassphrase(): string {
  const override = process.env.STELLAR_NETWORK_PASSPHRASE
  if (override) return override
  return getNetwork() === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET
}

export function getHorizonUrl(): string {
  return (
    process.env.STELLAR_HORIZON_URL ??
    (getNetwork() === 'mainnet'
      ? 'https://horizon.stellar.org'
      : 'https://horizon-testnet.stellar.org')
  )
}

// ---------------------------------------------------------------------------
// Horizon server singleton
// ---------------------------------------------------------------------------

let _server: Horizon.Server | null = null

export function getServer(): Horizon.Server {
  if (_server) return _server
  _server = new Horizon.Server(getHorizonUrl(), { allowHttp: false })
  return _server
}

// ---------------------------------------------------------------------------
// Keypair helpers
// ---------------------------------------------------------------------------

/**
 * Generate a brand-new random Stellar keypair.
 * The secret key must be encrypted before storing — never persist it in plain text.
 */
export function generateKeypair(): { publicKey: string; secretKey: string } {
  const kp = Keypair.random()
  return { publicKey: kp.publicKey(), secretKey: kp.secret() }
}

/**
 * Derive a Keypair from a stored secret key.
 */
export function keypairFromSecret(secretKey: string): Keypair {
  return Keypair.fromSecret(secretKey)
}

// ---------------------------------------------------------------------------
// Account helpers
// ---------------------------------------------------------------------------

/**
 * Load a Stellar account from Horizon.
 * Returns null when the account doesn't exist yet (HTTP 404).
 */
export async function loadAccount(publicKey: string): Promise<Horizon.AccountResponse | null> {
  try {
    const server = getServer()
    return await server.loadAccount(publicKey)
  } catch (err: unknown) {
    // Horizon returns 404 for unfunded / non-existent accounts
    if (
      typeof err === 'object' &&
      err !== null &&
      'response' in err &&
      (err as { response?: { status?: number } }).response?.status === 404
    ) {
      return null
    }
    throw err
  }
}

/**
 * Fund an account on the testnet using Friendbot.
 * Only works on testnet — throws on mainnet.
 */
export async function fundWithFriendbot(publicKey: string): Promise<void> {
  if (getNetwork() === 'mainnet') {
    throw new Error('Friendbot is only available on testnet')
  }
  const res = await fetch(
    `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`,
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Friendbot failed (${res.status}): ${body}`)
  }
}

// ---------------------------------------------------------------------------
// XLM balance
// ---------------------------------------------------------------------------

/**
 * Return the native XLM balance of an account in stroops (1 XLM = 10,000,000 stroops).
 * Returns 0 if the account does not exist yet.
 */
export async function getXlmBalanceStroops(publicKey: string): Promise<bigint> {
  const account = await loadAccount(publicKey)
  if (!account) return 0n
  const native = account.balances.find((b) => b.asset_type === 'native')
  if (!native) return 0n
  // Stellar balances are strings like "10.5000000"
  const xlm = parseFloat(native.balance)
  return BigInt(Math.round(xlm * 10_000_000))
}

/**
 * Format stroops as a human-readable XLM string with 7 decimal places.
 */
export function stroopsToXlm(stroops: bigint | number): string {
  const n = typeof stroops === 'bigint' ? Number(stroops) : stroops
  return (n / 10_000_000).toFixed(7).replace(/\.?0+$/, '') || '0'
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * Submit a native XLM payment from `sourceSecret` to `destinationPublicKey`.
 *
 * @param sourceSecret       - Secret key of the sending account
 * @param destinationPublicKey - Recipient's public key
 * @param amountXlm          - Amount in XLM (e.g. "10.5")
 * @param memo               - Optional text memo (max 28 bytes)
 */
export async function sendXlmPayment({
  sourceSecret,
  destinationPublicKey,
  amountXlm,
  memo,
}: {
  sourceSecret: string
  destinationPublicKey: string
  amountXlm: string
  memo?: string
}): Promise<Horizon.HorizonApi.SubmitTransactionResponse> {
  const server = getServer()
  const sourceKeypair = Keypair.fromSecret(sourceSecret)

  const sourceAccount = await server.loadAccount(sourceKeypair.publicKey())

  const txBuilder = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(
      Operation.payment({
        destination: destinationPublicKey,
        asset: Asset.native(),
        amount: amountXlm,
      }),
    )
    .setTimeout(180)

  if (memo) {
    txBuilder.addMemo(Memo.text(memo.slice(0, 28)))
  }

  const tx = txBuilder.build()
  tx.sign(sourceKeypair)

  return server.submitTransaction(tx)
}

/**
 * Create (fund) a new account on Stellar by sending it a minimum balance.
 * Uses the platform account as the funding source.
 *
 * @param platformSecret      - Secret key of the platform's Stellar account
 * @param newPublicKey        - Public key of the account to create
 * @param startingBalance     - Starting balance in XLM (minimum ~1 XLM on mainnet)
 */
export async function createStellarAccount({
  platformSecret,
  newPublicKey,
  startingBalance = '2',
}: {
  platformSecret: string
  newPublicKey: string
  startingBalance?: string
}): Promise<Horizon.HorizonApi.SubmitTransactionResponse> {
  const server = getServer()
  const platformKeypair = Keypair.fromSecret(platformSecret)

  const platformAccount = await server.loadAccount(platformKeypair.publicKey())

  const tx = new TransactionBuilder(platformAccount, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(
      Operation.createAccount({
        destination: newPublicKey,
        startingBalance,
      }),
    )
    .setTimeout(180)
    .build()

  tx.sign(platformKeypair)
  return server.submitTransaction(tx)
}

// ---------------------------------------------------------------------------
// Simple symmetric encryption for secret key storage
// Uses AES-256-GCM via the Web Crypto API (available in Node 18+)
// ---------------------------------------------------------------------------

function encryptionKey(): Promise<CryptoKey> {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('BETTER_AUTH_SECRET is required for key encryption')
  // Derive a 256-bit key from the secret using SHA-256
  const raw = Buffer.from(secret.slice(0, 32).padEnd(32, '0'))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * Encrypt a Stellar secret key for storage.
 * Returns a base64-encoded "iv:ciphertext" string.
 */
export async function encryptSecretKey(secretKey: string): Promise<string> {
  const key = await encryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(secretKey)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  const ivB64 = Buffer.from(iv).toString('base64')
  const ctB64 = Buffer.from(ciphertext).toString('base64')
  return `${ivB64}:${ctB64}`
}

/**
 * Decrypt a stored secret key.
 */
export async function decryptSecretKey(encrypted: string): Promise<string> {
  const [ivB64, ctB64] = encrypted.split(':')
  if (!ivB64 || !ctB64) throw new Error('Invalid encrypted secret key format')
  const key = await encryptionKey()
  const iv = Buffer.from(ivB64, 'base64')
  const ciphertext = Buffer.from(ctB64, 'base64')
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}
