import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { homeFor, useAuth } from '../auth'
import { Button, Field, inputCls } from '../ui'

const STUBS = [
  { code: 'A-014', c: '#2f6fed', r: '-rotate-6 translate-x-0' },
  { code: 'C-003', c: '#e8590c', r: 'rotate-3 translate-x-10' },
  { code: 'R-027', c: '#0e9f6e', r: '-rotate-2 -translate-x-2' },
]

export default function Login() {
  const { user, login } = useAuth()
  const nav = useNavigate()
  const [username, setU] = useState('')
  const [password, setP] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to={homeFor(user)} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('')
    try { nav(homeFor(await login(username, password)), { replace: true }) } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex">
        <div className="display text-2xl font-semibold tracking-tight">CELTTO-TOTEMS</div>
        <div className="flex flex-col gap-5">
          {STUBS.map((s) => (
            <div key={s.code} className={`stub w-[22rem] ${s.r} px-8 py-6`} style={{ background: s.c }}>
              <div className="num text-7xl leading-none text-white">{s.code}</div>
            </div>
          ))}
        </div>
        <p className="display max-w-sm text-3xl font-medium leading-tight text-white/90">Cada persona sabe cuándo le toca.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <div>
            <div className="display text-xl font-semibold lg:hidden">CELTTO-TOTEMS</div>
            <h1 className="display mt-2 text-3xl font-semibold lg:mt-0">Iniciar sesión</h1>
            <p className="mt-1 text-sm text-muted">Ingresá con tu usuario para continuar.</p>
          </div>
          <Field label="Usuario"><input className={inputCls} value={username} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus required /></Field>
          <Field label="Contraseña"><input className={inputCls} type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></Field>
          {error && <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</Button>
        </form>
      </div>
    </div>
  )
}
