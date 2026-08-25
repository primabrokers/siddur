import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { supabase } from '../../lib/supabase'
import { isConfigured } from '../../lib/env'
import { Button } from '../../components'
import { useAuth } from './AuthProvider'

type Mode = 'password' | 'magic'

interface LocationState {
  from?: string
}

export function LoginScreen() {
  const { session, loading } = useAuth()
  const location = useLocation()
  const from = (location.state as LocationState | null)?.from ?? '/'

  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (!loading && session) return <Navigate to={from} replace />

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      if (mode === 'password') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
        if (signInError) throw signInError
      } else {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin },
        })
        if (otpError) throw otpError
        setNotice(`Check ${email} — the sign-in link lasts one hour.`)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-ground px-5 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center justify-center gap-[10px]">
          <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-accent text-[16px] font-bold text-surface">
            Y
          </span>
          <span className="text-[17px] font-bold">Yeshiva CRM</span>
        </div>

        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-4 rounded-card border border-border bg-surface px-6 py-7"
        >
          <div>
            <h1 className="text-[16px] font-bold">Sign in</h1>
            <p className="mt-1 text-[13px] text-muted">
              {mode === 'password'
                ? 'Use the email and password set up for you.'
                : "We'll email you a one-time sign-in link."}
            </p>
          </div>

          <label className="flex flex-col gap-[6px]">
            <span className="text-[12px] font-semibold text-muted">Email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yeshiva.org"
              className="rounded-input border border-border bg-surface px-3 py-[9px] text-[13.5px] placeholder:text-faint focus:border-accent focus:outline-none"
            />
          </label>

          {mode === 'password' ? (
            <label className="flex flex-col gap-[6px]">
              <span className="text-[12px] font-semibold text-muted">Password</span>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-input border border-border bg-surface px-3 py-[9px] text-[13.5px] focus:border-accent focus:outline-none"
              />
            </label>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
              {error}
            </p>
          ) : null}

          {notice ? (
            <p role="status" className="rounded-input bg-good-bg px-3 py-2 text-[12.5px] text-good">
              {notice}
            </p>
          ) : null}

          {!isConfigured ? (
            <p className="rounded-input bg-row px-3 py-2 text-[12px] text-muted">
              No publishable key configured. Set <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code>{' '}
              before signing in.
            </p>
          ) : null}

          <Button type="submit" size="lg" disabled={busy} className="w-full">
            {busy ? 'Working…' : mode === 'password' ? 'Sign in' : 'Email me a link'}
          </Button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'password' ? 'magic' : 'password')
              setError(null)
              setNotice(null)
            }}
            className="text-[12.5px] font-semibold text-accent hover:text-accent-dark"
          >
            {mode === 'password' ? 'Email me a sign-in link instead' : 'Use a password instead'}
          </button>
        </form>

        <p className="mt-5 text-center text-[11.5px] text-faint">
          Access is granted per team member. Ask an administrator if you cannot sign in.
        </p>
      </div>
    </main>
  )
}
