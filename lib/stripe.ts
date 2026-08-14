import Stripe from 'stripe'

// ---------------------------------------------------------------------------
// Lazy singleton — safe to import at module level even when STRIPE_SECRET_KEY
// is absent (e.g. during `next build` without env vars set).
// The error is deferred until the first actual API call.
// ---------------------------------------------------------------------------

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (_stripe) return _stripe
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error(
      'STRIPE_SECRET_KEY environment variable is not set. ' +
        'Add it to .env.local (sk_test_...) for local development.',
    )
  }
  _stripe = new Stripe(key, {
    // Keep this in sync with the Stripe dashboard's webhook version.
    apiVersion: '2025-06-30.basil',
    typescript: true,
  })
  return _stripe
}

// Convenience re-export: a Proxy that initialises the singleton on first use.
// Type-safe because we cast to Stripe before proxying.
export const stripe = new Proxy<Stripe>({} as Stripe, {
  get(_target, prop: string | symbol) {
    const instance = getStripe()
    const value = (instance as Record<string | symbol, unknown>)[prop]
    return typeof value === 'function' ? value.bind(instance) : value
  },
})
