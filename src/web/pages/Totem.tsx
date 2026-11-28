import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, IdCard, Printer, Settings2, ShieldCheck, UserRoundPlus, WifiOff } from 'lucide-react'
import { api, ApiError, type Settings } from '../lib/api'
import { clock, longDate, textOn } from '../lib/format'
import { useIdle, useLive, useNow } from '../lib/live'
import { isLang, setAppLanguage } from '../i18n'
import { LanguagePills } from '../components/LanguageSwitcher'
import { ButtonIcon } from '../components/Icons'
import { Logo } from '../components/Brand'
import { AlphaKeyboard, NumPad } from '../components/Keyboards'
import { Button, QR, inputCls } from '../ui'

interface PubBtn { id: number; label: string; subtitle: string | null; color: string; icon: string | null; priorityName: string | null }
interface PubSector { id: number; name: string; color: string; welcomeMessage: string | null; buttons: PubBtn[] }
type PubSettings = Omit<Settings, 'totem_pin'>
interface PubData { sectors: PubSector[]; settings: PubSettings; logoVersion: string | null }
interface Issued { id: number; code: string; label: string; sectorName: string; color: string; priorityName: string | null; waitingAhead: number; estimatedWaitMin: number | null; qrPath: string | null; createdAt: string; patientName: string | null }
interface StationInfo { id: number; kind: string; name: string; sectorId: number | null; sectorName: string | null; lang: string | null }
type Patient = { document: string; greeting: string | null; firstName?: string; lastName?: string } | null
type Step = 'id' | 'register' | 'buttons'

const KEY = 'celtto.totem.sector'
const DEVICE_KEY = 'celtto.totem.device'
const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sin almacenamiento */ } },
  del: (k: string) => { try { localStorage.removeItem(k) } catch { /* sin almacenamiento */ } },
}
function localDeviceKey() {
  let k = store.get(DEVICE_KEY)
  if (!k) {
    k = `totem_${crypto.getRandomValues(new Uint32Array(2)).join('')}`
    store.set(DEVICE_KEY, k)
  }
  return k
}
const fmtDoc = (d: string) => (/^\d+$/.test(d) ? d.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : d)
const slide = {
  initial: { opacity: 0, x: 60, filter: 'blur(4px)' },
  animate: { opacity: 1, x: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, x: -60, filter: 'blur(4px)' },
  transition: { type: 'spring' as const, stiffness: 260, damping: 28 },
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
  const [step, setStep] = useState<Step>('id')
  const [patient, setPatient] = useState<Patient>(null)
  const taps = useRef<number[]>([])
  const lockedByStation = Boolean(stationKey && station?.sectorId)
  const mode = data?.settings.totem_patient_mode ?? 'required'
  const idle = useIdle((data?.settings.totem_idle_seconds ?? 60) * 1000, Boolean(data?.settings.totem_idle_enabled) && !issued && !pinOpen)

  const defaultLang = useCallback(() => setAppLanguage(isLang(station?.lang) ? station!.lang! : 'es', false), [station])
  const reset = useCallback(() => {
    setPatient(null)
    setStep('id')
    setIssued(null)
    setFail('')
    defaultLang()
  }, [defaultLang])

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

  useEffect(() => { void load(); const id = setInterval(load, 5 * 60_000); return () => clearInterval(id) }, [load])
  useEffect(() => { void loadStation(); const id = setInterval(loadStation, 120_000); return () => clearInterval(id) }, [loadStation])
  useEffect(() => { if (station?.lang) defaultLang() }, [station?.lang, defaultLang])
  useEffect(() => { if (idle) reset() }, [idle, reset])
  // Sin identificación configurada, se va directo a los botones
  useEffect(() => { if (mode === 'off' && step === 'id') setStep('buttons') }, [mode, step])

  const connected = useLive((m) => {
    if (m.type === 'config') { void load(); void loadStation() }
  })

  useEffect(() => {
    if (!issued || !data) return
    const id = setTimeout(reset, data.settings.totem_return_seconds * 1000)
    return () => clearTimeout(id)
  }, [issued, data, reset])

  const corner = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (lockedByStation) return
    const ts = Date.now()
    taps.current = [...taps.current.filter((x) => ts - x < 3000), ts]
    if (taps.current.length >= 5) { taps.current = []; setPinOpen(true) }
  }

  const showFail = (msg: string) => {
    setFail(msg)
    setTimeout(() => setFail(''), 6000)
  }

  const identify = async (document: string) => {
    setBusy(true)
    try {
      const r = await api<{ found: boolean; greeting?: string }>('/api/public/patients/lookup', { body: { document, deviceKey: stationKey || localDeviceKey() } })
      if (r.found) {
        setPatient({ document, greeting: r.greeting ?? null })
        setStep('buttons')
      } else {
        setPatient({ document, greeting: null })
        setStep('register')
      }
    } catch (e) {
      showFail((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const issue = async (b: PubBtn) => {
    if (busy) return
    setBusy(true)
    setFail('')
    try {
      const deviceKey = stationKey || localDeviceKey()
      const body: Record<string, unknown> = { buttonId: b.id, deviceKey }
      if (patient) body.patient = { document: patient.document, firstName: patient.firstName, lastName: patient.lastName }
      const tk = await api<Issued>('/api/public/tickets', { body })
      setIssued(tk)
      if (data?.settings.totem_auto_print) setTimeout(() => window.print(), 400)
    } catch (e) {
      if (e instanceof ApiError && e.message === 'patient_not_found') setStep('register')
      else showFail((e as Error).message || t('totem.errorIssue'))
      void load()
    } finally {
      setBusy(false)
    }
  }
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
  const stepIdx = step === 'id' || step === 'register' ? 0 : 1

  return (
    <div className="relative flex h-full select-none flex-col overflow-clip bg-night text-white">
      {/* Fondo animado */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div animate={{ scale: [1, 1.15, 1], x: [0, 30, 0] }} transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }} className="absolute -left-40 -top-40 h-[42rem] w-[42rem] rounded-full blur-3xl" style={{ background: `${accent}40` }} />
        <motion.div animate={{ scale: [1.1, 1, 1.1], y: [0, -30, 0] }} transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }} className="absolute -bottom-48 -right-40 h-[38rem] w-[38rem] rounded-full blur-3xl" style={{ background: `${accent}2a` }} />
        <div className="absolute inset-0 opacity-[0.04] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:44px_44px]" />
      </div>
      <div className="absolute left-0 top-0 z-30 h-20 w-20" onPointerDown={corner} aria-hidden />

      <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 px-6 py-5 sm:px-10">
        <div className="flex min-w-0 items-center gap-4">
          <Logo version={data.logoVersion} className="h-14 w-14" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium uppercase tracking-[0.2em] text-white/55">{org}</div>
            <div className="display truncate text-3xl font-semibold">{sector?.name || t('totem.chooseSector')}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          {!connected && (
            <span className="flex items-center gap-2 rounded-full bg-red-500/20 px-3 py-1.5 text-sm text-red-100"><WifiOff size={16} /> {t('totem.offline')}</span>
          )}
          <LanguagePills />
          <div className="text-right">
            <div className="num text-4xl leading-none">{clock(now)}</div>
            <div className="mt-1 hidden text-sm text-white/55 first-letter:uppercase md:block">{longDate(now)}</div>
          </div>
        </div>
      </header>

      {sector && mode !== 'off' && (
        <div className="relative z-10 mx-auto mb-2 flex items-center gap-3 text-sm font-medium">
          {[t('flow.step1'), t('flow.step2'), t('flow.step3')].map((l, i) => (
            <div key={l} className="flex items-center gap-3">
              <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 transition ${i === stepIdx ? 'bg-white text-night' : i < stepIdx ? 'bg-white/15 text-white' : 'bg-white/5 text-white/45'}`}>
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${i === stepIdx ? 'bg-night text-white' : 'bg-white/15'}`}>{i < stepIdx ? <Check size={12} /> : i + 1}</span>
                {l}
              </div>
              {i < 2 && <span className="h-px w-8 bg-white/15" />}
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {fail && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="relative z-20 mx-auto mb-2 w-full max-w-2xl rounded-2xl bg-red-500/25 px-5 py-4 text-center text-lg text-red-50 ring-1 ring-red-400/30" role="alert">
            {fail}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-x-clip">
        <AnimatePresence mode="wait">
          {!sector ? (
            <motion.div key="sectors" {...slide} className="grid min-h-0 flex-1 content-start gap-4 overflow-auto p-8 sm:grid-cols-2">
              {data.sectors.map((s) => (
                <button key={s.id} onClick={() => { store.set(KEY, String(s.id)); setSectorId(s.id) }} className="flex min-h-32 items-center rounded-3xl p-7 text-left text-3xl font-semibold shadow-xl transition active:scale-[0.98]" style={{ background: s.color, color: textOn(s.color) }}>
                  {s.name}
                </button>
              ))}
            </motion.div>
          ) : step === 'id' && mode !== 'off' ? (
            <motion.div key="id" {...slide} className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
              <DocumentStep accent={accent} busy={busy} optional={mode === 'optional'} onSubmit={identify} onSkip={() => { setPatient(null); setStep('buttons') }} />
            </motion.div>
          ) : step === 'register' && patient ? (
            <motion.div key="register" {...slide} className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-6">
              <RegisterStep accent={accent} document={patient.document} onBack={() => setStep('id')} onSubmit={(firstName, lastName) => { setPatient({ document: patient.document, greeting: firstName.split(' ')[0], firstName, lastName }); setStep('buttons') }} />
            </motion.div>
          ) : (
            <motion.div key="buttons" {...slide} className="flex min-h-0 flex-1 flex-col overflow-auto px-6 pb-8 sm:px-10">
              <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                  {patient?.greeting && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="display text-4xl font-semibold">{t('flow.hello', { name: patient.greeting })}</motion.div>}
                  <p className="mt-1 text-2xl text-white/75">{patient ? t('flow.choose') : sector.welcomeMessage || t('totem.takeTicket')}</p>
                </div>
                {mode !== 'off' && (
                  <button onClick={reset} className="flex items-center gap-2 rounded-full bg-white/10 px-5 py-3 text-lg text-white/80 ring-1 ring-white/10 active:scale-95">
                    <ArrowLeft size={20} /> {patient ? t('flow.notYou') : t('totem.back')}
                  </button>
                )}
              </div>
              {sector.buttons.length === 0 ? (
                <p className="text-xl text-white/60">{t('totem.noButtons')}</p>
              ) : (
                <div className={`grid flex-1 auto-rows-fr gap-5 ${sector.buttons.length === 1 ? '' : sector.buttons.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3'}`}>
                  {sector.buttons.map((b, i) => (
                    <motion.button
                      key={b.id}
                      initial={{ opacity: 0, y: 24, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ delay: 0.05 + i * 0.06, type: 'spring', stiffness: 220, damping: 22 }}
                      whileTap={{ scale: 0.96 }}
                      onClick={() => issue(b)}
                      disabled={busy}
                      className="group relative flex min-h-52 flex-col justify-between overflow-hidden rounded-[2rem] p-8 text-left shadow-2xl ring-1 ring-white/15 disabled:opacity-60"
                      style={{ background: `linear-gradient(150deg, ${b.color} 0%, color-mix(in srgb, ${b.color} 72%, black) 100%)`, color: textOn(b.color) }}
                    >
                      <span className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl transition group-hover:bg-white/20" />
                      <div className="flex items-start justify-between">
                        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/25 backdrop-blur-sm"><ButtonIcon name={b.icon} size={34} /></span>
                        {b.priorityName && <span className="rounded-full bg-black/20 px-3 py-1 text-sm font-semibold">{b.priorityName}</span>}
                      </div>
                      <div className="flex items-end justify-between gap-4">
                        <div>
                          <span className="display block text-4xl font-semibold leading-tight">{b.label}</span>
                          {b.subtitle && <span className="mt-2 block text-xl opacity-85">{b.subtitle}</span>}
                        </div>
                        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white/15 transition group-active:translate-x-1"><ArrowRight size={26} /></span>
                      </div>
                    </motion.button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {busy && step === 'buttons' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 grid place-items-center bg-night/85 backdrop-blur-sm">
            <div className="text-center">
              <div className="mx-auto h-16 w-16 animate-spin rounded-full border-[6px] border-white/15 border-t-white" />
              <div className="display mt-6 text-3xl">{t('totem.issuing')}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {issued && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-night/92 p-6 backdrop-blur-md">
            <motion.div initial={{ scale: 0.85, y: 40, rotateX: 12 }} animate={{ scale: 1, y: 0, rotateX: 0 }} transition={{ type: 'spring', stiffness: 170, damping: 18 }} className="w-full max-w-2xl overflow-hidden rounded-[2rem] bg-white text-night shadow-2xl">
              <div className="relative overflow-hidden px-10 pb-10 pt-8" style={{ background: `linear-gradient(140deg, ${issued.color}, color-mix(in srgb, ${issued.color} 70%, black))`, color: textOn(issued.color) }}>
                <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
                <div className="flex items-center justify-between text-base font-medium uppercase tracking-[0.16em] opacity-85">
                  <span>{issued.patientName ? t('flow.hello', { name: issued.patientName }) : t('totem.yourTicket')}</span>
                  {issued.priorityName && <span className="rounded-full bg-black/20 px-3 py-1 normal-case tracking-normal">{issued.priorityName}</span>}
                </div>
                <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.15, type: 'spring', stiffness: 200, damping: 14 }} className="num mt-2 text-[clamp(6rem,20vw,11rem)] leading-[0.9]">
                  {issued.code}
                </motion.div>
                <div className="display mt-2 text-3xl">{issued.label}</div>
                <div className="mt-1 text-lg opacity-85">{issued.sectorName}</div>
              </div>
              <div className="flex flex-col gap-6 px-10 py-8 sm:flex-row sm:items-center">
                <div className="flex-1 space-y-2">
                  <p className="display text-3xl font-semibold">{issued.waitingAhead === 0 ? t('totem.next') : issued.waitingAhead === 1 ? t('totem.aheadOne') : t('totem.aheadMany', { n: issued.waitingAhead })}</p>
                  {issued.estimatedWaitMin != null && issued.waitingAhead > 0 && <p className="text-xl text-slate-600">{t('totem.estimated', { n: issued.estimatedWaitMin })}</p>}
                  <p className="text-lg text-slate-500">{t('totem.wait')}</p>
                  {settings.totem_auto_print && <p className="flex items-center gap-2 pt-1 text-base text-slate-500"><Printer size={18} /> {t('totem.printing')}</p>}
                </div>
                {qrUrl && (
                  <div className="flex flex-col items-center gap-2 text-center">
                    <QR value={qrUrl} size={150} className="rounded-xl ring-1 ring-slate-200" />
                    <span className="max-w-[11rem] text-sm text-slate-500">{t('totem.scanQr')}</span>
                  </div>
                )}
              </div>
              <div className="flex gap-3 px-10 pb-8">
                <Button size="xl" variant="soft" className="!border-slate-200 !bg-white !text-night" onClick={reprint}><Printer size={20} /> {t('totem.reprint')}</Button>
                <Button size="xl" className="flex-1 !bg-night !text-white" onClick={reset}>{t('totem.done')}</Button>
              </div>
              <div className="h-2 bg-slate-100"><div className="h-full" style={{ background: issued.color, animation: `shrink ${settings.totem_return_seconds}s linear forwards` }} /></div>
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
          {issued.patientName && <div style={{ fontSize: 13, marginTop: 2 }}>{issued.patientName}</div>}
          {issued.priorityName && <div style={{ fontSize: 12, marginTop: 2 }}>{t('totem.priority')}: {issued.priorityName}</div>}
          <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />
          <div style={{ fontSize: 12 }}>{issued.waitingAhead === 0 ? t('totem.next') : issued.waitingAhead === 1 ? t('totem.aheadOne') : t('totem.aheadMany', { n: issued.waitingAhead })}</div>
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

      <AnimatePresence>
        {idle && !issued && (
          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }} className="fixed inset-0 z-[45] flex flex-col items-center justify-center gap-8 overflow-hidden bg-night text-white" aria-label={t('totem.touchToStart')}>
            <div className="spin-slow pointer-events-none absolute h-[70rem] w-[70rem] rounded-full opacity-40" style={{ background: `conic-gradient(from 0deg, transparent, ${accent}55, transparent 40%)` }} />
            <div className="float-soft relative flex flex-col items-center gap-6">
              <Logo version={data.logoVersion} className="h-28 w-28" rounded="rounded-3xl" />
              <div className="display text-center text-5xl font-semibold">{org}</div>
              {sector && <div className="text-2xl text-white/70">{sector.name}</div>}
            </div>
            <div className="num relative text-7xl">{clock(now)}</div>
            <div className="pulse-dot relative flex items-center gap-3 rounded-full bg-white/10 px-8 py-4 text-2xl ring-1 ring-white/15">
              <IdCard size={26} /> {mode === 'off' ? t('totem.touchToStart') : t('id.title')}
            </div>
          </motion.button>
        )}
      </AnimatePresence>

      {pinOpen && !lockedByStation && (
        <PinDialog onClose={() => setPinOpen(false)} onOk={() => { store.del(KEY); setSectorId(null); setPinOpen(false); reset() }} />
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

/** Paso 1: el paciente ingresa su documento con el teclado en pantalla. */
function DocumentStep({ accent, busy, optional, onSubmit, onSkip }: { accent: string; busy: boolean; optional: boolean; onSubmit: (d: string) => void; onSkip: () => void }) {
  const { t } = useTranslation()
  const [v, setV] = useState('')
  const [err, setErr] = useState('')
  const submit = () => {
    if (!/^\d{6,15}$/.test(v)) return setErr(t('id.invalid'))
    onSubmit(v)
  }
  return (
    <div className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1fr_26rem]">
      <div>
        <div className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-2xl ring-1 ring-white/20" style={{ background: `${accent}33` }}>
          <IdCard size={32} />
        </div>
        <h1 className="display text-5xl font-semibold leading-tight">{t('id.title')}</h1>
        <p className="mt-4 max-w-md text-xl text-white/65">{t('id.subtitle')}</p>
        <motion.div key={v.length} initial={{ scale: 0.98 }} animate={{ scale: 1 }} className={`num mt-8 flex h-24 items-center rounded-3xl bg-white/[0.06] px-7 text-6xl tracking-wide ring-2 ${err ? 'ring-red-400/70' : 'ring-white/15'}`} aria-live="polite">
          {v ? fmtDoc(v) : <span className="text-3xl font-normal text-white/30">— — — — — — — —</span>}
          <span className="ml-1 h-12 w-[3px] animate-pulse rounded bg-white/70" />
        </motion.div>
        {err && <p className="mt-3 text-lg text-red-300">{err}</p>}
        <p className="mt-4 flex items-center gap-2 text-sm text-white/45"><ShieldCheck size={16} /> {t('reg.privacy')}</p>
      </div>
      <div className="space-y-3">
        <NumPad onKey={(d) => { setErr(''); setV((x) => (x.length < 15 ? x + d : x)) }} onDelete={() => setV((x) => x.slice(0, -1))} onClear={() => setV('')} />
        <button onClick={submit} disabled={busy || v.length < 6} className="flex h-20 w-full items-center justify-center gap-3 rounded-2xl text-2xl font-semibold shadow-xl transition active:scale-[0.98] disabled:opacity-40" style={{ background: accent, color: textOn(accent) }}>
          {busy ? t('id.checking') : t('id.continue')} {!busy && <ArrowRight size={26} />}
        </button>
        {optional && (
          <button onClick={onSkip} className="h-14 w-full rounded-2xl text-lg text-white/70 ring-1 ring-white/15 active:scale-[0.98]">{t('id.skip')}</button>
        )}
      </div>
    </div>
  )
}

/** Paso 1b: alta del paciente nuevo con teclado alfabético en pantalla. */
function RegisterStep({ accent, document, onBack, onSubmit }: { accent: string; document: string; onBack: () => void; onSubmit: (first: string, last: string) => void }) {
  const { t } = useTranslation()
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [field, setField] = useState<'first' | 'last'>('first')
  const set = field === 'first' ? setFirst : setLast
  const ok = first.trim().length >= 2 && last.trim().length >= 2
  const cap = (s: string) => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
  const Input = ({ id, label, value }: { id: 'first' | 'last'; label: string; value: string }) => (
    <button type="button" onClick={() => setField(id)} className={`w-full rounded-2xl px-5 py-3 text-left transition ${field === id ? 'bg-white/[0.1] ring-2' : 'bg-white/[0.05] ring-1 ring-white/10'}`} style={field === id ? { boxShadow: `0 0 0 2px ${accent}` } : undefined}>
      <div className="text-sm text-white/55">{label}</div>
      <div className="flex h-10 items-center text-3xl font-semibold">
        {cap(value)}
        {field === id && <span className="ml-0.5 h-8 w-[3px] animate-pulse rounded bg-white/80" />}
      </div>
    </button>
  )
  return (
    <div className="w-full max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl ring-1 ring-white/20" style={{ background: `${accent}33` }}><UserRoundPlus size={28} /></span>
          <div>
            <h1 className="display text-4xl font-semibold">{t('reg.title')}</h1>
            <p className="mt-1 max-w-xl text-lg text-white/65">{t('reg.subtitle')}</p>
          </div>
        </div>
        <button onClick={onBack} className="flex shrink-0 items-center gap-2 rounded-full bg-white/10 px-5 py-3 text-lg text-white/80 active:scale-95"><ArrowLeft size={20} /> {t('totem.back')}</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_14rem]">
        <Input id="first" label={t('reg.firstName')} value={first} />
        <Input id="last" label={t('reg.lastName')} value={last} />
        <div className="rounded-2xl bg-white/[0.04] px-5 py-3 ring-1 ring-white/10">
          <div className="text-sm text-white/55">{t('reg.document')}</div>
          <div className="num flex h-10 items-center text-3xl">{fmtDoc(document)}</div>
        </div>
      </div>
      <div className="mt-5">
        <AlphaKeyboard onKey={(c) => set((x) => (x.length < 60 && !(c === ' ' && (x.endsWith(' ') || !x)) ? x + c : x))} onDelete={() => set((x) => x.slice(0, -1))} />
      </div>
      <div className="mt-5 flex gap-3">
        {field === 'first' && first.trim().length >= 2 && !last && (
          <button onClick={() => setField('last')} className="h-16 flex-1 rounded-2xl text-xl font-semibold ring-1 ring-white/20 active:scale-[0.98]">{t('reg.lastName')} <ArrowRight className="ml-2 inline" size={22} /></button>
        )}
        <button onClick={() => onSubmit(cap(first.trim()), cap(last.trim()))} disabled={!ok} className="flex h-16 flex-[2] items-center justify-center gap-3 rounded-2xl text-xl font-semibold shadow-xl transition active:scale-[0.98] disabled:opacity-40" style={{ background: accent, color: textOn(accent) }}>
          <Check size={24} /> {t('reg.save')}
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
      else { setErr(t('totem.pinWrong')); setPin('') }
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-night/85 p-6" onPointerDown={onClose}>
      <div className="w-full max-w-sm space-y-4 rounded-3xl bg-white p-7 text-night" onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="display text-2xl font-semibold">{t('totem.pinTitle')}</h2>
        <p className="text-sm text-slate-500">{t('totem.pinHint')}</p>
        <input className={`${inputCls} !bg-white !text-night text-center text-3xl tracking-[0.5em]`} type="password" inputMode="numeric" autoFocus maxLength={8} value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setErr('') }} onKeyDown={(e) => e.key === 'Enter' && submit()} aria-label="PIN" />
        {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="soft" className="!bg-white !text-night" onClick={onClose}>{t('app.cancel')}</Button>
          <Button onClick={submit} disabled={pin.length < 4}>{t('totem.changeSector')}</Button>
        </div>
      </div>
    </div>
  )
}
