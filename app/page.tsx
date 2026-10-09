'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleDollarSign,
  Edit2,
  ExternalLink,
  Landmark,
  Loader2,
  LogOut,
  MoreHorizontal,
  Plus,
  Send,
  Sparkles,
  Star,
  Target,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { accessibleTextColor } from '@/lib/contrast'
import { getWalletData, recordTransaction } from '@/app/actions/wallet'
import { createCheckoutSession, getConnectStatus, initiatePayout, startConnectOnboarding } from '@/app/actions/stripe'
import { provisionStellarAccount, refreshXlmBalance, sendXlm } from '@/app/actions/stellar'
import { AllocateModal, DeleteGoalConfirm, GoalFormModal } from '@/components/goal-modals'
import type { GoalRow } from '@/components/goal-modals'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WalletData = Awaited<ReturnType<typeof getWalletData>>
type TxRow = WalletData['activity'][number]

type Tab = 'home' | 'goals' | 'activity'
type Flow = 'send' | 'cashout' | 'xlm' | null
type SendStep = 'person' | 'amount' | 'done'
type CashoutStep = 'setup' | 'checking' | 'amount' | 'processing' | 'done' | 'needs-onboarding'
type XlmStep = 'panel' | 'send-dest' | 'send-amount' | 'sending' | 'done'

interface Person {
  name: string
  handle: string
  initials: string
  tone: string
}

const PEOPLE: Person[] = [
  { name: 'Maya Chen', handle: '@mayac', initials: 'MC', tone: 'blush' },
  { name: 'Jordan Lee', handle: '@jordanlee', initials: 'JL', tone: 'sky' },
  { name: 'Sam Rivera', handle: '@samr', initials: 'SR', tone: 'mint' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function fmtDate(iso: Date | string) {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86_400_000 && d.getDate() === now.getDate()) {
    return `Today, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  }
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth()) {
    return `Yesterday, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function txIcon(type: string) {
  if (type === 'deposit') return Landmark
  if (type === 'send') return ArrowUpRight
  if (type === 'cashout') return ArrowDownLeft
  if (type === 'goal_allocate') return Target
  if (type === 'goal_withdraw') return Target
  if (type === 'xlm_send') return Star
  return Wallet
}

function txIsCredit(type: string) {
  return type === 'deposit' || type === 'goal_withdraw'
}

function parseDollarsToCents(v: string) {
  const n = parseFloat(v.replace(/[^0-9.]/g, ''))
  if (isNaN(n) || n <= 0) return null
  return Math.round(n * 100)
}

function userInitials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function todayLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-[#e8e1d7] ${className}`} />
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[870px] px-5 py-6 sm:px-9 sm:py-8">
      <Skeleton className="mb-7 h-8 w-48" />
      <Skeleton className="mb-5 h-[152px] w-full rounded-[24px]" />
      <div className="grid grid-cols-3 gap-2.5">
        <Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" />
      </div>
      <Skeleton className="mt-9 h-6 w-32" />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root page component
// ---------------------------------------------------------------------------

export default function Page() {
  const { data: sessionData, isPending: sessionLoading } = authClient.useSession()
  const user = sessionData?.user ?? null

  const [data, setData] = useState<WalletData | null>(null)
  const [dataError, setDataError] = useState('')
  const [dataLoading, setDataLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  // UI state
  const [tab, setTab] = useState<Tab>('home')
  const [flow, setFlow] = useState<Flow>(null)
  const [sendStep, setSendStep] = useState<SendStep>('person')
  const [cashoutStep, setCashoutStep] = useState<CashoutStep>('setup')
  const [selectedPerson, setSelectedPerson] = useState<Person>(PEOPLE[0])
  const [amount, setAmount] = useState('')
  const [toast, setToast] = useState('')
  const [toastKind, setToastKind] = useState<'ok' | 'err'>('ok')

  // Goal modal state
  const [goalModal, setGoalModal] = useState<'create' | 'edit' | null>(null)
  const [editingGoal, setEditingGoal] = useState<GoalRow | null>(null)
  const [allocatingGoal, setAllocatingGoal] = useState<GoalRow | null>(null)
  const [deletingGoal, setDeletingGoal] = useState<GoalRow | null>(null)

  // Deposit amount picker
  const [showDepositPicker, setShowDepositPicker] = useState(false)
  const [depositDollars, setDepositDollars] = useState('')

  // Stellar / XLM state
  const [xlmStep, setXlmStep] = useState<XlmStep>('panel')
  const [xlmDest, setXlmDest] = useState('')
  const [xlmAmount, setXlmAmount] = useState('')
  const [xlmTxHash, setXlmTxHash] = useState('')

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---- data fetching ----

  const loadData = useCallback(async () => {
    if (!user) { setDataLoading(false); return }
    setDataLoading(true)
    try {
      const d = await getWalletData()
      setData(d)
      setDataError('')
    } catch (err) {
      console.error('[loadData]', err)
      setDataError('Could not load your account. Please refresh.')
    } finally {
      setDataLoading(false)
    }
  }, [user])

  useEffect(() => { loadData() }, [loadData])

  // ---- toast ----

  const showToast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast(msg)
    setToastKind(kind)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 4000)
  }, [])

  // ---- derived ----

  const balanceCents = data?.wallet?.balanceCents ?? 0
  const goals = data?.goals ?? []
  const activity = data?.activity ?? []
  const totalSavedCents = useMemo(() => goals.reduce((s, g) => s + g.savedCents, 0), [goals])
  const stellar = data?.stellar ?? { publicKey: null, xlmBalanceStroops: 0n, xlmFormatted: '0' }

  // ---- logout ----

  async function logout() {
    await authClient.signOut()
    window.location.href = '/sign-in'
  }

  // ---- flow helpers ----

  function resetFlow() {
    setFlow(null)
    setSendStep('person')
    setCashoutStep('setup')
    setAmount('')
    setXlmStep('panel')
    setXlmDest('')
    setXlmAmount('')
    setXlmTxHash('')
  }

  function openSend() { setFlow('send'); setSendStep('person') }
  function openXlm() { setFlow('xlm'); setXlmStep('panel') }
  function openCashout() {
    setFlow('cashout')
    setCashoutStep('checking')
    setAmount('')
    // Pre-check onboarding status
    startTransition(async () => {
      try {
        const { onboarded } = await getConnectStatus()
        setCashoutStep(onboarded ? 'amount' : 'needs-onboarding')
      } catch {
        setCashoutStep('needs-onboarding')
      }
    })
  }

  // ---- send flow ----

  function submitSend() {
    const cents = parseDollarsToCents(amount)
    if (!cents || cents > balanceCents) return
    startTransition(async () => {
      try {
        await recordTransaction({ type: 'send', amountCents: cents, description: `Sent to ${selectedPerson.name}` })
        await loadData()
        setSendStep('done')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Transfer failed', 'err')
      }
    })
  }

  // ---- cashout flow ----

  async function submitCashout() {
    const cents = parseDollarsToCents(amount)
    if (!cents || cents > balanceCents) return
    setCashoutStep('processing')
    try {
      await initiatePayout(cents)
      await loadData()
      setCashoutStep('done')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Cash out failed', 'err')
      setCashoutStep('amount')
    }
  }

  // ---- deposit via Stripe ----

  function submitDeposit() {
    const cents = parseDollarsToCents(depositDollars)
    if (!cents) return
    startTransition(async () => {
      try {
        await createCheckoutSession(cents) // redirects to Stripe
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not start deposit', 'err')
      }
    })
  }

  // ---- XLM flow ----

  async function handleProvisionStellar() {
    startTransition(async () => {
      try {
        await provisionStellarAccount()
        await loadData()
        showToast('Stellar account created and funded!')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not provision Stellar account', 'err')
      }
    })
  }

  async function handleRefreshXlm() {
    startTransition(async () => {
      try {
        await refreshXlmBalance()
        await loadData()
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not refresh balance', 'err')
      }
    })
  }

  async function submitXlmSend() {
    if (!xlmDest || !xlmAmount) return
    setXlmStep('sending')
    try {
      const { txHash } = await sendXlm({ destinationPublicKey: xlmDest, amountXlm: xlmAmount })
      setXlmTxHash(txHash)
      await loadData()
      setXlmStep('done')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'XLM transfer failed', 'err')
      setXlmStep('send-amount')
    }
  }

  // ---- goal modal callbacks ----

  function onGoalSaved() { loadData() }

  // ---- not signed in ----

  if (!sessionLoading && !user) {
    return (
      <main className="auth-shell">
        <div className="auth-card items-center text-center">
          <span className="grid size-8 place-items-center rounded-[11px] bg-[#102b4e] text-[#f5c86a]">
            <Sparkles size={17} />
          </span>
          <h1 className="font-display text-3xl font-bold tracking-[-0.05em]">stellar-save</h1>
          <p className="text-[#728079]">Sign in to see your savings at a glance.</p>
          <a href="/sign-in" className="primary-button w-full">Sign in</a>
          <a href="/sign-up" className="text-center text-sm font-semibold text-[#b07a18]">
            New here? Create an account
          </a>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#f3efe6] px-3 py-3 text-[#102b4e] sm:px-6 sm:py-6">
      <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1180px] overflow-hidden rounded-[28px] border border-[#d9d1c3] bg-[#fbfaf7] shadow-[0_24px_80px_rgba(16,43,78,0.12)] sm:min-h-[calc(100vh-3rem)]">

        {/* ---------------------------------------------------------------- */}
        {/* Sidebar                                                           */}
        {/* ---------------------------------------------------------------- */}
        <aside className="hidden w-[236px] shrink-0 flex-col border-r border-[#e5ded2] bg-[#f8f5ef] px-6 py-7 md:flex">
          <div className="flex items-center gap-2 font-display text-[22px] font-bold tracking-[-0.04em]">
            <span className="grid size-8 place-items-center rounded-[11px] bg-[#102b4e] text-[#f5c86a]">
              <Sparkles size={17} />
            </span>
            stellar-save
          </div>

          <nav className="mt-12 flex flex-col gap-2" aria-label="Main navigation">
            <NavItem icon={Wallet} label="Overview" active={tab === 'home'} onClick={() => { setTab('home'); resetFlow() }} />
            <NavItem icon={Target} label="Savings goals" active={tab === 'goals'} onClick={() => { setTab('goals'); resetFlow() }} />
            <NavItem icon={Send} label="Send money" active={false} onClick={openSend} />
            <NavItem icon={Star} label="Stellar (XLM)" active={flow === 'xlm'} onClick={openXlm} />
            <NavItem icon={ArrowDownLeft} label="Cash out" active={false} onClick={openCashout} />
            <NavItem icon={MoreHorizontal} label="Activity" active={tab === 'activity'} onClick={() => { setTab('activity'); resetFlow() }} />
          </nav>

          <div className="mt-auto rounded-2xl bg-[#e8f1ec] p-4 text-sm">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <CircleDollarSign size={16} /> Your money, your way
            </div>
            <p className="leading-5 text-[#5c706b]">Save steadily, spend intentionally, and stay in control.</p>
          </div>

          {/* User + logout */}
          <div className="mt-6 flex items-center gap-3 border-t border-[#e5ded2] pt-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#f0d9d2] text-xs font-bold">
              {user ? userInitials(user.name) : '…'}
            </span>
            <span className="min-w-0 flex-1 overflow-hidden">
              <span className="block truncate text-sm font-semibold">{user?.name ?? '…'}</span>
              <span className="block truncate text-xs text-[#7c877f]">{user?.email ?? ''}</span>
            </span>
            <button
              onClick={logout}
              aria-label="Sign out"
              title="Sign out"
              className="grid size-8 shrink-0 place-items-center rounded-full border border-[#e5ded2] text-[#77837d] transition hover:bg-[#f3efe6] hover:text-[#c15d54] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b07a18]/60"
            >
              <LogOut size={15} />
            </button>
          </div>
        </aside>

        {/* ---------------------------------------------------------------- */}
        {/* Main content                                                      */}
        {/* ---------------------------------------------------------------- */}
        <section className="min-w-0 flex-1">
          {/* Header */}
          <header className="flex items-center justify-between border-b border-[#e5ded2] px-5 py-5 sm:px-9">
            {/* Mobile logo */}
            <div className="flex items-center gap-2 font-display text-xl font-bold tracking-[-0.04em] md:hidden">
              <span className="grid size-7 place-items-center rounded-lg bg-[#102b4e] text-[#f5c86a]">
                <Sparkles size={14} />
              </span>
              stellar-save
            </div>

            {/* Desktop greeting */}
            <div className="hidden md:block">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#87928c]">{todayLabel()}</p>
              <h1 className="mt-1 font-display text-2xl font-bold tracking-[-0.03em]">
                {sessionLoading ? 'Loading…' : `${greeting()}, ${user?.name?.split(' ')[0] ?? 'there'}.`}
              </h1>
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-3">
              {/* Sync status indicator */}
              <span className="hidden text-xs font-semibold text-[#5c706b] sm:block">
                {isPending ? (
                  <span className="flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Saving…</span>
                ) : data ? (
                  'Synced'
                ) : dataLoading ? (
                  <span className="flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading…</span>
                ) : null}
              </span>

              {/* Mobile: avatar + logout */}
              <button
                aria-label="Open profile"
                className="grid size-9 place-items-center rounded-full bg-[#f0d9d2] text-xs font-bold md:hidden"
              >
                {user ? userInitials(user.name) : '?'}
              </button>
              <button
                onClick={logout}
                aria-label="Sign out"
                className="grid size-9 place-items-center rounded-full border border-[#e5ded2] text-[#77837d] transition hover:text-[#c15d54] md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b07a18]/60"
              >
                <LogOut size={15} />
              </button>
            </div>
          </header>

          {/* Body */}
          {dataLoading || sessionLoading ? (
            <DashboardSkeleton />
          ) : dataError ? (
            <div className="mx-auto max-w-[870px] px-5 py-12 text-center">
              <p className="font-semibold text-[#c15d54]">{dataError}</p>
              <button onClick={loadData} className="primary-button mt-4">Retry</button>
            </div>
          ) : (
            <div className="mx-auto max-w-[870px] px-5 py-6 sm:px-9 sm:py-8">

              {/* Toast */}
              {toast && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`mb-4 flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${
                    toastKind === 'ok'
                      ? 'bg-[#e8f1ec] text-[#28634e]'
                      : 'bg-[#f8dfda] text-[#8c3c37]'
                  }`}
                >
                  {toastKind === 'ok' ? <Check size={16} /> : <X size={16} />}
                  {toast}
                </div>
              )}

              {flow ? (
                flow === 'xlm' ? (
                  <XlmFlowView
                    stellar={stellar}
                    xlmStep={xlmStep}
                    xlmDest={xlmDest}
                    xlmAmount={xlmAmount}
                    xlmTxHash={xlmTxHash}
                    isPending={isPending}
                    setXlmDest={setXlmDest}
                    setXlmAmount={setXlmAmount}
                    onBack={resetFlow}
                    onProvision={handleProvisionStellar}
                    onRefresh={handleRefreshXlm}
                    onGoToSend={() => setXlmStep('send-dest')}
                    onGoToAmount={() => setXlmStep('send-amount')}
                    onSubmitSend={submitXlmSend}
                  />
                ) : (
                <FlowView
                  flow={flow}
                  sendStep={sendStep}
                  cashoutStep={cashoutStep}
                  selectedPerson={selectedPerson}
                  amount={amount}
                  setAmount={setAmount}
                  balanceCents={balanceCents}
                  isPending={isPending}
                  onBack={resetFlow}
                  onSelectPerson={(p) => { setSelectedPerson(p); setSendStep('amount') }}
                  onSend={submitSend}
                  onStartCashout={submitCashout}
                  onStartOnboarding={() => { startTransition(async () => { await startConnectOnboarding() }) }}
                />
                )
              ) : (
                <>
                  {/* Mobile greeting */}
                  <div className="mb-7 flex items-end justify-between">
                    <div>
                      <p className="text-sm text-[#78857f] md:hidden">{todayLabel()}</p>
                      <h1 className="mt-1 font-display text-[29px] font-bold tracking-[-0.045em] md:hidden">
                        {greeting()}, {user?.name?.split(' ')[0]}.
                      </h1>
                      <p className="mt-1 text-[15px] text-[#728079]">Here&apos;s your money at a glance.</p>
                    </div>
                  </div>

                  {/* Balance card */}
                  <div className="balance-card">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm text-[#d6dfdf]">Available balance</p>
                        <p className="mt-2 font-display text-[42px] font-bold leading-none tracking-[-0.06em]">
                          {fmt(balanceCents)}
                        </p>
                      </div>
                      <div className="grid size-11 place-items-center rounded-2xl bg-[#254568] text-[#f5c86a]">
                        <Wallet size={21} />
                      </div>
                    </div>
                    <div className="mt-8 flex items-end justify-between">
                      <div>
                        <p className="text-xs text-[#b4c4c6]">Goals saved total</p>
                        <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-[#8fe0bd]">
                          <Target size={14} /> {fmt(totalSavedCents)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-[#b4c4c6]">{goals.length} active goal{goals.length !== 1 ? 's' : ''}</p>
                        {stellar.publicKey && (
                          <button
                            onClick={openXlm}
                            className="mt-1 flex items-center gap-1 text-xs font-semibold text-[#f5c86a] hover:underline"
                          >
                            <Star size={11} />
                            {stellar.xlmFormatted} XLM
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Quick actions */}
                  <div className="mt-5 grid grid-cols-4 gap-2.5 sm:gap-3">
                    <QuickAction icon={Plus} label="Add money" onClick={() => setShowDepositPicker((o) => !o)} />
                    <QuickAction icon={Send} label="Send" onClick={openSend} />
                    <QuickAction icon={Star} label="Stellar" onClick={openXlm} />
                    <QuickAction icon={ArrowDownLeft} label="Cash out" onClick={openCashout} />
                  </div>

                  {/* Deposit picker */}
                  {showDepositPicker && (
                    <div className="mt-3 rounded-2xl border border-[#e6ded1] bg-[#f8f5ef] p-4">
                      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[#8a958e]">
                        Add money
                      </p>
                      {/* Quick-add chips — direct wallet credit, no Stripe needed */}
                      <div className="flex gap-2 flex-wrap mb-3">
                        {[25, 50, 100, 250].map((d) => (
                          <button
                            key={d}
                            disabled={isPending}
                            onClick={() => {
                              startTransition(async () => {
                                try {
                                  await recordTransaction({ type: 'deposit', amountCents: d * 100, description: `Added $${d}` })
                                  await loadData()
                                  showToast(`$${d}.00 added to your wallet`)
                                  setShowDepositPicker(false)
                                } catch (err) {
                                  showToast(err instanceof Error ? err.message : 'Could not add money', 'err')
                                }
                              })
                            }}
                            className="amount-chip disabled:opacity-40"
                          >
                            {isPending ? <Loader2 size={12} className="animate-spin inline" /> : `+$${d}`}
                          </button>
                        ))}
                      </div>
                      {/* Custom amount — uses Stripe Checkout if keys are configured */}
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-[#102b4e]">$</span>
                          <input
                            inputMode="decimal"
                            value={depositDollars}
                            onChange={(e) => setDepositDollars(e.target.value.replace(/[^0-9.]/g, ''))}
                            placeholder="Custom amount"
                            className="auth-input w-full pl-7"
                          />
                        </div>
                        <button
                          onClick={submitDeposit}
                          disabled={!depositDollars || isPending}
                          className="primary-button disabled:opacity-40"
                        >
                          {isPending ? <Loader2 size={16} className="animate-spin" /> : 'Pay'}
                        </button>
                      </div>
                      <p className="mt-2 text-[11px] text-[#8a958e]">
                        Quick add uses direct credit. Custom amount requires Stripe keys in .env.local.
                      </p>
                    </div>
                  )}

                  {/* Tab: Goals */}
                  {tab === 'goals' && (
                    <GoalsTab
                      goals={goals}
                      walletBalanceCents={balanceCents}
                      totalSaved={totalSavedCents}
                      onCreateGoal={() => setGoalModal('create')}
                      onEditGoal={(g) => { setEditingGoal(g); setGoalModal('edit') }}
                      onAllocateGoal={(g) => setAllocatingGoal(g)}
                      onDeleteGoal={(g) => setDeletingGoal(g)}
                    />
                  )}

                  {/* Tab: Activity */}
                  {tab === 'activity' && (
                    <ActivityTab activity={activity} />
                  )}

                  {/* Tab: Home */}
                  {tab === 'home' && (
                    <>
                      {/* Goals preview */}
                      <section className="mt-9">
                        <div className="mb-4 flex items-center justify-between">
                          <div>
                            <h2 className="font-display text-xl font-bold tracking-[-0.03em]">Your savings</h2>
                            <p className="mt-1 text-sm text-[#7b8881]">Small steps add up.</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setGoalModal('create')}
                              className="flex items-center gap-1 text-sm font-semibold text-[#b07a18] hover:underline"
                            >
                              <Plus size={14} /> New
                            </button>
                            <button
                              onClick={() => setTab('goals')}
                              className="text-sm font-semibold text-[#b07a18]"
                            >
                              See all <ChevronRight className="inline" size={15} />
                            </button>
                          </div>
                        </div>
                        {goals.length === 0 ? (
                          <button
                            onClick={() => setGoalModal('create')}
                            className="flex w-full flex-col items-center gap-2 rounded-[20px] border border-dashed border-[#d9d1c3] bg-[#fffefa] py-10 text-[#8a958e] transition hover:border-[#b07a18] hover:text-[#b07a18]"
                          >
                            <Plus size={22} />
                            <span className="text-sm font-semibold">Create your first savings goal</span>
                          </button>
                        ) : (
                          <div className="grid gap-3 sm:grid-cols-3">
                            {goals.slice(0, 3).map((g) => (
                              <GoalCard
                                key={g.id}
                                goal={g}
                                onAllocate={() => setAllocatingGoal(g)}
                                onEdit={() => { setEditingGoal(g); setGoalModal('edit') }}
                                onDelete={() => setDeletingGoal(g)}
                              />
                            ))}
                          </div>
                        )}
                      </section>

                      {/* Recent activity */}
                      <section className="mt-9">
                        <div className="mb-4 flex items-center justify-between">
                          <h2 className="font-display text-xl font-bold tracking-[-0.03em]">Recent activity</h2>
                          <button onClick={() => setTab('activity')} className="text-sm font-semibold text-[#b07a18]">
                            View all <ChevronRight className="inline" size={15} />
                          </button>
                        </div>
                        {activity.length === 0 ? (
                          <p className="rounded-2xl border border-[#e6ded1] bg-[#fffefa] px-4 py-8 text-center text-sm text-[#8a958e]">
                            No transactions yet. Add money to get started.
                          </p>
                        ) : (
                          <div className="divide-y divide-[#ece5da] rounded-2xl border border-[#e6ded1] bg-[#fffefa] px-4">
                            {activity.slice(0, 5).map((tx) => (
                              <TxRow key={tx.id} tx={tx} />
                            ))}
                          </div>
                        )}
                      </section>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Goal modals */}
      {goalModal === 'create' && (
        <GoalFormModal mode="create" onClose={() => setGoalModal(null)} onSaved={onGoalSaved} />
      )}
      {goalModal === 'edit' && editingGoal && (
        <GoalFormModal mode="edit" initial={editingGoal} onClose={() => { setGoalModal(null); setEditingGoal(null) }} onSaved={onGoalSaved} />
      )}
      {allocatingGoal && (
        <AllocateModal
          goal={allocatingGoal}
          walletBalanceCents={balanceCents}
          onClose={() => setAllocatingGoal(null)}
          onSaved={onGoalSaved}
        />
      )}
      {deletingGoal && (
        <DeleteGoalConfirm
          goal={deletingGoal}
          onClose={() => setDeletingGoal(null)}
          onDeleted={onGoalSaved}
        />
      )}
    </main>
  )
}

// ---------------------------------------------------------------------------
// Nav item
// ---------------------------------------------------------------------------

function NavItem({ icon: Icon, label, active, onClick }: { icon: typeof Wallet; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`nav-item ${active ? 'nav-item-active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <Icon size={18} />
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Quick action button
// ---------------------------------------------------------------------------

function QuickAction({ icon: Icon, label, onClick }: { icon: typeof Plus; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="quick-action">
      <span><Icon size={17} /></span>
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Goal card
// ---------------------------------------------------------------------------

function GoalCard({
  goal,
  onAllocate,
  onEdit,
  onDelete,
}: {
  goal: GoalRow
  onAllocate: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const percent = Math.min(100, Math.round((goal.savedCents / goal.targetCents) * 100))
  const textColor = accessibleTextColor(goal.color)
  const complete = goal.savedCents >= goal.targetCents

  return (
    <div className="goal-card group relative">
      {/* Accent icon */}
      <div
        className="goal-icon"
        style={{ backgroundColor: `${goal.color}22`, color: goal.color }}
      >
        <Target size={17} />
      </div>

      {/* Actions */}
      <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          onClick={onEdit}
          aria-label={`Edit ${goal.name}`}
          className="goal-action-btn"
        >
          <Edit2 size={12} />
        </button>
        <button
          onClick={onDelete}
          aria-label={`Delete ${goal.name}`}
          className="goal-action-btn goal-action-btn-danger"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="mt-4 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{goal.name}</h3>
          <p className="mt-1 text-xs text-[#829088]">
            {fmt(goal.savedCents)} of {fmt(goal.targetCents)}
          </p>
        </div>
        <span
          className="shrink-0 rounded-lg px-1.5 py-0.5 text-xs font-bold"
          style={{ backgroundColor: goal.color, color: textColor }}
        >
          {percent}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#eee8de]">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${percent}%`, backgroundColor: goal.color }}
        />
      </div>

      {/* Allocate button */}
      <button
        onClick={onAllocate}
        disabled={complete && goal.savedCents === goal.targetCents}
        className="mt-4 w-full rounded-xl border border-[#e6ded1] py-2 text-xs font-semibold text-[#102b4e] transition hover:border-[#b07a18] hover:text-[#b07a18] disabled:cursor-default disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b07a18]/60"
      >
        {complete ? '🎉 Goal reached!' : 'Add / Withdraw'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Transaction row
// ---------------------------------------------------------------------------

function TxRow({ tx }: { tx: TxRow }) {
  const Icon = txIcon(tx.type)
  const credit = txIsCredit(tx.type)
  const isXlm = tx.type === 'xlm_send'
  return (
    <div className="flex items-center gap-3 py-4">
      <div className={`activity-icon ${credit ? 'activity-in' : 'activity-out'}`}>
        <Icon size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{tx.description}</p>
        <p className="mt-1 text-xs text-[#8a958e]">{fmtDate(tx.createdAt)}</p>
        {tx.stellarTxHash && (
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${tx.stellarTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-[#b07a18] hover:underline"
          >
            View on Stellar Expert <ExternalLink size={9} />
          </a>
        )}
        {tx.status === 'failed' && (
          <span className="mt-0.5 inline-block rounded bg-[#f8dfda] px-1.5 py-0.5 text-[10px] font-bold text-[#8c3c37]">
            Failed
          </span>
        )}
        {tx.status === 'pending' && (
          <span className="mt-0.5 inline-block rounded bg-[#fff1c9] px-1.5 py-0.5 text-[10px] font-bold text-[#9e6a12]">
            Pending
          </span>
        )}
      </div>
      <p className={`shrink-0 text-sm font-bold ${credit ? 'text-[#28634e]' : 'text-[#c15d54]'}`}>
        {isXlm ? <span className="flex items-center gap-0.5"><Star size={11} /> XLM</span> : (credit ? '+' : '−') + fmt(tx.amountCents)}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Goals tab (full list)
// ---------------------------------------------------------------------------

function GoalsTab({
  goals,
  walletBalanceCents,
  totalSaved,
  onCreateGoal,
  onEditGoal,
  onAllocateGoal,
  onDeleteGoal,
}: {
  goals: GoalRow[]
  walletBalanceCents: number
  totalSaved: number
  onCreateGoal: () => void
  onEditGoal: (g: GoalRow) => void
  onAllocateGoal: (g: GoalRow) => void
  onDeleteGoal: (g: GoalRow) => void
}) {
  return (
    <section className="mt-8">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b07a18]">Goals overview</p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-[-0.05em]">Keep going.</h2>
        </div>
        <div className="text-right">
          <p className="text-sm text-[#7b8881]">Total saved</p>
          <strong className="text-lg text-[#102b4e]">{fmt(totalSaved)}</strong>
        </div>
      </div>

      {goals.length === 0 ? (
        <button
          onClick={onCreateGoal}
          className="flex w-full flex-col items-center gap-2 rounded-[20px] border border-dashed border-[#d9d1c3] bg-[#fffefa] py-12 text-[#8a958e] transition hover:border-[#b07a18] hover:text-[#b07a18]"
        >
          <Plus size={24} />
          <span className="text-sm font-semibold">Create your first savings goal</span>
        </button>
      ) : (
        <div className="flex flex-col gap-3">
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              onAllocate={() => onAllocateGoal(g)}
              onEdit={() => onEditGoal(g)}
              onDelete={() => onDeleteGoal(g)}
            />
          ))}
        </div>
      )}

      <button
        onClick={onCreateGoal}
        className="primary-button mt-5 w-full"
      >
        <Plus size={16} /> New savings goal
      </button>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Activity tab (full list)
// ---------------------------------------------------------------------------

function ActivityTab({ activity }: { activity: TxRow[] }) {
  return (
    <section className="mt-8">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b07a18]">Transaction history</p>
        <h2 className="mt-2 font-display text-3xl font-bold tracking-[-0.05em]">All activity.</h2>
      </div>
      {activity.length === 0 ? (
        <p className="rounded-2xl border border-[#e6ded1] bg-[#fffefa] px-4 py-10 text-center text-sm text-[#8a958e]">
          No transactions yet.
        </p>
      ) : (
        <div className="divide-y divide-[#ece5da] rounded-2xl border border-[#e6ded1] bg-[#fffefa] px-4">
          {activity.map((tx) => <TxRow key={tx.id} tx={tx} />)}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Send / cash-out flow view
// ---------------------------------------------------------------------------

function FlowView({
  flow,
  sendStep,
  cashoutStep,
  selectedPerson,
  amount,
  setAmount,
  balanceCents,
  isPending,
  onBack,
  onSelectPerson,
  onSend,
  onStartCashout,
  onStartOnboarding,
}: {
  flow: Flow
  sendStep: SendStep
  cashoutStep: CashoutStep
  selectedPerson: Person
  amount: string
  setAmount: (v: string) => void
  balanceCents: number
  isPending: boolean
  onBack: () => void
  onSelectPerson: (p: Person) => void
  onSend: () => void
  onStartCashout: () => void
  onStartOnboarding: () => void
}) {
  const isSend = flow === 'send'

  return (
    <div className="mx-auto max-w-[560px]">
      <button
        onClick={onBack}
        className="mb-8 flex items-center gap-2 text-sm font-semibold text-[#728079] transition hover:text-[#102b4e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b07a18]/60 rounded-lg"
      >
        <ArrowLeft size={17} /> Back to overview
      </button>

      {/* ---- Send flow ---- */}
      {isSend && (
        <>
          <div className="mb-9">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b07a18]">Send money</p>
            <h2 className="mt-2 font-display text-4xl font-bold tracking-[-0.06em]">
              {sendStep === 'done' ? 'You\u2019re all set.' : 'Who are you sending to?'}
            </h2>
            <p className="mt-3 text-[#78857f]">
              {sendStep === 'done'
                ? 'Your transfer was recorded.'
                : sendStep === 'amount'
                ? `Sending to ${selectedPerson.name}.`
                : 'Choose someone from your stellar-save circle.'}
            </p>
          </div>

          {sendStep === 'person' && (
            <div className="flex flex-col gap-3">
              {PEOPLE.map((p) => (
                <button
                  key={p.handle}
                  onClick={() => onSelectPerson(p)}
                  className="person-row"
                >
                  <span className={`person-avatar ${p.tone}`}>{p.initials}</span>
                  <span className="flex-1 text-left">
                    <strong className="block text-sm">{p.name}</strong>
                    <small className="mt-1 block text-[#8a958e]">{p.handle}</small>
                  </span>
                  <ChevronRight size={18} className="text-[#a0aaa3]" />
                </button>
              ))}
            </div>
          )}

          {sendStep === 'amount' && (
            <AmountStep
              label={`Send to ${selectedPerson.name}`}
              avatar={selectedPerson.initials}
              amount={amount}
              setAmount={setAmount}
              maxCents={balanceCents}
              onSubmit={onSend}
              action="Send money"
              isPending={isPending}
            />
          )}

          {sendStep === 'done' && (
            <div className="status-card">
              <div className="grid size-16 place-items-center rounded-full bg-[#dff3e9] text-[#28634e]">
                <Check size={29} />
              </div>
              <p className="mt-5 font-display text-2xl font-bold">Transfer complete</p>
              <p className="mt-2 text-sm text-[#78857f]">You&apos;ll see the update in your activity shortly.</p>
              <button onClick={onBack} className="primary-button mt-7">Done</button>
            </div>
          )}
        </>
      )}

      {/* ---- Cash-out flow ---- */}
      {!isSend && (
        <>
          <div className="mb-9">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b07a18]">Cash out</p>
            <h2 className="mt-2 font-display text-4xl font-bold tracking-[-0.06em]">
              {cashoutStep === 'done'
                ? 'Transfer initiated.'
                : cashoutStep === 'processing'
                ? 'On its way.'
                : cashoutStep === 'needs-onboarding'
                ? 'Set up payouts.'
                : cashoutStep === 'checking'
                ? 'Checking account…'
                : 'How much to cash out?'}
            </h2>
            <p className="mt-3 text-[#78857f]">
              {cashoutStep === 'done'
                ? 'Your bank transfer has been initiated.'
                : cashoutStep === 'processing'
                ? 'We\u2019re securely moving your money.'
                : cashoutStep === 'needs-onboarding'
                ? 'Connect a bank account to enable payouts.'
                : cashoutStep === 'checking'
                ? 'Verifying your payout account with Stripe.'
                : `Available balance: ${fmt(balanceCents)}`}
            </p>
          </div>

          {cashoutStep === 'checking' && (
            <div className="flex justify-center py-10">
              <Loader2 size={36} className="animate-spin text-[#b07a18]" />
            </div>
          )}

          {cashoutStep === 'needs-onboarding' && (
            <div className="flex flex-col gap-4 rounded-[24px] border border-[#e6ded1] bg-[#fffefa] p-6">
              <div className="flex items-center gap-3">
                <div className="grid size-11 place-items-center rounded-2xl bg-[#e8f1ec] text-[#28634e]">
                  <Landmark size={20} />
                </div>
                <div>
                  <p className="font-semibold">Connect your bank</p>
                  <p className="text-sm text-[#8a958e]">Powered by Stripe Express</p>
                </div>
              </div>
              <p className="text-sm text-[#5c706b]">
                To receive payouts, you need to complete a quick Stripe onboarding. This
                typically takes 2&ndash;3 minutes and requires ID verification.
              </p>
              <p className="rounded-xl bg-[#fff1c9] px-3 py-2 text-xs font-semibold text-[#9e6a12]">
                Payouts are subject to Stripe&apos;s availability in your country and may require
                additional verification. Stripe Connect Express is not available in all regions.
              </p>
              <button
                onClick={onStartOnboarding}
                disabled={isPending}
                className="primary-button w-full disabled:opacity-50"
              >
                {isPending ? <><Loader2 size={16} className="animate-spin" /> Redirecting…</> : 'Start onboarding with Stripe'}
              </button>
            </div>
          )}

          {cashoutStep === 'amount' && (
            <AmountStep
              label="Cash out from stellar-save"
              avatar="$$"
              amount={amount}
              setAmount={setAmount}
              maxCents={balanceCents}
              onSubmit={onStartCashout}
              action="Cash out"
              isPending={isPending}
            />
          )}

          {cashoutStep === 'processing' && (
            <div className="status-card">
              <div className="processing-ring"><Landmark size={25} /></div>
              <p className="mt-5 font-semibold">Processing your cash out</p>
              <p className="mt-2 text-sm text-[#78857f]">This usually takes a few seconds.</p>
            </div>
          )}

          {cashoutStep === 'done' && (
            <div className="status-card">
              <div className="grid size-16 place-items-center rounded-full bg-[#dff3e9] text-[#28634e]">
                <Check size={29} />
              </div>
              <p className="mt-5 font-display text-2xl font-bold">Transfer initiated</p>
              <p className="mt-2 text-sm text-[#78857f]">
                Funds are on their way to your bank. Arrival time depends on Stripe&apos;s payout schedule.
              </p>
              <button onClick={onBack} className="primary-button mt-7">Done</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Amount entry step (shared by send + cashout)
// ---------------------------------------------------------------------------

function AmountStep({
  label,
  avatar,
  amount,
  setAmount,
  maxCents,
  onSubmit,
  action,
  isPending,
}: {
  label: string
  avatar: string
  amount: string
  setAmount: (v: string) => void
  maxCents: number
  onSubmit: () => void
  action: string
  isPending: boolean
}) {
  const cents = parseDollarsToCents(amount)
  const overBalance = cents !== null && cents > maxCents

  return (
    <div className="rounded-[24px] border border-[#e6ded1] bg-[#fffefa] p-5 sm:p-7">
      <div className="flex items-center gap-3 border-b border-[#eee8de] pb-5">
        <span className="grid size-11 place-items-center rounded-full bg-[#f0d9d2] text-xs font-bold">
          {avatar}
        </span>
        <span className="text-sm font-semibold">{label}</span>
      </div>

      <label className="mt-8 block text-xs font-bold uppercase tracking-[0.16em] text-[#8a958e]" htmlFor="flow-amount">
        Amount
      </label>
      <div className={`mt-2 flex items-center border-b-2 pb-3 ${overBalance ? 'border-[#c15d54]' : 'border-[#102b4e]'}`}>
        <span className="font-display text-3xl font-bold">$</span>
        <input
          id="flow-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="0.00"
          aria-invalid={overBalance}
          aria-describedby={overBalance ? 'flow-amount-error' : undefined}
          className="min-w-0 flex-1 bg-transparent px-2 font-display text-4xl font-bold outline-none placeholder:text-[#c6c2ba]"
        />
      </div>

      {overBalance && (
        <p id="flow-amount-error" role="alert" className="mt-2 text-sm font-semibold text-[#c15d54]">
          Exceeds available balance ({fmt(maxCents)})
        </p>
      )}

      <div className="mt-5 flex gap-2">
        {[25, 50, 100].map((v) => (
          <button key={v} onClick={() => setAmount(String(v))} className="amount-chip">
            ${v}
          </button>
        ))}
      </div>

      <button
        onClick={onSubmit}
        disabled={!amount || overBalance || isPending}
        className="primary-button mt-8 w-full disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isPending ? (
          <><Loader2 size={16} className="animate-spin" /> Processing…</>
        ) : (
          <>{action} <ArrowUpRight size={17} /></>
        )}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stellar / XLM flow view
// ---------------------------------------------------------------------------

function XlmFlowView({
  stellar,
  xlmStep,
  xlmDest,
  xlmAmount,
  xlmTxHash,
  isPending,
  setXlmDest,
  setXlmAmount,
  onBack,
  onProvision,
  onRefresh,
  onGoToSend,
  onSubmitSend,
}: {
  stellar: { publicKey: string | null; xlmBalanceStroops: bigint; xlmFormatted: string }
  xlmStep: XlmStep
  xlmDest: string
  xlmAmount: string
  xlmTxHash: string
  isPending: boolean
  setXlmDest: (v: string) => void
  setXlmAmount: (v: string) => void
  onBack: () => void
  onProvision: () => void
  onRefresh: () => void
  onGoToSend: () => void
  onGoToAmount: () => void
  onSubmitSend: () => void
}) {
  const network = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet')
    : 'testnet'

  const explorerBase = network === 'mainnet'
    ? 'https://stellar.expert/explorer/public'
    : 'https://stellar.expert/explorer/testnet'

  const destInvalid = xlmDest.length > 0 && !/^G[A-Z0-9]{55}$/.test(xlmDest)
  const amountNum = parseFloat(xlmAmount)
  const amountInvalid = xlmAmount.length > 0 && (isNaN(amountNum) || amountNum <= 0)

  return (
    <div className="mx-auto max-w-[560px]">
      <button
        onClick={onBack}
        className="mb-8 flex items-center gap-2 text-sm font-semibold text-[#728079] transition hover:text-[#102b4e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b07a18]/60 rounded-lg"
      >
        <ArrowLeft size={17} /> Back to overview
      </button>

      <div className="mb-7">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b07a18]">Stellar network</p>
        <h2 className="mt-2 font-display text-4xl font-bold tracking-[-0.06em]">
          {xlmStep === 'done' ? 'Payment sent.' : xlmStep === 'sending' ? 'Sending…' : 'Your XLM wallet.'}
        </h2>
        <p className="mt-3 text-[#78857f]">
          {xlmStep === 'done'
            ? 'Your XLM transaction was submitted to the Stellar network.'
            : xlmStep === 'sending'
            ? 'Submitting transaction to Horizon…'
            : xlmStep === 'send-dest'
            ? 'Enter the recipient\'s Stellar public key.'
            : xlmStep === 'send-amount'
            ? 'How much XLM do you want to send?'
            : stellar.publicKey
            ? `On-chain balance: ${stellar.xlmFormatted} XLM · ${network}`
            : 'Create your Stellar account to send and receive XLM.'}
        </p>
      </div>

      {/* ---- panel: no account yet ---- */}
      {xlmStep === 'panel' && !stellar.publicKey && (
        <div className="rounded-[24px] border border-[#e6ded1] bg-[#fffefa] p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-2xl bg-[#fff8e6] text-[#b07a18]">
              <Star size={22} />
            </div>
            <div>
              <p className="font-semibold">No Stellar account yet</p>
              <p className="text-sm text-[#8a958e]">
                {network === 'testnet' ? 'Funded automatically via Friendbot (testnet)' : 'Requires platform funding'}
              </p>
            </div>
          </div>
          <p className="mb-5 text-sm text-[#5c706b]">
            stellar-save generates a Stellar keypair for you, funds it on the{' '}
            <strong>{network}</strong>, and encrypts the secret key server-side.
            Your public key is permanently recorded on the Stellar ledger.
          </p>
          <button
            onClick={onProvision}
            disabled={isPending}
            className="primary-button w-full disabled:opacity-50"
          >
            {isPending
              ? <><Loader2 size={16} className="animate-spin" /> Creating account…</>
              : 'Create Stellar account'}
          </button>
        </div>
      )}

      {/* ---- panel: account exists ---- */}
      {xlmStep === 'panel' && stellar.publicKey && (
        <div className="flex flex-col gap-4">
          {/* Balance card */}
          <div className="rounded-[24px] bg-[#102b4e] p-6 text-white">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-[#b4c4c6]">XLM balance</p>
                <p className="mt-1 font-display text-4xl font-bold tracking-[-0.05em]">
                  {stellar.xlmFormatted}
                  <span className="ml-2 text-xl font-semibold text-[#f5c86a]">XLM</span>
                </p>
              </div>
              <div className="grid size-11 place-items-center rounded-2xl bg-[#254568] text-[#f5c86a]">
                <Star size={21} />
              </div>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-[#b4c4c6]">Public key</p>
                <p className="mt-1 truncate font-mono text-xs text-[#e8e1d7]">
                  {stellar.publicKey}
                </p>
              </div>
              <a
                href={`${explorerBase}/account/${stellar.publicKey}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View on Stellar Expert"
                className="ml-3 shrink-0 grid size-8 place-items-center rounded-full bg-[#254568] text-[#f5c86a] hover:bg-[#1e3a5e] transition"
              >
                <ExternalLink size={14} />
              </a>
            </div>
            <span className="mt-3 inline-block rounded-full bg-[#1e3a5e] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#f5c86a]">
              {network}
            </span>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onGoToSend}
              className="primary-button justify-center"
            >
              <ArrowUpRight size={16} /> Send XLM
            </button>
            <button
              onClick={onRefresh}
              disabled={isPending}
              className="flex items-center justify-center gap-2 rounded-2xl border border-[#e6ded1] bg-[#fffefa] py-3 text-sm font-semibold text-[#102b4e] transition hover:border-[#b07a18] hover:text-[#b07a18] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b07a18]/60"
            >
              {isPending ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} />}
              Refresh
            </button>
          </div>

          <p className="text-center text-xs text-[#8a958e]">
            Transactions are recorded on-chain and verifiable on{' '}
            <a
              href={`${explorerBase}/account/${stellar.publicKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-[#b07a18] hover:underline"
            >
              Stellar Expert
            </a>.
          </p>
        </div>
      )}

      {/* ---- send: destination ---- */}
      {xlmStep === 'send-dest' && (
        <div className="rounded-[24px] border border-[#e6ded1] bg-[#fffefa] p-6">
          <label
            htmlFor="xlm-dest"
            className="block text-xs font-bold uppercase tracking-[0.16em] text-[#8a958e]"
          >
            Recipient public key
          </label>
          <input
            id="xlm-dest"
            value={xlmDest}
            onChange={(e) => setXlmDest(e.target.value.trim())}
            placeholder="G…"
            aria-invalid={destInvalid}
            aria-describedby={destInvalid ? 'xlm-dest-error' : undefined}
            className={`auth-input mt-2 w-full font-mono text-sm ${destInvalid ? 'border-[#c15d54]' : ''}`}
          />
          {destInvalid && (
            <p id="xlm-dest-error" role="alert" className="mt-1.5 text-xs font-semibold text-[#c15d54]">
              Must be a valid Stellar public key starting with G (56 characters)
            </p>
          )}
          <button
            onClick={() => {
              if (!destInvalid && xlmDest.length === 56) {
                setXlmAmount('')
                onGoToAmount()
              }
            }}
            disabled={destInvalid || xlmDest.length !== 56}
            className="primary-button mt-5 w-full disabled:opacity-40"
          >
            Continue <ArrowUpRight size={16} />
          </button>
        </div>
      )}

      {/* ---- send: amount ---- */}
      {xlmStep === 'send-amount' && (
        <div className="rounded-[24px] border border-[#e6ded1] bg-[#fffefa] p-5 sm:p-7">
          <div className="flex items-center gap-3 border-b border-[#eee8de] pb-5">
            <span className="grid size-11 place-items-center rounded-full bg-[#fff8e6] text-[#b07a18] font-bold">
              <Star size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Send XLM</p>
              <p className="truncate font-mono text-xs text-[#8a958e]">{xlmDest}</p>
            </div>
          </div>

          <label className="mt-8 block text-xs font-bold uppercase tracking-[0.16em] text-[#8a958e]" htmlFor="xlm-amount">
            Amount (XLM)
          </label>
          <div className={`mt-2 flex items-center border-b-2 pb-3 ${amountInvalid ? 'border-[#c15d54]' : 'border-[#102b4e]'}`}>
            <Star size={20} className="shrink-0 text-[#b07a18]" />
            <input
              id="xlm-amount"
              inputMode="decimal"
              value={xlmAmount}
              onChange={(e) => setXlmAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.0000000"
              aria-invalid={amountInvalid}
              className="min-w-0 flex-1 bg-transparent px-2 font-display text-4xl font-bold outline-none placeholder:text-[#c6c2ba]"
            />
          </div>
          <p className="mt-2 text-xs text-[#8a958e]">
            Available: <strong>{stellar.xlmFormatted} XLM</strong>
          </p>

          <div className="mt-5 flex gap-2">
            {['1', '10', '100'].map((v) => (
              <button key={v} onClick={() => setXlmAmount(v)} className="amount-chip">
                {v} XLM
              </button>
            ))}
          </div>

          <button
            onClick={onSubmitSend}
            disabled={!xlmAmount || amountInvalid || isPending}
            className="primary-button mt-8 w-full disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending
              ? <><Loader2 size={16} className="animate-spin" /> Sending…</>
              : <>Send {xlmAmount || '0'} XLM <ArrowUpRight size={17} /></>}
          </button>
        </div>
      )}

      {/* ---- sending spinner ---- */}
      {xlmStep === 'sending' && (
        <div className="status-card">
          <div className="processing-ring"><Star size={25} /></div>
          <p className="mt-5 font-semibold">Submitting to Stellar network</p>
          <p className="mt-2 text-sm text-[#78857f]">Broadcasting your transaction via Horizon…</p>
        </div>
      )}

      {/* ---- done ---- */}
      {xlmStep === 'done' && (
        <div className="status-card">
          <div className="grid size-16 place-items-center rounded-full bg-[#dff3e9] text-[#28634e]">
            <Check size={29} />
          </div>
          <p className="mt-5 font-display text-2xl font-bold">Transaction confirmed</p>
          <p className="mt-2 text-sm text-[#78857f]">
            Your XLM payment was submitted to the Stellar {network}.
          </p>
          {xlmTxHash && (
            <a
              href={`${explorerBase}/tx/${xlmTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#b07a18] hover:underline"
            >
              View transaction on Stellar Expert <ExternalLink size={13} />
            </a>
          )}
          <button onClick={onBack} className="primary-button mt-7">Done</button>
        </div>
      )}
    </div>
  )
}
