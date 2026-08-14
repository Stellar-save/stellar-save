'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')
    const result = mode === 'sign-up'
      ? await authClient.signUp.email({ name, email, password })
      : await authClient.signIn.email({ email, password })
    setPending(false)
    if (result.error) return setError(result.error.message ?? 'Something went wrong.')
    router.push('/')
    router.refresh()
  }

  return <form onSubmit={submit} className="auth-card">
    <div><p className="eyebrow">stellar-save</p><h1 className="font-display text-4xl font-bold tracking-[-0.06em]">{mode === 'sign-up' ? 'Start saving with intention.' : 'Welcome back.'}</h1><p className="mt-3 text-[#728079]">{mode === 'sign-up' ? 'Create your personal money space.' : 'Sign in to see your savings at a glance.'}</p></div>
    <div className="flex flex-col gap-4">
      {mode === 'sign-up' && <label className="auth-label">Name<input required value={name} onChange={(event) => setName(event.target.value)} className="auth-input" autoComplete="name" /></label>}
      <label className="auth-label">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="auth-input" autoComplete="email" /></label>
      <label className="auth-label">Password<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="auth-input" autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} /></label>
    </div>
    {error && <p role="alert" className="rounded-xl bg-[#f8dfda] px-3 py-2 text-sm font-semibold text-[#8c3c37]">{error}</p>}
    <button disabled={pending} className="primary-button w-full disabled:opacity-50">{pending ? 'Please wait…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}</button>
    <a href={mode === 'sign-up' ? '/sign-in' : '/sign-up'} className="text-center text-sm font-semibold text-[#b07a18]">{mode === 'sign-up' ? 'Already have an account? Sign in' : 'New here? Create an account'}</a>
  </form>
}
