// Ambient type declarations for environment variables used by stellar-save.
// All secrets are read server-side only; none are exposed to the client bundle.
declare namespace NodeJS {
  interface ProcessEnv {
    // Neon / Postgres
    DATABASE_URL: string

    // better-auth
    BETTER_AUTH_URL?: string
    BETTER_AUTH_SECRET: string

    // Vercel deployment (auto-set by Vercel)
    VERCEL_URL?: string
    VERCEL_PROJECT_PRODUCTION_URL?: string
    V0_RUNTIME_URL?: string

    // Stripe
    /** sk_live_... or sk_test_... */
    STRIPE_SECRET_KEY: string
    /** whsec_... — used to verify webhook signatures */
    STRIPE_WEBHOOK_SECRET: string
    /** pk_live_... or pk_test_... — safe to expose to the client */
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: string

    // App
    NEXT_PUBLIC_APP_URL: string

    // Stellar network
    /**
     * 'testnet' (default) or 'mainnet'.
     * Controls which Horizon URL and network passphrase are used.
     */
    STELLAR_NETWORK?: 'testnet' | 'mainnet'
    /** Client-safe copy of STELLAR_NETWORK — used to build Stellar Expert links in the UI. */
    NEXT_PUBLIC_STELLAR_NETWORK?: 'testnet' | 'mainnet'
    /** Override the Horizon base URL (e.g. a private instance). Optional. */
    STELLAR_HORIZON_URL?: string
    /** Override the network passphrase. Optional — derived from STELLAR_NETWORK if absent. */
    STELLAR_NETWORK_PASSPHRASE?: string
    /**
     * Secret key (S...) of the platform's funded Stellar account.
     * Used server-side to create user accounts on mainnet (CreateAccount operation).
     * On testnet, Friendbot is used instead and this variable is optional.
     */
    STELLAR_PLATFORM_SECRET?: string
  }
}
