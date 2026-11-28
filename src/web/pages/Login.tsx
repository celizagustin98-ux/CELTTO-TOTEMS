import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, BellRing, DatabaseBackup, Eye, EyeOff, Loader2, Lock, ShieldCheck, TrendingUp, User as UserIcon, Users, KeyRound, Timer } from 'lucide-react'
import { api } from '../lib/api'
import { homeFor, useAuth } from '../auth'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Logo } from '../components/Brand'
import { ThemeToggle } from '../ui'

const REMEMBER = 'celtto.login.user'
const store = {
  get: () => { try { return localStorage.getItem(REMEMBER) ?? '' } catch { return '' } },
  set: (v: string) => { try { if (v) localStorage.setItem(REMEMBER, v); else localStorage.removeItem(REMEMBER) } catch { /* sin almacenamiento */ } },
}

/** Vista animada del producto (lado izquierdo): turnos que entran, un llamado y métricas en vivo. */
function ProductShowcase() {
  const [n, setN] = useState(14)
  useEffect(() => {
    const id = setInterval(() => setN((x) => (x >= 28 ? 14 : x + 1)), 2600)
    return () => clearInterval(id)
  }, [])
  const queue = [n + 1, n + 2, n + 3].map((x) => `A-${String(x).padStart(3, '0')}`)
  return (
    <div className="relative h-[24rem] w-full max-w-lg">
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, type: 'spring', stiffness: 120 }} className="absolute left-0 top-6 w-72">
        <div className="float-soft overflow-hidden rounded-2xl bg-gradient-to-br from-teal-500 to-teal-700 p-5 text-white shadow-2xl shadow-teal-900/50 ring-1 ring-white/20">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/80"><BellRing size={13} className="pulse-dot" /> Llamando</div>
          <AnimatePresence mode="wait">
            <motion.div key={n} initial={{ opacity: 0, y: 12, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12 }} transition={{ type: 'spring', stiffness: 220, damping: 18 }} className="num mt-1 text-6xl leading-none">
              A-{String(n).padStart(3, '0')}
            </motion.div>
          </AnimatePresence>
          <div className="mt-2 text-sm text-white/85">Secretaría A · Box {(n % 3) + 1}</div>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4, type: 'spring', stiffness: 120 }} className="absolute right-0 top-0 w-56">
        <div className="rounded-2xl bg-white/[0.07] p-4 text-white shadow-xl ring-1 ring-white/10 backdrop-blur-md" style={{ animation: 'float-soft 6s ease-in-out infinite reverse' }}>
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60"><span>En espera</span><Users size={13} /></div>
          <ul className="space-y-1.5">
            <AnimatePresence initial={false}>
              {queue.map((c, i) => (
                <motion.li key={c} layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex items-center justify-between rounded-lg bg-white/[0.06] px-2.5 py-1.5">
                  <span className="num text-base">{c}</span>
                  <span className="text-[11px] text-white/50">{(i + 1) * 3} min</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, type: 'spring', stiffness: 120 }} className="absolute bottom-0 right-6 w-72">
        <div className="rounded-2xl bg-white p-4 text-slate-900 shadow-2xl ring-1 ring-black/5" style={{ animation: 'float-soft 7s ease-in-out infinite' }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-medium text-slate-500">Atendidos hoy</div>
              <div className="num text-3xl">{180 + n * 3}</div>
            </div>
            <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"><TrendingUp size={12} /> 12%</span>
          </div>
          <div className="mt-3 flex h-12 items-end gap-1">
            {[30, 45, 38, 60, 72, 55, 80, 64, 90, 70, 58, 76].map((h, i) => (
              <motion.span key={i} initial={{ height: 0 }} animate={{ height: `${h}%` }} transition={{ delay: 0.8 + i * 0.04, type: 'spring', stiffness: 140 }} className="flex-1 rounded-sm bg-gradient-to-t from-teal-600 to-teal-400" />
            ))}
          </div>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.8, type: 'spring' }} className="absolute bottom-24 left-6">
        <div className="flex items-center gap-3 rounded-2xl bg-white/[0.08] px-4 py-3 text-white ring-1 ring-white/10 backdrop-blur-md">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-400/90 text-slate-900"><Timer size={18} /></span>
          <div>
            <div className="text-[11px] text-white/60">Espera promedio</div>
            <div className="num text-xl">6 min</div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

/** Código de 6 dígitos en casillas separadas (acepta pegar el código completo). */
function OtpInput({ value, onChange, onComplete }: { value: string; onChange: (v: string) => void; onComplete: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  useEffect(() => refs.current[0]?.focus(), [])
  const digits = value.split('')
  const set = (i: number, ch: string) => {
    const arr = Array.from({ length: 6 }, (_, k) => digits[k] ?? '')
    arr[i] = ch
    const next = arr.join('')
    onChange(next)
    if (ch && i < 5) refs.current[i + 1]?.focus()
    if (next.length === 6 && !arr.includes('')) onComplete(next)
  }
  return (
    <div
      className="flex justify-between gap-2"
      onPaste={(e) => {
        const d = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
        if (!d) return
        e.preventDefault()
        onChange(d)
        refs.current[Math.min(d.length, 5)]?.focus()
        if (d.length === 6) onComplete(d)
      }}
    >
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el }}
          value={digits[i] ?? ''}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          aria-label={`Dígito ${i + 1}`}
          onChange={(e) => set(i, e.target.value.replace(/\D/g, '').slice(-1))}
          onKeyDown={(e) => { if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus() }}
          className="num h-14 w-full rounded-xl border border-line bg-surface text-center text-2xl text-ink shadow-sm transition focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
        />
      ))}
    </div>
  )
}

const inputBase = 'h-12 w-full rounded-xl border border-line bg-surface text-[15px] text-ink shadow-sm transition placeholder:text-muted/50 hover:border-line-strong focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15'

export default function Login() {
  const { t } = useTranslation()
  const { user, login, verifyMfa } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [username, setU] = useState(store.get)
  const [password, setP] = useState('')
  const [remember, setRemember] = useState(() => !!store.get())
  const [show, setShow] = useState(false)
  const [caps, setCaps] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [challenge, setChallenge] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [brand, setBrand] = useState<{ org: string; logo: string | null } | null>(null)
  const [shake, setShake] = useState(0)
  useEffect(() => {
    api<{ settings: { org_name: string }; logoVersion: string | null }>('/api/public/sectors')
      .then((d) => setBrand({ org: d.settings.org_name, logo: d.logoVersion }))
      .catch(() => setBrand({ org: '', logo: null }))
  }, [])
  if (user) return <Navigate to={homeFor(user)} replace />

  const submit = async (e?: FormEvent, otp?: string) => {
    e?.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const r = challenge ? await verifyMfa(challenge, (otp ?? code).trim()) : await login(username.trim(), password)
      store.set(remember ? username.trim() : '')
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
      setShake((x) => x + 1)
      if (challenge) {
        setCode('')
        if (/venció|Volvé a ingresar/.test(msg)) setChallenge(null)
      } else setP('')
    } finally {
      setBusy(false)
    }
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false)
  const hour = new Date().getHours()
  const hello = hour < 12 ? 'Buen día' : hour < 20 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      {/* Lado del producto */}
      <div className="relative hidden overflow-hidden bg-[#070d18] lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div className="pointer-events-none absolute inset-0">
          <motion.div animate={{ x: [0, 60, 0], y: [0, 40, 0] }} transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }} className="absolute -left-32 -top-32 h-[34rem] w-[34rem] rounded-full bg-teal-500/25 blur-[110px]" />
          <motion.div animate={{ x: [0, -50, 0], y: [0, -30, 0] }} transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }} className="absolute -bottom-40 right-0 h-[30rem] w-[30rem] rounded-full bg-indigo-500/25 blur-[110px]" />
          <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
        </div>

        <div className="relative flex items-center gap-3">
          <Logo version={brand?.logo} className="h-11 w-11" />
          <div>
            <div className="text-[15px] font-semibold text-white">{brand?.org || 'CELTTO-TOTEMS'}</div>
            <div className="text-[12px] text-slate-400">Gestión de turnos y atención</div>
          </div>
        </div>

        <div className="relative space-y-10">
          <div className="max-w-md">
            <motion.h2 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="display text-[2.6rem] font-semibold leading-[1.05] text-white">
              Toda la atención,
              <br />
              <span className="bg-gradient-to-r from-teal-300 to-sky-300 bg-clip-text text-transparent">en un solo lugar.</span>
            </motion.h2>
            <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mt-4 text-[15px] leading-relaxed text-slate-400">
              Tótems, llamador con voz, panel de atención y productividad del equipo, configurables sin tocar código.
            </motion.p>
          </div>
          <ProductShowcase />
        </div>

        <div className="relative flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-slate-400">
          <span className="flex items-center gap-1.5"><Lock size={13} /> Datos cifrados</span>
          <span className="flex items-center gap-1.5"><KeyRound size={13} /> Doble factor</span>
          <span className="flex items-center gap-1.5"><DatabaseBackup size={13} /> Respaldos automáticos</span>
          <span className="ml-auto text-slate-500">v{__APP_VERSION__}</span>
        </div>
      </div>

      {/* Formulario */}
      <div className="relative flex flex-col bg-surface px-6 py-6 sm:px-12">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 lg:invisible">
            <Logo version={brand?.logo} className="h-9 w-9" />
            <span className="font-semibold">{brand?.org || 'CELTTO-TOTEMS'}</span>
          </div>
          <div className="flex items-center gap-1">
            <LanguageSwitcher className="text-muted" />
            <ThemeToggle className="text-muted hover:bg-paper" />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <motion.div key={shake} animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : {}} transition={{ duration: 0.4 }} className="w-full max-w-[24rem]">
            <AnimatePresence mode="wait">
              {!challenge ? (
                <motion.form key="pw" onSubmit={submit} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-5" noValidate>
                  <div>
                    <div className="text-[13px] font-medium text-brand">{hello}</div>
                    <h1 className="display mt-1 text-[2rem] font-semibold tracking-tight">{t('login.title')}</h1>
                    <p className="mt-1.5 text-[14px] text-muted">Ingresá con tu usuario para acceder al sistema.</p>
                  </div>

                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">{t('login.username')}</span>
                    <div className="group relative">
                      <UserIcon size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted transition group-focus-within:text-brand" />
                      <input className={`${inputBase} pl-11 pr-3`} value={username} onChange={(e) => setU(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus={!username} placeholder="nombre.apellido" required />
                    </div>
                  </label>

                  <label className="block">
                    <span className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-ink-soft">
                      {t('login.password')}
                      <AnimatePresence>{caps && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[12px] font-medium text-warn">Bloq Mayús activado</motion.span>}</AnimatePresence>
                    </span>
                    <div className="group relative">
                      <Lock size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted transition group-focus-within:text-brand" />
                      <input className={`${inputBase} pl-11 pr-12`} type={show ? 'text' : 'password'} value={password} onChange={(e) => setP(e.target.value)} onKeyUp={onKey} onKeyDown={onKey} autoComplete="current-password" autoFocus={!!username} placeholder="••••••••" required />
                      <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted hover:bg-paper hover:text-ink" aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                        {show ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                  </label>

                  <label className="flex cursor-pointer items-center gap-2.5 text-[13.5px] text-muted">
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded accent-[var(--color-brand)]" />
                    Recordar mi usuario en este equipo
                  </label>

                  <AnimatePresence>
                    {error && (
                      <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} role="alert" className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[13.5px] text-danger">
                        {error}
                      </motion.p>
                    )}
                  </AnimatePresence>

                  <button type="submit" disabled={busy || !username.trim() || !password} className="group relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-brand text-[15px] font-semibold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-hover active:scale-[0.99] disabled:opacity-50">
                    <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                    {busy ? <Loader2 size={18} className="animate-spin" /> : <>{t('login.submit')} <ArrowRight size={17} className="transition group-hover:translate-x-0.5" /></>}
                  </button>
                  <p className="text-center text-[12.5px] text-muted">¿Olvidaste tu contraseña? Pedile al administrador que la restablezca.</p>
                </motion.form>
              ) : (
                <motion.form key="mfa" onSubmit={submit} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} className="space-y-6" noValidate>
                  <button type="button" onClick={() => { setChallenge(null); setError('') }} className="flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"><ArrowLeft size={15} /> Volver</button>
                  <div>
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand"><ShieldCheck size={24} /></span>
                    <h1 className="display mt-4 text-[1.8rem] font-semibold tracking-tight">Verificá que sos vos</h1>
                    <p className="mt-1.5 text-[14px] text-muted">{useBackup ? 'Ingresá uno de tus códigos de respaldo.' : 'Abrí la app de autenticación de tu celular e ingresá el código de 6 dígitos.'}</p>
                  </div>
                  {useBackup ? (
                    <input className={`${inputBase} px-4 text-center font-mono text-xl tracking-widest`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, '').slice(0, 11))} placeholder="XXXXX-XXXXX" autoFocus />
                  ) : (
                    <OtpInput value={code} onChange={setCode} onComplete={(v) => void submit(undefined, v)} />
                  )}
                  <AnimatePresence>
                    {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="alert" className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[13.5px] text-danger">{error}</motion.p>}
                  </AnimatePresence>
                  <button type="submit" disabled={busy || code.length < 6} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand text-[15px] font-semibold text-white shadow-lg shadow-brand/25 hover:bg-brand-hover disabled:opacity-50">
                    {busy ? <Loader2 size={18} className="animate-spin" /> : 'Verificar'}
                  </button>
                  <button type="button" onClick={() => { setUseBackup((v) => !v); setCode('') }} className="w-full text-center text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline">
                    {useBackup ? 'Usar el código de la app' : 'No tengo el celular: usar un código de respaldo'}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
        <div className="text-center text-[12px] text-muted lg:hidden">Versión {__APP_VERSION__}</div>
      </div>
    </div>
  )
}
