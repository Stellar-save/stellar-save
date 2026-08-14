'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Sparkles, X } from 'lucide-react'
import Link from 'next/link'
import { getConnectStatus } from '@/app/actions/stripe'

type Status = 'loading' | 'ready' | 'incomplete'

export default function OnboardingReturnPage() {
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    getConnectStatus()
      .then(({ onboarded }) => setStatus(onboarded ? 'ready' : 'incomplete'))
      .catch(() => setStatus('incomplete'))
  }, [])

  return (
    <main className="auth-shell">
      <div className="auth-card items-center text-center">
        <span className="grid size-7 place-items-center rounded-lg bg-[#102b4e] text-[#f5c86a]">
          <Sparkles size={14} />
        </span>

        {status === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 size={36} className="animate-spin text-[#b07a18]" />
            <p className="font-semibold text-[#102b4e]">Checking your account status…</p>
          </div>
        )}

        {status === 'ready' && (
          <>
            <div className="flex flex-col items-center gap-3">
              <div className="grid size-16 place-items-center rounded-full bg-[#dff3e9] text-[#28634e]">
                <Check size={29} strokeWidth={2.5} />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-[-0.05em]">
                Payout account ready.
              </h1>
              <p className="text-[#728079]">
                Your Stripe Express account is verified. You can now cash out directly to
                your bank account from the dashboard.
              </p>
            </div>
            <Link href="/" className="primary-button w-full">
              Go to dashboard
            </Link>
          </>
        )}

        {status === 'incomplete' && (
          <>
            <div className="flex flex-col items-center gap-3">
              <div className="grid size-16 place-items-center rounded-full bg-[#fff1c9] text-[#b07a18]">
                <X size={29} strokeWidth={2.5} />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-[-0.05em]">
                Setup not complete.
              </h1>
              <p className="text-[#728079]">
                Stripe needs a bit more information before payouts can be enabled. This
                usually means a required field was left blank.
              </p>
            </div>
            <div className="flex w-full flex-col gap-3">
              {/* Refresh onboarding link — server action will redirect back to Stripe */}
              <Link href="/cashout/onboarding-refresh" className="primary-button w-full">
                Continue onboarding
              </Link>
              <Link
                href="/"
                className="text-center text-sm font-semibold text-[#b07a18]"
              >
                Back to dashboard
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
