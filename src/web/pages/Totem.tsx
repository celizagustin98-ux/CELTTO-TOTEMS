import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, type Settings } from '../lib/api'
import { clock, textOn } from '../lib/format'
import { useLive, useNow } from '../lib/live'
import { Button, inputCls } from '../ui'
import { LanguageSwitcher } from '../components/LanguageSwitcher'

interface PubBtn { id: number; label: string; subtitle: string | null; color: string }
interface PubSector { id: number; name: string; color: string; welcomeMessage: string | null; buttons: PubBtn[] }
type PubSettings = Omit<Settings, 'totem_pin'>
interface Issued {
  code: string
  label: string
  sectorName: string
  color: string
  waitingAhead: number
  estimatedWaitMin?: number | null
  qrPath?: string | null
  createdAt: string
}
interface StationInfo {
  id: number
  kind: string
  name: string
  sectorId: number | null
  sectorName: string | null
  deviceKey: string
}

const KEY = 'celtto.totem.sector'
const DEVICE_KEY = 'celtto.totem.device'

function getOrCreateLocalDeviceKey() {
  let k = localStorage.getItem(DEVICE_KEY)
  if (!k) {
    k = `totem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem(DEVICE_KEY, k)
  }
  return k
}

export default function Totem() {
  const { t } = useTranslation()
  const { deviceKey: routeKey } = useParams()
  const stationKey = routeKey || null
  const now = useNow(15000)
  const [data, setData] = useState<{ sectors: PubSector[]; settings: PubSettings } | null>(null)
  const [station, setStation] = useState<StationInfo | null>(null)
  const [stationErr, setStationErr] = useState('')
  const [error, setError] = useState('')
  const [sectorId, setSectorId] = useState<number | null>(() => Number(localStorage.getItem(KEY)) || null)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState('')
  const [pinOpen, setPinOpen] = useState(false)
  const [dni, setDni] = useState('')
  const taps = useRef<number[]>([])
  const lockedByStation = Boolean(stationKey && station?.sectorId)

  const load = useCallback(() => {
    return api<{ sectors: PubSector[]; settings: PubSettings }>('/api/public/sectors')
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((e) => setError(e.message))
  }, [])

  const loadStation = useCallback(async () => {
    if (!stationKey) {
      setStation(null)
      setStationErr('')
      return
    }
    try {
      const st = await api<StationInfo>(`/api/public/stations/${encodeURIComponent(stationKey)}`)
      if (st.kind !== 'totem') throw new Error('Esta URL no es de un tótem')
      setStation(st)
      setStationErr('')
      if (st.sectorId) {
        setSectorId(st.sectorId)
        localStorage.setItem(KEY, String(st.sectorId))
      }
      localStorage.setItem(DEVICE_KEY, st.deviceKey)
    } catch (e: any) {
      setStation(null)
      setStationErr(e.message || 'Estación no encontrada')
    }
  }, [stationKey])

  useEffect(() => {
    void load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    void loadStation()
    const t = setInterval(() => void loadStation(), 120000)
    return () => clearInterval(t)
  }, [loadStation])

  useLive((m) => {
    if (m.type === 'config') {
      void load()
      void loadStation()
    }
  })

  useEffect(() => {
    if (!issued || !data) return
    const t = setTimeout(() => setIssued(null), data.settings.totem_return_seconds * 1000)
    return () => clearTimeout(t)
  }, [issued, data])

  const corner = () => {
    if (lockedByStation) return
    const t = Date.now()
    taps.current = [...taps.current.filter((x) => t - x < 3000), t]
    if (taps.current.length >= 5) {
      taps.current = []
      setPinOpen(true)
    }
  }

  const issue = async (b: PubBtn) => {
    if (busy) return
    setBusy(true)
    setFail('')
    try {
      const deviceKey = stationKey || getOrCreateLocalDeviceKey()
      const t = await api<Issued>('/api/public/tickets', {
        body: {
          buttonId: b.id,
          deviceKey,
          dni: data?.settings && (data.settings as any).totem_dni_enabled ? dni || undefined : undefined,
        },
      })
      setIssued(t)
      if (data?.settings.totem_auto_print) setTimeout(() => window.print(), 250)
    } catch (e) {
      setFail((e as Error).message)
      setTimeout(() => setFail(''), 6000)
      void load()
    } finally {
      setBusy(false)
    }
  }

  if (stationKey && stationErr) {
    return (
      <div className="grid h-full place-items-center bg-ink p-8 text-center text-white">
        <div>
          <div className="display text-3xl">Tótem no configurado</div>
          <p className="mt-2 text-white/70">{stationErr}</p>
          <p className="mt-4 text-sm text-white/50">Creá o revisá la estación en el panel maestro.</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="grid h-full place-items-center bg-ink p-8 text-center text-white">
        {error ? (
          <div>
            <div className="display text-3xl">{t('totem.offline')}</div>
            <p className="mt-2 text-white/70">{error}</p>
            <LanguageSwitcher className="mt-4 text-white" />
          </div>
        ) : (
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white" />
        )}
      </div>
    )
  }

  const sector = data.sectors.find((s) => s.id === sectorId)
  const org = data.settings.org_name

  return (
    <div className="relative flex h-full flex-col bg-ink text-white" onClick={corner}>
      <header className="flex items-center justify-between gap-4 px-6 py-4">
        <div>
          <div className="text-sm uppercase tracking-widest text-white/50">{org}</div>
          <div className="display text-2xl font-semibold">
            {station?.name || sector?.name || 'Elegí secretaría'}
          </div>
          {station && <div className="text-xs text-white/40">URL fija · {station.deviceKey}</div>}
        </div>
        <div className="text-right">
          <div className="text-lg tabular-nums">{clock(now)}</div>
          <LanguageSwitcher className="mt-1 text-white/70" />
        </div>
      </header>

      {fail && (
        <div className="mx-6 mb-2 rounded-xl bg-red-500/20 px-4 py-3 text-center text-red-100" role="alert">
          {fail}
        </div>
      )}

      {!sector && (
        <div className="grid flex-1 gap-3 overflow-auto p-6 sm:grid-cols-2">
          {data.sectors.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                localStorage.setItem(KEY, String(s.id))
                setSectorId(s.id)
              }}
              className="flex min-h-28 items-center gap-4 rounded-xl p-5 text-left text-xl font-semibold"
              style={{ background: s.color, color: textOn(s.color) }}
            >
              {s.name}
              <span className="ml-auto text-sm font-normal opacity-80">{s.buttons.length} botones</span>
            </button>
          ))}
        </div>
      )}

      {sector && (
        <div className="flex flex-1 flex-col overflow-auto p-6">
          {sector.welcomeMessage && <p className="mb-4 text-lg text-white/80">{sector.welcomeMessage}</p>}
          <div className="grid flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(data.settings as any).totem_dni_enabled && (
              <div className="col-span-full mb-2">
                <label className="mb-2 block text-lg text-white/80">Documento (opcional)</label>
                <input
                  className={inputCls + ' text-xl py-4'}
                  inputMode="numeric"
                  value={dni}
                  onChange={(e) => setDni(e.target.value)}
                  placeholder="DNI"
                />
              </div>
            )}
            {sector.buttons.map((b) => (
              <button
                key={b.id}
                onClick={() => issue(b)}
                disabled={busy}
                className="flex min-h-56 sm:min-h-64 flex-col justify-end rounded-3xl p-8 text-left shadow-lg transition-transform active:scale-[0.98] disabled:opacity-60"
                style={{ background: b.color, color: textOn(b.color) }}
              >
                <span className="display text-3xl font-semibold leading-tight">{b.label}</span>
                {b.subtitle && <span className="mt-2 text-lg opacity-85">{b.subtitle}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {issued && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/90 p-6">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white text-ink shadow-2xl">
            <div className="px-8 pb-10 pt-8" style={{ background: issued.color, color: textOn(issued.color) }}>
              <div className="text-sm uppercase tracking-widest opacity-80">{org}</div>
              <div className="num text-[clamp(6rem,22vw,13rem)] leading-[0.9]">{issued.code}</div>
              <div className="display text-3xl">{issued.label}</div>
            </div>
            <div className="space-y-3 px-8 py-6 text-center">
              <p className="display text-3xl font-semibold">
                {issued.waitingAhead === 0
                  ? 'Sos el siguiente'
                  : issued.waitingAhead === 1
                    ? 'Hay 1 persona antes que vos'
                    : `Hay ${issued.waitingAhead} personas antes que vos`}
              </p>
              {issued.estimatedWaitMin != null && (
                <p className="mt-2 text-xl opacity-90">Espera estimada: ~{issued.estimatedWaitMin} min</p>
              )}
              {issued.qrPath && (
                <p className="mt-3 text-sm opacity-80">
                  Seguí tu turno: {location.origin}
                  {issued.qrPath}
                </p>
              )}
              <button
                type="button"
                className="mt-4 rounded-xl bg-black/20 px-4 py-3 text-lg font-semibold"
                onClick={() => window.print()}
              >
                Reimprimir ticket
              </button>
              <Button className="mt-3 px-12" onClick={() => setIssued(null)}>
                Listo
              </Button>
            </div>
            <div className="h-1.5 bg-line">
              <div
                className="h-full bg-ink"
                style={{ animation: `shrink ${data.settings.totem_return_seconds}s linear forwards` }}
              />
            </div>
          </div>
        </div>
      )}

      {issued && (
        <div id="print-area" aria-hidden="true">
          <div style={{ fontSize: 15, fontWeight: 600 }}>{org}</div>
          <div style={{ fontSize: 13, marginTop: 2 }}>{issued.sectorName}</div>
          <div style={{ fontSize: 64, fontWeight: 800, margin: '10px 0 4px', letterSpacing: -1 }}>{issued.code}</div>
          <div style={{ fontSize: 16 }}>{issued.label}</div>
          <div style={{ fontSize: 12, marginTop: 10 }}>
            {new Date(issued.createdAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
          </div>
          <div style={{ fontSize: 12, marginTop: 8 }}>
            {issued.waitingAhead === 0 ? 'Sos el siguiente' : `Personas antes: ${issued.waitingAhead}`}
          </div>
          <div style={{ fontSize: 11, marginTop: 10 }}>{data.settings.ticket_footer}</div>
        </div>
      )}

      {pinOpen && !lockedByStation && (
        <PinDialog
          onClose={() => setPinOpen(false)}
          onOk={() => {
            localStorage.removeItem(KEY)
            setSectorId(null)
            setPinOpen(false)
          }}
        />
      )}
    </div>
  )
}

function PinDialog({ onClose, onOk }: { onClose: () => void; onOk: () => void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const submit = async () => {
    try {
      ;(await api<{ ok: boolean }>('/api/public/totem-pin', { body: { pin } })).ok ? onOk() : setErr('PIN incorrecto')
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/80 p-6">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6">
        <h2 className="display text-2xl font-semibold">Administración del tótem</h2>
        <p className="text-sm text-muted">Ingresá el PIN para cambiar la secretaría de este equipo.</p>
        <input
          className={inputCls}
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => {
            setPin(e.target.value)
            setErr('')
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          aria-label="PIN"
        />
        {err && (
          <p className="text-sm text-danger" role="alert">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="soft" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!pin}>
            Cambiar secretaría
          </Button>
        </div>
      </div>
    </div>
  )
}
