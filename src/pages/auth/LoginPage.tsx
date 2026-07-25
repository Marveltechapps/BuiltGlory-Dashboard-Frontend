import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { AlertCircle, Building2, CheckCircle, ChevronLeft, Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { COMPANY_SUPPORT_PHONE_DISPLAY, COMPANY_TEL_URL, buildCompanyWhatsAppUrl } from '@/config/companyContact'
import {
  AdminApiError,
  getAdminLoginStats,
  loginAdmin,
  readAdminSession,
  REDIRECT_AFTER_LOGIN_KEY,
  storeAdminSession,
  type AdminLoginStats,
} from '@/api/admin'

const statFormatter = new Intl.NumberFormat('en-IN')

function formatStat(value: number | undefined, unavailable: boolean) {
  if (unavailable) return '-'
  return typeof value === 'number' ? statFormatter.format(value) : '...'
}

function isSafeAdminRedirect(path: string | null): path is string {
  return Boolean(path && /^\/admin(?:\/|$|\?)/.test(path))
}

export function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sessionTimedOut = searchParams.get('reason') === 'timeout'

  const [view, setView] = useState<'login' | 'forgot' | 'reset-sent'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [forgotEmail, setForgotEmail] = useState('')
  const [welcomeToast, setWelcomeToast] = useState<string | null>(null)
  const [loginStats, setLoginStats] = useState<AdminLoginStats | null>(null)
  const [statsUnavailable, setStatsUnavailable] = useState(false)

  useEffect(() => {
    const session = readAdminSession()
    if (session) {
      const redirectTo = searchParams.get('redirect')
      navigate(isSafeAdminRedirect(redirectTo) ? redirectTo : '/admin/overview', { replace: true })
    }
  }, [navigate, searchParams])

  useEffect(() => {
    let active = true
    getAdminLoginStats()
      .then((stats) => {
        if (!active) return
        setLoginStats(stats)
        setStatsUnavailable(false)
      })
      .catch(() => {
        if (active) setStatsUnavailable(true)
      })
    return () => {
      active = false
    }
  }, [])

  const dashboardStats = [
    { value: formatStat(loginStats?.properties, statsUnavailable), label: 'Properties' },
    { value: formatStat(loginStats?.users, statsUnavailable), label: 'Users' },
    { value: formatStat(loginStats?.deals, statsUnavailable), label: 'Deals' },
  ]

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setAuthError('')
    setEmailError('')
    setPasswordError('')

    let valid = true
    if (!email.trim()) {
      setEmailError('Email is required')
      valid = false
    }
    if (!password) {
      setPasswordError('Password is required')
      valid = false
    }
    if (!valid) return

    setLoading(true)
    try {
      const session = await loginAdmin(email.trim().toLowerCase(), password)
      storeAdminSession(session)
      const redirectTo = searchParams.get('redirect') ?? localStorage.getItem(REDIRECT_AFTER_LOGIN_KEY)
      localStorage.removeItem(REDIRECT_AFTER_LOGIN_KEY)
      if (isSafeAdminRedirect(redirectTo)) {
        setWelcomeToast('Welcome back! Taking you back to where you left off...')
        setTimeout(() => setWelcomeToast(null), 3000)
        navigate(redirectTo)
      } else {
        navigate('/admin/overview')
      }
    } catch (err) {
      const isNetworkError =
        err instanceof TypeError ||
        (err instanceof Error && /failed to fetch|network|load failed/i.test(err.message))
      setAuthError(
        isNetworkError
          ? 'Cannot reach the API server. Start the backend with `npm run dev` in Backend-V1 (port 5001).'
          : err instanceof AdminApiError
            ? err.message
            : 'Could not sign in. Please try again.',
      )
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  const handleForgotSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!forgotEmail.trim()) return
    setView('reset-sent')
  }

  return (
    <div className="flex min-h-screen bg-[#F8FAFC]">
      <aside className="relative hidden w-[60%] flex-col justify-between bg-primary p-12 lg:flex">
        <div>
          <p className="text-3xl font-bold text-white">BUILTGLORY</p>
          <p className="mt-1 text-sm text-white/70">Admin Dashboard</p>
        </div>

        <div className="flex flex-col items-center text-center">
          <div className="rounded-2xl bg-white p-8">
            <div className="flex size-32 items-center justify-center rounded-xl bg-[#F1F5F9]">
              <Building2 className="size-20 text-primary" strokeWidth={1.25} />
            </div>
          </div>
          <h2 className="mt-6 text-xl font-semibold text-white">
            Manage your real estate operations
          </h2>
          <p className="mt-2 max-w-md text-sm text-white/70">
            Properties, Pipelines, Users and more — all in one place.
          </p>
          <div className="mt-8 grid w-full max-w-lg grid-cols-3 gap-3">
            {dashboardStats.map((stat) => (
              <div key={stat.label} className="rounded-xl bg-white/20 p-4">
                <p className="font-bold text-white">{stat.value}</p>
                <p className="text-xs text-white/70">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-white/50">© 2026 Builtglory. All rights reserved.</p>
      </aside>

      <main className="flex min-h-screen w-full flex-1 items-center justify-center bg-white p-8 md:p-12 lg:w-[40%]">
        <div className="relative mx-auto w-full max-w-[400px]">
          {welcomeToast && (
            <div className="fixed bottom-6 right-6 z-50 rounded-lg bg-green-600 px-4 py-2 text-sm text-white shadow-lg">
              {welcomeToast}
            </div>
          )}
          {view === 'login' && (
            <>
              <div>
                <h1 className="text-2xl font-bold">Welcome back</h1>
                <p className="mt-1 text-sm text-muted-foreground">Sign in to your admin account</p>
              </div>

              {sessionTimedOut && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
                  ⏱ Session expired due to inactivity.
                  <br />
                  Sign in to continue where you left off.
                </div>
              )}

              <form className="mt-8 space-y-4" onSubmit={handleLoginSubmit} noValidate>
                <div>
                  <label htmlFor="email" className="mb-1 block text-sm font-medium">
                    Email Address
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      setEmailError('')
                      setAuthError('')
                    }}
                    placeholder="Enter your email address"
                    required
                    className={cn(
                      'h-10 w-full rounded-md border bg-input px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20',
                      emailError ? 'border-red-500' : 'border-border',
                    )}
                  />
                  {emailError && <p className="mt-1 text-xs text-red-600">{emailError}</p>}
                </div>

                <div>
                  <label htmlFor="password" className="mb-1 block text-sm font-medium">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value)
                        setPasswordError('')
                        setAuthError('')
                      }}
                      placeholder="Enter your password"
                      required
                      className={cn(
                        'h-10 w-full rounded-md border bg-input py-2 pl-3 pr-10 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20',
                        passwordError ? 'border-red-500' : 'border-border',
                      )}
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {passwordError && (
                    <p className="mt-1 text-xs text-red-600">{passwordError}</p>
                  )}
                  <div className="mt-1 text-right">
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => {
                        setView('forgot')
                        setForgotEmail(email)
                        setAuthError('')
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>
                </div>

                {authError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <p>{authError}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="mt-2 h-11 w-full"
                >
                  {loading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    'Sign In'
                  )}
                </Button>
              </form>
            </>
          )}

          {view === 'forgot' && (
            <div>
              <button
                type="button"
                className="mb-6 flex items-center gap-1 text-sm text-primary hover:underline"
                onClick={() => setView('login')}
              >
                <ChevronLeft className="size-4" />
                Back to sign in
              </button>
              <h1 className="text-2xl font-bold">Reset Password</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter your email to receive reset instructions
              </p>
              <form className="mt-8 space-y-4" onSubmit={handleForgotSubmit}>
                <div>
                  <label htmlFor="forgot-email" className="mb-1 block text-sm font-medium">
                    Email Address
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="Enter your email address"
                    required
                    className="h-10 w-full rounded-md border border-border bg-input px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <Button type="submit" className="h-11 w-full">
                  Send Reset Link
                </Button>
              </form>
            </div>
          )}

          {view === 'reset-sent' && (
            <div className="text-center">
              <CheckCircle className="mx-auto size-12 text-green-600" />
              <h1 className="mt-4 text-2xl font-bold">Reset link sent!</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Check your email for instructions
              </p>
              <Button type="button" className="mt-6 h-11 w-full" onClick={() => setView('login')}>
                Back to Sign In
              </Button>
            </div>
          )}

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Having trouble? Contact{' '}
            <a href="mailto:support@builtglory.com" className="text-primary hover:underline">
              support@builtglory.com
            </a>
            {' · '}
            <a href={COMPANY_TEL_URL} className="text-primary hover:underline">
              {COMPANY_SUPPORT_PHONE_DISPLAY}
            </a>
            {' · '}
            <a
              href={buildCompanyWhatsAppUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              WhatsApp
            </a>
          </p>
        </div>
      </main>
    </div>
  )
}
