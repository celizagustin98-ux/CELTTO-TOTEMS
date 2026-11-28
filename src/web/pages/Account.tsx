import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Check, Copy, Download, KeyRound, LogOut, ShieldAlert, ShieldCheck, Smartphone } from 'lucide-react'
import { api } from '../lib/api'
import { ROLE_LABEL, homeFor, useAuth } from '../auth'
import { Avatar, Button, Field, QR, ThemeToggle, inputCls, useToast } from '../ui'

export default function Account() {
  const { user, refresh, logout } = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' })
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null)
  const [code, setCode] = useState('')
  const [backup, setBackup] = useState<string[] | null>(null)
  const [disable, setDisable] = useState({ password: '', code: '' })
  const [busy, setBusy] = useState(false)
  if (!user) return null
  const forced = !!user.mfaSetupRequired

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const changePw = () =>
    run(async () => {
      if (pw.next !== pw.repeat) throw new Error('Las contraseñas nuevas no coinciden')
      await api('/api/auth/password', { method: 'PUT', body: { current: pw.current, next: pw.next } })
      setPw({ current: '', next: '', repeat: '' })
      toast('Contraseña actualizada. Se cerraron tus otras sesiones.')
    })
  const startSetup = () => run(async () => setSetup(await api('/api/auth/mfa/setup', { method: 'POST' })))
  const enable = () =>
    run(async () => {
      const r = await api<{ backupCodes: string[] }>('/api/auth/mfa/enable', { body: { code } })
      setBackup(r.backupCodes)
      setSetup(null)
      setCode('')
      await refresh()
      toast('Doble factor activado')
    })
  const turnOff = () =>
    run(async () => {
      await api('/api/auth/mfa/disable', { body: disable })
      setDisable({ password: '', code: '' })
      await refresh()
      toast('Doble factor desactivado')
    })
  const downloadCodes = () => {
    const blob = new Blob([`Códigos de respaldo CELTTO-TOTEMS — ${user.username}\nCada código sirve una sola vez.\n\n${backup!.join('\n')}\n`], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `celtto-codigos-respaldo-${user.username}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="min-h-full bg-mesh">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur-md sm:px-6">
        {!forced && (
          <Link to={homeFor({ ...user, mfaSetupRequired: false })} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-muted hover:bg-paper hover:text-ink">
            <ArrowLeft size={15} /> Volver
          </Link>
        )}
        <div className="font-medium">Mi cuenta</div>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle className="text-muted hover:bg-paper" />
          <button onClick={async () => { await logout(); nav('/login') }} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:bg-paper hover:text-ink"><LogOut size={15} /> Salir</button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-4">
          <Avatar name={user.displayName} size={56} />
          <div>
            <h1 className="display text-2xl font-semibold">{user.displayName}</h1>
            <div className="text-[13px] text-muted">{user.username} · {ROLE_LABEL[user.role]}</div>
          </div>
        </motion.div>

        {forced && (
          <div className="flex items-start gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-[14px] text-warn" role="alert">
            <ShieldAlert size={20} className="mt-0.5 shrink-0" />
            <span>Tu rol requiere <b>doble factor</b>. Activalo para poder usar el sistema: solo tarda un minuto.</span>
          </div>
        )}

        <section className="surface p-6">
          <div className="flex items-start gap-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${user.mfaEnabled ? 'bg-ok-soft text-ok' : 'bg-brand-soft text-brand'}`}>{user.mfaEnabled ? <ShieldCheck size={20} /> : <Smartphone size={20} />}</span>
            <div className="flex-1">
              <h2 className="display text-lg font-semibold">Doble factor</h2>
              <p className="text-[13.5px] text-muted">Además de la contraseña, al entrar se pide un código de 6 dígitos de una app del celular (Google Authenticator, Microsoft Authenticator, Authy…). Si te roban la contraseña, sin el celular no pueden entrar.</p>
            </div>
            <span className={`badge ${user.mfaEnabled ? 'badge-ok' : 'badge-muted'}`}>{user.mfaEnabled ? 'Activado' : 'Desactivado'}</span>
          </div>

          {backup && (
            <div className="mt-5 rounded-xl border border-ok/30 bg-ok-soft/60 p-4">
              <div className="font-semibold text-ok">Guardá estos códigos de respaldo</div>
              <p className="mt-1 text-[13px] text-muted">Sirven para entrar si perdés el celular. Cada uno funciona una sola vez y no se vuelven a mostrar.</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {backup.map((c) => <code key={c} className="rounded-lg bg-surface px-2 py-1.5 text-center font-mono text-[13px] ring-1 ring-line">{c}</code>)}
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="soft" onClick={() => navigator.clipboard?.writeText(backup.join('\n')).then(() => toast('Códigos copiados'))}><Copy size={14} /> Copiar</Button>
                <Button size="sm" variant="soft" onClick={downloadCodes}><Download size={14} /> Descargar</Button>
                <Button size="sm" onClick={() => { setBackup(null); if (forced) nav('/') }}><Check size={14} /> Ya los guardé</Button>
              </div>
            </div>
          )}

          {!user.mfaEnabled && !setup && !backup && <Button className="mt-5" onClick={startSetup} disabled={busy}><ShieldCheck size={16} /> Activar doble factor</Button>}

          {setup && (
            <div className="mt-5 grid gap-6 sm:grid-cols-[auto_1fr]">
              <div className="flex flex-col items-center gap-2">
                <QR value={setup.otpauth} size={180} className="rounded-xl bg-white p-2 ring-1 ring-line" />
                <span className="text-[11.5px] text-muted">Escaneá con la app</span>
              </div>
              <div className="space-y-4">
                <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px] text-muted">
                  <li>Instalá una app de autenticación en tu celular.</li>
                  <li>Escaneá el código QR (o cargá la clave a mano).</li>
                  <li>Escribí el código de 6 dígitos que muestra la app.</li>
                </ol>
                <div className="rounded-lg bg-paper px-3 py-2">
                  <div className="text-[11.5px] text-muted">Clave para cargar a mano</div>
                  <code className="break-all font-mono text-[13px]">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
                </div>
                <Field label="Código de la app">
                  <input className={`${inputCls} max-w-48 text-center font-mono text-xl tracking-[0.35em]`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" autoFocus />
                </Field>
                <div className="flex gap-2">
                  <Button onClick={enable} disabled={busy || code.length !== 6}>Confirmar y activar</Button>
                  <Button variant="ghost" onClick={() => setSetup(null)}>Cancelar</Button>
                </div>
              </div>
            </div>
          )}

          {user.mfaEnabled && !backup && !forced && (
            <details className="mt-5 rounded-xl border border-line p-4">
              <summary className="cursor-pointer text-[13.5px] font-medium">Desactivar doble factor</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
                <Field label="Contraseña"><input type="password" className={inputCls} value={disable.password} onChange={(e) => setDisable({ ...disable, password: e.target.value })} autoComplete="current-password" /></Field>
                <Field label="Código actual"><input className={`${inputCls} font-mono`} value={disable.code} onChange={(e) => setDisable({ ...disable, code: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" /></Field>
                <Button variant="danger" onClick={turnOff} disabled={busy || !disable.password || disable.code.length !== 6}>Desactivar</Button>
              </div>
            </details>
          )}
        </section>

        <section className="surface p-6">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><KeyRound size={20} /></span>
            <div>
              <h2 className="display text-lg font-semibold">Contraseña</h2>
              <p className="text-[13.5px] text-muted">Mínimo 8 caracteres. Al cambiarla se cierran tus sesiones en otros equipos.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Field label="Actual"><input type="password" className={inputCls} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></Field>
            <Field label="Nueva"><input type="password" className={inputCls} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></Field>
            <Field label="Repetir nueva"><input type="password" className={inputCls} value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} autoComplete="new-password" /></Field>
          </div>
          <Button className="mt-4" variant="soft" onClick={changePw} disabled={busy || !pw.current || pw.next.length < 8 || !pw.repeat}>Cambiar contraseña</Button>
        </section>
      </main>
    </div>
  )
}
