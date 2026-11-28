import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, Lock, ShieldCheck, User as UserIcon } from 'lucide-react'
import { homeFor, useAuth } from '../auth'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Logo } from '../components/Brand'
import { Button, Field, ThemeToggle, inputCls } from '../ui'

export default function Login() {
  const { t } = useTranslation()
  const { user, login, verifyMfa } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [username, setU] = useState('')
  const [password, setP] = useState('')
  const [show, setShow] = useState(false)
  const [caps, setCaps] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [challenge, setChallenge] = useState<string | null>(null)
  const [code, setCode] = useState('')
  if (user) return <Navigate to={homeFor(user)} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = challenge ? await verifyMfa(challenge, code.trim()) : await login(username.trim(), password)
      if ('mfaRequired' in r) {
        setChallenge(r.challenge)
        setCode('')
        return
      }
      const from = (loc.state as { from?: string } | null)?.from
      nav(from && from.startsWith(homeFor(r)) ? from : homeFor(r), { replace: true })
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      if (challenge) {
        setCode('')
        if (/venció|Volvé a ingresar/.test(msg)) setChallenge(null)
      } else setP('')
    } finally {
      setBusy(false)
    }
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false)

  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <div className="relative hidden overflow-hidden bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,#134e4a_0%,transparent_55%),radial-gradient(ellipse_at_90%_80%,#1e3a5f_0%,transparent_50%)] opacity-80" />
        <div className="relative flex items-center gap-3">
          <Logo className="h-11 w-11" />
          <div>
            <div className="text-[13px] font-medium uppercase tracking-[0.14em] text-teal-300/90">CELTTO</div>
            <div className="display text-2xl font-semibold text-white">TOTEMS</div>
          </div>
        </div>
        <div className="relative max-w-md">
          <p className="display text-[2.1rem] font-semibold leading-tight text-white">
            Colas claras.
            <br />
            Atención ordenada.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-300">
            Tótems, panel de secretaría y pantallas de sala configurables desde un solo lugar, sin tocar código.
          </p>
          <ul className="mt-8 grid grid-cols-3 gap-3 text-[12.5px] text-slate-300">
            {['Tótem táctil', 'Llamador con voz', 'Reportes en vivo'].map((x) => (
              <li key={x} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">{x}</li>
            ))}
          </ul>
        </div>
        <div className="relative text-[12px] text-slate-500">Versión {__APP_VERSION__}</div>
      </div>

      <div className="flex flex-col p-6 sm:p-10">
        <div className="flex justify-end gap-2">
          <LanguageSwitcher />
          <ThemeToggle className="text-muted hover:bg-paper" />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <form onSubmit={submit} className="fade-up w-full max-w-[22rem] space-y-5" noValidate>
            <div>
              <div className="mb-6 flex items-center gap-3 lg:hidden">
                <Logo className="h-10 w-10" />
                <div className="display text-xl font-semibold">CELTTO-TOTEMS</div>
              </div>
              <h1 className="display text-[1.85rem] font-semibold tracking-tight">{t('login.title')}</h1>
              <p className="mt-1 text-[14px] text-muted">{t('login.subtitle')}</p>
            </div>
            {challenge ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-xl border border-line bg-paper p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand"><ShieldCheck size={20} /></span>
                  <p className="text-[13.5px] leading-relaxed text-muted">Abrí la app de autenticación de tu celular e ingresá el código de 6 dígitos. Si no tenés el celular, usá uno de tus códigos de respaldo.</p>
                </div>
                <Field label="Código de verificación">
                  <input className={`${inputCls} text-center font-mono text-2xl tracking-[0.4em]`} value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 11))} autoFocus inputMode="numeric" autoComplete="one-time-code" placeholder="000000" />
                </Field>
                <button type="button" className="text-[13px] text-muted underline" onClick={() => { setChallenge(null); setError('') }}>Volver a usuario y contraseña</button>
              </div>
            ) : (<>
            <Field label={t('login.username')}>
              <div className="relative">
                <UserIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input className={`${inputCls} pl-9`} value={username} onChange={(e) => setU(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required />
              </div>
            </Field>
            <Field label={t('login.password')} hint={caps ? <span className="font-medium text-warn">Bloq Mayús está activado</span> : undefined}>
              <div className="relative">
                <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  className={`${inputCls} pl-9 pr-10`}
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setP(e.target.value)}
                  onKeyUp={onKey}
                  onKeyDown={onKey}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink"
                  aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            </>)}
            {error && (
              <p role="alert" className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-[13.5px] text-danger">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={busy || (challenge ? code.length < 6 : !username.trim() || !password)}>
              {busy ? t('app.loading') : t('login.submit')}
            </Button>
            <p className="text-center text-[12px] text-muted lg:hidden">Versión {__APP_VERSION__}</p>
          </form>
        </div>
      </div>
    </div>
  )
}
