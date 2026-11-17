import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { homeFor, useAuth } from '../auth'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Button, Field, inputCls } from '../ui'

const STUBS = [
  { code: 'A-014', c: '#2f6fed', r: -6 },
  { code: 'C-003', c: '#e8590c', r: 3 },
  { code: 'R-027', c: '#0e9f6e', r: -2 },
]

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
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex">
        <div className="display text-2xl font-semibold tracking-tight">{t('app.name')}</div>
        <div className="flex flex-col gap-5">
          {STUBS.map((s, i) => (
            <motion.div
              key={s.code}
              initial={{ opacity: 0, x: -40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 * i, type: 'spring', stiffness: 120 }}
              className="stub w-[22rem] px-8 py-6"
              style={{ background: s.c, rotate: s.r }}
            >
              <div className="num text-7xl leading-none text-white">{s.code}</div>
            </motion.div>
          ))}
        </div>
        <p className="display max-w-sm text-3xl font-medium leading-tight text-white/90">{t('login.subtitle')}</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <motion.form
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          onSubmit={submit}
          className="w-full max-w-sm space-y-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="display text-xl font-semibold lg:hidden">{t('app.name')}</div>
              <h1 className="display mt-2 text-3xl font-semibold lg:mt-0">{t('login.title')}</h1>
              <p className="mt-1 text-sm text-muted">{t('login.subtitle')}</p>
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
            <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? t('app.loading') : t('login.submit')}
          </Button>
        </motion.form>
      </div>
    </div>
  )
}
