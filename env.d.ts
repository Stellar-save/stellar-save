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
  }
}
