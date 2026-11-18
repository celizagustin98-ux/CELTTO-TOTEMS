import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { homeFor, useAuth } from '../auth'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Button, Field, inputCls } from '../ui'

export default function Login() {
  const { t } = useTranslation()
  const { user, login } = useAuth()
  const nav = useNavigate()
  const [username, setU] = useState('')
  const [password, setP] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to={homeFor(user)} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      nav(homeFor(await login(username, password)), { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <div className="relative hidden overflow-hidden bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,#134e4a_0%,transparent_55%),radial-gradient(ellipse_at_90%_80%,#1e3a5f_0%,transparent_50%)] opacity-80" />
        <div className="relative">
          <div className="text-[13px] font-medium uppercase tracking-[0.14em] text-teal-300/90">CELTTO</div>
          <div className="display mt-2 text-2xl font-semibold text-white">TOTEMS</div>
        </div>
        <div className="relative max-w-md">
          <p className="display text-[2rem] font-semibold leading-tight text-white">
            Colas claras.
            <br />
            Atención ordenada.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-300">
            Sistema de turnos para tótems, paneles de secretaría y pantallas de sala. Diseñado para operación diaria real.
          </p>
        </div>
        <div className="relative text-[12px] text-slate-500">v0.0.1 · Linux · Docker · PostgreSQL</div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-10">
        <form onSubmit={submit} className="w-full max-w-[22rem] space-y-5 fade-up">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="display text-xl font-semibold lg:hidden">CELTTO-TOTEMS</div>
              <h1 className="display mt-1 text-[1.75rem] font-semibold tracking-tight">{t('login.title')}</h1>
              <p className="mt-1 text-[14px] text-muted">{t('login.subtitle')}</p>
            </div>
            <LanguageSwitcher />
          </div>
          <Field label={t('login.username')}>
            <input className={inputCls} value={username} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus required />
          </Field>
          <Field label={t('login.password')}>
            <input className={inputCls} type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required />
          </Field>
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-danger-soft px-3 py-2 text-[13.5px] text-danger">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? t('app.loading') : t('login.submit')}
          </Button>
        </form>
      </div>
    </div>
  )
}
