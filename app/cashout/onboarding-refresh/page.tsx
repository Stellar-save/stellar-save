/**
 * Stripe redirects here when the onboarding link expires before the user
 * finishes. We immediately re-trigger onboarding via a server action so they
 * get a fresh link without any manual click.
 */
import { startConnectOnboarding } from '@/app/actions/stripe'

export default async function OnboardingRefreshPage() {
  // This is an async server component — calling the action directly will
  // redirect() to Stripe before rendering any HTML.
  await startConnectOnboarding()
  // startConnectOnboarding always redirects, but satisfying TS:
  return null
}
