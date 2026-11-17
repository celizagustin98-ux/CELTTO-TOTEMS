import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Settings } from '../lib/api'
import { clock, textOn } from '../lib/format'
import { useLive, useNow } from '../lib/live'
import { Button, inputCls } from '../ui'

interface PubBtn { id: number; label: string; subtitle: string | null; color: string }
interface PubSector { id: number; name: string; color: string; welcomeMessage: string | null; buttons: PubBtn[] }
type PubSettings = Omit<Settings, 'totem_pin'>
interface Issued { code: string; label: string; sectorName: string; color: string; waitingAhead: number; createdAt: string }
const KEY = 'celtto.totem.sector'

export default function Totem() {
  const { t } = useTranslation()
  const now = useNow(15000)
  const [data, setData] = useState<{ sectors: PubSector[]; settings: PubSettings } | null>(null)
  const [error, setError] = useState('')
  const [sectorId, setSectorId] = useState<number | null>(() => Number(localStorage.getItem(KEY)) || null)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState('')
  const [pinOpen, setPinOpen] = useState(false)
  const taps = useRef<number[]>([])

  const load = useCallback(() => api<{ sectors: PubSector[]; settings: PubSettings }>('/api/public/sectors').then((d) => { setData(d); setError('') }).catch((e) => setError(e.message)), [])
  useEffect(() => { void load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [load])
  useLive((m) => { if (m.type === 'config') void load() })
  useEffect(() => { if (!issued || !data) return; const t = setTimeout(() => setIssued(null), data.settings.totem_return_seconds * 1000); return () => clearTimeout(t) }, [issued, data])

  const corner = () => {
    const t = Date.now(); taps.current = [...taps.current.filter((x) => t - x < 3000), t]
    if (taps.current.length >= 5) { taps.current = []; setPinOpen(true) }
  }
  const issue = async (b: PubBtn) => {
    if (busy) return
    setBusy(true); setFail('')
    try {
      const t = await api<Issued>('/api/public/tickets', { body: { buttonId: b.id } })
      setIssued(t)
      if (data?.settings.totem_auto_print) setTimeout(() => window.print(), 250)
    } catch (e) { setFail((e as Error).message); setTimeout(() => setFail(''), 6000); void load() } finally { setBusy(false) }
  }

  if (!data) return <div className="grid h-full place-items-center bg-ink p-8 text-center text-white">{error ? <div><div className="display text-3xl">{t('totem.offline')}</div><p className="mt-2 text-white/70">{error}</p><LanguageSwitcher className="mt-4 text-white" /></div> : <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white" />}</div>
  const sector = data.sectors.find((s) => s.id === sectorId)
  const org = data.settings.org_name

  if (!sector) {
    return (
      <div className="min-h-full bg-ink p-6 text-white sm:p-12">
        <div className="mx-auto max-w-3xl">
          <div className="display text-lg opacity-70">{org}</div>
          <h1 className="display mt-2 text-4xl font-semibold">¿Qué secretaría atiende este tótem?</h1>
          <p className="mt-2 text-white/70">Se elige una sola vez. Después este equipo solo muestra los botones de esa secretaría.</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {data.sectors.map((s) => <button key={s.id} onClick={() => { localStorage.setItem(KEY, String(s.id)); setSectorId(s.id) }} className="flex items-center gap-4 rounded-xl p-5 text-left text-xl font-semibold" style={{ background: s.color, color: textOn(s.color) }}>{s.name}<span className="ml-auto text-sm font-normal opacity-80">{s.buttons.length} botones</span></button>)}
          </div>
          {data.sectors.length === 0 && <p className="mt-8 rounded-xl bg-white/10 p-5">Todavía no hay secretarías con botones. Configuralas desde el panel maestro.</p>}
        </div>
      </div>
    )
  }

  const cols = sector.buttons.length <= 2 ? 'grid-cols-1' : sector.buttons.length <= 4 ? 'grid-cols-2' : 'grid-cols-2 xl:grid-cols-3'
  return (
    <div className="flex h-full flex-col bg-paper">
      <header className="relative flex items-center justify-between px-8 py-5" style={{ background: sector.color, color: textOn(sector.color) }}>
        <button aria-label="Administración del tótem" onClick={corner} className="absolute left-0 top-0 h-16 w-16 opacity-0" /><div className="flex items-center justify-between gap-4"><div className="display text-3xl font-semibold">{sector.name}</div><LanguageSwitcher className="text-white" /></div>
        <div className="num text-4xl">{clock(new Date(now))}</div>
      </header>
      <main className="flex flex-1 flex-col gap-8 p-8 sm:p-12">
        <h1 className="display text-4xl font-semibold leading-tight sm:text-5xl">{sector.welcomeMessage || 'Bienvenido. Tocá una opción para sacar tu turno.'}</h1>
        {sector.buttons.length === 0 ? <p className="text-xl text-muted">Esta secretaría todavía no tiene botones configurados.</p> : (
          <div className={`grid flex-1 auto-rows-fr gap-6 ${cols}`}>
            {sector.buttons.map((b) => (
              <button key={b.id} onClick={() => issue(b)} disabled={busy} className="flex min-h-48 flex-col justify-end rounded-3xl p-8 text-left shadow-lg transition-transform active:scale-[0.98] disabled:opacity-60" style={{ background: b.color, color: textOn(b.color) }}>
                <span className="display text-6xl font-semibold leading-tight">{b.label}</span>
                {b.subtitle && <span className="mt-2 text-2xl opacity-85">{b.subtitle}</span>}
              </button>
            ))}
          </div>
        )}
        {fail && <p role="alert" className="rounded-2xl bg-danger px-6 py-4 text-xl text-white">{fail}. Si sigue pasando, avisá en secretaría.</p>}
      </main>

      {issued && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 p-6" role="dialog" aria-modal="true" aria-label="Tu turno">
          <div className="stub w-full max-w-2xl overflow-hidden bg-white text-center" style={{ ['--n' as string]: '22px' }}>
            <div className="px-8 pb-10 pt-8" style={{ background: issued.color, color: textOn(issued.color) }}>
              <div className="display text-3xl">Tu turno</div>
              <div className="num text-[clamp(6rem,22vw,13rem)] leading-[0.9]">{issued.code}</div>
              <div className="display text-3xl">{issued.label}</div>
            </div>
            <div className="space-y-2 px-8 py-6">
              <p className="display text-3xl font-semibold">{issued.waitingAhead === 0 ? 'Sos el siguiente' : issued.waitingAhead === 1 ? 'Hay 1 persona antes que vos' : `Hay ${issued.waitingAhead} personas antes que vos`}</p>
              <p className="text-xl text-muted">{data.settings.ticket_footer}</p>
              <Button size="lg" className="mt-3 px-12" onClick={() => setIssued(null)}>Listo</Button>
            </div>
            <div className="h-1.5 bg-line"><div className="h-full bg-ink" style={{ animation: `shrink ${data.settings.totem_return_seconds}s linear forwards` }} /></div>
          </div>
        </div>
      )}

      {issued && (
        <div id="print-area" aria-hidden="true">
          <div style={{ fontSize: 15, fontWeight: 600 }}>{org}</div>
          <div style={{ fontSize: 13, marginTop: 2 }}>{issued.sectorName}</div>
          <div style={{ fontSize: 64, fontWeight: 800, margin: '10px 0 4px', letterSpacing: -1 }}>{issued.code}</div>
          <div style={{ fontSize: 16 }}>{issued.label}</div>
          <div style={{ fontSize: 12, marginTop: 10 }}>{new Date(issued.createdAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</div>
          <div style={{ fontSize: 12, marginTop: 8 }}>{issued.waitingAhead === 0 ? 'Sos el siguiente' : `Personas antes: ${issued.waitingAhead}`}</div>
          <div style={{ fontSize: 11, marginTop: 10 }}>{data.settings.ticket_footer}</div>
        </div>
      )}

      {pinOpen && <PinDialog onClose={() => setPinOpen(false)} onOk={() => { localStorage.removeItem(KEY); setSectorId(null); setPinOpen(false) }} />}
    </div>
  )
}

function PinDialog({ onClose, onOk }: { onClose: () => void; onOk: () => void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const submit = async () => {
    try { (await api<{ ok: boolean }>('/api/public/totem-pin', { body: { pin } })).ok ? onOk() : setErr('PIN incorrecto') } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/80 p-6">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6">
        <h2 className="display text-2xl font-semibold">Administración del tótem</h2>
        <p className="text-sm text-muted">Ingresá el PIN para cambiar la secretaría de este equipo.</p>
        <input className={inputCls} type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => { setPin(e.target.value); setErr('') }} onKeyDown={(e) => e.key === 'Enter' && submit()} aria-label="PIN" />
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        <div className="flex justify-end gap-2"><Button variant="soft" onClick={onClose}>Cancelar</Button><Button onClick={submit} disabled={!pin}>Cambiar secretaría</Button></div>
      </div>
    </div>
  )
}
