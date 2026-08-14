import { Check, Sparkles } from 'lucide-react'
import Link from 'next/link'

export default function DepositSuccessPage() {
  return (
    <main className="auth-shell">
      <div className="auth-card items-center text-center">
        <span className="grid size-7 place-items-center rounded-lg bg-[#102b4e] text-[#f5c86a]">
          <Sparkles size={14} />
        </span>

        <div className="flex flex-col items-center gap-3">
          <div className="grid size-16 place-items-center rounded-full bg-[#dff3e9] text-[#28634e]">
            <Check size={29} strokeWidth={2.5} />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-[-0.05em]">
            Deposit received.
          </h1>
          <p className="text-[#728079]">
            Your payment was successful. Your wallet balance will update within a few seconds
            once our webhook confirms the transaction.
          </p>
        </div>

        <Link
          href="/"
          className="primary-button w-full"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  )
}
