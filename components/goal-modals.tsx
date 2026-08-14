'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Check, Loader2, Minus, Plus, Target, Trash2, X } from 'lucide-react'
import { accessibleTextColor } from '@/lib/contrast'
import {
  allocateToGoal,
  createSavingsGoal,
  deleteSavingsGoal,
  updateSavingsGoal,
} from '@/app/actions/wallet'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoalRow {
  id: string
  name: string
  targetCents: number
  savedCents: number
  color: string
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const PRESET_COLORS = [
  '#5eb697', // teal
  '#f5c86a', // gold
  '#102b4e', // navy
  '#e07b5a', // terracotta
  '#7b9fd4', // sky
  '#b98fd1', // lavender
  '#e8a0bf', // blush
  '#6ec6a0', // mint
]

function formatMoney(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function parseDollarsToCents(value: string): number | null {
  const n = parseFloat(value.replace(/[^0-9.]/g, ''))
  if (isNaN(n) || n <= 0) return null
  return Math.round(n * 100)
}

// ---------------------------------------------------------------------------
// Backdrop / dialog shell
// ---------------------------------------------------------------------------

function Dialog({
  onClose,
  children,
  label,
}: {
  onClose: () => void
  children: React.ReactNode
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Focus trap: focus first focusable element on mount
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    el?.focus()
  }, [])

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#102b4e]/40 px-4 backdrop-blur-[2px]"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Dialog */}
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="w-full max-w-[460px] rounded-[24px] border border-[#e6ded1] bg-[#fbfaf7] p-6 shadow-[0_24px_80px_rgba(16,43,78,0.18)] focus:outline-none"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  )
}

function DialogHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <h2 className="font-display text-2xl font-bold tracking-[-0.04em]">{title}</h2>
      <button
        onClick={onClose}
        aria-label="Close dialog"
        className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-[#e5ded2] text-[#77837d] transition hover:bg-[#f3efe6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b07a18]/60"
      >
        <X size={16} />
      </button>
    </div>
  )
}

function FieldError({ msg }: { msg: string }) {
  return (
    <p role="alert" className="mt-1.5 rounded-lg bg-[#f8dfda] px-3 py-1.5 text-sm font-semibold text-[#8c3c37]">
      {msg}
    </p>
  )
}

// ---------------------------------------------------------------------------
// GoalFormModal — shared create / edit form
// ---------------------------------------------------------------------------

interface GoalFormModalProps {
  mode: 'create' | 'edit'
  initial?: GoalRow
  onClose: () => void
  onSaved: () => void
}

export function GoalFormModal({ mode, initial, onClose, onSaved }: GoalFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [targetDollars, setTargetDollars] = useState(
    initial ? String(initial.targetCents / 100) : '',
  )
  const [color, setColor] = useState(initial?.color ?? PRESET_COLORS[0])
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const targetCents = parseDollarsToCents(targetDollars)
    if (!targetCents) return setError('Enter a valid target amount (minimum $1.00)')

    startTransition(async () => {
      try {
        if (mode === 'create') {
          await createSavingsGoal({ name, targetCents, color })
        } else {
          await updateSavingsGoal({ id: initial!.id, name, targetCents, color })
        }
        onSaved()
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  const previewText = accessibleTextColor(color)

  return (
    <Dialog onClose={onClose} label={mode === 'create' ? 'Create savings goal' : 'Edit savings goal'}>
      <DialogHeader title={mode === 'create' ? 'New savings goal' : 'Edit goal'} onClose={onClose} />

      <form onSubmit={submit} className="flex flex-col gap-4">
        {/* Name */}
        <label className="auth-label">
          Goal name
          <input
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Emergency fund"
            className="auth-input"
            autoComplete="off"
          />
        </label>

        {/* Target */}
        <label className="auth-label">
          Target amount
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#102b4e] font-semibold">
              $
            </span>
            <input
              required
              inputMode="decimal"
              value={targetDollars}
              onChange={(e) => setTargetDollars(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
              className="auth-input w-full pl-7"
            />
          </div>
        </label>

        {/* Color picker */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#5c706b]">
            Accent colour
          </span>
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Select colour ${c}`}
                aria-pressed={color === c}
                className="size-8 rounded-full border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b07a18]/60"
                style={{
                  backgroundColor: c,
                  borderColor: color === c ? '#102b4e' : 'transparent',
                  boxShadow: color === c ? '0 0 0 2px #fbfaf7, 0 0 0 4px #102b4e' : undefined,
                }}
              />
            ))}
          </div>
          {/* Live preview swatch */}
          <div
            className="mt-1 flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-bold"
            style={{ backgroundColor: color, color: previewText }}
          >
            <Target size={14} />
            {name || 'Goal name preview'}
          </div>
        </div>

        {error && <FieldError msg={error} />}

        <button
          type="submit"
          disabled={isPending}
          className="primary-button mt-1 w-full disabled:opacity-50"
        >
          {isPending ? (
            <><Loader2 size={16} className="animate-spin" /> Saving…</>
          ) : mode === 'create' ? (
            <><Plus size={16} /> Create goal</>
          ) : (
            <><Check size={16} /> Save changes</>
          )}
        </button>
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// AllocateModal — move money between wallet and goal
// ---------------------------------------------------------------------------

interface AllocateModalProps {
  goal: GoalRow
  walletBalanceCents: number
  onClose: () => void
  onSaved: () => void
}

export function AllocateModal({ goal, walletBalanceCents, onClose, onSaved }: AllocateModalProps) {
  const [direction, setDirection] = useState<'add' | 'withdraw'>('add')
  const [dollars, setDollars] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  const remaining = goal.targetCents - goal.savedCents
  const maxAdd = Math.min(walletBalanceCents, remaining)
  const maxWithdraw = goal.savedCents

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const amountCents = parseDollarsToCents(dollars)
    if (!amountCents) return setError('Enter a valid amount')
    if (direction === 'add' && amountCents > maxAdd) {
      return setError(
        maxAdd <= 0
          ? remaining <= 0
            ? 'This goal is already complete'
            : 'Insufficient wallet balance'
          : `Maximum you can add is ${formatMoney(maxAdd)}`,
      )
    }
    if (direction === 'withdraw' && amountCents > maxWithdraw) {
      return setError(`Maximum you can withdraw is ${formatMoney(maxWithdraw)}`)
    }

    startTransition(async () => {
      try {
        await allocateToGoal({ goalId: goal.id, amountCents, direction })
        onSaved()
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  const textColor = accessibleTextColor(goal.color)

  return (
    <Dialog onClose={onClose} label={`Allocate to ${goal.name}`}>
      <DialogHeader title={goal.name} onClose={onClose} />

      {/* Goal progress summary */}
      <div
        className="mb-5 rounded-2xl p-4"
        style={{ backgroundColor: goal.color }}
      >
        <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: textColor, opacity: 0.75 }}>
          Progress
        </p>
        <p className="mt-1 font-display text-2xl font-bold tracking-tight" style={{ color: textColor }}>
          {formatMoney(goal.savedCents)}{' '}
          <span className="text-base font-semibold opacity-60">
            / {formatMoney(goal.targetCents)}
          </span>
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10">
          <div
            className="h-full rounded-full bg-white/70 transition-all"
            style={{ width: `${Math.min(100, Math.round((goal.savedCents / goal.targetCents) * 100))}%` }}
          />
        </div>
      </div>

      {/* Direction toggle */}
      <div className="mb-4 flex rounded-xl border border-[#e6ded1] bg-[#f8f5ef] p-1">
        {(['add', 'withdraw'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => { setDirection(d); setDollars(''); setError('') }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${
              direction === d
                ? 'bg-[#102b4e] text-[#fffefa] shadow-sm'
                : 'text-[#77837d] hover:text-[#102b4e]'
            }`}
          >
            {d === 'add' ? <><Plus size={14} /> Add to goal</> : <><Minus size={14} /> Withdraw</>}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="auth-label">
          Amount
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-[#102b4e]">
              $
            </span>
            <input
              required
              inputMode="decimal"
              value={dollars}
              onChange={(e) => setDollars(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
              className="auth-input w-full pl-7"
            />
          </div>
          <span className="text-[10px] text-[#8a958e]">
            {direction === 'add'
              ? `Available in wallet: ${formatMoney(walletBalanceCents)} · Max add: ${formatMoney(maxAdd)}`
              : `Available in goal: ${formatMoney(goal.savedCents)}`}
          </span>
        </label>

        {/* Quick amount chips */}
        <div className="flex flex-wrap gap-2">
          {[10, 25, 50, 100].map((d) => {
            const cents = d * 100
            const max = direction === 'add' ? maxAdd : maxWithdraw
            if (cents > max) return null
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDollars(String(d))}
                className="amount-chip"
              >
                ${d}
              </button>
            )
          })}
        </div>

        {error && <FieldError msg={error} />}

        <button
          type="submit"
          disabled={isPending}
          className="primary-button mt-1 w-full disabled:opacity-50"
        >
          {isPending ? (
            <><Loader2 size={16} className="animate-spin" /> Saving…</>
          ) : direction === 'add' ? (
            <><Plus size={16} /> Add to goal</>
          ) : (
            <><Minus size={16} /> Withdraw from goal</>
          )}
        </button>
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// DeleteGoalConfirm
// ---------------------------------------------------------------------------

interface DeleteGoalConfirmProps {
  goal: GoalRow
  onClose: () => void
  onDeleted: () => void
}

export function DeleteGoalConfirm({ goal, onClose, onDeleted }: DeleteGoalConfirmProps) {
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function confirm() {
    startTransition(async () => {
      try {
        await deleteSavingsGoal(goal.id)
        onDeleted()
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  return (
    <Dialog onClose={onClose} label={`Delete goal: ${goal.name}`}>
      <DialogHeader title="Delete this goal?" onClose={onClose} />

      <p className="mb-2 text-[#5c706b]">
        You&apos;re about to delete <strong>{goal.name}</strong>.
        {goal.savedCents > 0 && (
          <>
            {' '}The saved amount of{' '}
            <strong className="text-[#102b4e]">{formatMoney(goal.savedCents)}</strong> will be
            returned to your wallet.
          </>
        )}
      </p>
      <p className="mb-5 text-sm text-[#8a958e]">This action cannot be undone.</p>

      {error && <FieldError msg={error} />}

      <div className="flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 rounded-[13px] border border-[#d9d1c3] bg-[#fbfaf7] py-3 text-sm font-semibold text-[#102b4e] transition hover:bg-[#f3efe6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b07a18]/60"
        >
          Cancel
        </button>
        <button
          onClick={confirm}
          disabled={isPending}
          className="flex flex-1 items-center justify-center gap-2 rounded-[13px] bg-[#c15d54] py-3 text-sm font-semibold text-white transition hover:bg-[#a84a42] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c15d54]/60"
        >
          {isPending ? (
            <><Loader2 size={15} className="animate-spin" /> Deleting…</>
          ) : (
            <><Trash2 size={15} /> Delete goal</>
          )}
        </button>
      </div>
    </Dialog>
  )
}
