import { bigint, boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
})

export const wallet = pgTable('wallet', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  balanceCents: integer('balanceCents').notNull().default(0),
  /** Stripe Connect Express account ID for payouts (e.g. acct_xxx). Null until onboarding completes. */
  stripeConnectAccountId: text('stripeConnectAccountId'),
  /** Whether Stripe Connect onboarding is fully complete (charges_enabled). */
  stripeConnectOnboarded: boolean('stripeConnectOnboarded').notNull().default(false),
  // -------------------------------------------------------------------------
  // Stellar network integration
  // -------------------------------------------------------------------------
  /** Stellar public key (G...) for this user's on-chain account. Null until provisioned. */
  stellarPublicKey: text('stellarPublicKey'),
  /** AES-256-GCM encrypted Stellar secret key ("iv_b64:ciphertext_b64"). Never returned to client. */
  stellarSecretKeyEnc: text('stellarSecretKeyEnc'),
  /** Cached XLM balance in stroops (1 XLM = 10,000,000 stroops) — refreshed on dashboard load. */
  xlmBalanceStroops: bigint('xlmBalanceStroops', { mode: 'bigint' }).notNull().default(0n),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const savingsGoal = pgTable('savings_goal', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  targetCents: integer('targetCents').notNull(),
  savedCents: integer('savedCents').notNull().default(0),
  /** Hex color string, e.g. "#5eb697". Used to derive accessible text/bg pairs at runtime. */
  color: text('color').notNull().default('#5eb697'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const transactions = pgTable('transaction', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'deposit' | 'send' | 'cashout' | 'goal_allocate' | 'goal_withdraw'
  amountCents: integer('amountCents').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('completed'), // 'pending' | 'completed' | 'failed'
  /** Stripe PaymentIntent ID — used for idempotency checks on webhook. */
  stripePaymentIntentId: text('stripePaymentIntentId'),
  /** Related savings goal ID, if applicable. */
  goalId: text('goalId'),
  /** Stellar transaction hash — set for XLM send/receive operations. */
  stellarTxHash: text('stellarTxHash'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})
