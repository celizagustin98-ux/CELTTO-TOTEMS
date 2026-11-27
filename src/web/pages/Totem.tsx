import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { Delete, Printer, Settings2, WifiOff } from 'lucide-react'
import { api, type Settings } from '../lib/api'
import { clock, longDate, textOn } from '../lib/format'
import { useIdle, useLive, useNow } from '../lib/live'
import { isLang, setAppLanguage } from '../i18n'
import { LanguagePills } from '../components/LanguageSwitcher'
import { ButtonIcon } from '../components/Icons'
import { Logo } from '../components/Brand'
import { Button, QR, inputCls } from '../ui'

interface PubBtn { id: number; label: string; subtitle: string | null; color: string; icon: string | null; priorityName: string | null }
interface PubSector { id: number; name: string; color: string; welcomeMessage: string | null; buttons: PubBtn[] }
type PubSettings = Omit<Settings, 'totem_pin'>
interface PubData { sectors: PubSector[]; settings: PubSettings; logoVersion: string | null }
interface Issued {
  id: number
  code: string
  label: string
  sectorName: string
  color: string
  priorityName: string | null
  waitingAhead: number
  estimatedWaitMin: number | null
  qrPath: string | null
  createdAt: string
}
interface StationInfo { id: number; kind: string; name: string; sectorId: number | null; sectorName: string | null; lang: string | null }

const KEY = 'celtto.totem.sector'
const DEVICE_KEY = 'celtto.totem.device'
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* sin almacenamiento */
    }
  },
  del: (k: string) => {
    try {
      localStorage.removeItem(k)
    } catch {
      /* sin almacenamiento */
    }
  },
}
function localDeviceKey() {
  let k = store.get(DEVICE_KEY)
  if (!k) {
    k = `totem_${crypto.getRandomValues(new Uint32Array(2)).join('')}`
    store.set(DEVICE_KEY, k)
  }
  return k
}

export default function Totem() {
  const { t } = useTranslation()
  const { deviceKey: stationKey } = useParams()
  const now = useNow(15000)
  const [data, setData] = useState<PubData | null>(null)
  const [station, setStation] = useState<StationInfo | null>(null)
  const [stationErr, setStationErr] = useState('')
  const [error, setError] = useState('')
  const [sectorId, setSectorId] = useState<number | null>(() => Number(store.get(KEY)) || null)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState('')
  const [pinOpen, setPinOpen] = useState(false)
  const [dniFor, setDniFor] = useState<PubBtn | null>(null)
  const taps = useRef<number[]>([])
  const lockedByStation = Boolean(stationKey && station?.sectorId)
  const idle = useIdle((data?.settings.totem_idle_seconds ?? 60) * 1000, Boolean(data?.settings.totem_idle_enabled) && !issued && !pinOpen && !dniFor)

  const defaultLang = useCallback(() => {
    setAppLanguage(isLang(station?.lang) ? station!.lang! : 'es', false)
  }, [station])

  const load = useCallback(async () => {
    try {
      setData(await api<PubData>('/api/public/sectors'))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const loadStation = useCallback(async () => {
    if (!stationKey) return
    try {
      const st = await api<StationInfo>(`/api/public/stations/${encodeURIComponent(stationKey)}`)
      if (st.kind !== 'totem') throw new Error('Esta dirección es de una TV, no de un tótem')
      setStation(st)
      setStationErr('')
      if (st.sectorId) {
        setSectorId(st.sectorId)
        store.set(KEY, String(st.sectorId))
      }
    } catch (e) {
      setStation(null)
      setStationErr((e as Error).message || 'Estación no encontrada')
    }
  }, [stationKey])

  useEffect(() => {
    void load()
    const id = setInterval(load, 5 * 60_000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    void loadStation()
    const id = setInterval(loadStation, 120_000)
    return () => clearInterval(id)
  }, [loadStation])

  // Idioma de la estación al cargar
  useEffect(() => {
    if (station?.lang) defaultLang()
  }, [station?.lang, defaultLang])

  // En reposo se vuelve al idioma por defecto para el próximo paciente
  useEffect(() => {
    if (idle) defaultLang()
  }, [idle, defaultLang])

  const connected = useLive((m) => {
    if (m.type === 'config') {
      void load()
      void loadStation()
    }
  })

  useEffect(() => {
    if (!issued || !data) return
    const id = setTimeout(() => {
      setIssued(null)
      defaultLang()
    }, data.settings.totem_return_seconds * 1000)
    return () => clearTimeout(id)
  }, [issued, data, defaultLang])

  const corner = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (lockedByStation) return
    const ts = Date.now()
    taps.current = [...taps.current.filter((x) => ts - x < 3000), ts]
    if (taps.current.length >= 5) {
      taps.current = []
      setPinOpen(true)
    }
  }

  const issue = async (b: PubBtn, dni?: string) => {
    if (busy) return
    setBusy(true)
    setFail('')
    setDniFor(null)
    try {
      const deviceKey = stationKey || localDeviceKey()
      const tk = await api<Issued>('/api/public/tickets', { body: { buttonId: b.id, deviceKey, dni: dni || undefined } })
      setIssued(tk)
      if (data?.settings.totem_auto_print) setTimeout(() => window.print(), 350)
    } catch (e) {
      setFail((e as Error).message || t('totem.errorIssue'))
      setTimeout(() => setFail(''), 6000)
      void load()
    } finally {
      setBusy(false)
    }
  }
  const choose = (b: PubBtn) => (data?.settings.totem_dni_enabled ? setDniFor(b) : void issue(b))
  const reprint = async () => {
    if (!issued) return
    await api(`/api/public/tickets/${issued.id}/reprint`, { method: 'POST' }).catch(() => {})
    window.print()
  }

  if (stationKey && stationErr) {
    return (
      <Screen>
        <div className="text-center">
          <div className="display text-4xl font-semibold">{t('totem.notConfigured')}</div>
          <p className="mt-3 text-lg text-white/70">{stationErr}</p>
          <p className="mt-4 text-sm text-white/50">{t('totem.notConfiguredHint')}</p>
        </div>
      </Screen>
    )
  }

  if (!data) {
    return (
      <Screen>
        {error ? (
          <div className="text-center">
            <WifiOff size={48} className="mx-auto mb-4 text-white/60" />
            <div className="display text-3xl">{t('totem.offline')}</div>
            <p className="mt-2 text-white/60">{error}</p>
          </div>
        ) : (
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
        )}
      </Screen>
    )
  }

  const sector = data.sectors.find((s) => s.id === sectorId)
  const { settings } = data
  const org = settings.org_name
  const accent = sector?.color ?? settings.brand_color
  const qrUrl = issued?.qrPath ? `${location.origin}${issued.qrPath}` : null

  return (
    <div className="relative flex h-full select-none flex-col overflow-hidden bg-night text-white">
      <div className="pointer-events-none absolute inset-0 opacity-60" style={{ background: `radial-gradient(ellipse at 15% -10%, ${accent}55, transparent 55%), radial-gradient(ellipse at 100% 110%, ${accent}33, transparent 50%)` }} />
      {/* Zona secreta: 5 toques en la esquina abren la configuración */}
      <div className="absolute left-0 top-0 z-30 h-20 w-20" onPointerDown={corner} aria-hidden />

      <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 px-6 py-5 sm:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <Logo version={data.logoVersion} className="h-14 w-14" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium uppercase tracking-[0.18em] text-white/55">{org}</div>
            <div className="display truncate text-3xl font-semibold">{sector?.name || t('totem.chooseSector')}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          {!connected && (
            <span className="flex items-center gap-2 rounded-full bg-red-500/20 px-3 py-1.5 text-sm text-red-100">
              <WifiOff size={16} /> {t('totem.offline')}
            </span>
          )}
          <LanguagePills />
          <div className="text-right">
            <div className="num text-4xl leading-none">{clock(now)}</div>
            <div className="mt-1 hidden text-sm text-white/55 first-letter:uppercase md:block">{longDate(now)}</div>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {fail && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="relative z-10 mx-8 mb-2 rounded-2xl bg-red-500/25 px-5 py-4 text-center text-lg text-red-50" role="alert">
            {fail}
          </motion.div>
        )}
      </AnimatePresence>

      {!sector && (
        <div className="relative z-10 grid flex-1 content-start gap-4 overflow-auto p-8 sm:grid-cols-2">
          {data.sectors.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                store.set(KEY, String(s.id))
                setSectorId(s.id)
              }}
              className="flex min-h-32 items-center rounded-3xl p-7 text-left text-3xl font-semibold shadow-xl transition active:scale-[0.98]"
              style={{ background: s.color, color: textOn(s.color) }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {sector && (
        <div className="relative z-10 flex flex-1 flex-col overflow-auto px-8 pb-8">
          <p className="mb-6 text-2xl text-white/80">{sector.welcomeMessage || t('totem.takeTicket')}</p>
          {sector.buttons.length === 0 ? (
            <p className="text-xl text-white/60">{t('totem.noButtons')}</p>
          ) : (
            <div className={`grid flex-1 auto-rows-fr gap-5 ${sector.buttons.length === 1 ? '' : sector.buttons.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3'}`}>
              {sector.buttons.map((b, i) => (
                <motion.button
                  key={b.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => choose(b)}
                  disabled={busy}
                  className="group relative flex min-h-52 flex-col justify-between overflow-hidden rounded-[2rem] p-8 text-left shadow-2xl ring-1 ring-white/10 transition-transform active:scale-[0.97] disabled:opacity-60"
                  style={{ background: `linear-gradient(145deg, ${b.color}, color-mix(in srgb, ${b.color} 78%, black))`, color: textOn(b.color) }}
                >
                  <div className="flex items-start justify-between">
                    <span className="grid h-16 w-16 place-items-center rounded-2xl bg-white/20">
                      <ButtonIcon name={b.icon} size={34} />
                    </span>
                    {b.priorityName && <span className="rounded-full bg-black/20 px-3 py-1 text-sm font-semibold">{b.priorityName}</span>}
                  </div>
                  <div>
                    <span className="display block text-4xl font-semibold leading-tight">{b.label}</span>
                    {b.subtitle && <span className="mt-2 block text-xl opacity-85">{b.subtitle}</span>}
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Generando el turno */}
      <AnimatePresence>
        {busy && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 grid place-items-center bg-night/85 backdrop-blur-sm">
            <div className="text-center">
              <div className="mx-auto h-16 w-16 animate-spin rounded-full border-[6px] border-white/15 border-t-white" />
              <div className="display mt-6 text-3xl">{t('totem.issuing')}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Teclado para el documento */}
      {dniFor && <DniPad btn={dniFor} onCancel={() => setDniFor(null)} onSubmit={(dni) => issue(dniFor, dni)} />}

      {/* Turno emitido */}
      <AnimatePresence>
        {issued && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-night/92 p-6">
            <motion.div initial={{ scale: 0.9, y: 30 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 180, damping: 18 }} className="w-full max-w-2xl overflow-hidden rounded-[2rem] bg-white text-night shadow-2xl">
              <div className="px-10 pb-10 pt-8" style={{ background: issued.color, color: textOn(issued.color) }}>
                <div className="flex items-center justify-between text-base font-medium uppercase tracking-[0.16em] opacity-80">
                  <span>{t('totem.yourTicket')}</span>
                  {issued.priorityName && <span className="rounded-full bg-black/20 px-3 py-1 normal-case tracking-normal">{issued.priorityName}</span>}
                </div>
                <div className="num mt-2 text-[clamp(6rem,20vw,11rem)] leading-[0.9]">{issued.code}</div>
                <div className="display mt-2 text-3xl">{issued.label}</div>
                <div className="mt-1 text-lg opacity-80">{issued.sectorName}</div>
              </div>
              <div className="flex flex-col gap-6 px-10 py-8 sm:flex-row sm:items-center">
                <div className="flex-1 space-y-2">
                  <p className="display text-3xl font-semibold">
                    {issued.waitingAhead === 0 ? t('totem.next') : issued.waitingAhead === 1 ? t('totem.aheadOne') : t('totem.aheadMany', { n: issued.waitingAhead })}
                  </p>
                  {issued.estimatedWaitMin != null && issued.waitingAhead > 0 && <p className="text-xl text-slate-600">{t('totem.estimated', { n: issued.estimatedWaitMin })}</p>}
                  <p className="text-lg text-slate-500">{t('totem.wait')}</p>
                  {settings.totem_auto_print && (
                    <p className="flex items-center gap-2 pt-1 text-base text-slate-500">
                      <Printer size={18} /> {t('totem.printing')}
                    </p>
                  )}
                </div>
                {qrUrl && (
                  <div className="flex flex-col items-center gap-2 text-center">
                    <QR value={qrUrl} size={150} className="rounded-xl ring-1 ring-slate-200" />
                    <span className="max-w-[11rem] text-sm text-slate-500">{t('totem.scanQr')}</span>
                  </div>
                )}
              </div>
              <div className="flex gap-3 px-10 pb-8">
                <Button size="xl" variant="soft" className="!border-slate-200 !bg-white !text-night" onClick={reprint}>
                  <Printer size={20} /> {t('totem.reprint')}
                </Button>
                <Button
                  size="xl"
                  className="flex-1 !bg-night !text-white"
                  onClick={() => {
                    setIssued(null)
                    defaultLang()
                  }}
                >
                  {t('totem.done')}
                </Button>
              </div>
              <div className="h-2 bg-slate-100">
                <div className="h-full" style={{ background: issued.color, animation: `shrink ${settings.totem_return_seconds}s linear forwards` }} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {issued && (
        <div id="print-area" aria-hidden="true">
          {data.logoVersion && <img src={`/api/public/logo?v=${encodeURIComponent(data.logoVersion)}`} alt="" style={{ maxHeight: 48, maxWidth: '60%', margin: '0 auto 4px', display: 'block' }} />}
          <div style={{ fontSize: 15, fontWeight: 700 }}>{org}</div>
          <div style={{ fontSize: 13, marginTop: 2 }}>{issued.sectorName}</div>
          <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>{t('totem.yourTicket')}</div>
          <div style={{ fontSize: 66, fontWeight: 800, lineHeight: 1, margin: '4px 0', letterSpacing: -1 }}>{issued.code}</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{issued.label}</div>
          {issued.priorityName && <div style={{ fontSize: 12, marginTop: 2 }}>{t('totem.priority')}: {issued.priorityName}</div>}
          <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />
          <div style={{ fontSize: 12 }}>
            {issued.waitingAhead === 0 ? t('totem.next') : issued.waitingAhead === 1 ? t('totem.aheadOne') : t('totem.aheadMany', { n: issued.waitingAhead })}
          </div>
          {issued.estimatedWaitMin != null && issued.waitingAhead > 0 && <div style={{ fontSize: 12 }}>{t('totem.estimated', { n: issued.estimatedWaitMin })}</div>}
          {qrUrl && (
            <div style={{ marginTop: 8 }}>
              <QR value={qrUrl} size={110} className="mx-auto" />
              <div style={{ fontSize: 10, marginTop: 2 }}>{t('totem.scanQr')}</div>
            </div>
          )}
          <div style={{ fontSize: 11, marginTop: 8 }}>{new Date(issued.createdAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</div>
          <div style={{ fontSize: 11, marginTop: 6 }}>{settings.ticket_footer}</div>
        </div>
      )}

      {/* Pantalla de reposo */}
      <AnimatePresence>
        {idle && !issued && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="fixed inset-0 z-[45] flex flex-col items-center justify-center gap-8 bg-night text-white"
            aria-label={t('totem.touchToStart')}
          >
            <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 50% 40%, ${accent}40, transparent 60%)` }} />
            <div className="float-soft relative flex flex-col items-center gap-6">
              <Logo version={data.logoVersion} className="h-28 w-28" rounded="rounded-3xl" />
              <div className="display text-center text-5xl font-semibold">{org}</div>
              {sector && <div className="text-2xl text-white/70">{sector.name}</div>}
            </div>
            <div className="num relative text-7xl">{clock(now)}</div>
            <div className="pulse-dot relative rounded-full bg-white/10 px-8 py-4 text-2xl">{t('totem.touchToStart')}</div>
          </motion.button>
        )}
      </AnimatePresence>

      {pinOpen && !lockedByStation && (
        <PinDialog
          onClose={() => setPinOpen(false)}
          onOk={() => {
            store.del(KEY)
            setSectorId(null)
            setPinOpen(false)
          }}
        />
      )}
      {!lockedByStation && sector && (
        <button onClick={() => setPinOpen(true)} className="absolute bottom-3 right-3 z-20 rounded-full p-2 text-white/15 hover:text-white/50" aria-label={t('totem.changeSector')}>
          <Settings2 size={18} />
        </button>
      )}
    </div>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center bg-night p-8 text-white">{children}</div>
}

/** Teclado numérico en pantalla: el tótem táctil no tiene teclado físico. */
function DniPad({ btn, onCancel, onSubmit }: { btn: PubBtn; onCancel: () => void; onSubmit: (dni: string) => void }) {
  const { t } = useTranslation()
  const [v, setV] = useState('')
  const press = (d: string) => setV((x) => (x.length < 10 ? x + d : x))
  const fmt = v.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-night/90 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[2rem] bg-white p-7 text-night shadow-2xl">
        <div className="mb-1 text-base font-medium" style={{ color: btn.color }}>{btn.label}</div>
        <h2 className="display text-2xl font-semibold">{t('totem.dniLabel')}</h2>
        <div className="num mt-5 flex h-20 items-center justify-center rounded-2xl bg-slate-100 text-5xl tracking-wider" aria-live="polite">
          {fmt || <span className="text-3xl font-normal text-slate-400">—</span>}
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} onClick={() => press(d)} className="num h-20 rounded-2xl bg-slate-100 text-4xl active:scale-95 active:bg-slate-200">
              {d}
            </button>
          ))}
          <button onClick={() => setV('')} className="h-20 rounded-2xl bg-slate-100 text-lg font-semibold text-slate-600 active:scale-95">
            {t('totem.clear')}
          </button>
          <button onClick={() => press('0')} className="num h-20 rounded-2xl bg-slate-100 text-4xl active:scale-95 active:bg-slate-200">
            0
          </button>
          <button onClick={() => setV((x) => x.slice(0, -1))} className="grid h-20 place-items-center rounded-2xl bg-slate-100 text-slate-600 active:scale-95" aria-label={t('totem.clear')}>
            <Delete size={30} />
          </button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={() => onSubmit('')} className="h-16 rounded-2xl border border-slate-200 text-lg font-semibold text-slate-700">
            {t('totem.dniSkip')}
          </button>
          <button onClick={() => onSubmit(v)} disabled={v.length < 6} className="h-16 rounded-2xl text-lg font-semibold text-white disabled:opacity-40" style={{ background: btn.color, color: textOn(btn.color) }}>
            {t('totem.dniContinue')}
          </button>
        </div>
        <button onClick={onCancel} className="mt-4 w-full py-2 text-base text-slate-500">
          {t('totem.back')}
        </button>
      </div>
    </div>
  )
}

function PinDialog({ onClose, onOk }: { onClose: () => void; onOk: () => void }) {
  const { t } = useTranslation()
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const submit = async () => {
    try {
      const r = await api<{ ok: boolean }>('/api/public/totem-pin', { body: { pin } })
      if (r.ok) onOk()
      else {
        setErr(t('totem.pinWrong'))
        setPin('')
      }
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-night/85 p-6" onPointerDown={onClose}>
      <div className="w-full max-w-sm space-y-4 rounded-3xl bg-white p-7 text-night" onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="display text-2xl font-semibold">{t('totem.pinTitle')}</h2>
        <p className="text-sm text-slate-500">{t('totem.pinHint')}</p>
        <input
          className={`${inputCls} !bg-white !text-night text-center text-3xl tracking-[0.5em]`}
          type="password"
          inputMode="numeric"
          autoFocus
          maxLength={8}
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, ''))
            setErr('')
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          aria-label="PIN"
        />
        {err && (
          <p className="text-sm text-red-600" role="alert">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="soft" className="!bg-white !text-night" onClick={onClose}>
            {t('app.cancel')}
          </Button>
          <Button onClick={submit} disabled={pin.length < 4}>
            {t('totem.changeSector')}
          </Button>
        </div>
      </div>
    </div>
  )
}
